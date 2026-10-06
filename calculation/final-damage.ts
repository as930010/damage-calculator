import type { FinalDamageInput, FinalDamageResult } from "./types.ts";

function requireFiniteInputs(input: FinalDamageInput): void {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Final damage input ${key} must be a finite number.`);
    }
  }
}

function ratio(pct: number): number {
  return pct / 100;
}

/** Implements the B163 damage chain, weighting the two skill-damage multipliers by the selected share. */
export function calculateFinalDamage(input: FinalDamageInput): FinalDamageResult {
  requireFiniteInputs(input);

  const extremizedBase =
    (input.lowerDamage +
      (input.upperDamage - input.lowerDamage) * input.extremizationRate) /
      2 +
    input.upperDamage / 2;
  const critFactor =
    input.critRate *
      (ratio(input.critDamagePct) +
        ratio(input.classCritDamagePassivePct) +
        input.multiplicativeCritDamageOffset) +
    (1 - input.critRate);
  const transcendenceSharePct = input.transcendenceSkillDamageSharePct ?? 100;
  if (!Number.isFinite(transcendenceSharePct) || transcendenceSharePct < 0 || transcendenceSharePct > 100) {
    throw new RangeError("Transcendence skill damage share must be between 0 and 100.");
  }
  const strongSharePct = 100 - transcendenceSharePct;
  const transcendenceFactor = 1 + ratio(input.transcendenceSkillDamagePct);
  const strongFactor = 1 + ratio(input.strongSkillDamagePct);
  const combinedSkillDamageFactor =
    transcendenceFactor * ratio(transcendenceSharePct) +
    strongFactor * ratio(strongSharePct);
  const damageFactors = {
    bossDamage: 1 + ratio(input.bossDamagePct),
    polarization: 1 + ratio(input.polarizationPct),
    skillDamage: combinedSkillDamageFactor,
    allSkillDamage: 1 + ratio(input.allSkillDamagePct),
    bleedDamage: 1 + ratio(input.bleedDamagePct),
    fullHealthKillDamage: 1 + ratio(input.fullHealthKillDamagePct),
  };

  const strongerFactor = 1 + ratio(input.strongerPct);
  const heatFactor = 1 + ratio(input.heatPct);
  if (strongerFactor === 0 || heatFactor === 0) {
    throw new RangeError("B163 conditional damage source denominator is zero.");
  }
  const conditionalDenominator = 0.5 / strongerFactor + 0.5 / heatFactor;
  if (conditionalDenominator === 0) {
    throw new RangeError("B163 conditional damage denominator is zero.");
  }
  const conditionalFactor = 1 / conditionalDenominator;

  const adaptationFactor =
    1 - ratio(input.stageAdaptabilityPenaltyPct) +
    ratio(input.adaptabilityPct) +
    ratio(input.superAdaptabilityPct);
  const defenseDenominator =
    1 - ratio(input.enemyDefensePct) * ratio(input.defenseIgnorePct);
  if (defenseDenominator === 0) {
    throw new RangeError("B163 defense factor denominator is zero.");
  }
  const defenseFactor = 1 / defenseDenominator;

  const finalDamage =
    extremizedBase *
    critFactor *
    damageFactors.bossDamage *
    damageFactors.polarization *
    damageFactors.skillDamage *
    damageFactors.allSkillDamage *
    damageFactors.bleedDamage *
    damageFactors.fullHealthKillDamage *
    conditionalFactor *
    input.generalMultiplicativeDamage *
    adaptationFactor *
    defenseFactor;

  if (!Number.isFinite(finalDamage)) {
    throw new RangeError("B163 produced a non-finite final damage value.");
  }

  return {
    extremizedBase,
    critFactor,
    damageFactors,
    skillDamageWeighting: {
      transcendenceSharePct,
      strongSharePct,
      transcendenceFactor,
      strongFactor,
      combinedFactor: combinedSkillDamageFactor,
    },
    conditionalFactor,
    adaptationFactor,
    defenseFactor,
    finalDamage,
  };
}
