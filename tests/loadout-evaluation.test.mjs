import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime, createPage, gameData, sample, legacyEvaluation, normalize,
  evaluationSnapshot, digest, resultHtml } from './loadout-evaluation-harness.mjs';
import { scenarios, comparisons, engineInput } from './loadout-evaluation-scenarios.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/loadout-evaluation.json', import.meta.url), 'utf8'));
const runtime = await createRuntime();
const projection = await runtime.load('frontend/projection.ts');
const { createBaselineEvaluationCache } = await runtime.load('frontend/baseline-evaluation.ts');
const stateFor = id => structuredClone(scenarios.find(s => s.id === id).state);
const aggregations = () => runtime.counts.aggregateCharacterAttributes ?? 0;
const evaluations = () => runtime.counts.evaluateLoadout ?? 0;

test('public calculation API retains its complete output and original invalid-input errors', async () => {
  const { calculateLoadout } = await runtime.load('calculation/loadout-engine.ts');
  const input = engineInput(gameData, projection.projectAttributes(gameData, stateFor('minimal-complete')).calculationSources);
  for (const [id, changes] of [['valid', {}], ['undefined-weapon', { weaponEnhancementLevel: undefined }],
    ['nan-weapon', { weaponEnhancementLevel: NaN }], ['negative-weapon', { weaponEnhancementLevel: -1 }],
    ['late-failure', { transcendenceSkillDamageSharePct: 101 }]]) {
    let actual;
    try { actual = { value: calculateLoadout({ ...input, ...changes }) }; } catch (error) { actual = { error }; }
    assert.deepEqual(normalize(actual), fixture.engine[id], id);
  }
});

const expectedWork = {
  'public-complete': [2, 1], 'minimal-complete': [2, 1], 'no-class': [0, 0], 'invalid-class': [0, 0],
  'no-weapon-rates-fallback': [1, 1], 'no-bottom-attributes-fallback': [0, 0],
  'no-shoes-attributes-fallback': [0, 0], 'invalid-weapon': [1, 0],
  'invalid-boss-rates-fallback': [2, 1], 'invalid-rate-attributes-fallback': [2, 0],
  'late-damage-failure-rates-fallback': [2, 1], 'special-weapon-average': [2, 1],
  'passives-effects-decimals': [2, 1], 'empty-stage-boundaries': [2, 1],
};
for (const { id, state } of scenarios) {
  test(`evaluation: ${id} keeps exact pre-refactor values, ordered sources and errors`, () => {
    runtime.resetCounts();
    const value = projection.evaluateLoadout(gameData, state);
    const { attributeProjectionHash, combatProjectionHash, ...expected } = fixture.evaluations[id];
    assert.deepEqual(evaluationSnapshot(value), expected);
    assert.equal(runtime.counts.resolveLoadoutSources, 1);
    assert.deepEqual([aggregations(), runtime.counts.calculateLoadoutCombatRates ?? 0], expectedWork[id]);
    assert.ok(aggregations() <= (fixture.workload[id].aggregateCharacterAttributes ?? 0));
    assert.ok(runtime.counts.resolveLoadoutSources <= fixture.workload[id].projectAttributes);
    // Public throwing/attribute/rate APIs remain equivalent too.
    assert.deepEqual(evaluationSnapshot(legacyEvaluation(projection, gameData, state)), expected);
    const capture = fn => { try { return { value: fn(gameData, state) }; } catch (error) { return { error }; } };
    assert.equal(digest(normalize(capture(projection.projectAttributes))), attributeProjectionHash);
    assert.equal(digest(normalize(capture(projection.projectCombatRates))), combatProjectionHash);
  });
}

for (const [id, current, baseline] of comparisons) {
  test(`actual main UI: ${id} keeps all result HTML and comparison formatting`, async () => {
    const page = await createPage(stateFor(current), stateFor(baseline));
    try {
      assert.equal(digest(resultHtml(page.dom.window.document)), fixture.pages[id]);
      const expected = expectedWork[current][0] + expectedWork[baseline][0];
      assert.equal(page.runtime.counts.aggregateCharacterAttributes ?? 0, expected);
      assert.ok(expected < fixture.workload['page:' + id].aggregateCharacterAttributes);
    } finally { page.close(); }
  });
}

test('baseline reuses a clone with the same complete input and different object key order', () => {
  const cache = createBaselineEvaluationCache(), state = structuredClone(sample), revision = Symbol();
  const first = cache.get(gameData, state, revision);
  runtime.resetCounts();
  state.values = Object.fromEntries(Object.entries(state.values).reverse());
  assert.equal(cache.get(gameData, structuredClone(state), revision), first);
  assert.equal(evaluations(), 0);
  assert.equal(aggregations(), 0);
});

test('baseline invalidates for every state field and in-place values changes', () => {
  const cache = createBaselineEvaluationCache(), revision = Symbol();
  const modifications = [
    state => { state.Job = 'KE'; }, state => { state.values['Stage.BossDEF'] = 60; },
    state => { state.lowerwearAlternativeEnabled = !state.lowerwearAlternativeEnabled; },
    state => { state.masterBeastSpiritStoneColor = '綠'; },
    state => { state.petSkillAttackEnabled = !state.petSkillAttackEnabled; },
    state => { state.transcendenceSkillDamageSharePct = 25; }, state => { state.schemaVersion = 2; },
  ];
  for (const modify of modifications) {
    const state = structuredClone(sample);
    cache.get(gameData, state, revision);
    modify(state);
    runtime.resetCounts();
    const actual = cache.get(gameData, state, revision);
    assert.equal(evaluations(), 1);
    assert.deepEqual(normalize(actual), normalize(projection.evaluateLoadout(gameData, state, false)));
  }
});

test('data identity and explicit data/parameter revision invalidate baseline', () => {
  const cache = createBaselineEvaluationCache(), data = structuredClone(gameData);
  const old = cache.get(data, sample, 1);
  data.parameters.characterBase.attackLevel = (data.parameters.characterBase.attackLevel ?? 0) + 1;
  runtime.resetCounts();
  const revised = cache.get(data, sample, 2);
  assert.equal(evaluations(), 1);
  assert.notEqual(revised.damage.result.finalDamage.finalDamage, old.damage.result.finalDamage.finalDamage);
  assert.deepEqual(normalize(revised), normalize(projection.evaluateLoadout(data, sample, false)));
  runtime.resetCounts();
  cache.get(structuredClone(data), sample, 2);
  assert.equal(evaluations(), 1);
});

test('clear, restore/import/history changes and last-entry eviction force evaluation', () => {
  const cache = createBaselineEvaluationCache(), revision = Symbol(), a = structuredClone(sample);
  const b = stateFor('special-weapon-average');
  cache.get(gameData, a, revision);
  for (const state of [b, a]) {
    runtime.resetCounts(); cache.get(gameData, state, revision); assert.equal(evaluations(), 1);
  }
  assert.equal(cache.get(gameData, null, revision), null);
  runtime.resetCounts(); cache.get(gameData, a, revision); assert.equal(evaluations(), 1);
  cache.clear(); runtime.resetCounts(); cache.get(gameData, a, revision); assert.equal(evaluations(), 1);
});

test('invalid baselines are cached and corrected contents recover without stale results', () => {
  const cache = createBaselineEvaluationCache(), state = stateFor('invalid-class'), revision = Symbol();
  assert.equal(cache.get(gameData, state, revision).attributes, null);
  runtime.resetCounts(); assert.equal(cache.get(gameData, state, revision).attributes, null);
  assert.equal(evaluations(), 0);
  state.Job = 'KE';
  assert.ok(cache.get(gameData, state, revision).damage);
  assert.equal(aggregations(), 2);
});

test('cached sources are detached and frozen; current evaluations remain independent', () => {
  const cache = createBaselineEvaluationCache(), data = structuredClone(gameData), revision = Symbol();
  const cached = cache.get(data, sample, revision), saved = digest(normalize(cached));
  assert.throws(() => { cached.attributes.stats.magicalAttack.finalTotal = -1; }, TypeError);
  assert.throws(() => cached.attributes.stats.magicalAttack.sharedSources.reverse(), TypeError);
  const current = projection.evaluateLoadout(data, sample);
  current.attributes.stats.magicalAttack.finalTotal = -1;
  data.parameters.characterBase.magicalAttack += 10;
  assert.equal(digest(normalize(cache.get(data, sample, revision))), saved);
  assert.notEqual(digest(normalize(cache.get(data, sample, Symbol()))), saved);
});

test('cache key distinguishes non-finite numbers, null, undefined and negative zero', () => {
  const cache = createBaselineEvaluationCache(), state = structuredClone(sample), revision = Symbol();
  for (const value of [NaN, null, undefined, 0, -0, Infinity, -Infinity]) {
    state.values['Stage.BossDEF'] = value;
    runtime.resetCounts(); cache.get(gameData, state, revision); assert.equal(evaluations(), 1);
  }
});

function enter(page, label, value) {
  const { document, Event, KeyboardEvent } = page.dom.window;
  const input = document.querySelector(`input[aria-label="${label}"]`);
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

test('actual main events: current changes reuse baseline; replacement/restore/undo/redo update comparisons', async () => {
  const page = await createPage(sample, sample), { document } = page.dom.window;
  try {
    const original = document.querySelector('#equipment-damage-summary').innerHTML;
    const formula = document.querySelector('#calculation-details details');
    assert.ok(formula); formula.open = true;
    page.runtime.resetCounts(); enter(page, 'Boss防禦', '60');
    assert.equal(fixture.workload['page:unchanged-baseline-update'].aggregateCharacterAttributes, 8);
    assert.equal(page.runtime.counts.evaluateLoadout, 1);
    assert.equal(page.runtime.counts.aggregateCharacterAttributes, 2);
    assert.notEqual(document.querySelector('#equipment-damage-summary').innerHTML, original);
    assert.equal(document.querySelector('#calculation-details details').open, true);
    const modified = document.querySelector('#equipment-damage-summary').innerHTML;
    document.querySelector('#undo').click();
    assert.equal(document.querySelector('#equipment-damage-summary').innerHTML, original);
    document.querySelector('#redo').click();
    assert.equal(document.querySelector('#equipment-damage-summary').innerHTML, modified);
    page.runtime.resetCounts(); document.querySelector('#baseline').click();
    assert.equal(page.runtime.counts.evaluateLoadout, 2); // New baseline once, current once.
    assert.equal(page.runtime.counts.aggregateCharacterAttributes, 4);
    assert.equal(JSON.parse(page.dom.window.localStorage.getItem('dab-baseline-v1')).values['Stage.BossDEF'], '60');
    assert.match(document.querySelector('#equipment-damage-summary').textContent, /0.00%/);
    enter(page, 'Boss防禦', '30');
    document.querySelector('#restore-baseline').click();
    assert.equal(document.querySelector('input[aria-label="Boss防禦"]').value, '60');
    assert.match(document.querySelector('#equipment-damage-summary').textContent, /0.00%/);
    page.runtime.resetCounts(); enter(page, '職業', 'KE');
    assert.equal(page.runtime.counts.evaluateLoadout, 1);
    assert.equal(JSON.parse(page.dom.window.localStorage.getItem('dab-loadout-v1')).Job, 'KE');
    const weapon = document.querySelector('input[aria-label="武器強化"]');
    weapon.value = 'Lv.12'; weapon.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    const option = [...document.getElementById(weapon.getAttribute('aria-controls')).querySelectorAll('[role="option"]')]
      .find(item => item.textContent.includes('Lv.12'));
    assert.ok(option); option.click();
    assert.equal(JSON.parse(page.dom.window.localStorage.getItem('dab-loadout-v1')).values['Weapon.ENHC'], 'Lv.12');
    const share = document.querySelector('#transcendence-skill-share-number');
    share.value = '50'; share.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    assert.equal(JSON.parse(page.dom.window.localStorage.getItem('dab-loadout-v1')).transcendenceSkillDamageSharePct, 50);
    assert.equal(document.querySelector('#calculation-details details').open, true);
  } finally { page.close(); }
});

test('actual import keeps baseline and save/export contracts; cleared storage has no baseline on reload', async () => {
  const page = await createPage(sample, sample);
  try {
    const { serializeLoadout, parseLoadoutJson } = await page.runtime.load('frontend/loadout-transfer.ts');
    const state = stateFor('special-weapon-average');
    const json = serializeLoadout(state, gameData).json;
    const imported = parseLoadoutJson(json, state, gameData).state;
    assert.deepEqual(normalize(imported.values), normalize(state.values));
    assert.equal(imported.Job, state.Job);
    assert.equal(imported.lowerwearAlternativeEnabled, state.lowerwearAlternativeEnabled);
    // Legacy samples omit optional settings; the existing importer fills their defaults.
    assert.deepEqual(normalize(parseLoadoutJson(serializeLoadout(imported, gameData).json, imported, gameData).state), normalize(imported));
    const baselineBefore = page.dom.window.localStorage.getItem('dab-baseline-v1');
    const input = page.dom.window.document.querySelector('#loadout-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => json }] });
    page.runtime.resetCounts(); input.dispatchEvent(new page.dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(page.dom.window.document.querySelector('#transfer-status').textContent, /已匯入/);
    assert.equal(page.runtime.counts.evaluateLoadout, 1);
    assert.equal(page.runtime.counts.aggregateCharacterAttributes, 2);
    assert.equal(page.dom.window.localStorage.getItem('dab-baseline-v1'), baselineBefore);
  } finally { page.close(); }
  const cleared = await createPage(sample, null);
  try { assert.match(cleared.dom.window.document.querySelector('#comparison-label').textContent, /可儲存目前配置/); }
  finally { cleared.close(); }
});
