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

/** Recover defense from damage reduction using the coefficient provided by the workbook author. */
export function defenseFromDamageReduction(
  damageReduction: number,
  defenseCoefficient: number,
): number {
  if (damageReduction === 1) {
    throw new RangeError("A 100% damage reduction has no finite defense value");
  }
  return (damageReduction * defenseCoefficient) / (1 - damageReduction);
}

export function calculateResistanceControlSeconds(
  resistanceReduction: number,
  coefficient: number,
  capSeconds = 15,
): number {
  return Math.min(capSeconds, resistanceReduction * 0.01 * coefficient);
}
