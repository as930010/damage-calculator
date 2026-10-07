import { aggregateCharacterAttributes, prepareCharacterAttributeInput } from "./attribute-aggregation.ts";
import { calculateAttack, calculateWeaponBaseAttack, resolveAttackParameters } from "./attack.ts";
import { calculateCombatRates } from "./engine.ts";
import type { CombatRateEngineResult } from "./engine.ts";
import { resolveClassCritDamagePassivePct } from "./class-damage-passives.ts";
import { calculateFinalDamage } from "./final-damage.ts";
import { calculateProductStat } from "./multiplicative.ts";
import type { SimulatorEquipmentContributionGroups } from "./equipment-catalog.ts";
import { resolveCombatRateSources } from "./combat-rate-sources.ts";
import type {
  CombatRateSourceRulesDocument,
  CombatRateSourceValues,
} from "./combat-rate-sources.ts";
import type {
  AttackParametersDocument,
  AttackType,
  AttributeRule,
  CharacterAttributeResult,
  ClassCombatEffectsDocument,
  ClassDamagePassivesDocument,
  FinalDamageResult,
  ProductStatEffect,
  ProductStatResult,
  ResolvedPercentEffect,
  StatContribution,
} from "./types.ts";

export interface LoadoutCalculationInput {
  classId: string;
  attackType: AttackType;
  attributeRules: readonly AttributeRule[];
  characterBaseStats: Readonly<Record<string, number>>;
  /** All spreadsheet-mapped sources already resolved from data and user selections. */
  sources: SimulatorEquipmentContributionGroups;
  attackParameters: AttackParametersDocument;
  weaponEnhancementLevel: number;
  classCombatEffects: ClassCombatEffectsDocument;
  classDamagePassives: ClassDamagePassivesDocument;
  combatRateSourceRules: CombatRateSourceRulesDocument;
  combatRateSourceValues: CombatRateSourceValues;
  /** Future or independently resolved sources, excluding the class profile and B77/B103/B105. */
  additionalCritRateEffects?: readonly ResolvedPercentEffect[];
  additionalExtremizationEffects?: readonly ResolvedPercentEffect[];
  targetCritPenaltyPct: number;
  stageAdaptabilityPenaltyPct: number;
  enemyDefensePct: number;
  /** Percent of skill damage assigned to transcendence; the strong share is its complement. */
  transcendenceSkillDamageSharePct?: number;
  critDamageProductBasePct: number;
  critDamageProductBaselinePctToSubtract: number;
}

export interface LoadoutCalculationResult {
  attributes: CharacterAttributeResult;
  attack: ReturnType<typeof calculateAttack>;
  combatRates: CombatRateEngineResult;
  generalMultiplicativeDamage: ProductStatResult;
  multiplicativeCritDamage: ProductStatResult;
  classCritDamagePassivePct: number;
  finalDamage: FinalDamageResult;
}

export interface CombatRateCalculationInput {
  classId: string;
  classCombatEffects: ClassCombatEffectsDocument;
  baseCritRatePct: number;
  baseExtremizationPct: number;
  combatRateSourceRules: CombatRateSourceRulesDocument;
  combatRateSourceValues: CombatRateSourceValues;
  additionalCritRateEffects?: readonly ResolvedPercentEffect[];
  additionalExtremizationEffects?: readonly ResolvedPercentEffect[];
  targetCritPenaltyPct: number;
}

function statTotal(result: CharacterAttributeResult, key: string): number {
  return result.stats[key]?.finalTotal ?? 0;
}

function withCharacterBaseStats(
  sources: SimulatorEquipmentContributionGroups,
  baseStats: Readonly<Record<string, number>>,
): SimulatorEquipmentContributionGroups {
  const base: StatContribution = {
    sourceId: "character-base",
    stats: baseStats,
  };
  return {
    shared: [base, ...sources.shared],
    lowerwearA: sources.lowerwearA,
    lowerwearB: sources.lowerwearB,
    lowerwearAlternativeEnabled: sources.lowerwearAlternativeEnabled,
  };
}

/** Calculate actual in-combat rates without requiring weapon attack inputs. */
export function calculateLoadoutCombatRates(input: CombatRateCalculationInput): CombatRateEngineResult {
  const resolvedRateSources = resolveCombatRateSources(
    input.combatRateSourceRules,
    input.combatRateSourceValues,
  );
  return calculateCombatRates({
    classId: input.classId,
    classEffects: input.classCombatEffects,
    baseCritRatePct: input.baseCritRatePct,
    baseExtremizationPct: input.baseExtremizationPct,
    otherCritEffects: [
      ...resolvedRateSources.critRate.map((effect) => ({ ...effect, sourceId: effect.id })),
      ...(input.additionalCritRateEffects ?? []),
    ],
    otherExtremizationEffects: [
      ...resolvedRateSources.extremization.map((effect) => ({ ...effect, sourceId: effect.id })),
      ...(input.additionalExtremizationEffects ?? []),
    ],
    targetCritPenaltyPct: input.targetCritPenaltyPct,
  });
}

/** Run the spreadsheet-mapped source groups through the complete combat calculation chain. */
export function calculateLoadout(input: LoadoutCalculationInput): LoadoutCalculationResult {
  const preliminaryPrepared = prepareCharacterAttributeInput(
    input.attributeRules,
    withCharacterBaseStats(input.sources, input.characterBaseStats),
  );
  const preliminaryAttributes = aggregateCharacterAttributes(preliminaryPrepared.attributeInput);
  const resolvedAttack = resolveAttackParameters(
    input.attackParameters,
    input.classId,
    input.weaponEnhancementLevel,
  );
  // C53/D53 depend on U1 (attack level), then C1/D1 include their values.
  // Resolve this acyclic step before final aggregation so the attack formula consumes them.
  const weaponBase = calculateWeaponBaseAttack({
    attackLevel: statTotal(preliminaryAttributes, "attackLevel"),
    ...resolvedAttack,
  });
  const prepared = prepareCharacterAttributeInput(
    input.attributeRules,
    withCharacterBaseStats(
      {
        ...input.sources,
        shared: [
          ...input.sources.shared,
          {
            sourceId: "weapon-base-attack",
            stats: { physicalAttack: weaponBase.physicalAttack, magicalAttack: weaponBase.magicalAttack },
          },
        ],
      },
      input.characterBaseStats,
    ),
  );
  const attributes = aggregateCharacterAttributes(prepared.attributeInput);
  const attack = calculateAttack({
    attackType: input.attackType,
    physicalAttack: statTotal(attributes, "physicalAttack"),
    magicalAttack: statTotal(attributes, "magicalAttack"),
    doubleAttackPct: statTotal(attributes, "doubleAttackPct"),
    skillTypeAttackPct: statTotal(attributes, "skillTypeAttackPct"),
    attackLevel: statTotal(attributes, "attackLevel"),
    ...resolvedAttack,
  });
  const combatRates = calculateLoadoutCombatRates({
    classId: input.classId,
    classCombatEffects: input.classCombatEffects,
    baseCritRatePct: statTotal(attributes, "critRatePct"),
    baseExtremizationPct: statTotal(attributes, "extremizationPct"),
    combatRateSourceRules: input.combatRateSourceRules,
    combatRateSourceValues: input.combatRateSourceValues,
    additionalCritRateEffects: input.additionalCritRateEffects,
    additionalExtremizationEffects: input.additionalExtremizationEffects,
    targetCritPenaltyPct: input.targetCritPenaltyPct,
  });

  const generalMultiplicativeDamage = calculateProductStat(
    prepared.generalMultiplicativeEffects,
  );
  const multiplicativeCritDamage = calculateProductStat(
    [
      ...prepared.multiplicativeCritDamageEffects,
      { sourceId: "character-base:crit-damage-product", valuePct: input.critDamageProductBasePct },
    ],
    input.critDamageProductBaselinePctToSubtract,
  );
  const classCritDamagePassivePct = resolveClassCritDamagePassivePct(
    input.classDamagePassives,
    input.classId,
  );
  const finalDamage = calculateFinalDamage({
    lowerDamage: attack.lowerDamage,
    upperDamage: attack.upperDamage,
    critRate: combatRates.critRate.finalRate,
    extremizationRate: combatRates.extremization.finalRate,
    critDamagePct: statTotal(attributes, "critDamagePct"),
    classCritDamagePassivePct,
    multiplicativeCritDamageOffset: multiplicativeCritDamage.value,
    bossDamagePct: statTotal(attributes, "bossDamagePct"),
    polarizationPct: statTotal(attributes, "polarizationPct"),
    transcendenceSkillDamagePct: statTotal(attributes, "transcendenceSkillDamagePct"),
    strongSkillDamagePct: statTotal(attributes, "strongSkillDamagePct"),
    transcendenceSkillDamageSharePct: input.transcendenceSkillDamageSharePct ?? 100,
    allSkillDamagePct: statTotal(attributes, "allSkillDamagePct"),
    bleedDamagePct: statTotal(attributes, "bleedDamagePct"),
    fullHealthKillDamagePct: statTotal(attributes, "fullHealthKillDamagePct"),
    strongerPct: attributes.conditionalDamage.strongerPct,
    heatPct: attributes.conditionalDamage.heatPct,
    generalMultiplicativeDamage: generalMultiplicativeDamage.value,
    adaptabilityPct: statTotal(attributes, "adaptabilityPct"),
    superAdaptabilityPct: statTotal(attributes, "superAdaptabilityPct"),
    stageAdaptabilityPenaltyPct: input.stageAdaptabilityPenaltyPct,
    enemyDefensePct: input.enemyDefensePct,
    defenseIgnorePct: statTotal(attributes, "defenseIgnorePct"),
  });

  return {
    attributes,
    attack,
    combatRates,
    generalMultiplicativeDamage,
    multiplicativeCritDamage,
    classCritDamagePassivePct,
    finalDamage,
  };
}

export function mergeLoadoutSources(
  ...groups: readonly SimulatorEquipmentContributionGroups[]
): SimulatorEquipmentContributionGroups {
  const explicitModes = new Set(groups.flatMap((group) =>
    group.lowerwearAlternativeEnabled === undefined ? [] : [group.lowerwearAlternativeEnabled],
  ));
  if (explicitModes.size > 1) {
    throw new TypeError("Cannot merge loadout sources with conflicting alternative-lowerwear settings.");
  }
  return {
    shared: groups.flatMap((group) => group.shared),
    lowerwearA: groups.flatMap((group) => group.lowerwearA),
    lowerwearB: groups.flatMap((group) => group.lowerwearB),
    lowerwearAlternativeEnabled: [...explicitModes][0],
  };
}

export function productEffectsFromSources(
  sources: readonly StatContribution[],
  statKey: "multiplicativeDamagePct" | "multiplicativeCritDamagePct",
): ProductStatEffect[] {
  return sources.flatMap((source) => {
    const valuePct = source.stats[statKey];
    return valuePct === undefined ? [] : [{ sourceId: source.sourceId, valuePct }];
  });
}
