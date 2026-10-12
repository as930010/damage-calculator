import { sample } from './loadout-evaluation-harness.mjs';

const minimal = {
  schemaVersion: 3, Job: 'KE', values: {
    'Weapon.ENHC': 'Lv.8', 'Left.Armor.Upper.ENHC': 'Lv.8', 'Left.Armor.Bottom.ENHC': 'Lv.8',
    'Left.Armor.Gloves.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8',
    'Left.Armor.Upper.FORGE': 0, 'Left.Armor.Bottom.FORGE': 0,
    'Left.Armor.Gloves.FORGE': 0, 'Left.Armor.Shoes.FORGE': 0,
  }, lowerwearAlternativeEnabled: false, masterBeastSpiritStoneColor: '',
  petSkillAttackEnabled: false, transcendenceSkillDamageSharePct: 100,
};
function change(base, fields = {}, values = {}) {
  const state = structuredClone(base);
  Object.assign(state, fields);
  Object.assign(state.values, values);
  return state;
}

export const scenarios = [
  { id: 'public-complete', state: change(sample) },
  { id: 'minimal-complete', state: change(minimal) },
  { id: 'no-class', state: change(minimal, { Job: '' }) },
  { id: 'invalid-class', state: change(minimal, { Job: 'unknown' }) },
  { id: 'no-weapon-rates-fallback', state: change(minimal, {}, { 'Weapon.ENHC': '' }) },
  { id: 'no-bottom-attributes-fallback', state: change(minimal, {}, { 'Left.Armor.Bottom.ENHC': '' }) },
  { id: 'no-shoes-attributes-fallback', state: change(minimal, {}, { 'Left.Armor.Shoes.ENHC': '' }) },
  { id: 'invalid-weapon', state: change(minimal, {}, { 'Weapon.ENHC': 'invalid' }) },
  { id: 'invalid-boss-rates-fallback', state: change(sample, {}, { 'Stage.BossDEF': 'invalid' }) },
  { id: 'invalid-rate-attributes-fallback', state: change(sample, {}, { 'Stage.CritRatePenalty': 'invalid' }) },
  { id: 'late-damage-failure-rates-fallback', state: change(sample, { transcendenceSkillDamageSharePct: 101 }) },
  { id: 'special-weapon-average', state: change(sample, { lowerwearAlternativeEnabled: true }, {
    'Weapon.Transform.4.Stat': '雙攻% × 強化', 'Weapon.Transform.4.Value': 0.013333333333,
    'Weapon.ENHC': 'Lv.13',
  }) },
  { id: 'passives-effects-decimals', state: change(sample, { Job: 'KE', petSkillAttackEnabled: true,
    masterBeastSpiritStoneColor: '黃', transcendenceSkillDamageSharePct: 33.333333333333 }, {
    'SpiritRecord.Class.1': 'KE', 'SpiritRecord.Class.2': 'AS', 'SpiritRecord.Class.3': 'AN',
    'MasterBeast.Head.Option1': '致命一擊8%', 'MasterBeast.Head.Option2': '極大化8%',
    'Stage.BossDEF': 99.999999999999, 'Stage.CritRatePenalty': 0.000000000001,
  }) },
  { id: 'empty-stage-boundaries', state: change(minimal, { transcendenceSkillDamageSharePct: 0 }, {
    'Stage.Adapt': '', 'Stage.CritRatePenalty': '', 'Stage.BossDEF': '',
  }) },
];
export const comparisons = [
  ['same', 'public-complete', 'public-complete'],
  ['different', 'special-weapon-average', 'public-complete'],
  ['invalid-baseline', 'public-complete', 'invalid-class'],
  ['fallback-baseline', 'public-complete', 'no-weapon-rates-fallback'],
  ['fallback-current', 'invalid-boss-rates-fallback', 'public-complete'],
];

export function engineInput(data, calculationSources) {
  return {
    classId: 'KE', attackType: 'physical',
    attributeRules: data.attributes.attributes.filter(entry => entry.active && entry.aggregation === 'sum')
      .map(entry => ({ key: entry.key, aggregation: 'sum', cap: entry.cap })),
    characterBaseStats: { ...data.parameters.characterBase, ...data.parameters.characterBaseByClass?.KE },
    sources: calculationSources, attackParameters: data.attack, weaponEnhancementLevel: 8,
    classCombatEffects: data.classCombatEffects, classDamagePassives: data.classDamagePassives,
    combatRateSourceRules: data.combatRateSources,
    combatRateSourceValues: { parameters: { yellowBeastSpiritStoneRatePct: data.parameters.yellowBeastSpiritStoneRatePct },
      selections: { 'Left.Armor.Bottom.ENHC': 'Lv.8', 'Left.Armor.Shoes.ENHC': 'Lv.8', masterBeastSpiritStoneColor: '' } },
    targetCritPenaltyPct: 0, stageAdaptabilityPenaltyPct: 0, enemyDefensePct: 0,
    transcendenceSkillDamageSharePct: 100,
    critDamageProductBasePct: data.parameters.characterBaseByClass?.KE?.critDamagePct === undefined
      ? data.parameters.critDamageProductBasePct : data.parameters.characterBaseByClass.KE.critDamagePct - 100,
    critDamageProductBaselinePctToSubtract: data.parameters.characterBaseByClass?.KE?.critDamagePct
      ?? data.parameters.critDamageProductBaselinePctToSubtract,
  };
}
