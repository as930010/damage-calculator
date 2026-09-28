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
  /** Raw F1 contribution excluding the class effects in class-combat-effects.json. */
  baseCritRatePct: number;
  /** Raw G1 contribution excluding the class effects in class-combat-effects.json. */
  baseExtremizationPct: number;
  /** Equipment, buffs, and other effects already classified by calculation method. */
  otherCritEffects?: readonly ResolvedPercentEffect[];
  otherExtremizationEffects?: readonly ResolvedPercentEffect[];
  /** Y1, supplied as a positive percentage and subtracted after the crit additions. */
  targetCritPenaltyPct?: number;
}

export interface CombatRateEngineResult extends CombatRateResults {
  classId: string;
}

/**
 * Calculate the spreadsheet's B159/B160 probability results from source groups.
 * Class diminishing entries are added to raw F1/G1 totals, multiplicative
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
