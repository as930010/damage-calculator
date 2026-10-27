import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createIceSearchDomains, snapshotIceSearchConstraints } from '../../../dist/features/ice-optimizer/frontend/search-policy.js';
import { generateIceSearchStructures, isThreeSetIceCandidate, searchIce } from '../../../dist/features/ice-optimizer/frontend/search.js';
import { resolveRightIceSetEffects } from '../../../dist/calculation/equipment-effects.js';
import { projectDamage } from '../../../dist/frontend/projection.js';

const data = JSON.parse(readFileSync('dist/data/game-data.json', 'utf8'));
const sample = JSON.parse(readFileSync('data/examples/public-example-2026-09-28.json', 'utf8'));
const right = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
const items = data.catalogs['equipment/right-ice.json'].items;
const excluded = new Set(['神埃', '騎士團']);
const choices = Object.fromEntries(right.map(entry => [entry.selectionField, String(sample.values[entry.selectionField] ?? '')]));
const equipped = Object.fromEntries(right.map(entry => {
  const names = items.filter(item => item.active && item.slotId === entry.slotId && !excluded.has(item.name)).map(item => item.name);
  return [entry.selectionField, names.includes(choices[entry.selectionField]) ? choices[entry.selectionField] : names[0]];
}));

test('預設政策精確排除兩系列，保留原始資料與舊版完整候選政策', () => {
  const original = JSON.stringify(data);
  const all = createIceSearchDomains(data, choices, { excludedSeries: [] });
  const defaults = createIceSearchDomains(data, choices);
  assert.equal(all.reduce((sum, domain) => sum + domain.names.length, 0)
    - defaults.reduce((sum, domain) => sum + domain.names.length, 0), 19);
  assert.equal(defaults.length, 12);
  assert.ok(defaults.every(domain => domain.names.length > 0 && !domain.names.includes('')));
  assert.ok(defaults.every(domain => domain.names.every(name => !excluded.has(name))));
  assert.ok(all.some(domain => domain.names.includes('神埃')));
  assert.ok(all.every(domain => domain.names.includes('騎士團')));
  assert.equal(JSON.stringify(data), original);
  for (const seed of generateIceSearchStructures(data, choices).seeds) {
    assert.ok(Object.values(seed.choices).every(name => !excluded.has(name)));
    assert.ok(seed.setNames.every(name => !excluded.has(name)));
  }
});

test('指定裝備以穩定 ID 只覆寫該部位的預設排除，固定部位亦可保留排除裝備', () => {
  const field = right.find(entry => entry.slotId === 'top');
  const item = items.find(item => item.slotId === 'top' && item.name === '神埃');
  const required = { requiredItemIds: { [field.selectionField]: item.id } };
  const domains = createIceSearchDomains(data, choices, required);
  assert.deepEqual(domains.find(domain => domain.field === field.selectionField).names, ['神埃']);
  assert.ok(domains.filter(domain => domain.field !== field.selectionField)
    .every(domain => domain.names.every(name => !excluded.has(name))));
  assert.deepEqual(createIceSearchDomains(data, { ...choices, [field.selectionField]: '神埃' },
    { fixedFields: [field.selectionField] }).find(domain => domain.field === field.selectionField).names, ['神埃']);
  const constraints = snapshotIceSearchConstraints(required);
  required.requiredItemIds[field.selectionField] = 'changed';
  assert.equal(constraints.requiredItemIds[field.selectionField], item.id);
});

test('冰武與其餘十一部位共同計數，二件與三件以上套效遵守正式解析器', async () => {
  const outfit = Object.fromEntries(right.map(entry => {
    const fallback = items.find(item => item.active && item.slotId === entry.slotId
      && item.name !== '幻影面紗' && !excluded.has(item.name));
    assert.ok(fallback, `${entry.selectionField} 缺少合法的非面紗裝備`);
    return [entry.selectionField, fallback.name];
  }));
  const phantomSlots = ['Ice.Weapon.Set', 'Right.Ice.FaceTop', 'Right.Ice.Support', 'Right.Ice.Top'];
  for (const count of [2, 3, 4]) {
    const choicesForCount = { ...outfit };
    phantomSlots.slice(0, count).forEach(field => { choicesForCount[field] = '幻影面紗'; });
    const equippedNames = right.map(entry => choicesForCount[entry.selectionField]);
    const effects = resolveRightIceSetEffects(data.rightIceSets, equippedNames, ['幻影面紗']);
    assert.equal(effects.length, 1);
    assert.equal(effects[0].sourceId, count === 2
      ? 'right-ice-set-effects-656dd55982fe' : 'right-ice-set-effects-68641ac41a43');
    assert.equal(equippedNames.length, 12);
  }
});

test('正式搜尋拒絕不存在於關卡選項的數值', async () => {
  const values = { ...sample.values, ...equipped, 'Stage.Adapt': 96 };
  await assert.rejects(searchIce(data, { ...sample, values }, () => {}), /Stage.Adapt/);
  values['Stage.Adapt'] = 95;
  values['Stage.BossDEF'] = 72;
  await assert.rejects(searchIce(data, { ...sample, values }, () => {}), /Stage.BossDEF/);
});

test('固定與指定衝突、錯誤 ID 或錯誤部位會明確回報約束無可行解', () => {
  assert.throws(() => createIceSearchDomains(data, choices, { fixedFields: ['missing'] }), /約束無可行解/);
  assert.throws(() => createIceSearchDomains(data, choices, { requiredItemIds: { 'Ice.Weapon.Set': 'missing' } }), /約束無可行解/);
  const item = items.find(item => item.name === '神埃');
  assert.throws(() => createIceSearchDomains(data, choices, { requiredItemIds: { 'Ice.Weapon.Set': item.id } }), /約束無可行解/);
  const weapon = items.find(item => item.slotId === 'weapon' && item.name === '騎士團');
  assert.throws(() => createIceSearchDomains(data, { ...choices, 'Ice.Weapon.Set': '' },
    { fixedFields: ['Ice.Weapon.Set'], requiredItemIds: { 'Ice.Weapon.Set': weapon.id } }), /衝突/);
  assert.throws(() => createIceSearchDomains(data, { ...equipped, 'Ice.Weapon.Set': '' },
    { fixedFields: ['Ice.Weapon.Set'] }), /無法固定/);
});

test('還原舊結果時，3×3 候選仍須符合搜尋開始時的固定部位', () => {
  const seeds = generateIceSearchStructures(data, choices).seeds;
  const original = seeds[0];
  const field = right.find(entry => seeds.some(seed => seed.choices[entry.selectionField]
    !== original.choices[entry.selectionField])).selectionField;
  const different = seeds.find(seed => seed.choices[field] !== original.choices[field]);
  const constraints = { fixedFields: [field] };
  assert.ok(isThreeSetIceCandidate(data, original.choices, original.setNames,
    constraints, original.choices));
  assert.equal(isThreeSetIceCandidate(data, different.choices, different.setNames,
    constraints, original.choices), false);
});

test('多件指定騎士團可正常啟用既有套效，結構產生與全部搜尋階段均保留固定部位', async () => {
  const state = { ...sample, values: { ...sample.values, ...equipped } };
  for (const field of data.rightIceSets.selectionFields) state.values[field] = '';
  const knightSlots = right.slice(0, 4);
  const requiredItemIds = Object.fromEntries(knightSlots.map(entry => [entry.selectionField,
    items.find(item => item.slotId === entry.slotId && item.name === '騎士團').id]));
  const required = { requiredItemIds };
  const seed = generateIceSearchStructures(data, state.values, required).seeds[0];
  assert.ok(seed);
  const stateWithFixed = { ...state, values: { ...state.values, ...seed.choices } };
  for (const entry of knightSlots) stateWithFixed.values[entry.selectionField] = equipped[entry.selectionField];
  const constraints = { fixedFields: right.filter(entry => !knightSlots.includes(entry)).map(entry => entry.selectionField), requiredItemIds };
  const generated = generateIceSearchStructures(data, stateWithFixed.values, constraints);
  assert.ok(generated.seeds.length);
  assert.ok(generated.seeds.every(seed => knightSlots.every(entry => seed.choices[entry.selectionField] === '騎士團')));
  const four = generated.seeds.find(seed => seed.setNames.includes('騎士團'));
  assert.ok(four);
  assert.equal(four.counts[four.setNames.indexOf('騎士團')], 4);
  const sources = resolveRightIceSetEffects(data.rightIceSets, Object.values(four.choices), four.setNames);
  assert.ok(sources.some(source => source.sourceId === 'right-ice-set-effects-c979fe541d3c'));
  const result = await searchIce(data, stateWithFixed, () => {}, constraints);
  assert.equal(result.baselineGameLegal, true);
  assert.equal(result.baselineInScope, false, '尚未穿上指定裝備的目前配置只能作外部基準');
  assert.ok(result.results.length);
  for (const group of result.results) for (const candidate of group.alternatives) {
    assert.ok(knightSlots.every(entry => candidate.choices[entry.selectionField] === '騎士團'));
    assert.ok(right.filter(entry => !knightSlots.includes(entry)).every(entry =>
      candidate.choices[entry.selectionField] === seed.choices[entry.selectionField]));
    const values = { ...stateWithFixed.values, ...candidate.choices };
    data.rightIceSets.selectionFields.forEach((field, index) => { values[field] = candidate.setNames[index] ?? ''; });
    assert.equal(projectDamage(data, { ...stateWithFixed, values }).result.finalDamage.finalDamage, candidate.damage);
  }
});

test('排除裝備可作外部基準，但不會自行回到正式推薦或重新解禁其他部位', async () => {
  const state = { ...sample, values: { ...sample.values, ...equipped } };
  for (const field of data.rightIceSets.selectionFields) state.values[field] = '';
  state.values['Ice.Weapon.Set'] = '騎士團';
  const seed = generateIceSearchStructures(data, state.values).seeds[0];
  assert.ok(seed);
  for (const entry of right) if (entry.selectionField !== 'Ice.Weapon.Set') state.values[entry.selectionField] = seed.choices[entry.selectionField];
  const constraints = { fixedFields: right.filter(entry => entry.selectionField !== 'Ice.Weapon.Set').map(entry => entry.selectionField) };
  const updates = [];
  const result = await searchIce(data, state, update => { if (update.results) updates.push(update); }, constraints);
  assert.equal(result.baselineGameLegal, true);
  assert.equal(result.baselineInScope, false);
  assert.equal(result.baseline.damage, projectDamage(data, state).result.finalDamage.finalDamage);
  for (const groups of [result.results, ...updates.map(update => update.results)]) {
    assert.ok(groups.flatMap(group => group.alternatives).every(candidate =>
      Object.values(candidate.choices).every(name => !excluded.has(name))));
  }
});

test('指定單件神埃時，完整搜尋保留該件裝備而不解禁其他部位', async () => {
  const state = { ...sample, values: { ...sample.values, ...equipped } };
  for (const field of data.rightIceSets.selectionFields) state.values[field] = '';
  const field = right.find(entry => entry.slotId === 'top');
  const item = items.find(item => item.slotId === 'top' && item.name === '神埃');
  const required = { requiredItemIds: { [field.selectionField]: item.id } };
  const seed = generateIceSearchStructures(data, state.values, required).seeds[0];
  assert.ok(seed);
  for (const entry of right) if (entry !== field) state.values[entry.selectionField] = seed.choices[entry.selectionField];
  const constraints = { fixedFields: right.filter(entry => entry !== field).map(entry => entry.selectionField),
    ...required };
  const result = await searchIce(data, state, () => {}, constraints);
  assert.ok(result.results.length);
  assert.ok(result.results.flatMap(group => group.alternatives).every(candidate =>
    candidate.choices[field.selectionField] === '神埃' && right.filter(entry => entry !== field)
      .every(entry => candidate.choices[entry.selectionField] === seed.choices[entry.selectionField])));
});

test('固定裝備無法形成三組 3set 時明確拒絕，不放寬搜尋範圍', async () => {
  const values = { ...sample.values, ...Object.fromEntries(right.map(entry => [entry.selectionField, '騎士團'])) };
  await assert.rejects(searchIce(data, { ...sample, values }, () => {},
    { fixedFields: right.map(entry => entry.selectionField) }), /無法組成三組各至少三件/);
});
