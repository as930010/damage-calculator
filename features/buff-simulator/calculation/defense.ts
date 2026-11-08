import { combineDefenseBreak } from './aggregation.ts';
import type { TeamMode } from "./types.ts";

export function calculateDefenseDamageMultiplier(
  mode: TeamMode,
  defenseBreak: number,
  bossDamageReduction?: number,
  challengeBreakCoefficient?: number,
): number {
  const coefficient = mode === "single" ? bossDamageReduction : challengeBreakCoefficient;
  if (coefficient === undefined) {
    throw new Error(`Missing defense coefficient for ${mode} calculation`);
  }

  const remainingDamage = 1 - coefficient * defenseBreak;
  if (remainingDamage === 0) {
    throw new RangeError("Defense parameters produce a zero damage denominator");
  }
  return 1 / remainingDamage;
}

/** LA is additive to the beneficiary's equipment group, never an independent external break source. */
export function calculateBeneficiaryDefenseGain(equipmentRate: number, additive: number, externalRate: number, bossDefense: number): number {
  for (const rate of [equipmentRate, additive, externalRate, bossDefense, equipmentRate + additive]) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new RangeError('無視防禦加算與破防率須介於 0% 與 100%。');
  }
  const before = calculateDefenseDamageMultiplier('single', combineDefenseBreak([equipmentRate, externalRate]), bossDefense);
  const after = calculateDefenseDamageMultiplier('single', combineDefenseBreak([equipmentRate + additive, externalRate]), bossDefense);
  const gain = after / before - 1;
  if (!Number.isFinite(gain)) throw new RangeError('無視防禦收益無法計算。');
  return gain;
}
