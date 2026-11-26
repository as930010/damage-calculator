import parameters from '../data/calculation-parameters.json' with { type: 'json' };
import { multiplyBonuses } from './aggregation.ts';
import type { DamageAdditiveKey, DamageAdditiveSource, DamageBuffDetails, EffectValues, SelectedMember, SelectedOption, TeamCalculationInput } from './types.ts';

export const damageAdditiveKeys = ['critDamageAdditive', 'bossDamageAdditive'] as const;

export function damageAdditiveSources(effects: EffectValues, id: string, label: string): DamageAdditiveSource[] {
  return damageAdditiveKeys.flatMap(key => {
    const value = effects[key] ?? 0;
    return value === 0 ? [] : [{ id, label, key, value }];
  });
}

/** Calculate against the same beneficiary before and after applying the sources active in this scope. */
export function calculateDamageBuff(input: TeamCalculationInput, members: SelectedMember[], options: SelectedOption[],
  attackFactor: number): DamageBuffDetails | undefined {
  const rows = [
    ...members.flatMap(member => member.additiveSources ?? damageAdditiveSources(member.effects, 'class:' + member.classId, member.classCode)),
    ...options.flatMap(option => damageAdditiveSources(option.effects, 'loadout:' + option.id, option.id)),
  ];
  const sources = [...new Map(rows.map(source => [source.key + ':' + source.id, source])).values()];
  const productSources = [
    ...members.map(member => ({ id: 'class:' + member.classId, label: member.classCode, value: member.effects.multiplicativeCritDamage ?? 0 })),
    ...options.map(option => ({ id: 'loadout:' + option.id, label: option.id, value: option.effects.multiplicativeCritDamage ?? 0 })),
  ].filter(source => source.value !== 0);
  const legacySources = [...members.map(member => ({ label: member.classCode, value: member.effects.legacyCompositeBuff ?? 0 })),
    ...options.map(option => ({ label: option.id, value: option.effects.legacyCompositeBuff ?? 0 }))].filter(source => source.value !== 0);
  const base = input.damageBase;
  if (!base) {
    if (!sources.length && !productSources.length) return undefined;
    throw new RangeError('缺少基礎傷害屬性');
  }

  const totalPoints = (entries: DamageAdditiveSource[], key: DamageAdditiveKey) =>
    entries.filter(source => source.key === key).reduce((total, source) => total + source.value * 100, 0);
  if (!Number.isFinite(base.critDamagePct) || base.critDamagePct <= 0 || !Number.isFinite(base.bossDamagePct) || base.bossDamagePct < 0) {
    throw new RangeError('基礎致命傷害必須大於 0%，Boss 額外傷害不得小於 0%。');
  }
  const critPoints = totalPoints(sources, 'critDamageAdditive');
  const bossPoints = totalPoints(sources, 'bossDamageAdditive');
  const critProduct = multiplyBonuses(productSources.map(({ value }) => value));
  const critProductPoints = parameters.criticalDamage.characterBasePercent * (critProduct - 1);
  const critFactor = (base.critDamagePct + critPoints + critProductPoints) / base.critDamagePct;
  const bossFactor = 1 + bossPoints / (100 + base.bossDamagePct);
  if (!Number.isFinite(attackFactor * critFactor * bossFactor)) throw new RangeError('基礎傷害屬性超出可計算範圍。');
  return { base, sources, attackFactor, critPoints, critFactor, bossPoints, bossFactor,
    productSources, critProduct, critProductPoints, legacySources };
}
