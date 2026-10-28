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
