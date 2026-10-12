import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, SourceTextModule } from 'node:vm';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const gameData = JSON.parse(await readFile(resolve(root, 'dist/data/game-data.json'), 'utf8'));
export const sample = JSON.parse(await readFile(resolve(root, 'data/examples/public-example-2026-09-28.json'), 'utf8'));

/** Real source modules, with counters inserted only in the test's VM copies. */
export async function createRuntime({ dom, sourceReader, instrument = true } = {}) {
  const counts = {};
  const globals = { console, structuredClone, URL, URLSearchParams, Intl, Error, RangeError, TypeError,
    TextEncoder, TextDecoder, btoa, atob,
    setTimeout, clearTimeout, queueMicrotask,
    __count: name => { counts[name] = (counts[name] ?? 0) + 1; } };
  if (dom) {
    for (const name of ['window', 'document', 'location', 'localStorage', 'navigator', 'HTMLElement',
      'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLDetailsElement', 'Element',
      'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'File', 'Blob']) globals[name] = dom.window[name];
    globals.requestAnimationFrame = callback => setTimeout(callback, 0);
    globals.cancelAnimationFrame = clearTimeout;
    globals.fetch = async url => {
      if (!String(url).includes('/data/game-data.json')) throw new Error(`Unexpected request: ${url}`);
      return { ok: true, json: async () => structuredClone(gameData) };
    };
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  const context = createContext(globals);
  const modules = new Map();
  async function getModule(path) {
    if (modules.has(path)) return modules.get(path);
    let source = sourceReader ? await sourceReader(relative(root, path).replaceAll('\\', '/')) : await readFile(path, 'utf8');
    source = stripTypeScriptTypes(source);
    const file = relative(root, path).replaceAll('\\', '/');
    if (instrument) {
      const names = file === 'calculation/attribute-aggregation.ts' ? ['aggregateCharacterAttributes', 'prepareCharacterAttributeInput']
        : file === 'frontend/projection.ts' ? ['projectAttributes', 'resolveLoadoutSources', 'projectDamage', 'projectCombatRates', 'evaluateLoadout']
        : file === 'calculation/loadout-engine.ts' ? ['calculateLoadout', 'calculateLoadoutCombatRates', 'prepareLoadoutAttributes', 'evaluatePreparedLoadout']
        : file === 'frontend/main.ts' ? ['renderResults'] : [];
      for (const name of names) source = source.replace(new RegExp(`(function ${name}\\([\\s\\S]*?\\)\\s*\\{)`), `$1\n__count('${name}');`);
    }
    if (file === 'frontend/main.ts') source = source.replace('start().catch(', 'globalThis.__startup = start().catch(');
    const module = new SourceTextModule(source, { context, identifier: path });
    modules.set(path, module);
    return module;
  }
  return {
    counts,
    resetCounts() { for (const key of Object.keys(counts)) delete counts[key]; },
    async load(path) {
      const module = await getModule(resolve(root, path));
      if (module.status === 'unlinked') await module.link((specifier, parent) => getModule(resolve(dirname(parent.identifier), specifier)));
      if (module.status === 'linked') await module.evaluate();
      return module.namespace;
    },
    async start() { await this.load('frontend/main.ts'); await context.__startup; },
  };
}

export async function createPage(state, baseline, options = {}) {
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://loadout.test/', pretendToBeVisual: true });
  dom.window.localStorage.setItem('dab-loadout-v1', JSON.stringify(state));
  if (baseline) dom.window.localStorage.setItem('dab-baseline-v1', JSON.stringify(baseline));
  const runtime = await createRuntime({ dom, ...options });
  await runtime.start();
  if (dom.window.document.querySelector('.error-card')) throw new Error(dom.window.document.querySelector('.error-card').textContent);
  return { dom, runtime, close: () => dom.window.close() };
}

export function legacyEvaluation(projection, data, state, fallbackRates = true) {
  let damage = null, attributes = null, combatRates = null, damageError, attributeError;
  try { damage = projection.projectDamage(data, state); attributes = damage.attributes; combatRates = damage.result.combatRates; }
  catch (error) { damageError = error; }
  if (!attributes) {
    try { attributes = projection.projectAttributes(data, state); }
    catch (error) { attributeError = error; }
    if (attributes && fallbackRates) {
      try { combatRates = projection.projectCombatRates(data, state); } catch { /* Existing UI fallback. */ }
    }
  }
  return { damage, attributes, combatRates, damageError, attributeError };
}

export function normalize(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Error
    ? { name: item.name, message: item.message } : item));
}

export function resultHtml(document) {
  return Object.fromEntries(['results', 'damage-result', 'calculation-details', 'calculation-comparison',
    'equipment-damage-summary', 'comparison-label'].map(id => [id, document.getElementById(id)?.innerHTML ?? null]));
}

export function digest(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function evaluationSnapshot(value) {
  const normalized = normalize(value);
  return {
    // No tolerances: raw totals, rates, attack, products and every final-damage factor.
    stats: Object.fromEntries(Object.entries(normalized.attributes?.stats ?? {}).map(([key, stat]) =>
      [key, Object.fromEntries(Object.entries(stat).filter(([, item]) => typeof item === 'number'))])),
    conditionalDamage: normalized.attributes?.conditionalDamage ?? null,
    result: normalized.damage ? Object.fromEntries(Object.entries(normalized.damage.result).filter(([key]) => key !== 'attributes')) : null,
    combatRates: normalized.combatRates,
    damageError: normalized.damageError ?? null,
    attributeError: normalized.attributeError ?? null,
    // Complete ordered sources and all nested fields, including fallback calculationSources.
    completeEvaluationHash: digest(normalized),
  };
}
