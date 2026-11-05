import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createRuntime, gameData, sample } from '../../../tests/loadout-evaluation-harness.mjs';
import { generateIceSearchStructures } from '../../../dist/features/ice-optimizer/frontend/search.js';
import { projectDamage } from '../../../dist/frontend/projection.js';
import { iceScenario } from './scenarios.mjs';

test('即時排名、取消、過期訊息及套用要求均使用同一份搜尋快照', async t => {
  const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
    .replace('__OPTIMIZER_GAME_DATA_URL__', '../data/game-data.test.json')
    .replace('__OPTIMIZER_WORKER_URL__', '../assets/worker.test.js');
  const dom = new JSDOM(html, { url: 'https://optimizer.test/damage-calculator/ice-optimizer/' });
  const state = iceScenario(gameData, sample, 17), raw = JSON.stringify(state);
  dom.window.localStorage.setItem('dab-loadout-v1', raw);
  const workers = [];
  let failNextWorker = false;
  class Worker {
    listeners = new Map();
    terminated = false;
    constructor() { if (failNextWorker) { failNextWorker = false; throw new Error('worker unavailable'); } workers.push(this); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    postMessage(value) { this.request = structuredClone(value); }
    terminate() { this.terminated = true; }
    send(type, fields) {
      this.listeners.get('message')?.({ data: { type, searchId: this.request.searchId, ...structuredClone(fields) } });
    }
  }
  let navigated;
  const runtime = await createRuntime({ dom, instrument: false, globals: {
    Worker, sessionStorage: dom.window.sessionStorage,
    location: { href: dom.window.location.href, assign: url => { navigated = url; } },
    fetch: async () => ({ ok: true, json: async () => structuredClone(gameData) }),
  } });
  try {
    await runtime.load('features/ice-optimizer/frontend/main.ts');
    await new Promise(resolve => setTimeout(resolve, 0));
    const { document } = dom.window;
    const start = document.querySelector('#optimizer-start'), cancel = document.querySelector('#optimizer-cancel');
    const baselineDamage = projectDamage(gameData, state).result.finalDamage.finalDamage;
    const right = gameData.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
    const choices = Object.fromEntries(right.map(entry => [entry.selectionField, String(state.values[entry.selectionField] ?? '')]));
    const seeds = generateIceSearchStructures(gameData, choices, { allowedSeries: [...new Set(gameData.rightIceSets.effects.filter(effect => effect.active && effect.setName !== '騎士團').map(effect => effect.setName))] }).seeds.slice(0, 20);
    const candidates = seeds.map(seed => {
      const values = { ...state.values, ...seed.choices };
      gameData.rightIceSets.selectionFields.forEach((field, index) => { values[field] = seed.setNames[index] ?? ''; });
      return { choices: seed.choices, setNames: seed.setNames, damage: projectDamage(gameData, { ...state, values }).result.finalDamage.finalDamage };
    }).sort((a, b) => b.damage - a.damage);
    const winner = candidates[0];
    assert.ok(winner.damage > baselineDamage);
    const baseline = { choices, setNames: [], damage: baselineDamage, isBaseline: true };
    const progress = items => ({ evaluated: 20, budgetUsed: 20, phase: 'test', baselineDamage,
      baselineInScope: true, bestDamage: items[0].damage, results: items.map(item => ({ ...item, alternatives: [item] })) });
    const result = { ...progress([winner]), baseline, scope: 'three-set-3x3-bounded', globallyOptimalProven: false,
      bestSearchDomainDamage: winner.damage, termination: 'budget-exhausted', localOptimality: 'current-best' };

    const detailAt = index => document.querySelectorAll('#optimizer-results details')[index];
    const summaryAt = index => detailAt(index).querySelector('summary');
    const emit = (active, items) => active.send('progress', { progress: progress(items) });
    const [a, b, c] = candidates;
    const scenario = async (name, run) => t.test(name, async () => {
      start.click();
      const active = workers.at(-1);
      try { await run(active); } finally { cancel.click(); }
    });
    await scenario('Progress retains multiple disclosures and Summary focus without scrolling focus', active => {
      emit(active, [a, b, c]);
      detailAt(0).open = true; detailAt(2).open = true;
      summaryAt(2).focus();
      const focusOptions = [];
      const originalFocus = dom.window.HTMLElement.prototype.focus;
      dom.window.HTMLElement.prototype.focus = function (options) {
        focusOptions.push(options); originalFocus.call(this, options);
      };
      try { emit(active, [a, b, c]); }
      finally { dom.window.HTMLElement.prototype.focus = originalFocus; }
      assert.deepEqual([...document.querySelectorAll('#optimizer-results details')].map(d => d.open), [true, false, true]);
      assert.equal(document.activeElement, summaryAt(2));
      assert.ok(focusOptions.every(options => options?.preventScroll === true));
    });
    await scenario('Reordering, insertion and changed damage follow outfit identity rather than rank', active => {
      emit(active, [a, b, c]); detailAt(2).open = true; summaryAt(2).focus();
      const reordered = { ...c, damage: c.damage + 1,
        choices: Object.fromEntries(Object.entries(c.choices).reverse()), setNames: [...c.setNames].reverse() };
      emit(active, [reordered, candidates[3], a, b]);
      assert.equal(detailAt(0).open, true);
      assert.equal(document.activeElement, summaryAt(0));
      assert.equal(detailAt(2).open, false);
    });
    await scenario('Removing a focused outfit falls back to the existing search status', active => {
      emit(active, [a, b]); detailAt(0).open = true; summaryAt(0).focus();
      emit(active, [b, c]);
      assert.equal(detailAt(0).open, false);
      assert.equal(detailAt(1).open, false);
      assert.equal(document.activeElement, document.querySelector('#optimizer-status'));
      assert.equal(document.activeElement.tabIndex, -1);
      emit(active, [a, b]);
      assert.equal(detailAt(0).open, false, 'removed identities must not retain stale open state');
    });
    await scenario('Progress to Complete retains disclosure and Apply focus', active => {
      emit(active, [a, b]); detailAt(1).open = true;
      document.querySelectorAll('.optimizer-apply')[1].focus();
      active.send('complete', { result: { ...result, ...progress([b, a]) } });
      assert.equal(detailAt(0).open, true);
      assert.equal(document.activeElement, document.querySelectorAll('.optimizer-apply')[0]);
    });
    await scenario('Updates never steal focus from controls outside results', active => {
      emit(active, [a]); detailAt(0).open = true; cancel.focus();
      emit(active, [a, b]);
      assert.equal(detailAt(0).open, true);
      assert.equal(document.activeElement, cancel);
    });
    await scenario('New searches reset disclosure state and ignore old worker messages', active => {
      emit(active, [a]); detailAt(0).open = true; summaryAt(0).focus();
      cancel.click(); start.click(); const next = workers.at(-1);
      emit(active, [a]); assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);
      emit(next, [a]); assert.equal(detailAt(0).open, false);
      assert.notEqual(document.activeElement, summaryAt(0));
    });
    await scenario('Tied outfit regrouping preserves surviving identities and exact Apply focus', active => {
      const entry = right.find(entry => gameData.catalogs[entry.catalogFile].items.some(item =>
        item.active && item.slotId === entry.slotId && item.name !== a.choices[entry.selectionField]));
      const replacement = gameData.catalogs[entry.catalogFile].items.find(item =>
        item.active && item.slotId === entry.slotId && item.name !== a.choices[entry.selectionField]);
      const variant = { ...a, choices: { ...a.choices, [entry.selectionField]: replacement.name } };
      const tied = items => active.send('progress', { progress: {
        ...progress([a]), results: [{ ...a, alternatives: items }] } });
      emit(active, [a]); detailAt(0).open = true;
      tied([variant, a]);
      assert.equal(detailAt(0).open, true);
      document.querySelectorAll('.optimizer-apply')[1].focus();
      tied([a, variant]);
      assert.equal(document.activeElement, document.querySelectorAll('.optimizer-apply')[0]);
      tied([variant]);
      assert.equal(document.activeElement, document.querySelector('#optimizer-status'));
    });
    await scenario('Worker error preserves the current disclosure and reports the error', active => {
      emit(active, [a]); detailAt(0).open = true; summaryAt(0).focus();
      active.send('error', { message: 'controlled failure' });
      assert.equal(detailAt(0).open, true);
      assert.equal(document.activeElement, summaryAt(0));
      assert.equal(start.dataset.searchState, 'idle');
      assert.equal(document.querySelector('#optimizer-status').textContent, 'controlled failure');
    });

    assert.equal(start.disabled, false);
    failNextWorker = true;
    start.click();
    assert.equal(start.dataset.searchState, 'idle');
    assert.match(document.querySelector('#optimizer-status').textContent, /無法啟動背景搜尋/);
    start.click();
    const first = workers.at(-1);
    assert.equal(start.dataset.searchState, 'running');
    first.send('progress', { progress: progress([baseline]) });
    assert.match(document.querySelector('#optimizer-results').textContent, /當前配裝為目前已知最佳解/);
    first.send('progress', { progress: progress([winner]) });
    assert.ok(document.querySelector('.optimizer-apply'));
    cancel.click();
    assert.equal(start.dataset.searchState, 'idle');
    assert.equal(first.terminated, true);
    first.send('complete', { result });
    assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);

    start.click();
    const second = workers.at(-1);
    assert.notEqual(second.request.searchId, first.request.searchId);
    first.send('progress', { progress: progress([winner]) });
    assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);
    second.send('complete', { result });
    assert.equal(start.dataset.searchState, 'idle');
    const completed = document.querySelector('#optimizer-results').innerHTML;
    second.send('progress', { progress: progress([baseline]) });
    assert.equal(document.querySelector('#optimizer-results').innerHTML, completed);
    dom.window.localStorage.setItem('dab-loadout-v1', JSON.stringify({ ...state, nutProtectionPotionEnabled: !state.nutProtectionPotionEnabled }));
    dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'dab-loadout-v1' }));
    assert.equal(document.querySelector('.optimizer-apply').disabled, true);
    assert.equal(dom.window.sessionStorage.getItem('dab-ice-optimizer-apply-v1'), null);

    dom.window.localStorage.setItem('dab-loadout-v1', raw);
    start.click();
    const third = workers.at(-1);
    assert.equal(start.dataset.searchState, 'running');
    third.send('progress', { progress: progress([winner]) });
    document.querySelector('.optimizer-apply').click();
    assert.equal(third.terminated, true);
    assert.equal(navigated, '../');
    const handoff = JSON.parse(dom.window.sessionStorage.getItem('dab-ice-optimizer-apply-v1'));
    assert.equal(handoff.baseRaw, raw);
    assert.equal(handoff.expectedDamage, winner.damage);
    assert.deepEqual(handoff.choices, winner.choices);
    assert.equal(dom.window.localStorage.getItem('dab-loadout-v1'), raw);
    assert.equal(JSON.stringify(third.request.state.values), JSON.stringify(first.request.state.values));

    start.click();
    const fourth = workers.at(-1);
    const variantEntry = right.find(entry => gameData.catalogs[entry.catalogFile]?.items.some(item =>
      item.active && item.slotId === entry.slotId && item.name !== winner.choices[entry.selectionField]));
    assert.ok(variantEntry, 'fixture needs an alternate item for one right-ice slot');
    const replacement = gameData.catalogs[variantEntry.catalogFile].items.find(item =>
      item.active && item.slotId === variantEntry.slotId && item.name !== winner.choices[variantEntry.selectionField]);
    const tiedAlternative = { ...winner, choices: { ...winner.choices,
      [variantEntry.selectionField]: replacement.name } };
    fourth.send('complete', { result: { ...result, results: [{ ...winner,
      alternatives: [winner, tiedAlternative] }] } });
    const tieDetails = [...document.querySelectorAll('#optimizer-results article.optimizer-result details')];
    assert.equal(tieDetails.length, 1, 'same-slot tied alternatives should share one compact outfit');
    const slotLabel = gameData.layout.slots.find(slot => slot.selectionField === variantEntry.selectionField).label;
    const slotTerm = [...tieDetails[0].querySelectorAll('dt')].find(term => term.textContent === slotLabel);
    assert.equal(slotTerm?.nextElementSibling.textContent,
      `${winner.choices[variantEntry.selectionField]} / ${replacement.name}`);
    assert.equal(tieDetails[0].querySelectorAll('.optimizer-apply').length, 2,
      'each alternative remains individually applicable');

    const setSelect = document.querySelector('#required-set');
    const requiredId = setSelect.value;
    document.querySelector('#set-add').click();
    assert.ok(document.querySelector('#optimizer-results').textContent.includes('目前配裝基準傷害'));
    assert.ok([...document.querySelectorAll('.optimizer-apply')].every(button => button.disabled));
    assert.equal(start.disabled, false);
    start.click();
    const constrained = workers.at(-1);
    assert.deepEqual(constrained.request.constraints.requiredSetEffectIds, [requiredId]);
    document.querySelector('#set-add').click();
    assert.equal(constrained.terminated, true, 'changing conditions cancels the old worker');
    constrained.send('complete', { result });
    assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);

    document.querySelector('#constraint-clear').click();
    const slotControl = document.querySelector('#fixed-slot');
    const itemControl = document.querySelector('#fixed-item');
    for (const entry of right.slice(0, 11)) {
      slotControl.value = entry.selectionField;
      slotControl.dispatchEvent(new dom.window.Event('change'));
      itemControl.value = gameData.catalogs[entry.catalogFile].items.find(item =>
        item.active && item.slotId === entry.slotId && item.name === '騎士團').id;
      document.querySelector('#fixed-add').click();
    }
    assert.match(document.querySelector('#fixed-count').textContent, /11／11/);
    assert.equal(document.querySelector('#fixed-add').disabled, true);
    assert.equal(start.disabled, true);
    assert.match(document.querySelector('#constraint-status').textContent, /無法同時達成/);

    document.querySelector('#constraint-clear').click();
    const boxes = [...document.querySelectorAll('#series-options input')];
    for (const box of boxes) if (!['紫霄花郎', '真理假面'].includes(box.value)) { box.checked = false; box.dispatchEvent(new dom.window.Event('change')); }
    assert.equal(start.disabled, true);
    const thirdBox = document.querySelector('#series-options input[value="幻影面紗"]');
    thirdBox.checked = true; thirdBox.dispatchEvent(new dom.window.Event('change'));
    assert.equal(start.disabled, false);
    start.click();
    const rangedWorker = workers.at(-1);
    assert.deepEqual([...rangedWorker.request.constraints.allowedSeries].sort(), ['幻影面紗', '紫霄花郎', '真理假面'].sort());
    document.querySelector('#range-clear').click();
    assert.equal(rangedWorker.terminated, true);
    rangedWorker.send('complete', { result });
    assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);
  } finally { dom.window.close(); }
});
