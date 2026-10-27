import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchIce, sameDamage, generateIceSearchStructures, isThreeSetIceCandidate } from '../../../dist/features/ice-optimizer/frontend/search.js';
import { countSearchSpace, exhaustiveReference, evaluateCandidate } from './exact-reference.mjs';
import { assertCompleteIceStudy, optimalityFixture, completeIceFixture, synergyFixture, tieFixture, growIceData } from './optimality-fixtures.mjs';
import { iceScenario } from './scenarios.mjs';
import { createIceSearchDomains } from '../../../dist/features/ice-optimizer/frontend/search-policy.js';
import { effectiveSetNames } from './exact-reference.mjs';

const data = JSON.parse(readFileSync('dist/data/game-data.json', 'utf8'));
const example = JSON.parse(readFileSync('data/examples/public-example-2026-09-28.json', 'utf8'));
const signature = candidate => JSON.stringify([Object.entries(candidate.choices).sort(), [...candidate.setNames].sort()]);

test('固定搜尋情境只使用傷害計算機可選的關卡數值', () => {
  for (let index = 0; index < 20; index += 1) {
    assertCompleteIceStudy(data, iceScenario(data, example, index));
  }
  for (const field of ['Stage.Adapt', 'Stage.BossDEF', 'Stage.CritRatePenalty']) {
    const input = data.simulatorInputs.inputs.find(entry => entry.fieldIds.includes(field));
    const catalog = data.simulatorInputs.catalogs.find(entry => entry.id === input?.catalogId);
    const allowed = new Set(catalog?.options.map(entry => entry.value));
    assert.ok(allowed.size > 0, `${field} 缺少可選數值`);
    for (let index = 0; index < 20; index += 1) {
      assert.ok(allowed.has(iceScenario(data, example, index).values[field]), `${field} 情境 ${index} 超出 UI 選項`);
    }
    if (field === 'Stage.Adapt') assert.equal(Math.max(...allowed), 95);
  }
});

test('八部位、空裝與非法關卡不得冒充完整十二部位實戰品質比較', () => {
  const reduced = optimalityFixture(data, example, { slots: 8 });
  assert.throws(() => assertCompleteIceStudy(reduced.data, reduced.state), /12 distinct/);
  const full = completeIceFixture(data, example);
  assert.doesNotThrow(() => assertCompleteIceStudy(full.data, full.state));
  const missing = structuredClone(full.state);
  missing.values['Ice.Weapon.Set'] = '';
  assert.throws(() => assertCompleteIceStudy(full.data, missing), /Ice.Weapon.Set/);
  const invalid = structuredClone(full.state);
  invalid.values['Stage.Adapt'] = 96;
  assert.throws(() => assertCompleteIceStudy(full.data, invalid), /Stage.Adapt/);
});

for (const index of [0, 17]) test(`完整十二部位真實裝備情境 ${index} 的計數、傷害及 Top K 與精確枚舉一致`, async () => {
  const fixture = completeIceFixture(data, example, index);
  const count = countSearchSpace(fixture.data, fixture.state);
  const truth = exhaustiveReference(fixture.data, fixture.state, {}, Infinity,
    candidate => candidate.setNames.length === 3 && candidate.setNames.every(name =>
      Object.values(candidate.choices).filter(value => value === name).length >= 3));
  assert.equal(count.domains.length, 12);
  assert.ok(count.domains.some(domain => domain.field === 'Ice.Weapon.Set'));
  assert.ok(count.domains.every(domain => domain.names.length === 2 && !domain.names.includes('')));
  assert.ok(BigInt(truth.evaluated.length) < count.count && truth.evaluated.length > 0,
    '三組 3set 正式搜尋域應是完整遊戲合法空間的真子集');
  const result = await searchIce(fixture.data, fixture.state, () => {});
  assert.equal(result.bestSearchDomainDamage, truth.upperBound);
  assert.deepEqual(result.results.map(group => ({ damage: group.damage,
    alternatives: group.alternatives.map(signature).sort() })),
    truth.groups.map(group => ({ damage: group.damage, alternatives: group.alternatives.map(signature).sort() })));
  assert.ok(truth.groups[0].alternatives.every(candidate =>
    Object.keys(candidate.choices).length === 12 && candidate.choices['Ice.Weapon.Set']));
  assert.ok(result.results.flatMap(group => group.alternatives).every(candidate =>
    isThreeSetIceCandidate(fixture.data, candidate.choices, candidate.setNames)));
  assert.equal(result.globallyOptimalProven, false, '小型外部枚舉證明不得冒充正式大範圍的全域證明');
});

for (const size of [2, 3]) test(`完整引擎可重現必須同時更換 ${size} 部位的嚴格局部陷阱`, async () => {
  const fixture = synergyFixture(data, example, size);
  const right = fixture.data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const initial = { choices: Object.fromEntries(right.map(entry => [entry.selectionField, fixture.state.values[entry.selectionField]])), setNames: ['研究套裝A'] };
  const baseline = evaluateCandidate(fixture.data, fixture.state, initial).damage;
  const truth = exhaustiveReference(fixture.data, fixture.state);
  for (const candidate of truth.evaluated) {
    const distance = right.filter(entry => candidate.choices[entry.selectionField] !== initial.choices[entry.selectionField]).length;
    if (distance < size) assert.ok(candidate.damage <= baseline || sameDamage(candidate.damage, baseline));
  }
  assert.ok(truth.upperBound > baseline);
  await assert.rejects(searchIce(fixture.data, fixture.state, () => {}), /12 個右冰部位/);
});

test('真正最高傷害的十五組等傷害穿搭與 Top K 邊界不會被順序任意裁掉', async () => {
  const fixture = tieFixture(data, example);
  const truth = exhaustiveReference(fixture.data, fixture.state);
  assert.equal(truth.evaluated.length, 5 * 3, '兩個必要部位各選真實裝備，不另計空欄');
  assert.equal(truth.groups[0].alternatives.length, 15);
  await assert.rejects(searchIce(fixture.data, fixture.state, () => {}), /12 個右冰部位/);
});

test('極不均衡的部位候選與新增裝備會改變真正最佳配置，但不修改正式資料', async () => {
  const original = JSON.stringify(data);
  const fixture = tieFixture(data, example, 40, 2, true);
  const before = exhaustiveReference(fixture.data, fixture.state);
  assert.equal(before.evaluated.length, 40 * 2, '兩個必要部位各選真實裝備，不另計空欄');
  fixture.data.catalogs['equipment/right-ice.json'].items.push({
    id: 'research:improved', name: '研究新最優武器', slotId: 'weapon', active: true,
    stats: { physicalAttack: 10_000, magicalAttack: 10_000, allSkillDamagePct: 1000 },
  });
  const after = exhaustiveReference(fixture.data, fixture.state);
  assert.ok(after.upperBound > before.upperBound);
  await assert.rejects(searchIce(fixture.data, fixture.state, () => {}), /12 個右冰部位/);
  assert.equal(JSON.stringify(data), original);
});

test('未來成長資料具有不同屬性、唯一的部位名稱與 ID，不以完全重複裝備灌水', () => {
  const original = JSON.stringify(data);
  for (const model of ['existing-slots', 'series', 'skewed', 'interaction']) {
    const grown = growIceData(data, model, 1.5);
    const items = grown.catalogs['equipment/right-ice.json'].items;
    assert.ok(items.length > data.catalogs['equipment/right-ice.json'].items.length);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    assert.equal(new Set(items.map(item => item.slotId + ':' + item.name)).size, items.length);
    assert.ok(items.filter(item => item.id.startsWith('research:')).every(item => Object.values(item.stats).every(Number.isFinite)));
  }
  assert.equal(JSON.stringify(data), original);
});

test('結構起點的有限前綴與完整生成順序完全相同，且每個起點唯一', () => {
  const full = generateIceSearchStructures(data, example.values);
  assert.equal(full.stats.generationComplete, true);
  assert.equal(new Set(full.seeds.map(signature)).size, full.seeds.length);
  for (const limit of [1, 20, 300]) {
    const limited = generateIceSearchStructures(data, example.values, {}, limit);
    assert.deepEqual(limited.seeds, full.seeds.slice(0, limit));
    assert.equal(limited.stats.generationComplete, false);
  }
  assert.throws(() => generateIceSearchStructures(data, example.values, {}, 0), /seed limit/);
});

for (const model of ['existing-slots', 'series']) test(`以合法關卡值重新驗算 ${model} 歷史反例；已知較佳配裝作基準時不得退步`, async () => {
  const records = JSON.parse(readFileSync('features/ice-optimizer/tests/fixtures/research-results.json', 'utf8'));
  const record = records.cases.findLast(entry => entry.options.mode === 'witness' && entry.options.model === model);
  assert.ok(record, '完整反例須保存，不得只留下統計');
  const game = growIceData(data, model, 2), state = iceScenario(data, example, 0);
  const domains = createIceSearchDomains(game, state.values);
  const witness = record.witness;
  assert.ok(domains.every(domain => domain.names.includes(witness.choices[domain.field])));
  const effective = effectiveSetNames(game, Object.values(witness.choices));
  assert.ok(witness.setNames.every(name => effective.includes(name)));
  const verified = evaluateCandidate(game, state, witness);
  const earlierWinner = evaluateCandidate(game, state, record.measuredWinner.alternatives[0]);
  assert.ok(Number.isFinite(verified.damage));
  assert.ok(Number.isFinite(earlierWinner.damage));
  assert.ok(verified.damage > earlierWinner.damage);
  const values = { ...state.values, ...witness.choices };
  game.rightIceSets.selectionFields.forEach((field, index) => { values[field] = witness.setNames[index] ?? ''; });
  const kept = await searchIce(game, { ...state, values }, () => {}, { fixedFields: domains.map(domain => domain.field) });
  assert.equal(kept.baselineInScope, true);
  assert.ok(kept.results[0].damage >= verified.damage);
  assert.equal(kept.globallyOptimalProven, false, '已知下界不等於真正最佳答案');
});
