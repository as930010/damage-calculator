import type {
  AggregatedAttributeDetail,
  AttributeRule,
  CharacterAttributeInput,
  CharacterAttributeResult,
  EffectValueDetail,
  ProductStatEffect,
  StatContribution,
} from "./types.ts";
import type { SimulatorEquipmentContributionGroups } from "./equipment-catalog.ts";

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function validateRules(rules: readonly AttributeRule[]): Map<string, AttributeRule> {
  const byKey = new Map<string, AttributeRule>();
  for (const rule of rules) {
    if (!rule.key.trim()) {
      throw new TypeError("Attribute rule keys must be non-empty strings.");
    }
    if (byKey.has(rule.key)) {
      throw new TypeError(`Duplicate attribute rule for ${rule.key}.`);
    }
    if (rule.aggregation !== "sum") {
      throw new TypeError(`Unsupported aggregation method for ${rule.key}.`);
    }
    if (rule.cap) {
      requireFinite(rule.cap.value, `${rule.key}.cap.value`);
      if (rule.cap.value < 0) {
        throw new RangeError(`${rule.key}.cap.value cannot be negative.`);
      }
      if (rule.cap.scope !== "characterTotal") {
        throw new TypeError(`${rule.key} cap must apply to characterTotal.`);
      }
    }
    byKey.set(rule.key, rule);
  }
  return byKey;
}

function validateSources(
  sources: readonly StatContribution[],
  rules: ReadonlyMap<string, AttributeRule>,
  label: string,
): void {
  for (const source of sources) {
    if (!source.sourceId.trim()) {
      throw new TypeError(`${label} sourceId must be a non-empty string.`);
    }
    for (const [key, value] of Object.entries(source.stats)) {
      if (!rules.has(key)) {
        throw new Error(`${label} source ${source.sourceId} uses unknown stat ${key}.`);
      }
      requireFinite(value, `${label}.${source.sourceId}.${key}`);
    }
  }
}

function detailsFor(sources: readonly StatContribution[], key: string): EffectValueDetail[] {
  const details: EffectValueDetail[] = [];
  for (const source of sources) {
    const valuePct = source.stats[key];
    if (valuePct !== undefined) {
      details.push({ sourceId: source.sourceId, valuePct });
    }
  }
  return details;
}

function sumDetails(details: readonly EffectValueDetail[]): number {
  return details.reduce((sum, detail) => sum + detail.valuePct, 0);
}

/**
 * Route stronger/heat stats out of ordinary gear totals before lowerwear averaging.
 * All conditional sources apply in both boss-health states; the B163 equation
 * combines their full totals independently of the ordinary lowerwear average.
 */
export interface PreparedCharacterAttributeInput {
  attributeInput: CharacterAttributeInput;
  generalMultiplicativeEffects: readonly ProductStatEffect[];
  multiplicativeCritDamageEffects: readonly ProductStatEffect[];
}

export function prepareCharacterAttributeInput(
  rules: readonly AttributeRule[],
  groups: SimulatorEquipmentContributionGroups,
): PreparedCharacterAttributeInput {
  const stronger: EffectValueDetail[] = [];
  const heat: EffectValueDetail[] = [];
  const generalMultiplicativeEffects: ProductStatEffect[] = [];
  const multiplicativeCritDamageEffects: ProductStatEffect[] = [];
  const removeConditionalStats = (sources: readonly StatContribution[]): StatContribution[] => {
    const ordinary: StatContribution[] = [];
    for (const source of sources) {
      const {
        strongerPct,
        heatPct,
        multiplicativeDamagePct,
        multiplicativeCritDamagePct,
        ...stats
      } = source.stats;
      if (strongerPct !== undefined) stronger.push({ sourceId: source.sourceId, valuePct: strongerPct });
      if (heatPct !== undefined) heat.push({ sourceId: source.sourceId, valuePct: heatPct });
      if (multiplicativeDamagePct !== undefined) {
        generalMultiplicativeEffects.push({ sourceId: source.sourceId, valuePct: multiplicativeDamagePct });
      }
      if (multiplicativeCritDamagePct !== undefined) {
        multiplicativeCritDamageEffects.push({ sourceId: source.sourceId, valuePct: multiplicativeCritDamagePct });
      }
      if (Object.keys(stats).length > 0) ordinary.push({ sourceId: source.sourceId, stats });
    }
    return ordinary;
  };

  return {
    attributeInput: {
      rules,
      sharedSources: removeConditionalStats(groups.shared),
      lowerwearA: removeConditionalStats(groups.lowerwearA),
      lowerwearB: removeConditionalStats(groups.lowerwearAlternativeEnabled === false ? [] : groups.lowerwearB),
      lowerwearAlternativeEnabled: groups.lowerwearAlternativeEnabled,
      conditionalDamage: { stronger, heat },
    },
    generalMultiplicativeEffects,
    multiplicativeCritDamageEffects,
  };
}

function aggregateConditionalSources(
  sources: readonly EffectValueDetail[],
  label: string,
): { totalPct: number; sources: readonly EffectValueDetail[] } {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source.sourceId.trim()) {
      throw new TypeError(`${label} sourceId must be a non-empty string.`);
    }
    if (ids.has(source.sourceId)) {
      throw new TypeError(`${label} sourceId duplicates ${source.sourceId}.`);
    }
    ids.add(source.sourceId);
    requireFinite(source.valuePct, `${label}.${source.sourceId}.valuePct`);
  }
  return { totalPct: sumDetails(sources), sources: [...sources] };
}

/**
 * Sum ordinary character stats, average the two mutually exclusive lowerwear
 * configurations, and only then apply any character-total caps from JSON rules.
 * Stronger/heat conditional bonuses stay separate for the B163 conditional factor.
 */
export function aggregateCharacterAttributes(
  input: CharacterAttributeInput,
): CharacterAttributeResult {
  const rules = validateRules(input.rules);
  validateSources(input.sharedSources, rules, "sharedSources");
  validateSources(input.lowerwearA, rules, "lowerwearA");
  validateSources(input.lowerwearB, rules, "lowerwearB");

  const stats: Record<string, AggregatedAttributeDetail> = {};
  for (const [key, rule] of rules) {
    const sharedSources = detailsFor(input.sharedSources, key);
    const lowerwearASources = detailsFor(input.lowerwearA, key);
    const lowerwearBSources = detailsFor(input.lowerwearAlternativeEnabled === false ? [] : input.lowerwearB, key);
    const sharedTotal = sumDetails(sharedSources);
    const lowerwearA = sumDetails(lowerwearASources);
    const lowerwearB = sumDetails(lowerwearBSources);
    const lowerwearAverage = input.lowerwearAlternativeEnabled === false
      ? lowerwearA
      : (lowerwearA + lowerwearB) / 2;
    const totalBeforeCap = sharedTotal + lowerwearAverage;
    const finalTotal = rule.cap
      ? Math.min(rule.cap.value, totalBeforeCap)
      : totalBeforeCap;

    stats[key] = {
      key,
      sharedSources,
      sharedTotal,
      lowerwearASources,
      lowerwearA,
      lowerwearBSources,
      lowerwearB,
      lowerwearAverage,
      totalBeforeCap,
      ...(rule.cap ? { cap: rule.cap.value } : {}),
      finalTotal,
    };
  }

  const stronger = aggregateConditionalSources(
    input.conditionalDamage?.stronger ?? [],
    "conditionalDamage.stronger",
  );
  const heat = aggregateConditionalSources(
    input.conditionalDamage?.heat ?? [],
    "conditionalDamage.heat",
  );

  return {
    stats,
    conditionalDamage: {
      strongerPct: stronger.totalPct,
      heatPct: heat.totalPct,
      strongerSources: stronger.sources,
      heatSources: heat.sources,
    },
  };
}
