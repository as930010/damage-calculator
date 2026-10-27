import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { canAssignSetCounts, describeIceSearchStatus, generateIceSearchStructures, generateThreeSetStructures, iceFields, isThreeSetIceCandidate, sameDamage, searchIce } from '../../../dist/features/ice-optimizer/frontend/search.js';
import { resolveRightIceSetEffects } from '../../../dist/calculation/equipment-effects.js';
import { projectDamage } from '../../../dist/frontend/projection.js';
import { iceScenario, smallIceScenario, icePairCoverageCounterexample } from './scenarios.mjs';
import { createIceSearchDomains } from '../../../dist/features/ice-optimizer/frontend/search-policy.js';

const dataFile = readdirSync('site-dist/data').find(name => /^game-data\.[a-f0-9]+\.json$/.test(name));
if (!dataFile) throw new Error('正式遊戲資料尚未建立。');
const data = JSON.parse(readFileSync(`site-dist/data/${dataFile}`, 'utf8'));
const base = JSON.parse(readFileSync('data/examples/public-example-2026-09-28.json', 'utf8'));
const right = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
const weapon = right.find(entry => entry.selectionField === 'Ice.Weapon.Set');
const leftIce = data.mapping.selections.find(entry => entry.catalogFile === 'equipment/left-ice.json');

test('部位遮罩前置篩選與小型完整指派枚舉一致', () => {
  const brute = (masks, counts) => {
    const visit = (slot, remaining) => {
      if (remaining.every(value => value === 0)) return true;
      if (slot === 4) return false;
      if (visit(slot + 1, remaining)) return true;
      for (let index = 0; index < masks.length; index += 1) {
        if (remaining[index] > 0 && (masks[index] & (1 << slot))) {
          const next = [...remaining]; next[index] -= 1;
          if (visit(slot + 1, next)) return true;
        }
      }
      return false;
    };
    return visit(0, counts);
  };
  for (let first = 0; first < 16; first += 1)
    for (let second = 0; second < 16; second += 1)
      for (let third = 0; third < 16; third += 1)
        for (const counts of [[1, 1, 1], [2, 1, 1], [1, 2, 1], [1, 1, 2]]) {
          const masks = [first, second, third];
          assert.equal(canAssignSetCounts(masks, counts, 4), brute(masks, counts),
            `masks=${masks} counts=${counts}`);
        }
});

test('結構產生器完整涵蓋目前可行的三套效件數並排除部位衝突', () => {
  const current = Object.fromEntries(right.map(entry => [entry.selectionField,
    String(base.values[entry.selectionField] ?? '')]));
  const generated = generateThreeSetStructures(data, current, { excludedSeries: [] });
  assert.equal(generated.stats.raw, 4400);
  assert.equal(generated.stats.feasible, 1141);
  assert.equal(generated.stats.infeasible, 3259);
  assert.equal(generated.stats.tierRejected, 0);
  assert.ok(generated.seeds.length >= generated.stats.feasible);
  for (const seed of generated.seeds) {
    const counts = seed.setNames.map(name => right.filter(entry =>
      seed.choices[entry.selectionField] === name).length);
    assert.deepEqual(counts, seed.counts);
    const effects = resolveRightIceSetEffects(data.rightIceSets,
      right.map(entry => seed.choices[entry.selectionField] ?? ''), seed.setNames);
    for (const [index, name] of seed.setNames.entries()) {
      const eligibleTiers = data.rightIceSets.effects.filter(effect => effect.active && effect.setName === name
        && (effect.requiredPieces.operator === 'exactly'
          ? seed.counts[index] === effect.requiredPieces.count
          : seed.counts[index] >= effect.requiredPieces.count));
      const expected = eligibleTiers.sort((a, b) => b.requiredPieces.count - a.requiredPieces.count)[0];
      assert.ok(expected, `${name} 未觸發資料定義的套效階級`);
      assert.ok(effects.some(source => source.sourceId === expected.id),
        `${name} 的 exactly/atLeast 階級與現有套效解析器不一致`);
    }
  }
});

test('正式結構產生器僅涵蓋完整十二部位的三組有效 3set', () => {
  const current = Object.fromEntries(right.map(entry => [entry.selectionField,
    String(base.values[entry.selectionField] ?? '')]));
  const generated = generateIceSearchStructures(data, current, { excludedSeries: [] });
  assert.deepEqual(iceFields(data).right.map(entry => entry.selectionField), right.map(entry => entry.selectionField));
  assert.deepEqual(generated.stats.profilesBySelectedSetCount.slice(0, 4), [0, 0, 0, 1141]);
  assert.ok(generated.stats.priorityThreeSetProfiles > 0);
  assert.equal(generated.stats.priorityThreeSetProfiles, 1141);
  assert.ok(weapon, '右冰資料應保留冰裝武器欄位');
  for (const counts of ['3,3,3', '4,3,3', '4,4,4']) {
    assert.ok(generated.seeds.some(seed => seed.counts.join(',') === counts),
      `${counts} 必須保留為可搜尋的合法件數分配`);
  }
  assert.ok(generated.stats.seedCandidates >= generated.stats.feasible);
  for (const seed of generated.seeds) {
    assert.equal(seed.setNames.length, 3);
    assert.ok(seed.counts.every(count => count >= 3));
    assert.equal(new Set(seed.setNames).size, seed.setNames.length);
    assert.equal(Object.hasOwn(seed.choices, leftIce.selectionField), false,
      '搜尋結構不得帶入冰裝左五欄位');
    assert.ok(Object.hasOwn(seed.choices, weapon.selectionField), '搜尋結構必須包含冰裝武器欄位');
    const resolved = resolveRightIceSetEffects(data.rightIceSets,
      right.map(entry => seed.choices[entry.selectionField] ?? ''), seed.setNames);
    const resolvedNames = new Set(resolved.flatMap(source => {
      const effect = data.rightIceSets.effects.find(candidate => candidate.id === source.sourceId);
      return effect ? [effect.setName] : [];
    }));
    assert.ok(seed.setNames.every(name => resolvedNames.has(name)));
    assert.ok(isThreeSetIceCandidate(data, seed.choices, seed.setNames, { excludedSeries: [] }));
    for (const entry of right) {
      const choice = seed.choices[entry.selectionField];
      assert.ok(choice && data.catalogs[entry.catalogFile].items.some(item => item.active
        && item.slotId === entry.slotId && item.name === choice), `非法冰裝候選：${entry.selectionField}`);
    }
  }
});

test('縮減必要部位的資料不能作為正式十二部位搜尋', () => {
  const tiny = {
    mapping: { selections: [
      { catalogFile: 'equipment/right-ice.json', selectionField: 'R1', slotId: '1' },
      { catalogFile: 'equipment/right-ice.json', selectionField: 'R2', slotId: '2' },
      { catalogFile: 'equipment/right-ice.json', selectionField: 'R3', slotId: '3' },
    ] },
    catalogs: {
      'equipment/right-ice.json': { items: [
        { active: true, slotId: '1', name: 'A' }, { active: true, slotId: '1', name: 'B' },
        { active: true, slotId: '2', name: 'A' }, { active: true, slotId: '3', name: 'unused' },
      ] },
    },
    rightIceSets: { schemaVersion: 2, selectionFields: ['Set1', 'Set2'], maxSelectedSets: 2, effects: [
      { id: 'A1', setName: 'A', active: true, requiredPieces: { operator: 'atLeast', count: 1 }, stats: {} },
      { id: 'A2', setName: 'A', active: true, requiredPieces: { operator: 'exactly', count: 2 }, stats: {} },
      { id: 'B1', setName: 'B', active: true, requiredPieces: { operator: 'exactly', count: 1 }, stats: {} },
    ] },
  };
  const current = { R1: '', R2: '', R3: '' };
  assert.throws(() => generateIceSearchStructures(tiny, current), /12 個右冰部位/);
});

function bestDamageForChoices(state, choices, requiredSetNames = null) {
  const values = { ...state.values, ...choices };
  const counts = new Map();
  for (const entry of right) {
    const name = values[entry.selectionField];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const eligible = new Map();
  for (const effect of data.rightIceSets.effects) {
    const count = counts.get(effect.setName) ?? 0;
    if (!effect.active || (effect.requiredPieces.operator === 'exactly'
      ? count !== effect.requiredPieces.count : count < effect.requiredPieces.count)) continue;
    const previous = eligible.get(effect.setName);
    if (!previous || effect.requiredPieces.count > previous.requiredPieces.count) {
      eligible.set(effect.setName, effect);
    }
  }
  const names = [...eligible.keys()];
  const selections = requiredSetNames ? [requiredSetNames] : Array.from({ length: 2 ** names.length }, (_, mask) =>
    names.filter((_, index) => mask & (1 << index)));
  let best = -Infinity;
  for (const selected of selections) {
    if (selected.length > data.rightIceSets.maxSelectedSets) continue;
    data.rightIceSets.selectionFields.forEach((field, index) => { values[field] = selected[index] ?? ''; });
    try {
      const damage = projectDamage(data, { ...state, values }).result.finalDamage.finalDamage;
      if (Number.isFinite(damage)) best = Math.max(best, damage);
    } catch { /* An invalid set choice is not a legal replacement. */ }
  }
  return best;
}

for (const index of [0, 6, 17]) test(`縮減映射的套效機制測試 ${index} 不能啟動正式搜尋`, async () => {
  const { data: tiny, state } = smallIceScenario(data, base, index);
  await assert.rejects(searchIce(tiny, state, () => {}), /12 個右冰部位/);
});

test('搜尋只比較右冰與冰裝武器，左冰固定且推薦傷害與完整引擎一致', async () => {
  const initial = generateThreeSetStructures(data, Object.fromEntries(right.map(entry => [
    entry.selectionField, String(base.values[entry.selectionField] ?? ''),
  ]))).seeds[0];
  const currentValues = { ...base.values, ...initial.choices };
  data.rightIceSets.selectionFields.forEach((field, index) => { currentValues[field] = initial.setNames[index] ?? ''; });
  const currentState = { ...base, values: currentValues };
  const updates = [];
  const search = await searchIce(data, currentState, update => { if (update.results) updates.push(update); });
  const baselineActual = projectDamage(data, currentState).result.finalDamage.finalDamage;
  assert.equal(search.baselineDamage, baselineActual);
  assert.equal(search.baseline.damage, baselineActual);
  assert.equal(search.baselineInScope, true);
  assert.deepEqual(search.baseline.setNames, [...initial.setNames].sort());
  assert.ok(search.belowBaselineEvaluated > 0, '搜尋流程仍應評估低於基準的中間候選');
  assert.equal(search.scope, 'three-set-3x3-bounded');
  assert.equal(search.globallyOptimalProven, false);
  assert.equal(search.budgetUsed, search.evaluated + search.invalidCandidates,
    '候選預算應由完整傷害計算與未送進引擎的非法候選互斥組成；快取命中不另扣預算');
  assert.ok(search.duplicateCandidates >= 0 && search.lnsDuplicateCandidates >= 0);
  assert.ok(updates.length >= 2, '搜尋期間必須持續送出正式排名');
  assert.equal(updates[0].baselineDamage, search.baselineDamage);
  assert.equal(updates[0].baselineInScope, search.baselineInScope);
  assert.deepEqual(updates.at(-1).results, search.results,
    '最後一筆即時排名必須與最終排名一致');
  for (const update of updates) {
    assert.ok(update.budgetUsed <= 50_000);
    assert.ok(update.results.every(group => group.alternatives.every(item =>
      item.damage > search.baselineDamage || sameDamage(item.damage, search.baselineDamage))));
  }
  assert.equal(search.structures.raw,
    generateThreeSetStructures(data, currentValues).stats.raw);
  assert.equal(search.structures.raw,
    search.structures.feasible + search.structures.infeasible + search.structures.tierRejected);
  assert.equal(search.structures.priorityThreeSetProfiles,
    generateThreeSetStructures(data, currentValues).stats.feasible);
  assert.equal(search.structures.feasible, search.structures.priorityThreeSetProfiles);
  assert.ok(search.structures.infeasible > 0);
  assert.ok(search.structures.seedCandidates >= search.structures.feasible);
  assert.ok(search.structures.seedAttempts <= search.structures.seedCandidates);
  assert.ok(search.structures.seedEvaluated <= search.structures.seedAttempts);
  assert.deepEqual(search.structures.profilesBySelectedSetCount.slice(0, 3), [0, 0, 0]);
  assert.ok(search.structures.profilesBySelectedSetCount[3] > 0);
  assert.ok(search.results.length > 0 && search.results.length <= 5);
  assert.ok(weapon);
  const alternatives = search.results.flatMap(group => group.alternatives ?? [group]);
  const signatures = alternatives.map(item => JSON.stringify([
    right.map(entry => item.choices[entry.selectionField]), [...item.setNames].sort(),
  ]));
  assert.equal(new Set(signatures).size, signatures.length);
  for (const group of search.results) for (const item of group.alternatives ?? [group]) {
    assert.ok(item.damage > search.baselineDamage || sameDamage(item.damage, search.baselineDamage),
      '低於目前基準的穿搭不得顯示為推薦');
    assert.ok(sameDamage(group.damage, item.damage), '等傷害配置必須採並列排名');
    assert.equal(item.setNames.length, 3);
    assert.ok(isThreeSetIceCandidate(data, item.choices, item.setNames, search.candidatePolicy));
    assert.equal(new Set(item.setNames).size, item.setNames.length);
    assert.ok(Object.hasOwn(item.choices, weapon.selectionField));
    assert.equal(Object.hasOwn(item.choices, leftIce.selectionField), false);
    const values = { ...currentState.values, ...item.choices };
    assert.equal(values[leftIce.selectionField], currentState.values[leftIce.selectionField],
      '冰裝左五應固定使用開始搜尋時的配裝');
    const resolved = resolveRightIceSetEffects(data.rightIceSets,
      right.map(entry => values[entry.selectionField] ?? ''), item.setNames);
    const resolvedNames = new Set(resolved.flatMap(source => {
      const effect = data.rightIceSets.effects.find(candidate => candidate.id === source.sourceId);
      return effect ? [effect.setName] : [];
    }));
    assert.ok(item.setNames.every(name => resolvedNames.has(name)));
    data.rightIceSets.selectionFields.forEach((field, index) => { values[field] = item.setNames[index] ?? ''; });
    const actual = projectDamage(data, { ...currentState, values }).result.finalDamage.finalDamage;
    assert.ok(Math.abs(actual - item.damage) <= Math.abs(actual) * 1e-12);
  }
  assert.ok(['current-best', 'single-local'].includes(search.localOptimality));
  if (search.localOptimality === 'single-local') {
    const incumbent = search.results[0];
    const tolerance = Math.max(1e-6, Math.abs(incumbent.damage) * 1e-12);
    for (const entry of right) {
      const names = createIceSearchDomains(data, currentState.values, search.candidatePolicy)
        .find(domain => domain.field === entry.selectionField).names;
      for (const name of names) {
        const candidate = bestDamageForChoices(currentState,
          { ...incumbent.choices, [entry.selectionField]: name }, incumbent.setNames);
        assert.ok(candidate <= incumbent.damage + tolerance,
          `局部最佳標示錯誤：${entry.selectionField} → ${name} 可提升至 ${candidate}`);
      }
    }
  }
});

test('無改善時保留目前配裝訊息，且不宣稱搜尋範圍已達全域最佳', () => {
  const message = describeIceSearchStatus({
    baselineDamage: 100, baselineInScope: true, bestSearchDomainDamage: 100,
    results: [{ choices: {}, setNames: [], damage: 100 }],
    termination: 'budget-exhausted', localOptimality: 'single-local',
  });
  assert.match(message, /未找到更高傷害配置/);
  assert.equal(message, '已達搜尋次數上限；未找到更高傷害配置。');
});

test('完整十二部位固定情境的推薦維持基準保護及正式引擎一致', async () => {
  const state = iceScenario(data, base, 6);
  const search = await searchIce(data, state, () => {});
  assert.ok(search.results[0].damage >= search.baselineDamage - Math.max(1e-6, search.baselineDamage * 1e-12));
  const values = { ...state.values, ...search.results[0].choices };
  data.rightIceSets.selectionFields.forEach((field, index) => {
    values[field] = search.results[0].setNames[index] ?? '';
  });
  const actual = projectDamage(data, { ...state, values }).result.finalDamage.finalDamage;
  assert.ok(Math.abs(actual - search.results[0].damage) <= Math.abs(actual) * 1e-12);
  assert.ok(['current-best', 'single-local'].includes(search.localOptimality));
  const tolerance = Math.max(1e-6, Math.abs(search.results[0].damage) * 1e-12);
  for (const entry of right) {
    const names = createIceSearchDomains(data, state.values, search.candidatePolicy)
      .find(domain => domain.field === entry.selectionField).names;
    for (const name of names) {
      const candidate = bestDamageForChoices(state,
        { ...search.results[0].choices, [entry.selectionField]: name }, search.results[0].setNames);
      if (search.localOptimality === 'single-local') assert.ok(candidate <= search.results[0].damage + tolerance,
        `雙部位改善後仍有未檢查的單部位替換：${entry.selectionField} → ${name}`);
    }
  }
});

test('舊多部位套裝反例以合法關卡值重新驗算，不沿用過期傷害數字', async () => {
  const state = iceScenario(data, base, 17);
  const priorWinner = {
    'Right.Ice.Necklace': '紫霄花郎',
    'Right.Ice.Support': '幻影面紗',
    'Right.Ice.WeaponAccessory': '真理假面',
    'Right.Ice.Arm': '紫霄花郎',
    'Right.Ice.FaceBottom': '真理假面',
    'Right.Ice.Ring': '幻影面紗',
    'Right.Ice.Earring': '真理假面',
    'Right.Ice.FaceMiddle': '紫霄花郎',
    'Right.Ice.Bottom': '星辰牧者',
    'Right.Ice.FaceTop': '幻影面紗',
    'Right.Ice.Top': '日冕．灼耀花仙',
    'Ice.Weapon.Set': '幻影面紗',
  };
  const higherCandidate = {
    ...priorWinner,
    'Right.Ice.Necklace': '幽潮吞源',
    'Right.Ice.Arm': '幽潮吞源',
    'Right.Ice.Top': '紫霄花郎',
    'Ice.Weapon.Set': '紫霄花郎',
  };
  const threeSlotCandidate = {
    ...priorWinner,
    'Right.Ice.Arm': '幽潮吞源',
    'Right.Ice.Top': '紫霄花郎',
    'Ice.Weapon.Set': '紫霄花郎',
  };
  assert.equal(right.filter(entry => priorWinner[entry.selectionField]
    !== higherCandidate[entry.selectionField]).length, 4);
  assert.equal(right.filter(entry => priorWinner[entry.selectionField]
    !== threeSlotCandidate[entry.selectionField]).length, 3);
  const previousDamage = bestDamageForChoices(state, priorWinner);
  const constrainedSuites = ['幻影面紗', '真理假面', '紫霄花郎'];
  const counterexampleDamage = bestDamageForChoices(state, higherCandidate, constrainedSuites);
  const threeSlotDamage = bestDamageForChoices(state, threeSlotCandidate);
  assert.ok([previousDamage, counterexampleDamage, threeSlotDamage].every(Number.isFinite));

  const search = await searchIce(data, state, () => {});
  if (counterexampleDamage > previousDamage) {
    assert.ok(search.results[0].damage >= counterexampleDamage - counterexampleDamage * 1e-12,
      `套裝重組搜尋仍漏掉已驗證的多部位反例：${search.results[0].damage} < ${counterexampleDamage}`);
  }
  const winnerValues = { ...state.values, ...search.results[0].choices };
  data.rightIceSets.selectionFields.forEach((field, index) => {
    winnerValues[field] = search.results[0].setNames[index] ?? '';
  });
  const actual = projectDamage(data, { ...state, values: winnerValues }).result.finalDamage.finalDamage;
  assert.ok(Math.abs(actual - search.results[0].damage) <= Math.abs(actual) * 1e-12);
});

test('搜尋 Top K 不遺失縮減雙部位探索後漏掉的固定合法穿搭', async () => {
  const witness = icePairCoverageCounterexample;
  const state = iceScenario(data, base, witness.scenarioIndex);
  const values = { ...state.values, ...witness.choices };
  data.rightIceSets.selectionFields.forEach((field, i) => { values[field] = witness.setNames[i] ?? ''; });
  const sources = resolveRightIceSetEffects(data.rightIceSets,
    right.map(entry => values[entry.selectionField] ?? ''), witness.setNames);
  assert.ok(witness.setNames.every(name => sources.some(source => data.rightIceSets.effects.some(effect =>
    effect.id === source.sourceId && effect.setName === name))));
  const actual = projectDamage(data, { ...state, values }).result.finalDamage.finalDamage;
  assert.ok(Number.isFinite(actual));
  const search = await searchIce(data, state, () => {});
  assert.equal(search.results.length, 5);
  assert.ok(search.results.at(-1).damage >= actual - Math.max(1e-6, actual * 1e-12),
    '較快的第一名不足以證明整體排名品質；Top K 仍須保留已知較佳解');
});
