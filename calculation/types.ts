export type CalculationMethod =
  | "diminishing"
  | "multiplicative"
  | "nonDiminishing";

export type CombatAttribute = "critRate" | "extremization";

export interface PercentEffect {
  /** Unique within the owning class and combat attribute. */
  id: string;
  method: CalculationMethod;
  /** Percentage points, e.g. 20 means 20%. */
  valuePct: number;
}

export interface ClassCombatEffectProfile {
  critRate: readonly PercentEffect[];
  extremization: readonly PercentEffect[];
}

export interface ClassCombatEffectsDocument {
  schemaVersion: 2;
  methods: Readonly<Record<CalculationMethod, string>>;
  classCodeAliases?: Readonly<Record<string, string>>;
  classes: Readonly<Record<string, ClassCombatEffectProfile>>;
}

export interface ResolvedPercentEffect extends PercentEffect {
  /** Composite key suitable for result details and UI list keys. */
  sourceId: string;
}

export interface RateCalculationInput {
  /**
   * Raw percentage total already assigned to the diminishing tier formula,
   * excluding every `diminishing` effect in `effects`.
   */
  baseRawStatPct: number;
  /** Class, equipment, buff, or other effects classified by calculation method. */
  effects: readonly Pick<ResolvedPercentEffect, "sourceId" | "method" | "valuePct">[];
  /** Signed percentage-point adjustment applied after multipliers and additions. */
  finalAdjustmentPct?: number;
}

export interface EffectValueDetail {
  sourceId: string;
  valuePct: number;
}

export interface MultiplierDetail extends EffectValueDetail {
  factor: number;
}

export interface RateCalculationResult {
  baseRawStatPct: number;
  diminishingAddedPct: number;
  rawStatPct: number;
  tierRate: number;
  multipliers: readonly MultiplierDetail[];
  multiplierProduct: number;
  nonDiminishingSources: readonly EffectValueDetail[];
  nonDiminishingPct: number;
  finalAdjustmentPct: number;
  valueBeforeUpperCap: number;
  /** Apply only an upper clamp of 1; negative values remain unchanged. */
  finalRate: number;
}

export interface CombatRateResults {
  critRate: RateCalculationResult;
  extremization: RateCalculationResult;
}

export interface AttributeRule {
  key: string;
  aggregation: "sum";
  cap?: {
    value: number;
    scope: "characterTotal";
  };
}

export interface StatContribution {
  sourceId: string;
  stats: Readonly<Record<string, number>>;
}

export interface ConditionalDamageContributions {
  stronger: readonly EffectValueDetail[];
  heat: readonly EffectValueDetail[];
}

export interface CharacterAttributeInput {
  rules: readonly AttributeRule[];
  sharedSources: readonly StatContribution[];
  lowerwearA: readonly StatContribution[];
  lowerwearB: readonly StatContribution[];
  /** False means only A is worn for the entire fight; omitted preserves two-profile averaging. */
  lowerwearAlternativeEnabled?: boolean;
  /** These conditional sources are kept outside the lowerwear average and stat caps. */
  conditionalDamage?: ConditionalDamageContributions;
}

export interface AggregatedAttributeDetail {
  key: string;
  sharedSources: readonly EffectValueDetail[];
  sharedTotal: number;
  lowerwearASources: readonly EffectValueDetail[];
  lowerwearA: number;
  lowerwearBSources: readonly EffectValueDetail[];
  lowerwearB: number;
  lowerwearAverage: number;
  totalBeforeCap: number;
  cap?: number;
  finalTotal: number;
}

export interface CharacterAttributeResult {
  stats: Readonly<Record<string, AggregatedAttributeDetail>>;
  conditionalDamage: {
    strongerPct: number;
    heatPct: number;
    strongerSources: readonly EffectValueDetail[];
    heatSources: readonly EffectValueDetail[];
  };
}

export type AttackType = "physical" | "magical";

export interface ClassAttackCoefficients {
  physical: number;
  magical: number;
}

export interface AttackParametersDocument {
  schemaVersion: 2;
  classes: Readonly<Record<string, ClassAttackCoefficients>>;
  weaponEnhancementFactors: Readonly<Record<string, number>>;
}

export interface ResolvedAttackParameters {
  physicalClassCoefficient: number;
  magicalClassCoefficient: number;
  weaponEnhancementFactor: number;
}

export interface AttackCalculationInput {
  attackType: AttackType;
  physicalAttack: number;
  magicalAttack: number;
  /** Additional attack, in percentage points. */
  doubleAttackPct: number;
  /** Skill-type attack bonus, in percentage points. */
  skillTypeAttackPct: number;
  /** Attack-level bonus. */
  attackLevel: number;
  /** Class coefficients for physical and magical weapon base attack. */
  physicalClassCoefficient: number;
  magicalClassCoefficient: number;
  /** Weapon enhancement multiplier resolved from game parameters. */
  weaponEnhancementFactor: number;
}

export interface AttackCalculationResult {
  attackType: AttackType;
  selectedAttack: number;
  attackPower: number;
  weaponPhysicalAttack: number;
  weaponMagicalAttack: number;
  lowerDamage: number;
  upperDamage: number;
}

export interface ClassDamagePassivesDocument {
  schemaVersion: 2;
  /** Missing class keys are unconfigured, never assumed to be 0%. */
  critDamagePctByClass: Readonly<Record<string, number>>;
  bossDamagePctByClass: Readonly<Record<string, number>>;
  /** Each entry is an independent product source; duplicate percentages remain distinct effects. */
  multiplicativeCritDamagePctByClass: Readonly<Record<string, readonly number[]>>;
}

export interface ProductStatEffect {
  sourceId: string;
  valuePct: number;
}

export interface ProductStatResult {
  factors: readonly MultiplierDetail[];
  productBeforeBaseline: number;
  baselinePct: number;
  value: number;
}

export interface FinalDamageInput {
  /** Damage bounds after rounding each bound down. */
  lowerDamage: number;
  upperDamage: number;
  /** Combat probabilities, e.g. 0.75 means 75%. */
  critRate: number;
  extremizationRate: number;
  /** Critical damage, in percentage points. */
  critDamagePct: number;
  /** Per-class passive bonus, stored as percentage points and resolved from JSON. */
  classCritDamagePassivePct: number;
  /** Critical damage product offset after subtracting the configured baseline. */
  multiplicativeCritDamageOffset: number;
  bossDamagePct: number;
  polarizationPct: number;
  transcendenceSkillDamagePct: number;
  strongSkillDamagePct: number;
  /** Share assigned to transcendence skills; strong skills receive the remainder. */
  transcendenceSkillDamageSharePct: number;
  allSkillDamagePct: number;
  bleedDamagePct: number;
  fullHealthKillDamagePct: number;
  strongerPct: number;
  heatPct: number;
  /** Select the existing high-HP (1) or low-HP (0) half; omission keeps the original 50/50 calculation. */
  bossHighHealthShare?: 0 | 1;
  /** Total damage multiplier product. */
  generalMultiplicativeDamage: number;
  adaptabilityPct: number;
  superAdaptabilityPct: number;
  stageAdaptabilityPenaltyPct: number;
  enemyDefensePct: number;
  defenseIgnorePct: number;
}

export interface FinalDamageResult {
  extremizedBase: number;
  critFactor: number;
  damageFactors: Readonly<Record<string, number>>;
  skillDamageWeighting: {
    transcendenceSharePct: number;
    strongSharePct: number;
    transcendenceFactor: number;
    strongFactor: number;
    combinedFactor: number;
  };
  conditionalFactor: number;
  adaptationFactor: number;
  defenseFactor: number;
  finalDamage: number;
}
