import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectAttributes, projectDamage } from '../dist/frontend/projection.js';
import { normalizePortraitAwakeningSplit } from '../dist/frontend/state.js';
import { resolveInnerwearSources } from '../dist/calculation/innerwear.js';
import { resolveMasterBeastEffects, resolveRightIceSetEffects } from '../dist/calculation/equipment-effects.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));

async function loadData() {
  const [layout, classes, attributes, parameters, mapping, attack, innerwear, nephronArmor, appraisals, chips,
    chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, accessoryEffects, classCombatEffects,
    classDamagePassives, combatRateSources, simulatorInputs, rightIceSets, resonance, raidSets, atma,
    masterBeast, spiritRecord, otherEffects, pets, colorSetEffects] = await Promise.all([
    readJson('equipment-layout.json'), readJson('classes.json'), readJson('attributes.json'), readJson('parameters.json'),
    readJson('simulator-equipment-mapping.json'), readJson('attack-parameters.json'),
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
  return { layout, classes, attributes, parameters, mapping, attack, innerwear, nephronArmor, appraisals, chips, chipSlots,
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
    "Effect.Title": 'Dogma', "Effect.Emblem": '有', "Effect.Consumable": '適應靈藥', "Effect.Environment": '集合地', "Peak.Option": '精神挑戰者', "Effect.PortraitAwakening.TranscendenceSkillDamagePct": 5, "Pet.Passive": '致命一擊+4%', "MasterBeast.OverallPotential": 'Boss傷害+1%',
    "Ice.Weapon.Set": '騎士團', "Right.Ice.WeaponAccessory": '騎士團', "Right.Ice.FaceTop": '騎士團',
    "Accessory.FaceMiddle": '亞特瑪臉中', "Accessory.FaceBottom": '亞特瑪臉下', "Accessory.Arm": '亞特瑪手臂', "Accessory.Necklace": '亞特瑪項鍊', "Atma.Element": '草木', "Atma.Color": '米色',
    "GuildFountain.Stage2": '致命一擊+3%', "GuildFountain.Stage3": '雙攻+0.6%', "GuildFountain.Stage4": '強者+3%', "Resonance.AllATK.Points": 1, "Resonance.TranscendenceSkillDMG.Points": 10, "Resonance.Polarization.Points": 10, "Resonance.BossDMG.Points": 10, "Resonance.Adapt.Points": 10,
    "MasterBeast.Head.Option1": '致命一擊8%', "MasterBeast.Head.Option2": '極大化8%', "MasterBeast.Head.CustomAttribute": '致命一擊', "MasterBeast.Head.CustomValue": 5, "MasterBeast.Necklace.CustomAttribute": '超越技傷%', "MasterBeast.Necklace.CustomValue": 5,
    "MasterBeast.Ring1.CustomAttribute": '雙攻%', "MasterBeast.Ring1.CustomValue": 1.5, "MasterBeast.Ring2.CustomAttribute": '無視防禦%', "MasterBeast.Ring2.CustomValue": 2, "MasterBeast.Head.Mirror.1.Attribute": '所有技能傷害%', "MasterBeast.Head.Mirror.1.Value": 0.01,
    "SpiritRecord.Class.1": 'KE', "SpiritRecord.Class.2": 'AS', "SpiritRecord.Class.3": 'AN',
  };
  const withEffects = projectDamage(data, { schemaVersion: 2, Job: 'KE', values, lowerwearAlternativeEnabled: false }).result;
  const withoutBinaryEffects = projectDamage(data, { schemaVersion: 2, Job: 'KE', values: { ...values, "Effect.Emblem": '沒有', "Effect.PortraitAwakening.TranscendenceSkillDamagePct": '' }, lowerwearAlternativeEnabled: false }).result;
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

test('立繪、覺醒輸入任一技傷比例後會互補至5%，並套用至正確屬性', async () => {
  const data = await loadData();
  const loadout = {
    schemaVersion: 3, Job: 'KE', lowerwearAlternativeEnabled: false, transcendenceSkillDamageSharePct: 40,
    values: {
      'Weapon.ENHC': 'Lv.8',
      'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
      'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
      'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
      'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
    },
  };
  const baseline = projectDamage(data, loadout).result;
  const values = {
    ...loadout.values,
    [data.otherEffects.portraitAwakening.strongCell]: 2,
    [data.otherEffects.portraitAwakening.transcendenceCell]: 3,
  };
  const result = projectDamage(data, { ...loadout, values }).result;
  const expectedStrong = baseline.attributes.stats.strongSkillDamagePct.finalTotal + 2;
  const expectedTranscendence = baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal + 3;
  const expectedFactor = (1 + expectedTranscendence / 100) * 0.4 + (1 + expectedStrong / 100) * 0.6;

  assert.equal(result.attributes.stats.strongSkillDamagePct.finalTotal, expectedStrong);
  assert.equal(result.attributes.stats.transcendenceSkillDamagePct.finalTotal, expectedTranscendence);
  assert.ok(Math.abs(result.finalDamage.skillDamageWeighting.combinedFactor - expectedFactor) < 1e-12);
  const singleInput = projectDamage(data, { ...loadout, values: {
    ...loadout.values,
    [data.otherEffects.portraitAwakening.strongCell]: 3,
  } }).result;
  assert.equal(singleInput.attributes.stats.strongSkillDamagePct.finalTotal, baseline.attributes.stats.strongSkillDamagePct.finalTotal + 3);
  assert.equal(singleInput.attributes.stats.transcendenceSkillDamagePct.finalTotal, baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal + 2);
  assert.throws(() => projectAttributes(data, { ...loadout, values: {
    ...loadout.values,
    [data.otherEffects.portraitAwakening.strongCell]: 2,
    [data.otherEffects.portraitAwakening.transcendenceCell]: 4,
  } }), /合計必須為 5/);
  assert.throws(() => projectAttributes(data, { ...loadout, values: {
    ...loadout.values,
    [data.otherEffects.portraitAwakening.strongCell]: 1.5,
  } }), /正整數/);
});

test('立繪、覺醒比例載入時預設超越5%，並依單欄輸入互補', () => {
  assert.deepEqual(normalizePortraitAwakeningSplit(undefined, undefined), {
    strongSkillDamagePct: 0, transcendenceSkillDamagePct: 5,
  });
  assert.deepEqual(normalizePortraitAwakeningSplit(3, undefined), {
    strongSkillDamagePct: 3, transcendenceSkillDamagePct: 2,
  });
  assert.deepEqual(normalizePortraitAwakeningSplit(undefined, 4), {
    strongSkillDamagePct: 1, transcendenceSkillDamagePct: 4,
  });
  assert.deepEqual(normalizePortraitAwakeningSplit(0, 5), {
    strongSkillDamagePct: 0, transcendenceSkillDamagePct: 5,
  });
});

test('亞特瑪新增的強烈與強烈/超越魔法石選項依防具、武器套用正確屬性', async () => {
  const data = await loadData();
  const magicStones = data.catalogs['equipment/magic-stones.json'].items;
  for (const removedId of [
    'magic-stone-atma-transcendence-skill-damage-2-4',
    'magic-stone-atma-strong-skill-damage-2-4',
    'magic-stone-atma-strong-transcendence-skill-damage-15-3',
  ]) {
    assert.equal(magicStones.some(entry => entry.id === removedId), false, removedId + ' must be removed');
  }
  const atmaNames = magicStones.filter(entry => entry.id.startsWith('magic-stone-atma-')).map(entry => entry.name);
  assert.ok(atmaNames.indexOf('亞特瑪強烈技傷 2.5/5%') < atmaNames.indexOf('亞特瑪超越技傷'));
  const baseValues = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
  };
  const baseline = projectDamage(data, {
    schemaVersion: 2,
    Job: 'KE',
    values: { ...baseValues, 'Costume.MagicStone': '', 'Weapon.MagicStone.1': '' },
    lowerwearAlternativeEnabled: false,
  }).result;
  const cases = [
    { itemId: 'magic-stone-atma-transcendence-skill-damage', armor: [2.5, 0], weapon: [5, 0] },
    { itemId: 'magic-stone-atma-strong-skill-damage-25-5', armor: [0, 2.5], weapon: [0, 5] },
    { itemId: 'magic-stone-atma-strong-transcendence-skill-damage-2-4', armor: [2, 2], weapon: [4, 4] },
  ];

  for (const { itemId, armor, weapon } of cases) {
    const item = data.catalogs['equipment/magic-stones.json'].items.find(entry => entry.id === itemId);
    assert.ok(item, itemId + ' must exist in the active magic-stone catalog');
    const result = projectDamage(data, {
      schemaVersion: 2,
      Job: 'KE',
      values: {
        ...baseValues,
        'Costume.MagicStone': item.targetApplications.armor.sourceName,
        'Weapon.MagicStone.1': item.targetApplications.weapon.sourceName,
      },
      lowerwearAlternativeEnabled: false,
    }).result;
    const expectedTranscendence = baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal + armor[0] + weapon[0];
    const expectedStrong = baseline.attributes.stats.strongSkillDamagePct.finalTotal + armor[1] + weapon[1];
    assert.equal(result.attributes.stats.transcendenceSkillDamagePct.finalTotal, expectedTranscendence, itemId + ' transcendence');
    assert.equal(result.attributes.stats.strongSkillDamagePct.finalTotal, expectedStrong, itemId + ' strong');
    assert.equal(result.finalDamage.skillDamageWeighting.transcendenceFactor, 1 + expectedTranscendence / 100, itemId + ' transcendence factor');
    assert.equal(result.finalDamage.skillDamageWeighting.strongFactor, 1 + expectedStrong / 100, itemId + ' strong factor');
    assert.equal(result.finalDamage.skillDamageWeighting.combinedFactor, 1 + expectedTranscendence / 100, itemId + ' default 100% transcendence share');
  }
});

test('戒指B的強烈技術戒指、通用技術戒指效果與互斥欄位正確', async () => {
  const data = await loadData();
  const accessories = data.catalogs['equipment/accessories.json'].items;
  const byName = name => accessories.find(item => item.name === name);
  const strongRing = byName('強烈的技術戒指');
  const transcendentRing = byName('超越的技術戒指');
  const strongWarriorRing = byName('強烈鬥士的技術戒指');
  const transcendentWarriorRing = byName('超越鬥士的技術戒指');
  const technicalRing = byName('技術的戒指');

  assert.ok(strongRing);
  assert.ok(transcendentRing);
  assert.ok(strongWarriorRing);
  assert.ok(transcendentWarriorRing);
  assert.ok(technicalRing);
  const ringBNames = accessories.filter(item => item.slotId === 'ringB').map(item => item.name);
  assert.ok(ringBNames.indexOf('強烈的技術戒指') < ringBNames.indexOf('超越的技術戒指'));
  assert.ok(ringBNames.indexOf('強烈鬥士的技術戒指') < ringBNames.indexOf('超越鬥士的技術戒指'));
  assert.deepEqual(strongRing.stats, { strongSkillDamagePct: 20 });
  assert.deepEqual(strongWarriorRing.stats, {
    doubleAttackPct: 0.5,
    critRatePct: 1,
    strongSkillDamagePct: 20,
  });
  assert.equal(strongWarriorRing.appraisal.canAppraise, transcendentWarriorRing.appraisal.canAppraise);
  assert.equal(strongWarriorRing.appraisal.effectCount, transcendentWarriorRing.appraisal.effectCount);
  assert.deepEqual(technicalRing.stats, {
    transcendenceSkillDamagePct: 20,
    strongSkillDamagePct: 20,
  });

  const ringBSelections = data.mapping.selections.filter(entry => entry.slotId === 'ringB');
  assert.deepEqual(ringBSelections.map(entry => entry.selectionCell), ['Accessory.Ring2']);
  const ringBInput = data.simulatorInputs.inputs.find(entry => entry.simulatorCells.split(/\s+/).includes('Accessory.Ring2'));
  const ringBOptionCatalog = data.simulatorInputs.catalogs.find(entry => entry.id === ringBInput?.catalogId);
  assert.ok(ringBOptionCatalog?.options.some(option => option.value === '強烈的技術戒指'));
  assert.ok(ringBOptionCatalog?.options.some(option => option.value === '強烈鬥士的技術戒指'));

  const baseValues = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
  };
  const baseline = projectDamage(data, {
    schemaVersion: 2,
    Job: 'KE',
    values: { ...baseValues, 'Accessory.Ring2': '' },
    lowerwearAlternativeEnabled: false,
  }).result;
  for (const [name, item] of [
    ['強烈的技術戒指', strongRing],
    ['強烈鬥士的技術戒指', strongWarriorRing],
    ['技術的戒指', technicalRing],
  ]) {
    const result = projectDamage(data, {
      schemaVersion: 2,
      Job: 'KE',
      values: { ...baseValues, 'Accessory.Ring2': name },
      lowerwearAlternativeEnabled: false,
    }).result;
    assert.equal(
      result.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal,
      item.stats.strongSkillDamagePct ?? 0,
      name + ' strong skill damage',
    );
    assert.equal(
      result.attributes.stats.transcendenceSkillDamagePct.finalTotal - baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal,
      item.stats.transcendenceSkillDamagePct ?? 0,
      name + ' transcendence skill damage',
    );
  }
});

test('結果屬性卡片按 Boss、兩極化、所有技能；強烈、超越、流血順序排列', async () => {
  const data = await loadData();
  const keys = data.attributes.attributes.map(attribute => attribute.key);
  const bossIndex = keys.indexOf('bossDamagePct');
  assert.deepEqual(keys.slice(bossIndex, bossIndex + 6), [
    'bossDamagePct',
    'polarizationPct',
    'allSkillDamagePct',
    'strongSkillDamagePct',
    'transcendenceSkillDamagePct',
    'bleedDamagePct',
  ]);
});

test('幻影面紗右冰戒指同步提供相同百分比的超越與強烈技傷', async () => {
  const data = await loadData();
  const baseValues = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
  };
  const baseline = projectDamage(data, {
    schemaVersion: 2,
    Job: 'KE',
    values: baseValues,
    lowerwearAlternativeEnabled: false,
  }).result;
  const result = projectDamage(data, {
    schemaVersion: 2,
    Job: 'KE',
    values: { ...baseValues, 'Right.Ice.Ring': '幻影面紗' },
    lowerwearAlternativeEnabled: false,
  }).result;

  assert.equal(result.attributes.stats.transcendenceSkillDamagePct.finalTotal - baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal, 3);
  assert.equal(result.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal, 3);
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

test('大師聖獸固定效果、各顏色的精靈石套效與五種潛力來源分開處理', async () => {
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

  const setStoneFactor = result => result.generalMultiplicativeDamage.factors.find(effect => effect.sourceId === data.masterBeast.armorSpiritStoneSetEffect.id)?.factor;
  assert.equal(setStoneFactor(yellow), 1.04);
  assert.equal(setStoneFactor(green), 1.04);
  assert.equal(yellow.attributes.stats.doubleAttackPct.finalTotal - green.attributes.stats.doubleAttackPct.finalTotal, 0);
  assert.equal(yellow.attributes.stats.doubleAttackPct.sharedSources.find(source => source.sourceId === 'sheet:計算機!E76').valuePct, 3);
  assert.equal(yellow.attributes.stats.bossDamagePct.finalTotal - green.attributes.stats.bossDamagePct.finalTotal, 0);
  assert.equal(yellow.attributes.stats.bossDamagePct.sharedSources.find(source => source.sourceId === 'master-beast-potential:bossDamagePct').valuePct, 15);
  assert.equal(green.attributes.stats.doubleAttackPct.finalTotal, empty.attributes.stats.doubleAttackPct.finalTotal);
  assert.equal(green.attributes.stats.bossDamagePct.finalTotal - empty.attributes.stats.bossDamagePct.finalTotal, 15);
  assert.ok(yellow.combatRates.critRate.multipliers.some(source => source.sourceId === 'sheet:計算機!B77' && source.factor === 1.08));
  assert.ok(yellow.combatRates.extremization.multipliers.some(source => source.sourceId === 'sheet:計算機!B77' && source.factor === 1.08));
  assert.ok(!green.combatRates.critRate.multipliers.some(source => source.sourceId === 'sheet:計算機!B77'));
  assert.ok(!green.combatRates.extremization.multipliers.some(source => source.sourceId === 'sheet:計算機!B77'));
  assert.ok(resolveMasterBeastEffects(data.masterBeast, { overallOption: 'Boss傷害+15%' })
    .some(source => source.sourceId === 'master-beast-potential:bossDamagePct' && source.stats.bossDamagePct === 15));
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

test('百億套效紅藍固定值與綠色依內裝手套單技傷電路計算', async () => {
  const data = await loadData();
  const baseValues = { "Weapon.ENHC": 'Lv.8', "Left.Armor.Upper.ENHC": 'Lv.8', "Left.Armor.Bottom.ENHC": 'Lv.8', "Left.Armor.Gloves.ENHC": 'Lv.8', "Left.Armor.Shoes.ENHC": 'Lv.8', "Left.Armor.Upper.FORGE": 0, "Left.Armor.Bottom.FORGE": 0, "Left.Armor.Gloves.FORGE": 0, "Left.Armor.Shoes.FORGE": 0 };
  const baseState = { schemaVersion: 2, Job: 'KE', lowerwearAlternativeEnabled: false };
  const baseResult = projectDamage(data, { ...baseState, values: baseValues }).result;
  const base = baseResult.generalMultiplicativeDamage.value;
  const red = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '紅' } }).result.generalMultiplicativeDamage.value;
  const blue = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '藍' } }).result.generalMultiplicativeDamage.value;
  const greenWithoutCircuit = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '綠' } }).result.generalMultiplicativeDamage.value;
  const greenWithCircuitResult = projectDamage(data, { ...baseState, values: { ...baseValues, "Left.Armor.SetColor": '綠', "Left.Armor.Gloves.Circuit.Attribute": '單技傷%', "Left.Armor.Gloves.Circuit.Value": 0.05 } }).result;

  assert.equal(red / base, 1.2);
  assert.equal(blue / base, 1.08);
  assert.equal(greenWithoutCircuit / base, 1.1);
  assert.ok(Math.abs(greenWithCircuitResult.generalMultiplicativeDamage.value / base - 1.144) < 1e-12);
  assert.equal(greenWithCircuitResult.attributes.stats.strongSkillDamagePct.finalTotal - baseResult.attributes.stats.strongSkillDamagePct.finalTotal, 5);
  assert.equal(greenWithCircuitResult.attributes.stats.transcendenceSkillDamagePct.finalTotal - baseResult.attributes.stats.transcendenceSkillDamagePct.finalTotal, 5);
});

test('單技傷電路板、芯片、武器變換、共鳴、聖獸與賦靈錄都映射強烈技傷', async () => {
  const data = await loadData();
  const baseValues = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
  };
  const baseState = { schemaVersion: 3, Job: 'KE', values: baseValues, lowerwearAlternativeEnabled: false };
  const baseline = projectDamage(data, baseState).result;
  const skillBoard = data.circuits.inputs.find(entry => entry.slot === 'gloves');
  assert.deepEqual(skillBoard.attributeOptions[0], '單技傷%');
  const boardResult = projectDamage(data, { ...baseState, values: {
    ...baseValues, [skillBoard.attributeCell]: '單技傷%', [skillBoard.valueCell]: 0.05,
  } }).result;
  assert.equal(boardResult.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal, 5);
  assert.equal(boardResult.attributes.stats.transcendenceSkillDamagePct.finalTotal - baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal, 5);

  const chipSlot = data.chipSlots.slots.find(entry => entry.id === 'upper');
  const chipResult = projectDamage(data, { ...baseState, values: {
    ...baseValues, [chipSlot.attributeCell]: '強烈技傷%', [chipSlot.tuningCell]: '+8',
  } }).result;
  assert.equal(chipResult.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal, 9);
  const strongChip = data.chips.chips.find(entry => entry.name === '強烈技傷%');
  const transcendenceChip = data.chips.chips.find(entry => entry.name === '超越技傷%');
  assert.deepEqual(strongChip.tuningLevels, transcendenceChip.tuningLevels);
  assert.equal(strongChip.valueSourceColumn, transcendenceChip.valueSourceColumn);

  const weaponTransform = data.transformations.slots[0];
  const weaponResult = projectDamage(data, { ...baseState, values: {
    ...baseValues, [weaponTransform.choiceCell]: '強烈技傷%', [weaponTransform.valueCell]: 0.05,
  } }).result;
  assert.equal(weaponResult.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal, 5);

  const resonance = data.resonance.effects.find(entry => entry.id === 'resonance-skill-damage');
  const resonanceResult = projectDamage(data, { ...baseState, values: { ...baseValues, [resonance.inputCell]: 100 } }).result;
  assert.equal(resonanceResult.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal, 35);
  assert.equal(resonanceResult.attributes.stats.transcendenceSkillDamagePct.finalTotal - baseline.attributes.stats.transcendenceSkillDamagePct.finalTotal, 35);

  const beastResult = projectDamage(data, { ...baseState, values: {
    ...baseValues,
    'MasterBeast.Necklace.CustomAttribute': '強烈技傷%',
    'MasterBeast.Necklace.CustomValue': 5,
    'MasterBeast.Head.Mirror.1.Attribute': '強烈技傷%',
    'MasterBeast.Head.Mirror.1.Value': 0.007,
  } }).result;
  assert.ok(Math.abs(beastResult.attributes.stats.strongSkillDamagePct.finalTotal - baseline.attributes.stats.strongSkillDamagePct.finalTotal - 5.7) < 1e-9);
  assert.ok(data.masterBeast.customAttributeOptions.necklace.includes('強烈技傷%'));
  assert.ok(data.masterBeast.customAttributeOptions.mirror.includes('強烈技傷%'));

  const defaultRecord = baseline.attributes.stats.strongSkillDamagePct.sharedSources.find(source => source.sourceId === 'spirit-record:default-maxed');
  assert.equal(defaultRecord.valuePct, data.spiritRecord.defaultMaxedStats.transcendenceSkillDamagePct);
  assert.equal(defaultRecord.valuePct, data.spiritRecord.defaultMaxedStats.strongSkillDamagePct);
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

test('職業加算爆傷、乘算爆傷與 Boss 傷害按獨立公式投影', async () => {
  const data = await loadData();
  const values = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0
  };
  const stateFor = Job => ({ schemaVersion: 3, Job, values, lowerwearAlternativeEnabled: false });
  const ke = projectDamage(data, stateFor('KE')).result;
  const im = projectDamage(data, stateFor('IM')).result;
  assert.equal(ke.classCritDamagePassivePct, 8);
  assert.equal(im.classCritDamagePassivePct, 20);
  assert.equal(im.attributes.stats.bossDamagePct.finalTotal - ke.attributes.stats.bossDamagePct.finalTotal, 20);
  assert.equal(im.finalDamage.damageFactors.bossDamage, 1 + im.attributes.stats.bossDamagePct.finalTotal / 100);

  const withoutImBossPassive = { ...data, classDamagePassives: { ...data.classDamagePassives, bossDamagePctByClass: { ...data.classDamagePassives.bossDamagePctByClass, IM: 0 } } };
  const imWithoutBoss = projectDamage(withoutImBossPassive, stateFor('IM')).result;
  assert.ok(Math.abs(im.finalDamage.damageFactors.bossDamage - imWithoutBoss.finalDamage.damageFactors.bossDamage - 0.2) < 1e-12);

  const noKeCritPassive = { ...data, classDamagePassives: { ...data.classDamagePassives, critDamagePctByClass: { ...data.classDamagePassives.critDamagePctByClass, KE: 0 } } };
  const keWithoutPassive = projectDamage(noKeCritPassive, stateFor('KE')).result;
  assert.ok(Math.abs(ke.finalDamage.critFactor - keWithoutPassive.finalDamage.critFactor - ke.combatRates.critRate.finalRate * 0.08) < 1e-12);

  for (const [classId, expectedValues] of [['LA', [5]], ['HE', [28]], ['EW', [20]]]) {
    const result = projectDamage(data, stateFor(classId)).result;
    const prefix = 'class-passive:' + classId + ':multiplicative-crit-damage:';
    const sources = result.multiplicativeCritDamage.factors.filter(effect => effect.sourceId.startsWith(prefix));
    assert.deepEqual(sources.map(effect => effect.valuePct), expectedValues, classId);
    if (classId === 'EW') assert.equal(result.classCritDamagePassivePct, 15);
    const expectedProduct = result.multiplicativeCritDamage.factors.reduce((product, effect) => product * (1 + effect.valuePct / 100), 1);
    assert.equal(result.multiplicativeCritDamage.productBeforeBaseline, expectedProduct, classId);
    assert.ok(Math.abs(result.multiplicativeCritDamage.value - (expectedProduct - result.multiplicativeCritDamage.baselinePct / 100)) < 1e-12, classId);
  }

  for (const [classId, additive, multiplicative] of [['CT', 23, 23], ['IN', 25, 23], ['DA', 12, 23], ['DE', 0, 23]]) {
    const result = projectDamage(data, stateFor(classId)).result;
    assert.equal(result.classCritDamagePassivePct, additive, classId + ' additive crit damage');
    const prefix = 'class-passive:' + classId + ':multiplicative-crit-damage:';
    const sources = result.multiplicativeCritDamage.factors.filter(effect => effect.sourceId.startsWith(prefix));
    assert.deepEqual(sources.map(effect => effect.valuePct), [multiplicative], classId + ' multiplicative crit damage');
    const expectedProduct = result.multiplicativeCritDamage.factors.reduce((product, effect) => product * (1 + effect.valuePct / 100), 1);
    assert.equal(result.multiplicativeCritDamage.productBeforeBaseline, expectedProduct, classId + ' multiplier product');
  }

  const rm = projectDamage(data, stateFor('RM')).result;
  assert.equal(rm.classCritDamagePassivePct, 0);
  assert.equal(rm.attributes.stats.critDamagePct.sharedSources.find(source => source.sourceId === 'character-base').valuePct, 180);
  assert.equal(rm.multiplicativeCritDamage.baselinePct, 180);
});

test('隨機抽樣十個職業在多裝備傷害環境下交叉驗算', async () => {
  const data = await loadData();
  const classSample = ['CS', 'MO', 'AD', 'SU', 'DB', 'PO', 'MM', 'RE', 'VI', 'CU'];
  assert.equal(classSample.length, 10);
  for (const classId of classSample) assert.ok(data.classes.classes.some(entry => entry.id === classId), classId);

  const baseValues = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0
  };
  const atLevel13 = values => {
    for (const key of ['Upper', 'Bottom', 'Gloves', 'Shoes']) values['Left.Armor.' + key + '.ENHC'] = 'Lv.13';
    return values;
  };
  const critStone = data.weaponGrades.colorGroups.find(group => group.id === 'yellow').options.find(option => option.id === 'yellow-crit-damage-1-5').name;
  const strongerCritStone = data.weaponGrades.colorGroups.find(group => group.id === 'yellow').options.find(option => option.id === 'yellow-crit-damage-1-7').name;
  const scenarios = [
    { id: 'baseline', values: { ...baseValues }, bossGain: 0, critGain: 0 },
    {
      id: 'boss-equipment',
      values: { ...atLevel13({ ...baseValues }), 'Weapon.Transform.1.Stat': 'Boss傷害%', 'Weapon.Transform.1.Value': 0.08, 'Stage.BossDEF': 25, 'Stage.CritRatePenalty': 7 },
      bossGain: 28, critGain: 0
    },
    {
      id: 'crit-equipment-and-boss-environment',
      values: { ...baseValues, 'Weapon.Transform.1.Stat': '致命傷害%', 'Weapon.Transform.1.Value': 0.12, 'Weapon.MagicStone.Yellow.1': critStone, 'Peak.Option': '精神挑戰者', 'Stage.BossDEF': 35, 'Stage.CritRatePenalty': 12 },
      bossGain: 45, critGain: 13.5
    },
    {
      id: 'mixed-equipment',
      values: { ...atLevel13({ ...baseValues }), 'Weapon.Transform.1.Stat': 'Boss傷害%', 'Weapon.Transform.1.Value': 0.06, 'Weapon.Transform.2.Stat': '致命傷害%', 'Weapon.Transform.2.Value': 0.09, 'Weapon.MagicStone.Yellow.1': strongerCritStone, 'Peak.Option': '嗜肉骨斷', 'Stage.BossDEF': 71.92, 'Stage.CritRatePenalty': 30 },
      bossGain: 106, critGain: 10.7
    }
  ];
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-11 * Math.max(1, Math.abs(expected)), label + ': ' + actual + ' != ' + expected);
  let checkedCases = 0;

  for (const classId of classSample) {
    const results = new Map();
    for (const scenario of scenarios) {
      const result = projectDamage(data, { schemaVersion: 3, Job: classId, values: scenario.values, lowerwearAlternativeEnabled: false }).result;
      results.set(scenario.id, result);
      const bossPct = result.attributes.stats.bossDamagePct.finalTotal;
      close(result.finalDamage.damageFactors.bossDamage, 1 + bossPct / 100, classId + '/' + scenario.id + ' Boss factor');
      const critRate = result.combatRates.critRate.finalRate;
      const critPct = result.attributes.stats.critDamagePct.finalTotal;
      const expectedCritFactor = critRate * (critPct / 100 + result.classCritDamagePassivePct / 100 + result.multiplicativeCritDamage.value) + (1 - critRate);
      close(result.finalDamage.critFactor, expectedCritFactor, classId + '/' + scenario.id + ' critical factor');
      const product = result.multiplicativeCritDamage.factors.reduce((value, factor) => value * (1 + factor.valuePct / 100), 1);
      close(result.multiplicativeCritDamage.productBeforeBaseline, product, classId + '/' + scenario.id + ' multiplier product');
      close(result.multiplicativeCritDamage.value, product - result.multiplicativeCritDamage.baselinePct / 100, classId + '/' + scenario.id + ' multiplier baseline');
      const damageFactors = Object.values(result.finalDamage.damageFactors).reduce((value, factor) => value * factor, 1);
      const recomputedDamage = result.finalDamage.extremizedBase * result.finalDamage.critFactor * damageFactors * result.finalDamage.conditionalFactor * result.generalMultiplicativeDamage.value * result.finalDamage.adaptationFactor * result.finalDamage.defenseFactor;
      close(result.finalDamage.finalDamage, recomputedDamage, classId + '/' + scenario.id + ' final damage');
      checkedCases += 1;
    }
    const baseline = results.get('baseline');
    for (const scenario of scenarios.slice(1)) {
      const result = results.get(scenario.id);
      close(result.attributes.stats.bossDamagePct.finalTotal - baseline.attributes.stats.bossDamagePct.finalTotal, scenario.bossGain, classId + '/' + scenario.id + ' additive Boss gear');
      close(result.attributes.stats.critDamagePct.finalTotal - baseline.attributes.stats.critDamagePct.finalTotal, scenario.critGain, classId + '/' + scenario.id + ' additive critical gear');
    }
  }
  assert.equal(checkedCases, 40);
});
test('強/排褲不可將相同條件電路板效果重複計入，強者與排熱分開時公式正確', async () => {
  const data = await loadData();
  const lowerwear = data.circuits.inputs.find(entry => entry.slot === 'lowerwear');
  const alternative = data.circuits.inputs.find(entry => entry.slot === 'lowerwearAlternative');
  const values = {
    'Weapon.ENHC': 'Lv.8',
    'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
    [lowerwear.attributeCell]: '強者%', [lowerwear.valueCell]: 0.05,
    [alternative.attributeCell]: '強者%', [alternative.valueCell]: 0.03,
  };
  const invalidState = { schemaVersion: 3, Job: 'KE', values, lowerwearAlternativeEnabled: true };
  assert.throws(() => projectAttributes(data, invalidState), /不可同時使用「強者%」/);

  const validValues = { ...values, [alternative.attributeCell]: '排熱%' };
  const validState = { ...invalidState, values: validValues };
  const projected = projectDamage(data, validState).result;
  assert.ok(projected.attributes.conditionalDamage.strongerSources.some(source => source.sourceId === 'circuit-board:lowerwear' && source.valuePct === 5));
  assert.ok(projected.attributes.conditionalDamage.heatSources.some(source => source.sourceId === 'circuit-board:lowerwearAlternative' && source.valuePct === 3));
  const expectedConditionalFactor = 1 / (
    0.5 / (1 + projected.attributes.conditionalDamage.strongerPct / 100)
    + 0.5 / (1 + projected.attributes.conditionalDamage.heatPct / 100)
  );
  assert.ok(Math.abs(projected.finalDamage.conditionalFactor - expectedConditionalFactor) < 1e-12);

  const chipSlots = Object.fromEntries(data.chipSlots.slots.map(slot => [slot.id, slot]));
  const chipValues = { ...validValues };
  for (const slot of data.chipSlots.slots) {
    const attribute = slot.id === 'lowerwearAlternative' ? '排熱%' : '強者%';
    chipValues[slot.attributeCell] = attribute;
    chipValues[slot.tuningCell] = '+5';
  }
  const chipState = { ...validState, values: chipValues };
  const chipProjected = projectDamage(data, chipState).result;
  for (const slotId of ['upper', 'gloves', 'shoes']) {
    assert.ok(chipProjected.attributes.conditionalDamage.strongerSources.some(source => source.sourceId === 'chip:' + slotId), slotId + ' may reuse 強者% chip');
  }
  assert.ok(chipProjected.attributes.conditionalDamage.heatSources.some(source => source.sourceId === 'chip:lowerwearAlternative'));
  const expectedChipFactor = 1 / (
    0.5 / (1 + chipProjected.attributes.conditionalDamage.strongerPct / 100)
    + 0.5 / (1 + chipProjected.attributes.conditionalDamage.heatPct / 100)
  );
  assert.ok(Math.abs(chipProjected.finalDamage.conditionalFactor - expectedChipFactor) < 1e-12);

  const invalidChipValues = { ...chipValues, [chipSlots.lowerwearAlternative.attributeCell]: '強者%' };
  assert.throws(() => projectAttributes(data, { ...validState, values: invalidChipValues }), /下衣與強\/排褲不可同時使用.*芯片/);
});
