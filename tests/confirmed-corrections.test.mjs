import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveInnerwearSources } from '../dist/calculation/innerwear.js';
import { resolveWeaponTransformationsFromCells } from '../dist/calculation/weapon-transformations.js';
import { aggregateCharacterAttributes, prepareCharacterAttributeInput } from '../dist/calculation/attribute-aggregation.js';
import { createFieldValues } from '../dist/frontend/state.js';

const json = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const [rules, attack, transforms, layout, mapping] = await Promise.all(['innerwear-rules.json', 'attack-parameters.json', 'weapon-transformations.json', 'equipment-layout.json', 'simulator-equipment-mapping.json'].map(json));
const resolve = (values, enabled = true) => resolveInnerwearSources(rules, attack, 'DaB', createFieldValues(values), enabled);

test('強/排褲魔攻取 H21，變動 H12 不會改變這件裝備', () => {
  const first = resolve({ H12: 'Lv.8', J12: 21, H21: 'Lv.13', J21: 21 });
  const second = resolve({ H12: 'Lv.10', J12: 21, H21: 'Lv.13', J21: 21 });
  assert.deepEqual(first.lowerwearB, second.lowerwearB);
  const coefficient = attack.classes.DaB.magical;
  const expected = Math.floor(0.05 * (0.85 * coefficient - 0.7775 * 400) + 0.05 * (0.15 * coefficient - 0.0225 * 400) * 119 + 0.5) * 3.35 + 2000;
  assert.equal(first.lowerwearB[0].stats.magicalAttack, expected);
  assert.equal(resolve({ H21: 'Lv.13', J21: 21 }, false).lowerwearB.length, 0);
});

test('五個內裝配置的 Lv.13 均有 Boss 5、適應 3；鍛造 21 再加適應 2', () => {
  const values = Object.fromEntries(rules.slots.flatMap(slot => [[slot.enhancementCell, 'Lv.13'], [slot.forgingCell, 0]]));
  const source = resolve(values);
  for (const entry of [...source.shared, ...source.lowerwearA, ...source.lowerwearB]) {
    assert.equal(entry.stats.bossDamagePct, 5); assert.equal(entry.stats.adaptabilityPct, 3);
  }
  assert.equal(resolve({ H3: 'Lv.13', J3: 21 }).shared[0].stats.adaptabilityPct, 5);
});

test('鍛造門檻取已達成的最高階，未達首個門檻為零，不累加階層', () => {
  const cases = [[0,0,0,0],[2,0,0,0],[3,3,0,0],[5,3,0,0],[6,3,3,0],[8,3,3,0],[9,6,3,0],[11,6,3,0],[12,6,6,0],[14,6,6,0],[15,6,6,2],[17,6,6,2],[18,6,10,2],[21,6,10,2]];
  for (const [level, crit, skill, doubleAttack] of cases) {
    const stats = resolve({ H3: 'Lv.13', J3: level }).shared[0].stats;
    assert.deepEqual([stats.critDamagePct, stats.transcendenceSkillDamagePct, stats.doubleAttackPct], [crit,skill,doubleAttack], `鍛造 ${level}`);
  }
});

test('四個武器變換共用 B32 強化，不受 B33:B35 文字內數字影響', () => {
  const values = { B32: 'Lv.13', B33: '成長6', B34: '3.5%', B35: '2.25%' };
  for (const slot of transforms.slots) { values[slot.choiceCell] = '雙攻% × 強化'; values[slot.valueCell] = .01; }
  const result = resolveWeaponTransformationsFromCells(transforms, createFieldValues(values));
  assert.equal(result.length, 4);
  for (const entry of result) assert.equal(entry.stats.doubleAttackPct, 13);
  assert.deepEqual(resolveWeaponTransformationsFromCells(transforms, createFieldValues({ ...values, B33: '成長1', B34: '9%', B35: '8%' })), result);
});

test('十二種武器變換都依自己的規則換算，所有「×強化」只讀取 B32', () => {
  const values = { B32: 'Lv.11', B33: 'Lv.2', B34: 'Lv.3', B35: 'Lv.4' };
  for (const slot of transforms.slots) {
    values[slot.choiceCell] = '';
    values[slot.valueCell] = 0.02;
  }
  for (const rule of transforms.rules) {
    for (const slot of transforms.slots) {
      values[slot.choiceCell] = rule.choice;
      const [actual] = resolveWeaponTransformationsFromCells(transforms, createFieldValues(values)).filter(entry => entry.sourceId === `weapon-transform:${slot.choiceCell}`);
      const expected = 0.02 * rule.valueMultiplier * (rule.strengthenByFirstIntegerFrom ? 11 : 1);
      assert.equal(actual.stats[rule.statKey], expected, `${slot.choiceCell}: ${rule.choice}`);
      values[slot.choiceCell] = '';
    }
  }
  const withoutEnhancement = { ...values, B32: '', B33: 'Lv.13' };
  values.B42 = '雙攻% × 強化';
  withoutEnhancement.B42 = '雙攻% × 強化';
  assert.equal(resolveWeaponTransformationsFromCells(transforms, createFieldValues(withoutEnhancement))[0].stats.doubleAttackPct, 0);
});


test('兩極化／適應力上限在全角色彙總後套用，極大化無 60 上限', () => {
  const rules = ['polarizationPct','adaptabilityPct','extremizationPct'].map(key => ({ key, aggregation:'sum', ...(key !== 'extremizationPct' ? { cap: { value:60, scope: 'characterTotal' } } : {}) }));
  const prepared = prepareCharacterAttributeInput(rules, { shared:[{ sourceId:'shared',stats:{polarizationPct:55,adaptabilityPct:55,extremizationPct:90}}],lowerwearA:[{sourceId:'a',stats:{polarizationPct:20,adaptabilityPct:20}}],lowerwearB:[{sourceId:'b',stats:{polarizationPct:40,adaptabilityPct:40}}],lowerwearAlternativeEnabled:true });
  const result = aggregateCharacterAttributes(prepared.attributeInput);
  assert.equal(result.stats.polarizationPct.finalTotal,60);
  assert.equal(result.stats.adaptabilityPct.finalTotal,60);
  assert.equal(result.stats.extremizationPct.finalTotal,90);
});

test('部位圖涵蓋所有裝備選擇與魔法石，魔法石沒有重複或漏列', () => {
  const equipment = new Set(layout.slots.map(slot => slot.selectionCell).filter(Boolean));
  assert.deepEqual([...equipment].sort(), mapping.selections.map(entry => entry.selectionCell).sort());
  const stones = layout.slots.flatMap(slot => slot.stoneCells ?? []);
  assert.equal(stones.length, new Set(stones).size);
  assert.deepEqual(stones.sort(), mapping.magicStoneSelections.inputGroups.map(entry => entry.selectionCell).sort());
});

