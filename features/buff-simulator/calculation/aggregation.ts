import type { EffectValues, SupportRank } from "./types.ts";

const value = (effects: EffectValues, key: keyof EffectValues): number =>
  effects[key] ?? 0;

export function multiplyBonuses(values: number[]): number {
  return values.reduce((result, bonus) => result * (1 + bonus), 1);
}

export function combineDefenseBreak(values: number[]): number {
  return 1 - values.reduce((remaining, amount) => remaining * (1 - amount), 1);
}

export function combineShield(values: number[]): number {
  return 1 - values.reduce((remaining, amount) => remaining * (1 - amount), 1);
}

export function sumEffects(values: number[]): number {
  return values.reduce((sum, amount) => sum + amount, 0);
}

export function rankSupport(values: number[]): SupportRank {
  const count = sumEffects(values);
  if (count === 1) return "has";
  if (count === 2) return "good";
  if (count >= 3) return "strong";
  return "none";
}

export function cappedMultiplicativeBonus(values: number[], cap: number): number {
  return Math.min(cap, multiplyBonuses(values) - 1);
}

export function collectValues(
  members: EffectValues[],
  options: EffectValues[],
  key: keyof EffectValues,
): number[] {
  return [...members, ...options].map((effects) => value(effects, key));
}
