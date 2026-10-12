import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, createContext } from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const buildRoot = new URL('../dist/', import.meta.url);
const sourceRoot = new URL('../', import.meta.url);
export const storageKey = 'buff-team-simulator.state.v1';

// Instrument only the in-memory test copy. Production modules have no counters.
function countFunction(source, name) {
  const pattern = new RegExp(`(function ${name}\\([^)]*\\)\\s*\\{)`);
  assert.match(source, pattern, `instrumentation must find ${name}`);
  return source.replace(pattern, `$1 globalThis.__calls.${name}++;`);
}

export async function boot({ saved = null, storageThrows = false, compiled = false, fetchSkill } = {}) {
  // Run the real source without rebuilding during incremental work; compiled verifies release output.
  const root = compiled ? buildRoot : sourceRoot;
  const failures = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: 'https://test.example/buff-simulator/',
    virtualConsole,
  });
  const { window } = dom;
  const calls = Object.fromEntries(['calculateTeam', 'calculateChallenge', 'updateResults',
    'updateSkillReference', 'saveCurrentInputs', 'shell', 'storage', 'resultWrites', 'skillWrites',
    'memberScans'].map(name => [name, 0]));
  const teamResults = [];
  const requests = [];
  const tick = () => new Promise(resolve => window.setTimeout(resolve, 0));
  const savedValues = new Map(saved === null ? [] : [[storageKey, typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: key => savedValues.get(key) ?? null,
    setItem(key, value) {
      calls.storage++;
      if (storageThrows) throw new Error('Storage unavailable');
      savedValues.set(key, value);
    },
  } });
  Object.defineProperty(window.document, 'baseURI', { value: 'https://test.example/buff-simulator/' });
  const descriptor = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML');
  Object.defineProperty(window.Element.prototype, 'innerHTML', {
    ...descriptor,
    set(value) {
      if (this.id === 'results') calls.resultWrites++;
      if (this.hasAttribute('data-skill-results')) calls.skillWrites++;
      descriptor.set.call(this, value);
    },
  });
  for (const owner of [window.Document.prototype, window.Element.prototype]) {
    const query = owner.querySelectorAll;
    owner.querySelectorAll = function(selector) {
      if (selector.includes('[data-member]')) calls.memberScans++;
      return query.call(this, selector);
    };
  }
  const context = createContext({ window, document: window.document, URL,
    HTMLInputElement: window.HTMLInputElement, console: { error: (...args) => failures.push(args) },
    __calls: calls, __teamResults: teamResults,
    fetch: async url => {
      const path = new URL(String(url)).pathname.split('/data/')[1];
      requests.push(path);
      const response = { ok: true, json: async () => JSON.parse(await readFile(new URL(`data/${path}`, root), 'utf8')) };
      return path === 'skill-reference.json' && fetchSkill ? fetchSkill(response) : response;
    },
  });
  const modules = new Map();
  async function moduleFor(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    let source = await readFile(url, 'utf8');
    if (!compiled) source = stripTypeScriptTypes(source);
    if (/\/frontend\/main\.(js|ts)$/.test(url.pathname)) {
      for (const name of ['updateResults', 'updateSkillReference', 'saveCurrentInputs', 'shell']) source = countFunction(source, name);
      source = source.replace('start().catch(', 'globalThis.__startup = start().catch(');
      source += '\nexport const __pendingSkills = () => skillReferenceRequest;';
    }
    if (/\/calculation\/engine\.(js|ts)$/.test(url.pathname)) {
      for (const name of ['calculateTeam', 'calculateChallenge']) source = countFunction(source, name);
      assert.equal(source.match(/return result;/g)?.length, 1);
      source = source.replace('return result;', 'globalThis.__teamResults.push(JSON.parse(JSON.stringify(result))); return result;');
    }
    const module = new SourceTextModule(source, { context, identifier: url.href });
    modules.set(url.href, module);
    return module;
  }
  const entry = await moduleFor(new URL(`frontend/main.${compiled ? 'js' : 'ts'}`, root));
  await entry.link((specifier, parent) => moduleFor(new URL(specifier, parent.identifier)));
  await entry.evaluate();
  await context.__startup;
  assert.deepEqual(failures, [], 'the actual entry must start successfully');
  // jsdom queues the same initial details toggle events that browsers can queue.
  await tick();
  const app = window.document.querySelector('#app');
  return {
    window, app, calls, teamResults, requests,
    query: selector => { const node = app.querySelector(selector); assert.ok(node, selector); return node; },
    reset() { for (const key of Object.keys(calls)) calls[key] = 0; teamResults.length = 0; },
    event(node, type = 'input', options = {}) {
      const EventType = type.startsWith('composition') ? window.CompositionEvent : type === 'input' ? window.InputEvent : window.Event;
      node.dispatchEvent(new EventType(type, { bubbles: true, ...options }));
    },
    clickMode(value) { app.querySelector(`[data-mode="${value}"]`).click(); },
    setSkillsOpen(value) {
      const panel = app.querySelector('.skill-reference');
      panel.open = value;
      panel.dispatchEvent(new window.Event('toggle'));
    },
    async settleSkills() { await entry.namespace.__pendingSkills(); await tick(); },
    async openSkills() { this.setSkillsOpen(true); await this.settleSkills(); },
    saved: () => savedValues.has(storageKey) ? JSON.parse(savedValues.get(storageKey)) : null,
    close() { dom.window.close(); assert.deepEqual(failures, [], 'no event handler may throw'); },
  };
}

export const fixturesUrl = new URL('./baseline-fixtures.json', import.meta.url);
