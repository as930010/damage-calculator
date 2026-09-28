import type {
  EffectValueDetail,
  MultiplierDetail,
  RateCalculationInput,
  RateCalculationResult,
  ResolvedPercentEffect,
} from "./types.ts";

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

/** Spreadsheet diminishing curve used by 計算機!B159. */
export function criticalTierRate(rawCritPct: number): number {
  requireFinite(rawCritPct, "rawCritPct");
  const raw = rawCritPct / 100;
  return (
    Math.min(Math.max(0, raw), 0.4) +
    0.8 * Math.min(Math.max(0, raw - 0.4), 0.35) +
    0.6 * Math.min(Math.max(0, raw - 0.75), 0.3) +
    0.4 * Math.min(Math.max(0, raw - 1.05), 0.35)
  );
}

/** Spreadsheet diminishing curve used by 計算機!B160. */
export function extremizationTierRate(rawExtremizationPct: number): number {
  requireFinite(rawExtremizationPct, "rawExtremizationPct");
  const raw = rawExtremizationPct / 100;
  return (
    Math.min(Math.max(0, raw), 0.4) +
    0.75 * Math.min(Math.max(0, raw - 0.4), 0.4) +
    0.5 * Math.min(Math.max(0, raw - 0.8), 0.4) +
    0.25 * Math.min(Math.max(0, raw - 1.2), 0.4)
  );
}

function calculateRate(
  input: RateCalculationInput,
  tierRateForStat: (rawStatPct: number) => number,
): RateCalculationResult {
  requireFinite(input.baseRawStatPct, "baseRawStatPct");
  const finalAdjustmentPct = input.finalAdjustmentPct ?? 0;
  requireFinite(finalAdjustmentPct, "finalAdjustmentPct");

  const diminishingSources: EffectValueDetail[] = [];
  const multipliers: MultiplierDetail[] = [];
  const nonDiminishingSources: EffectValueDetail[] = [];
  const seenSourceIds = new Set<string>();

  for (const effect of input.effects) {
    requireFinite(effect.valuePct, `${effect.sourceId}.valuePct`);
    if (!effect.sourceId.trim()) {
      throw new TypeError("Effect sourceId must be a non-empty string.");
    }
    if (seenSourceIds.has(effect.sourceId)) {
      throw new TypeError(`Effect sourceId duplicates ${effect.sourceId}.`);
    }
    seenSourceIds.add(effect.sourceId);

    if (effect.method === "diminishing") {
      diminishingSources.push({ sourceId: effect.sourceId, valuePct: effect.valuePct });
    } else if (effect.method === "multiplicative") {
      multipliers.push({
        sourceId: effect.sourceId,
        valuePct: effect.valuePct,
        factor: 1 + effect.valuePct / 100,
      });
    } else if (effect.method === "nonDiminishing") {
      nonDiminishingSources.push({ sourceId: effect.sourceId, valuePct: effect.valuePct });
    } else {
      throw new TypeError(`Unsupported calculation method for ${effect.sourceId}.`);
    }
  }

  const diminishingAddedPct = diminishingSources.reduce(
    (sum, source) => sum + source.valuePct,
    0,
  );
  const rawStatPct = input.baseRawStatPct + diminishingAddedPct;
  const tierRate = tierRateForStat(rawStatPct);
  const multiplierProduct = multipliers.reduce((product, item) => product * item.factor, 1);
  const nonDiminishingPct = nonDiminishingSources.reduce(
    (sum, source) => sum + source.valuePct,
    0,
  );
  const valueBeforeUpperCap =
    tierRate * multiplierProduct + nonDiminishingPct / 100 + finalAdjustmentPct / 100;

  return {
    baseRawStatPct: input.baseRawStatPct,
    diminishingAddedPct,
    rawStatPct,
    tierRate,
    multipliers,
    multiplierProduct,
    nonDiminishingSources,
    nonDiminishingPct,
    finalAdjustmentPct,
    valueBeforeUpperCap,
    // The source formula uses MIN(1, value), without a lower clamp.
    finalRate: Math.min(1, valueBeforeUpperCap),
  };
}

export function calculateCriticalRate(input: RateCalculationInput): RateCalculationResult {
  return calculateRate(input, criticalTierRate);
}

export function calculateExtremizationRate(
  input: RateCalculationInput,
): RateCalculationResult {
  return calculateRate(input, extremizationTierRate);
}

export function combineEffects(
  groups: readonly (readonly ResolvedPercentEffect[])[],
): readonly ResolvedPercentEffect[] {
  return groups.flat();
}
