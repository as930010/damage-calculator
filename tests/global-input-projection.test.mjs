import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectAttributes, projectDamage } from '../dist/frontend/projection.js';
import { resolveMasterBeastEffects, resolveRightIceSetEffects } from '../dist/calculation/equipment-effects.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));

async function loadData() {
  const [layout, classes, attributes, parameters, manifest, mapping, attack, innerwear, appraisals, chips,
    chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, accessoryEffects, classCombatEffects,
    classDamagePassives, combatRateSources, simulatorInputs, rightIceSets, resonance, raidSets, atma,
    masterBeast, spiritRecord, otherEffects, pets, colorSetEffects] = await Promise.all([
    readJson('equipment-layout.json'), readJson('classes.json'), readJson('attributes.json'), readJson('parameters.json'),
    readJson('manifest.json'), readJson('simulator-equipment-mapping.json'), readJson('attack-parameters.json'),
    readJson('innerwear-rules.json'), readJson('armor-appraisals.json'), readJson('equipment/chips.json'),
    readJson('chip-slots.json'), readJson('circuit-board-rules.json'), readJson('weapon-transformations.json'),
    readJson('weapon-growth.json'), readJson('weapon-appraisals.json'), readJson('weapon-grade-options.json'), readJson('giant-magic-stones.json'),
    readJson('accessory-special-effects.json'),
    readJson('class-combat-effects.json'), readJson('class-damage-passives.json'), readJson('combat-rate-source-rules.json'),
    readJson('simulator-input-options.json'), readJson('equipment/right-ice-set-effects.json'), readJson('resonance-effects.json'),
    readJson('raid-set-effects.json'), readJson('atma-effects.json'), readJson('master-beast-effects.json'),
    readJson('spirit-record-effects.json'), readJson('other-effect-options.json'), readJson('pet-effects.json'), readJson('color-set-effects.json'),
  ]);
  const catalogFiles = [...new Set([...mapping.selections.map(entry => entry.catalogFile), mapping.magicStoneSelections.catalogFile])];
  const catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async file => [file, await readJson(file)])));
  return { layout, classes, attributes, parameters, manifest, mapping, attack, innerwear, appraisals, chips, chipSlots,
    circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, accessoryEffects, classCombatEffects, classDamagePassives,
    combatRateSources, simulatorInputs, rightIceSets, resonance, raidSets, atma, masterBeast, spiritRecord,
    otherEffects, pets, colorSetEffects, catalogs };
}

function enableSelectedAccessoryAppraisals(data, values) {
  const catalog = data.catalogs['equipment/accessories.json'];
  for (const group of data.accessoryEffects.groups) {
    const name = values[group.selectionCell];
    const item = catalog.items.find(entry => entry.slotId === group.slotId && entry.name === name);
    if (item) item.appraisal = { canAppraise: true, effectCount: group.inputCells.length };
  }
}

test('巨型魔力石新增選項會分別增加雙攻%與攻擊力等級', async () => {
  const data = await loadData();
  const baseState = { schemaVersion: 3, Job: 'KE', values: {}, lowerwearAlternativeEnabled: false };
  const base = projectAttributes(data, baseState);
  const cases = [
    ['攻擊力+5%', 'doubleAttackPct', 5],
    ['攻擊力等級+6', 'attackLevel', 6],
  ];

  for (const [option, stat, expectedIncrease] of cases) {
    const values = { ...baseState.values, 'Weapon.GiantStone.1': option };
    const actual = projectAttributes(data, { ...baseState, values });
    assert.equal(actual.stats[stat].finalTotal - base.stats[stat].finalTotal, expectedIncrease);
  }
});

test('JSON 選擇的全域來源進入角色彙總與 B163 傷害流程', async () => {
  const data = await loadData();
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0 };
  const base = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: baseValues, lowerwearAlternativeEnabled: false }).result;
  const values = {
    ...baseValues,
    "Effect.Title": 'Dogma', "Effect.Emblem": '有', "Effect.Consumable": '適應靈藥', "Effect.Environment": '集合地', "Peak.Option": '精神挑戰者', "Effect.PortraitAwakening": '有', "Pet.Passive": '致命一擊+4%', "MasterBeast.OverallPotential": 'Boss傷害+1%',
    "Ice.Weapon.Set": '騎士團', "Right.Ice.WeaponAccessory": '騎士團', "Right.Ice.FaceTop": '騎士團',
    "Accessory.FaceMiddle": '亞特瑪臉中', "Accessory.FaceBottom": '亞特瑪臉下', "Accessory.Arm": '亞特瑪手臂', "Accessory.Necklace": '亞特瑪項鍊', "Atma.Element": '草木', "Atma.Color": '米色',
    "GuildFountain.Stage2": '致命一擊+3%', "GuildFountain.Stage3": '雙攻+0.6%', "GuildFountain.Stage4": '強者+3%', "Resonance.AllATK.Points": 1, "Resonance.TranscendenceSkillDMG.Points": 10, "Resonance.Polarization.Points": 10, "Resonance.BossDMG.Points": 10, "Resonance.Adapt.Points": 10,
    "MasterBeast.Head.Option1": '致命一擊8%', "MasterBeast.Head.Option2": '極大化8%', "MasterBeast.Head.CustomAttribute": '致命一擊', "MasterBeast.Head.CustomValue": 5, "MasterBeast.Necklace.CustomAttribute": '超越技傷%', "MasterBeast.Necklace.CustomValue": 5,
    "MasterBeast.Ring1.CustomAttribute": '雙攻%', "MasterBeast.Ring1.CustomValue": 1.5, "MasterBeast.Ring2.CustomAttribute": '無視防禦%', "MasterBeast.Ring2.CustomValue": 2, "MasterBeast.Head.Mirror.1.Attribute": '所有技能傷害%', "MasterBeast.Head.Mirror.1.Value": 0.01,
    "SpiritRecord.Class.1": 'KE', "SpiritRecord.Class.2": 'KE', "SpiritRecord.Class.3": 'KE',
  };
  const withEffects = projectDamage(data, { schemaVersion: 2, Job: 'KE', values, lowerwearAlternativeEnabled: false }).result;
  const withoutBinaryEffects = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...values, "Effect.Emblem": '沒有', "Effect.PortraitAwakening": '沒有' }, lowerwearAlternativeEnabled: false }).result;
  const withoutSpiritRecords = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...values, "SpiritRecord.Class.1": '', "SpiritRecord.Class.2": '', "SpiritRecord.Class.3": '' }, lowerwearAlternativeEnabled: false }).result;

  assert.equal(base.generalMultiplicativeDamage.value, 1.04);
  assert.equal(withEffects.generalMultiplicativeDamage.value, 1.3);
  assert.equal(withEffects.attributes.stats.superAdaptabilityPct.finalTotal - withoutBinaryEffects.attributes.stats.superAdaptabilityPct.finalTotal, 3);
  assert.equal(withEffects.attributes.stats.transcendenceSkillDamagePct.finalTotal - withoutBinaryEffects.attributes.stats.transcendenceSkillDamagePct.finalTotal, 5);
  assert.equal(withEffects.multiplicativeCritDamage.value, withoutBinaryEffects.multiplicativeCritDamage.value);
  assert.ok(withEffects.attributes.stats.adaptabilityPct.finalTotal > base.attributes.stats.adaptabilityPct.finalTotal);
  assert.ok(withEffects.attributes.stats.critRatePct.finalTotal > base.attributes.stats.critRatePct.finalTotal);
  assert.ok(withEffects.attributes.stats.doubleAttackPct.finalTotal > base.attributes.stats.doubleAttackPct.finalTotal);
  assert.ok(withEffects.attributes.stats.bossDamagePct.finalTotal > base.attributes.stats.bossDamagePct.finalTotal);
  assert.ok(withEffects.attributes.stats.transcendenceSkillDamagePct.finalTotal > base.attributes.stats.transcendenceSkillDamagePct.finalTotal);
  assert.ok(withEffects.attributes.stats.allSkillDamagePct.finalTotal > base.attributes.stats.allSkillDamagePct.finalTotal);
  assert.equal(withEffects.attributes.stats.allSkillDamagePct.finalTotal - withoutSpiritRecords.attributes.stats.allSkillDamagePct.finalTotal, 3);
  assert.ok(withEffects.attributes.conditionalDamage.strongerPct > base.attributes.conditionalDamage.strongerPct);
  assert.ok(withEffects.multiplicativeCritDamage.value > base.multiplicativeCritDamage.value);
  assert.ok(withEffects.finalDamage.finalDamage > base.finalDamage.finalDamage);
});

test('武器等級、飾品倍率與聖獸指環選項依各自公式映射', async () => {
  const data = await loadData();
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0,
    "Accessory.Top": '亞特瑪上衣 - 橘', "Accessory.FaceMiddle": '亞特瑪臉中', "Accessory.FaceBottom": '亞特瑪臉下', "Accessory.Arm": '亞特瑪手臂', "Accessory.Necklace": '亞特瑪項鍊', "Accessory.Ring1": '憤怒戒指', "Accessory.Ring2": '超越的技術戒指' };
  const baseline = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: baseValues, lowerwearAlternativeEnabled: false }).result;
  const values = {
    ...baseValues, "Weapon.MagicStone.Grade": '深淵',
    "Accessory.Top": '亞特瑪上衣 - 橘', "Accessory.FaceMiddle": '亞特瑪臉中', "Accessory.FaceBottom": '亞特瑪臉下', "Accessory.Arm": '亞特瑪手臂', "Accessory.Necklace": '亞特瑪項鍊',
    "Accessory.Ring1": '憤怒戒指', "Accessory.Ring2": '超越的技術戒指',
    "Accessory.Top.Appraisal.1": '攻擊力+1%', "Accessory.FaceMiddle.Appraisal.1": '雙攻%', "Accessory.FaceMiddle.Appraisal.2": '致命一擊%', "Accessory.FaceBottom.Appraisal.1": '致命一擊%',
    "Accessory.Arm.Appraisal.2": '致命一擊%', "Accessory.Necklace.Appraisal.1": '致命一擊%', "Accessory.Ring1.Appraisal.1": '致命一擊+2%', "Accessory.Ring2.Appraisal.2": '極大化+2%',
    "MasterBeast.Ring1.Option1": '致命傷害+2%', "MasterBeast.Ring1.Option2": '適應力+1%', "MasterBeast.Ring2.Option1": '致命傷害+3%', "MasterBeast.Ring2.Option2": '適應力+1%',
  };
  enableSelectedAccessoryAppraisals(data, values);
  const result = projectDamage(data, { schemaVersion: 2, Job: 'KE', values, lowerwearAlternativeEnabled: false }).result;

  assert.equal(result.attributes.stats.doubleAttackPct.finalTotal - baseline.attributes.stats.doubleAttackPct.finalTotal, 34);
  assert.equal(result.attributes.stats.attackLevel.finalTotal - baseline.attributes.stats.attackLevel.finalTotal, 18);
  assert.equal(result.attributes.stats.critRatePct.finalTotal - baseline.attributes.stats.critRatePct.finalTotal, 8.5);
  assert.equal(result.attributes.stats.extremizationPct.finalTotal - baseline.attributes.stats.extremizationPct.finalTotal, 2);
  assert.equal(result.attributes.stats.critDamagePct.finalTotal - baseline.attributes.stats.critDamagePct.finalTotal, 5);
  assert.equal(result.attributes.stats.adaptabilityPct.finalTotal - baseline.attributes.stats.adaptabilityPct.finalTotal, 2);
});

test('大師聖獸固定效果、精靈石乘算與五種潛力來源分開處理', async () => {
  const data = await loadData();
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0 };
  const selectedPotential = { ...baseValues, "MasterBeast.OverallPotential": 'Boss傷害+15%' };
  const yellow = projectDamage(data, {
    schemaVersion: 2, Job: 'KE', values: selectedPotential, lowerwearAlternativeEnabled: false,
    masterBeastSpiritStoneColor: '黃',
  }).result;
  const green = projectDamage(data, {
    schemaVersion: 2, Job: 'KE', values: selectedPotential, lowerwearAlternativeEnabled: false,
    masterBeastSpiritStoneColor: '綠',
  }).result;
  const empty = projectDamage(data, {
    schemaVersion: 2, Job: 'KE', values: baseValues, lowerwearAlternativeEnabled: false,
    masterBeastSpiritStoneColor: '',
  }).result;

  assert.equal(yellow.attributes.stats.doubleAttackPct.finalTotal - green.attributes.stats.doubleAttackPct.finalTotal, 0);
  assert.equal(yellow.attributes.stats.doubleAttackPct.sharedSources.find(source => source.sourceId === 'sheet:計算機!E76').valuePct, 3);
  assert.equal(yellow.attributes.stats.bossDamagePct.finalTotal - green.attributes.stats.bossDamagePct.finalTotal, 0);
  assert.equal(yellow.attributes.stats.bossDamagePct.sharedSources.find(source => source.sourceId === 'sheet:計算機!I78').valuePct, 15);
  assert.equal(green.attributes.stats.doubleAttackPct.finalTotal, empty.attributes.stats.doubleAttackPct.finalTotal);
  assert.equal(green.attributes.stats.bossDamagePct.finalTotal - empty.attributes.stats.bossDamagePct.finalTotal, 15);
  assert.ok(yellow.combatRates.critRate.multipliers.some(source => source.sourceId === 'sheet:計算機!B77' && source.factor === 1.08));
  assert.ok(yellow.combatRates.extremization.multipliers.some(source => source.sourceId === 'sheet:計算機!B77' && source.factor === 1.08));
  assert.ok(!green.combatRates.critRate.multipliers.some(source => source.sourceId === 'sheet:計算機!B77'));
  assert.ok(!green.combatRates.extremization.multipliers.some(source => source.sourceId === 'sheet:計算機!B77'));
  assert.ok(resolveMasterBeastEffects(data.masterBeast, { overallOption: 'Boss傷害+15%' })
    .some(source => source.sourceId === 'sheet:計算機!I78' && source.stats.bossDamagePct === 15));
});

test('右冰套效只計算使用者選取的套裝，效果依實際裝備件數判定', async () => {
  const data = await loadData();
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0 };
  const withoutSetEffects = structuredClone(data);
  for (const effect of withoutSetEffects.rightIceSets.effects) effect.active = false;
  const threePieceValues = { ...baseValues, "Ice.Weapon.Set": '騎士團', "Right.Ice.WeaponAccessory": '騎士團', "Right.Ice.FaceTop": '騎士團' };
  const fourPieceValues = { ...threePieceValues, "Right.Ice.FaceMiddle": '騎士團' };
  const unselectedThreePieces = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: threePieceValues, lowerwearAlternativeEnabled: false }).result;
  const baselineThree = projectDamage(withoutSetEffects, { schemaVersion: 2, Job: 'KE', values: threePieceValues, lowerwearAlternativeEnabled: false }).result;
  const baselineFour = projectDamage(withoutSetEffects, { schemaVersion: 2, Job: 'KE', values: fourPieceValues, lowerwearAlternativeEnabled: false }).result;
  const threePieces = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...threePieceValues, "Right.Ice.SetEffect.1": '騎士團' }, lowerwearAlternativeEnabled: false }).result;
  const fourPieces = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...fourPieceValues, "Right.Ice.SetEffect.1": '騎士團' }, lowerwearAlternativeEnabled: false }).result;

  assert.equal(unselectedThreePieces.attributes.stats.allSkillDamagePct.finalTotal, baselineThree.attributes.stats.allSkillDamagePct.finalTotal);
  assert.equal(threePieces.attributes.stats.allSkillDamagePct.finalTotal - baselineThree.attributes.stats.allSkillDamagePct.finalTotal, 5);
  assert.equal(fourPieces.attributes.stats.allSkillDamagePct.finalTotal - baselineFour.attributes.stats.allSkillDamagePct.finalTotal, 5);
  assert.equal(fourPieces.attributes.stats.adaptabilityPct.finalTotal - baselineFour.attributes.stats.adaptabilityPct.finalTotal, 5);

  assert.throws(() => projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...threePieceValues, "Right.Ice.SetEffect.1": '騎士團', "Right.Ice.SetEffect.2": '騎士團' }, lowerwearAlternativeEnabled: false }), /不可重複/);
  assert.throws(() => resolveRightIceSetEffects(data.rightIceSets, [], ['騎士團', '幽潮吞源', '日冕．灼耀花仙', '猛虎奇談']), /最多選擇3套/);
});

test('未確認鑑定資料的飾品不會套用其鑑定輸入', async () => {
  const data = await loadData();
  const item = data.catalogs['equipment/accessories.json'].items.find(entry => entry.slotId === 'top' && entry.name === '亞特瑪上衣 - 橘');
  assert.ok(item);
  item.appraisal = { canAppraise: null, effectCount: null };
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0 };
  const baseline = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...baseValues, "Accessory.Top": '亞特瑪上衣 - 橘' }, lowerwearAlternativeEnabled: false }).result;
  const result = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...baseValues, "Accessory.Top": '亞特瑪上衣 - 橘', "Accessory.Top.Appraisal.1": '攻擊力+1%' }, lowerwearAlternativeEnabled: false }).result;
  assert.equal(result.attributes.stats.doubleAttackPct.finalTotal, baseline.attributes.stats.doubleAttackPct.finalTotal);
});

test('百億套效紅藍固定值與綠色依內裝手電路的超越技傷計算', async () => {
  const data = await loadData();
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0 };
  const baseState = { schemaVersion: 2, Job: 'KE', lowerwearAlternativeEnabled: false };
  const base = projectDamage(data, { ...baseState, values: baseValues }).result.generalMultiplicativeDamage.value;
  const red = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '紅' } }).result.generalMultiplicativeDamage.value;
  const blue = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '藍' } }).result.generalMultiplicativeDamage.value;
  const greenWithoutCircuit = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '綠' } }).result.generalMultiplicativeDamage.value;
  const greenWithCircuit = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '綠', "Left.Armor.Gloves.Circuit.Attribute": '超越技傷%', "Left.Armor.Gloves.Circuit.Value": 0.05 } }).result.generalMultiplicativeDamage.value;

  assert.equal(red / base, 1.2);
  assert.equal(blue / base, 1.08);
  assert.equal(greenWithoutCircuit / base, 1.1);
  assert.ok(Math.abs(greenWithCircuit / base - 1.144) < 1e-12);
});
test('RM 致命傷害基底採 180%，乘算後扣除同一個 180% 基準', async () => {
  const data = await loadData();
  const values = {
    "Weapon.ENHC": 'Lv.8',
    "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8',
    "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8',
    "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0,
    "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0,
  };
  const result = projectDamage(data, { schemaVersion: 2, Job: 'RM', values, lowerwearAlternativeEnabled: false }).result;
  const baseFactor = result.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'character-base:crit-damage-product')?.factor;
  assert.equal(result.attributes.stats.critDamagePct.sharedSources.find(source => source.sourceId === 'character-base')?.valuePct, 180);
  assert.equal(baseFactor, 1.8);
  assert.equal(result.multiplicativeCritDamage.baselinePct, 180);
  assert.ok(Math.abs(result.multiplicativeCritDamage.value - 0.18) < 1e-12);
});
