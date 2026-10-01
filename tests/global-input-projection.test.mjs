import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectAttributes, projectDamage } from '../dist/frontend/projection.js';
import { resolveInnerwearSources } from '../dist/calculation/innerwear.js';
import { resolveMasterBeastEffects, resolveRightIceSetEffects } from '../dist/calculation/equipment-effects.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));

async function loadData() {
  const [layout, classes, attributes, parameters, manifest, mapping, attack, innerwear, nephronArmor, appraisals, chips,
    chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, accessoryEffects, classCombatEffects,
    classDamagePassives, combatRateSources, simulatorInputs, rightIceSets, resonance, raidSets, atma,
    masterBeast, spiritRecord, otherEffects, pets, colorSetEffects] = await Promise.all([
    readJson('equipment-layout.json'), readJson('classes.json'), readJson('attributes.json'), readJson('parameters.json'),
    readJson('manifest.json'), readJson('simulator-equipment-mapping.json'), readJson('attack-parameters.json'),
    readJson('innerwear-rules.json'), readJson('nephron-armor-rules.json'), readJson('armor-appraisals.json'), readJson('equipment/chips.json'),
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
  return { layout, classes, attributes, parameters, manifest, mapping, attack, innerwear, nephronArmor, appraisals, chips, chipSlots,
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

test('內裝左四件強化 Lv.8 至 Lv.13 的四種效果正確套用', async () => {
  const data = await loadData();
  for (const [level, expectedDamagePct, expectedCritPct, expectedSkillDamagePct, expectedExtremizationPct] of [
    [8, 10, 10, 40, 10],
    [9, 11, 11, 45, 11],
    [10, 12, 12, 50, 12],
    [11, 13, 13, 55, 13],
    [12, 14, 14, 60, 14],
    [13, 15, 15, 65, 15],
  ]) {
    const values = {
      'Weapon.ENHC': 'Lv.8',
      'Left.Armor.Upper.ENHC': 'Lv.' + level,
      'Left.Armor.Bottom.ENHC': 'Lv.' + level,
      'Left.Armor.Gloves.ENHC': 'Lv.' + level,
      'Left.Armor.Shoes.ENHC': 'Lv.' + level,
      'Left.Armor.Upper.FORGE': 0,
      'Left.Armor.Bottom.FORGE': 0,
      'Left.Armor.Gloves.FORGE': 0,
      'Left.Armor.Shoes.FORGE': 0,
    };
    const result = projectDamage(data, {
      schemaVersion: 2, Job: 'KE', values, lowerwearAlternativeEnabled: false,
    }).result;
    const upper = result.generalMultiplicativeDamage.factors.find(effect => effect.sourceId === 'innerwear:upper');
    const lowerwearCrit = result.combatRates.critRate.multipliers.find(effect => effect.sourceId === 'lowerwear-crit-rate-enhancement');
    const gloveSkillDamage = result.attributes.stats.allSkillDamagePct.sharedSources.find(source => source.sourceId === 'innerwear:gloves');
    const shoeExtremization = result.combatRates.extremization.multipliers.find(effect => effect.sourceId === 'shoes-extremization-enhancement');

    assert.ok(upper, 'missing upper damage multiplier at Lv.' + level);
    assert.equal(upper.valuePct, expectedDamagePct, 'upper damage bonus at Lv.' + level);
    assert.equal(upper.factor, 1 + expectedDamagePct / 100, 'upper damage factor at Lv.' + level);
    assert.ok(lowerwearCrit, 'missing lowerwear crit multiplier at Lv.' + level);
    assert.equal(lowerwearCrit.valuePct, expectedCritPct, 'lowerwear crit bonus at Lv.' + level);
    assert.equal(lowerwearCrit.factor, 1 + expectedCritPct / 100, 'lowerwear crit factor at Lv.' + level);
    assert.ok(gloveSkillDamage, 'missing glove skill-damage source at Lv.' + level);
    assert.equal(gloveSkillDamage.valuePct, expectedSkillDamagePct, 'glove skill damage at Lv.' + level);
    assert.ok(shoeExtremization, 'missing shoe extremization multiplier at Lv.' + level);
    assert.equal(shoeExtremization.valuePct, expectedExtremizationPct, 'shoe extremization bonus at Lv.' + level);
    assert.equal(shoeExtremization.factor, 1 + expectedExtremizationPct / 100, 'shoe extremization factor at Lv.' + level);
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

  assert.ok(Math.abs(base.generalMultiplicativeDamage.value - 1.144) < 1e-12);
  assert.ok(Math.abs(withEffects.generalMultiplicativeDamage.value - 1.43) < 1e-12);
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

test('Nephron selects independent armor types, fifth magic stone, conversion, and magazine in the computed source groups', async () => {
  const data = await loadData();
  const upper = data.innerwear.slots.find(entry => entry.id === 'upper');
  const lower = data.innerwear.slots.find(entry => entry.id === 'lowerwear');
  const innerwearLayout = data.layout.slots.filter(entry => entry.innerwearId);
  const stoneCell = data.layout.slots.find(entry => entry.innerwearId === 'upper').stoneCells[4];
  const stone = data.catalogs['equipment/magic-stones.json'].items.find(entry => entry.active && entry.name === '狩獵 B傷');
  const transform = data.nephronArmor.transformations.find(entry => entry.id === 'enhancement-double-attack');
  const fields = data.nephronArmor.fields.find(entry => entry.slotId === 'upper');
  const values = {
    [upper.typeCell]: '內布隆', [lower.typeCell]: '百億', [upper.enhancementCell]: 'Lv.10', [upper.forgingCell]: 21,
    [fields.transformFields[0].attributeCell]: transform.name,
    [fields.transformFields[0].valueCell]: String(transform.tierValuesPct[9] / 100),
    [fields.magazineCell]: '戰鬥彈匣Type - I', [fields.magazineLevelCell]: 'Lv.3',
    [stoneCell]: stone.targetApplications.armor.sourceName,
  };
  const state = { schemaVersion: 3, Job: 'KE', values, lowerwearAlternativeEnabled: false };
  const projected = projectAttributes(data, state);
  const upperSource = projected.calculationSources.shared.find(entry => entry.sourceId === 'innerwear:upper');
  assert.ok(upperSource);
  assert.equal(upperSource.stats.bossDamagePct, 5);
  assert.equal(upperSource.stats.multiplicativeDamagePct, 12);
  assert.equal(upperSource.stats.physicalAttack - resolveInnerwearSources(data.innerwear, data.attack, 'KE', { ...values, [upper.forgingCell]: 0 }, false).shared.find(entry => entry.sourceId === 'innerwear:upper').stats.physicalAttack, 2500);
  assert.deepEqual(projected.calculationSources.shared.find(entry => entry.sourceId === 'nephron-transform:upper:1').stats, { doubleAttackPct: 2 });
  assert.deepEqual(projected.calculationSources.shared.find(entry => entry.sourceId === 'nephron-magazine:upper:combat-type-i:Lv.3').stats, { bleedDamagePct: 1.5 });
  assert.deepEqual(projected.calculationSources.shared.find(entry => entry.sourceId === `simulator:${stoneCell}`).stats, { bossDamagePct: 2.5 });
  assert.equal(data.innerwear.slots.filter(entry => entry.typeCell).length, 5);
  assert.equal(new Set(data.innerwear.slots.map(entry => entry.typeCell)).size, 5);
  for (const layoutSlot of innerwearLayout) assert.equal(layoutSlot.stoneCells.length, 5, layoutSlot.innerwearId);
  assert.equal(values[upper.typeCell], '內布隆');
  assert.equal(values[lower.typeCell], '百億');
});

test('mixed Nephron and Billion keep shared innerwear bonuses, set effects, circuits, and chips', async () => {
  const data = await loadData();
  const values = { 'Weapon.ENHC': 'Lv.8', 'Left.Armor.SetColor': '紅' };
  const byId = Object.fromEntries(data.innerwear.slots.map(slot => [slot.id, slot]));
  for (const [id, type] of [['upper', '內布隆'], ['lowerwear', '百億'], ['gloves', '內布隆'], ['shoes', '百億']]) {
    const slot = byId[id];
    values[slot.typeCell] = type;
    values[slot.enhancementCell] = 'Lv.11';
    values[slot.forgingCell] = id === 'upper' ? 21 : 0;
  }
  const upperCircuit = data.circuits.inputs.find(entry => entry.slot === 'upper');
  values[upperCircuit.attributeCell] = '流血%';
  values[upperCircuit.valueCell] = 0.01;
  const upperChip = data.chipSlots.slots.find(entry => entry.id === 'upper');
  const bleedChip = data.chips.chips.find(entry => entry.name === '流血%');
  values[upperChip.attributeCell] = bleedChip.name;
  values[upperChip.tuningCell] = '+5';

  const state = { schemaVersion: 3, Job: 'KE', values, lowerwearAlternativeEnabled: false };
  const projection = projectAttributes(data, state);
  const shared = projection.calculationSources.shared;
  assert.deepEqual(shared.find(entry => entry.sourceId === 'sheet:計算機!Q37').stats, { adaptabilityPct: 2 });
  assert.equal(shared.find(entry => entry.sourceId === 'innerwear:upper').stats.adaptabilityPct, 4);
  assert.equal(shared.find(entry => entry.sourceId === 'innerwear:gloves').stats.adaptabilityPct, 2);
  assert.deepEqual(shared.find(entry => entry.sourceId === 'sheet:計算機!T101').stats, { multiplicativeCritDamagePct: 10 });
  assert.deepEqual(shared.find(entry => entry.sourceId === 'color-set:紅').stats, { multiplicativeDamagePct: 20 });
  assert.deepEqual(shared.find(entry => entry.sourceId === 'circuit-board:upper').stats, { bleedDamagePct: 1 });
  assert.deepEqual(shared.find(entry => entry.sourceId === 'chip:upper').stats, { bleedDamagePct: 3.5 });

  const damage = projectDamage(data, state).result;
  assert.equal(damage.generalMultiplicativeDamage.factors.find(entry => entry.sourceId === 'innerwear:upper').valuePct, 13);
  assert.equal(damage.combatRates.critRate.multipliers.find(entry => entry.sourceId === 'lowerwear-crit-rate-enhancement').valuePct, 13);
  assert.equal(damage.attributes.stats.allSkillDamagePct.sharedSources.find(entry => entry.sourceId === 'innerwear:gloves').valuePct, 55);
  assert.equal(damage.combatRates.extremization.multipliers.find(entry => entry.sourceId === 'shoes-extremization-enhancement').valuePct, 13);

  for (const [color, expected] of [['紅', 20], ['藍', 8]]) {
    const colored = projectAttributes(data, { ...state, values: { ...values, 'Left.Armor.SetColor': color } });
    assert.equal(colored.calculationSources.shared.find(entry => entry.sourceId === 'color-set:' + color).stats.multiplicativeDamagePct, expected);
  }
});
