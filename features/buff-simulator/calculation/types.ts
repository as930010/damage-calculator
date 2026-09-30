/** The calculation source is mode-specific even when two values share a label. */
export type TeamMode = "single" | "challenge";

export type EffectKey =
  | "buff"
  | "debuff"
  | "defenseBreak"
  | "shield"
  | "attackReduction"
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
  sourceRanges: { single: string; challenge: string };
}

export interface ClassModeProfile {
  classId: string;
  code: string;
  mode: TeamMode;
  effects: EffectValues;
  estimatedDamageScore: number;
  sourceRange: string;
  workbookDerived?: { defenseBreakDamageIncrease: number | null };
}

export interface EffectTypeDefinition {
  key: EffectKey;
  label: string;
  unit: string;
  group: string;
  aggregation: EffectBreakdown["aggregation"];
  sortOrder: number;
}

export interface SelectedMember {
  classId: string;
  classCode: string;
  effects: EffectValues;
  /** Values in one exclusivity group overwrite each other on the same map. */
  uniquenessGroup?: string;
}

export interface SelectedOption {
  /** Stable option source ID; same ID across teams is effective once in a shared arena. */
  id: string;
  effects: EffectValues;
}

export type OptionValueSpec =
  | { kind: "fixed"; value: number }
  | {
      kind: "relative-parameter-increase";
      parameter: "criticalDamagePercent";
      additiveIncrease: number;
    }
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
  };
  /** Read-only workbook summary cells, not the web UI input controls. */
  sourceSummaryCells?: { single?: string; challengeFirstTeam?: string; challengeSecondTeam?: string };
  sourceRange: string;
  effects: Partial<Record<EffectKey, OptionValueSpec>>;
}

export interface CalculationParameters {
  /** Decimal multiplier; 2.35 represents a 235% critical-damage stat. */
  criticalDamagePercent: number;
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
  singleResistanceSource: string;
  challengeSharedResistanceSource: string;
  categories: ControlTimeCategory[];
  formulaNote: string;
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
  sourceRanges: string[];
}

export interface ClassSkillReference {
  code: string;
  skills: SkillReferenceEntry[];
  sourceRanges: string[];
}

export interface SkillReferenceCatalog {
  schemaVersion: number;
  sourceSpreadsheetId: string;
  sourceSheet: string;
  purpose: string;
  notes: Array<{ text: string; sourceRange: string }>;
  roles: ClassSkillReference[];
}

export interface DefenseModel {
  /** Single-team boss damage reduction parameter (Excel A2). */
  bossDamageReduction?: number;
  /** Challenge break-to-damage coefficient (Excel 96.01%). */
  challengeBreakCoefficient?: number;
}

export interface TeamCalculationInput {
  mode: TeamMode;
  members: SelectedMember[];
  options?: SelectedOption[];
  defense: DefenseModel;
  /** The spreadsheet's unique-support set, stored as data in the eventual class catalog. */
  uniqueClassCodes?: string[];
  actionSpeedCap?: number;
}

export type SupportRank = "none" | "has" | "good" | "strong";

export interface EffectBreakdown {
  key: EffectKey;
  /** Values after duplicate/exclusivity filtering and option application. */
  values: number[];
  aggregation: "multiply" | "sum" | "remaining-product" | "rank" | "capped-multiply";
  result: number | SupportRank;
}

export interface TeamCalculationResult {
  mode: TeamMode;
  buffMultiplier: number;
  debuffMultiplier: number;
  /** Multiplier minus one; challenge tables display this increment. */
  buffIncrease: number;
  /** Multiplier minus one; challenge tables display this increment. */
  debuffIncrease: number;
  defenseBreak: number;
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
}

export interface ChallengeCalculationInput {
  firstTeam: Omit<TeamCalculationInput, "mode" | "defense" | "uniqueClassCodes" | "actionSpeedCap">;
  secondTeam: Omit<TeamCalculationInput, "mode" | "defense" | "uniqueClassCodes" | "actionSpeedCap">;
  /** Options applied only to the combined eight-person calculation. */
  sharedOptions?: SelectedOption[];
  defense: DefenseModel;
  uniqueClassCodes?: string[];
  actionSpeedCap?: number;
}

export interface ChallengeCalculationResult {
  firstTeam: TeamCalculationResult;
  secondTeam: TeamCalculationResult;
  /** Recalculated across eight members with same-arena duplicate rules. */
  sharedArena: TeamCalculationResult;
}
