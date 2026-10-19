import { getClassEffects, resolveClassId } from "./class-effects.ts";
import { calculateCriticalRate, calculateExtremizationRate } from "./probability.ts";
import type {
  ClassCombatEffectsDocument,
  CombatRateResults,
  ResolvedPercentEffect,
} from "./types.ts";

export interface CombatRateEngineInput {
  classId: string;
  classEffects: ClassCombatEffectsDocument;
  /** Base critical-hit percentage excluding separately resolved class effects. */
  baseCritRatePct: number;
  /** Base extremization percentage excluding separately resolved class effects. */
  baseExtremizationPct: number;
  /** Equipment, buffs, and other effects already classified by calculation method. */
  otherCritEffects?: readonly ResolvedPercentEffect[];
  otherExtremizationEffects?: readonly ResolvedPercentEffect[];
  /** Target penalty, supplied as a positive percentage and subtracted after crit additions. */
  targetCritPenaltyPct?: number;
}

export interface CombatRateEngineResult extends CombatRateResults {
  classId: string;
}

/**
 * Calculate critical hit and extremization probabilities from source groups.
 * Class diminishing entries are added to base percentages, multiplicative
 * entries join the factor product, and non-diminishing entries are added last.
 */
export function calculateCombatRates(input: CombatRateEngineInput): CombatRateEngineResult {
  const classId = resolveClassId(input.classEffects, input.classId);
  const classCritEffects = getClassEffects(input.classEffects, classId, "critRate");
  const classExtremizationEffects = getClassEffects(
    input.classEffects,
    classId,
    "extremization",
  );

  const critPenaltyPct = input.targetCritPenaltyPct ?? 0;
  if (!Number.isFinite(critPenaltyPct)) {
    throw new TypeError("targetCritPenaltyPct must be a finite number.");
  }

  return {
    classId,
    critRate: calculateCriticalRate({
      baseRawStatPct: input.baseCritRatePct,
      effects: [...classCritEffects, ...(input.otherCritEffects ?? [])],
      finalAdjustmentPct: -critPenaltyPct,
    }),
    extremization: calculateExtremizationRate({
      baseRawStatPct: input.baseExtremizationPct,
      effects: [
        ...classExtremizationEffects,
        ...(input.otherExtremizationEffects ?? []),
      ],
    }),
  };
}
