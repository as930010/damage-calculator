import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createRuntime, gameData, sample } from '../../../tests/loadout-evaluation-harness.mjs';
import { generateIceSearchStructures } from '../../../dist/features/ice-optimizer/frontend/search.js';
import { projectDamage } from '../../../dist/frontend/projection.js';
import { iceScenario } from './scenarios.mjs';

test('即時排名、取消、過期訊息及套用要求均使用同一份搜尋快照', async () => {
  const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
    .replace('__OPTIMIZER_GAME_DATA_URL__', '../data/game-data.test.json')
    .replace('__OPTIMIZER_WORKER_URL__', '../assets/worker.test.js');
  const dom = new JSDOM(html, { url: 'https://optimizer.test/damage-calculator/ice-optimizer/' });
  const state = iceScenario(gameData, sample, 17), raw = JSON.stringify(state);
  dom.window.localStorage.setItem('dab-loadout-v1', raw);
  const workers = [];
  class Worker {
    listeners = new Map();
    terminated = false;
    constructor() { workers.push(this); }
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
    const seeds = generateIceSearchStructures(gameData, choices).seeds.slice(0, 20);
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

    assert.equal(start.disabled, false);
    start.click();
    const first = workers.at(-1);
    first.send('progress', { progress: progress([baseline]) });
    assert.match(document.querySelector('#optimizer-results').textContent, /當前配裝為目前已知最佳解/);
    first.send('progress', { progress: progress([winner]) });
    assert.ok(document.querySelector('.optimizer-apply'));
    cancel.click();
    assert.equal(first.terminated, true);
    first.send('complete', { result });
    assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);

    start.click();
    const second = workers.at(-1);
    assert.notEqual(second.request.searchId, first.request.searchId);
    first.send('progress', { progress: progress([winner]) });
    assert.equal(document.querySelector('#optimizer-results').childElementCount, 0);
    second.send('complete', { result });
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
  } finally { dom.window.close(); }
});
