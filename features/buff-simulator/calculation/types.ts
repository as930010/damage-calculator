/** Calculation profiles are mode-specific even when two values share a label. */
export type TeamMode = "single" | "challenge";

export type EffectKey =
  | "buff"
  | "critDamageAdditive"
  | "bossDamageAdditive"
  | "multiplicativeCritDamage"
  | "legacyCompositeBuff"
  | "debuff"
  | "defenseBreak"
  | "defenseIgnoreAdditive"
  | "shield"
  | "attackReduction"
  | "magicalAttackReduction"
  | "cooldownAcceleration"
  | "cooldownReductionSeconds"
  | "resistanceReduction"
  | "mpRecoveryPerSecond"
  | "actionSpeedMultiplicative"
  | "actionSpeedDiminishing"
  | "roarBlock"
  | "debuffCleanse"
  | "superArmor";

/** Ratios are decimals: 0.2 means 20%. Seconds and resistance points are not ratios. */
export type EffectValues = Partial<Record<EffectKey, number>>;

export interface ClassRecord {
  id: string;
  code: string;
  name: string;
  sortOrder?: number;
  enabled: boolean;
  uniquenessGroup?: string;
}

export interface ClassModeProfile {
  classId: string;
  code: string;
  mode: TeamMode;
  effects: EffectValues;
}

export interface EffectTypeDefinition {
  key: EffectKey;
  label: string;
  unit: string;
  group: string;
  aggregation: EffectBreakdown["aggregation"];
  sortOrder: number;
}

export type SupportMagazineTarget = 'attackBuff' | 'allSkillDamageBuff' | 'allSpeedBuff';
export interface SupportMagazineSelection { id: string; target: SupportMagazineTarget; level: number; enabled: boolean }
export interface SupportMagazineDetail { optionId: string; target: SupportMagazineTarget; level: number; classCode: string; baseValue: number; effectiveValue: number }
export type DamageAdditiveKey = 'critDamageAdditive' | 'bossDamageAdditive';
export type TeamKey = 'single' | 'first' | 'second';
export interface DamageAdditiveSource { id: string; label: string; key: DamageAdditiveKey; value: number }
export interface DamageBase { critDamagePct: number; bossDamagePct: number }
export interface DamageBuffDetails {
  base: DamageBase;
  sources: DamageAdditiveSource[];
  attackFactor: number;
  critPoints: number;
  critFactor: number;
  bossPoints: number;
  bossFactor: number;
  productSources: { id: string; label: string; value: number }[];
  critProduct: number;
  critProductPoints: number;
  legacySources: { label: string; value: number }[];
}

export interface SelectedMember {
  classId: string;
  classCode: string;
  effects: EffectValues;
  additiveSources?: DamageAdditiveSource[];
  /** Ephemeral owning-team settings, bound before shared-arena uniqueness. */
  supportMagazines?: readonly SupportMagazineSelection[];
  /** Values in one exclusivity group overwrite each other on the same map. */
  uniquenessGroup?: string;
}

export interface SelectedOption {
  /** Stable option source ID; same ID across teams is effective once in a shared arena. */
  id: string;
  effects: EffectValues;
  supportMagazine?: SupportMagazineSelection;
}

export type OptionValueSpec =
  | { kind: "fixed"; value: number }
  | { kind: "scaled-parameter"; parameter: "movementSpeedShoePercent" | "skillDamageGlovePercent"; factor: number };

export interface LoadoutOptionDefinition {
  id: string;
  label: string;
  scope: "per-team";
  defaultSelected: boolean;
  presentation?: "background";
  userInput?: {
    kind: "percentage";
    parameter: "movementSpeedShoePercent" | "skillDamageGlovePercent";
    helpText: string;
  } | { kind: "support-magazine"; target: SupportMagazineTarget };
  effects: Partial<Record<EffectKey, OptionValueSpec>>;
}

export interface CalculationParameters {
  movementSpeedShoePercent: number;
  skillDamageGlovePercent: number;
}

export interface ControlTimeCategory {
  id: string;
  label: string;
  coefficient: number;
}

export interface ControlTimeParameters {
  capSeconds: number;
  secondsPerResistancePoint: number;
  categories: ControlTimeCategory[];
}

export interface ControlTimeResult {
  categoryId: string;
  label: string;
  coefficient: number;
  seconds: number;
}

export interface SkillReferenceEntry {
  name: string;
  category: string;
  description: string;
  icon?: string;
}

export interface ClassSkillReference {
  code: string;
  skills: SkillReferenceEntry[];
}

export interface SkillReferenceCatalog {
  schemaVersion: number;
  purpose: string;
  roles: ClassSkillReference[];
}

export interface DefenseModel {
  /** Configurable boss damage reduction for single-team calculations. */
  bossDamageReduction?: number;
  /** Default break-to-damage coefficient for challenge calculations. */
  challengeBreakCoefficient?: number;
}

export interface TeamCalculationInput {
  mode: TeamMode;
  members: SelectedMember[];
  options?: SelectedOption[];
  defense: DefenseModel;
  /** Shared arena support options are applied once when their IDs match. */
  uniqueClassCodes?: string[];
  actionSpeedCap?: number;
  includeDefenseContributions?: boolean;
  damageBase?: DamageBase;
}

export type SupportRank = "none" | "has" | "good" | "strong";

export interface EffectBreakdown {
  key: EffectKey;
  /** Values after duplicate/exclusivity filtering and option application. */
  values: number[];
  aggregation: "multiply" | "sum" | "remaining-product" | "rank" | "capped-multiply";
  result: number | SupportRank;
}

export interface DefenseContribution {
  id: string;
  category: "class" | "loadout" | "defense-ignore";
  label: string;
  /** Fraction supplied by this source after applying eligibility and uniqueness rules. */
  rate: number;
}

export interface TeamCalculationResult {
  damageBuff?: DamageBuffDetails;
  defenseContributions?: DefenseContribution[];
  mode: TeamMode;
  buffMultiplier: number;
  debuffMultiplier: number;
  /** Multiplier minus one; challenge results display this increment. */
  buffIncrease: number;
  /** Multiplier minus one; challenge results display this increment. */
  debuffIncrease: number;
  defenseBreak: number;
  /** Additive beneficiary ignore; displayed separately from totalDamageMultiplier. */
  defenseIgnoreAdditive?: number;
  defenseBreakDamageIncrease: number;
  defenseDamageMultiplier: number;
  totalDamageMultiplier: number;
  shield: number;
  attackReduction: number;
  cooldownAcceleration: number;
  cooldownReductionSeconds: number;
  resistanceReduction: number;
  mpRecoveryPerSecond: number;
  actionSpeedMultiplicative: number;
  actionSpeedDiminishing: number;
  roarBlock: SupportRank;
  debuffCleanse: SupportRank;
  superArmor: SupportRank;
  breakdown: EffectBreakdown[];
  ignoredClassIds: string[];
  supportMagazineDetails?: SupportMagazineDetail[];
}

export interface ChallengeCalculationInput {
  firstTeam: Omit<TeamCalculationInput, "mode" | "defense" | "uniqueClassCodes" | "actionSpeedCap" | "includeDefenseContributions" | "damageBase">;
  secondTeam: Omit<TeamCalculationInput, "mode" | "defense" | "uniqueClassCodes" | "actionSpeedCap" | "includeDefenseContributions">;
  /** Options applied only to the combined eight-person calculation. */
  sharedOptions?: SelectedOption[];
  defense: DefenseModel;
  uniqueClassCodes?: string[];
  actionSpeedCap?: number;
  includeDefenseContributions?: boolean;
  damageBase?: DamageBase;
}

export interface ChallengeCalculationResult {
  firstTeam: TeamCalculationResult;
  secondTeam: TeamCalculationResult;
  /** Recalculated across eight members with same-arena duplicate rules. */
  sharedArena: TeamCalculationResult;
}
