import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { projectAttributes, projectDamage } from '../dist/frontend/projection.js';
import { readCalculationComparisonValues } from '../dist/frontend/calculation-comparison.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const localReferenceUrl = new URL('../data/examples/live-sheet-2026-09-28-expected.json', import.meta.url);
const hasLocalReference = existsSync(localReferenceUrl);
const referenceMetricKeys = [
  ['C1', 'physicalAttack'], ['D1', 'magicalAttack'], ['E1', 'doubleAttackPct'], ['F1', 'critRatePct'],
  ['G1', 'extremizationPct'], ['H1', 'critDamagePct'], ['I1', 'bossDamagePct'], ['J1', 'polarizationPct'],
  ['K1', 'transcendenceSkillDamagePct'], ['L1', 'allSkillDamagePct'], ['M1', 'bleedDamagePct'],
  ['N1', 'strongerPct'], ['O1', 'heatPct'], ['P1', 'fullHealthKillDamagePct'], ['Q1', 'adaptabilityPct'],
  ['R1', 'defenseIgnorePct'], ['S1', 'multiplicativeEffect'], ['T1', 'multiplicativeCritDamage'],
  ['U1', 'attackLevel'], ['V1', 'skillTypeAttackPct'], ['W1', 'superAdaptabilityPct'],
  ['C53', 'weaponPhysicalBase'], ['D53', 'weaponMagicalBase'], ['B156', 'attackPower'],
  ['B157', 'lowerAttack'], ['B158', 'upperAttack'], ['B159', 'critRate'], ['B160', 'extremizationRate'],
  ['B161', 'nonDiminishingCritRate'], ['B162', 'nonDiminishingExtremizationRate'], ['B163', 'finalDamage'],
];

function compareWithLocalReference(result, reference) {
  const actualValues = readCalculationComparisonValues(result);
  return referenceMetricKeys.map(([cell, key]) => {
    const expected = cell === 'B163' && reference.b163RecomputedFromFormula !== undefined
      ? reference.b163RecomputedFromFormula : reference.cells[cell];
    const actual = actualValues[key];
    const delta = actual - expected;
    const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)));
    return { cell, expected, actual, delta, matches: Math.abs(delta) <= tolerance };
  });
}

async function loadData() {
  const files = {
    layout: 'equipment-layout.json', classes: 'classes.json', attributes: 'attributes.json', parameters: 'parameters.json',
    mapping: 'simulator-equipment-mapping.json', attack: 'attack-parameters.json',
    innerwear: 'innerwear-rules.json', nephronArmor: 'nephron-armor-rules.json', appraisals: 'armor-appraisals.json', chips: 'equipment/chips.json',
    chipSlots: 'chip-slots.json', circuits: 'circuit-board-rules.json', transformations: 'weapon-transformations.json',
    growth: 'weapon-growth.json', weaponAppraisals: 'weapon-appraisals.json', weaponGrades: 'weapon-grade-options.json',
    giantStones: 'giant-magic-stones.json', accessoryEffects: 'accessory-special-effects.json',
    classCombatEffects: 'class-combat-effects.json', classDamagePassives: 'class-damage-passives.json',
    combatRateSources: 'combat-rate-source-rules.json', simulatorInputs: 'simulator-input-options.json',
    rightIceSets: 'equipment/right-ice-set-effects.json', resonance: 'resonance-effects.json',
    raidSets: 'raid-set-effects.json', atma: 'atma-effects.json', masterBeast: 'master-beast-effects.json',
    spiritRecord: 'spirit-record-effects.json', otherEffects: 'other-effect-options.json', pets: 'pet-effects.json',
    colorSetEffects: 'color-set-effects.json',
  };
  const data = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readJson(path)])));
  const catalogFiles = [...new Set([
    ...data.mapping.selections.map(entry => entry.catalogFile),
    data.mapping.magicStoneSelections.catalogFile,
  ])];
  data.catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async path => [path, await readJson(path)])));
  return data;
}

test('本機維護參照可比對公開配裝範例的計算輸出', { skip: !hasLocalReference && '本機未安裝維護用驗算參照。' }, async () => {
  const [data, sample, expected] = await Promise.all([
    loadData(),
    readJson('examples/public-example-2026-09-28.json'),
    readJson('examples/live-sheet-2026-09-28-expected.json'),
  ]);
  const result = projectDamage(data, sample).result;
  const rows = compareWithLocalReference(result, expected);
  assert.equal(rows.length, 31);
  assert.deepEqual(rows.filter(row => !row.matches).map(row => row.cell), ['S1', 'B163']);
  const multiplier = rows.find(row => row.cell === 'S1');
  assert.ok(Math.abs(multiplier.actual / multiplier.expected - 1.13) < 1e-12);
  assert.deepEqual(['Right.Ice.SetEffect.1', 'Right.Ice.SetEffect.2', 'Right.Ice.SetEffect.3'].map(fieldId => sample.values[fieldId]), ['幽潮吞源', '日冕．灼耀花仙', '猛虎奇談']);

  const bleed = rows.find(row => row.cell === 'M1');
  const damage = rows.find(row => row.cell === 'B163');
  assert.equal(bleed.expected, 54.5);
  assert.equal(bleed.actual, 54.5);
  assert.equal(bleed.delta, 0);
  assert.equal(damage.expected, expected.b163RecomputedFromFormula);
  assert.notEqual(damage.expected, expected.cells.B163);
  assert.equal(result.attributes.stats.strongSkillDamagePct.finalTotal, 94);
  assert.equal(result.finalDamage.skillDamageWeighting.transcendenceSharePct, 100);
  assert.equal(result.finalDamage.skillDamageWeighting.strongSharePct, 0);
  assert.ok(Math.abs(damage.actual / damage.expected - 1.13) < 1e-12);
  const weaponStoneSources = projectAttributes(data, sample).calculationSources.shared.filter(source => source.sourceId.startsWith('weapon-magic-stone:'));
  const level = weaponStoneSources.reduce((sum, source) => sum + (source.stats.attackLevel ?? 0), 0);
  const doubleAttack = weaponStoneSources.reduce((sum, source) => sum + (source.stats.doubleAttackPct ?? 0), 0);
  assert.equal(level, 18);
  assert.equal(doubleAttack, 31.5);

  const manuallyChanged = structuredClone(sample);
  for (const group of data.weaponGrades.colorGroups) {
    const preset = group.options.find(option => option.id === group.presetByGrade['深淵']);
    for (const cell of group.selectorCells) manuallyChanged.values[cell] = preset.name;
  }
  manuallyChanged.values['Weapon.MagicStone.Red.1'] = '攻擊力等級+1.5';
  manuallyChanged.values['Weapon.MagicStone.Yellow.1'] = '致命一擊傷害+1.7%';
  const custom = projectDamage(data, manuallyChanged).result.attributes.stats;
  assert.equal(custom.attackLevel.finalTotal, result.attributes.stats.attackLevel.finalTotal - 0.5);
  assert.equal(custom.doubleAttackPct.finalTotal, result.attributes.stats.doubleAttackPct.finalTotal - 1.5);
  assert.equal(custom.critDamagePct.finalTotal, result.attributes.stats.critDamagePct.finalTotal + 1.7);
});

test('被侵蝕的荊棘角把310秒Buff週期平均放入乘算效果，並單獨記錄適應力與動作速度', async () => {
  const [data, sourceState] = await Promise.all([
    loadData(),
    readJson('examples/public-example-2026-09-28.json'),
  ]);
  const base = projectDamage(data, sourceState).result;
  const baseProjection = projectAttributes(data, sourceState);
  const previousFaceTop = baseProjection.calculationSources.shared.find(source => source.sourceId === 'simulator:Accessory.FaceTop');
  const previousMultiplicativePct = previousFaceTop?.stats.multiplicativeDamagePct ?? 0;
  const equippedState = structuredClone(sourceState);
  equippedState.values['Accessory.FaceTop'] = '被侵蝕的荊棘角';

  const formulaPct = (0.04 * (5 / 310) + 0.08 * (5 / 310) + ((1 + 0.12) * (1 + 0.03) - 1) * (300 / 310)) * 100;
  const equippedProjection = projectAttributes(data, equippedState);
  const contribution = equippedProjection.calculationSources.shared.find(source => source.sourceId === 'simulator:Accessory.FaceTop');
  assert.ok(contribution);
  assert.equal(contribution.stats.adaptabilityPct, 3);
  assert.equal(contribution.stats.actionSpeedPct, 3);
  assert.equal(contribution.stats.multiplicativeDamagePct, 15.0580645161291);

  const equipped = projectDamage(data, equippedState).result;
  assert.equal(equipped.attributes.stats.actionSpeedPct.finalTotal, 3);
  assert.equal(equipped.attributes.stats.allSkillDamagePct.finalTotal, base.attributes.stats.allSkillDamagePct.finalTotal);
  assert.equal(equipped.attributes.stats.doubleAttackPct.finalTotal, base.attributes.stats.doubleAttackPct.finalTotal);
  const expectedProduct = base.generalMultiplicativeDamage.value / (1 + previousMultiplicativePct / 100) * (1 + formulaPct / 100);
  assert.ok(Math.abs(equipped.generalMultiplicativeDamage.value - expectedProduct) < 1e-12);

  const item = data.catalogs['equipment/accessories.json'].items.find(entry => entry.name === '被侵蝕的荊棘角');
  assert.equal(item.appraisal.canAppraise, false);
  assert.match(item.description, /使用特殊主動技能時/);
  assert.match(item.developerNote, /15\.0580645161291%/);
});
