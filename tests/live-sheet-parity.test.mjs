import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectDamage } from '../dist/frontend/projection.js';
import { compareSheetParity } from '../dist/frontend/sheet-parity.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));

async function loadData() {
  const files = {
    layout: 'equipment-layout.json', classes: 'classes.json', attributes: 'attributes.json', parameters: 'parameters.json',
    manifest: 'manifest.json', mapping: 'simulator-equipment-mapping.json', attack: 'attack-parameters.json',
    innerwear: 'innerwear-rules.json', appraisals: 'armor-appraisals.json', chips: 'equipment/chips.json',
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

test('線上試算表範例的三套右冰套效選擇可逐項重現計算機輸出', async () => {
  const [data, sample, expected] = await Promise.all([
    loadData(),
    readJson('examples/live-sheet-2026-09-28.json'),
    readJson('examples/live-sheet-2026-09-28-expected.json'),
  ]);
  const result = projectDamage(data, sample).result;
  const rows = compareSheetParity(result, expected);
  assert.equal(rows.length, 31);
  assert.deepEqual(rows.filter(row => !row.matches).map(row => row.cell), []);
  assert.deepEqual(['Right.Ice.SetEffect.1', 'Right.Ice.SetEffect.2', 'Right.Ice.SetEffect.3'].map(fieldId => sample.values[fieldId]), ['幽潮吞源', '日冕．灼耀花仙', '猛虎奇談']);

  const bleed = rows.find(row => row.cell === 'M1');
  const damage = rows.find(row => row.cell === 'B163');
  assert.equal(bleed.expected, 54.5);
  assert.equal(bleed.actual, 54.5);
  assert.equal(bleed.delta, 0);
  assert.equal(damage.expected, expected.b163RecomputedFromFormula);
  assert.notEqual(damage.expected, expected.cells.B163);
  assert.ok(Math.abs(damage.actual - damage.expected) < 1e-6);
});
