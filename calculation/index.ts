export {
  getClassEffects,
  parseClassCombatEffects,
  resolveClassId,
} from "./class-effects.ts";
export { calculateCombatRates } from "./engine.ts";
export type { CombatRateEngineInput, CombatRateEngineResult } from "./engine.ts";
export { aggregateCharacterAttributes, prepareCharacterAttributeInput } from "./attribute-aggregation.ts";
export type { PreparedCharacterAttributeInput } from "./attribute-aggregation.ts";
export {
  calculateAttack,
  parseAttackParameters,
  resolveAttackParameters,
} from "./attack.ts";
export {
  parseClassDamagePassives,
  resolveClassCritDamagePassivePct,
} from "./class-damage-passives.ts";
export { calculateFinalDamage } from "./final-damage.ts";
export { calculateLoadout, mergeLoadoutSources, productEffectsFromSources } from "./loadout-engine.ts";
export type { LoadoutCalculationInput, LoadoutCalculationResult } from "./loadout-engine.ts";
export { resolveSupplementalSimulatorSources } from "./simulator-sources.ts";
export type {
  SelectedChip,
  SelectedNamedOption,
  SimulatorSourceDocuments,
  SimulatorSourceResolution,
  SimulatorSourceSelections,
} from "./simulator-sources.ts";
export { calculateSimulatorLoadout } from "./simulator.ts";
export type { SimulatorCalculationInput, SimulatorCalculationResult } from "./simulator.ts";
export { resolveCombatRateSources } from "./combat-rate-sources.ts";
export type {
  CombatRateSourceRule,
  CombatRateSourceRulesDocument,
  CombatRateSourceValues,
  ResolvedCombatRateSources,
} from "./combat-rate-sources.ts";
export {
  resolveEquipmentItemContribution,
  resolveEquipmentItemContributionByName,
  resolveSimulatorEquipmentContributions,
  getEquipmentOptionName,
} from "./equipment-catalog.ts";
export type {
  EquipmentApplication,
  EquipmentCatalogDocument,
  EquipmentCatalogItem,
  SimulatorEquipmentContributionGroups,
  SimulatorEquipmentMappingDocument,
  SimulatorEquipmentSelectionInput,
} from "./equipment-catalog.ts";
export { calculateProductStat } from "./multiplicative.ts";
export {
  resolveChipContribution,
  resolveNamedStatOption,
  resolveRightIceSetEffects,
  resolveSpiritRecordEffects,
  resolveAtmaSetEffects,
  resolveArmorAppraisals,
  resolveCircuitBoardEffects,
  resolveMasterBeastEffects,
  resolveRaidSetEffects,
  resolveResonanceEffects,
  resolveWeaponGrowth,
} from "./equipment-effects.ts";
export type {
  ChipCatalogDocument,
  ChipOption,
  NamedStatOption,
  RightIceSetEffect,
  RightIceSetEffectDocument,
  ChipTuningValue,
  AtmaEffectDocument,
  AtmaEffectRule,
  ArmorAppraisalContribution,
  ArmorAppraisalDocument,
  ArmorAppraisalInput,
  ArmorAppraisalOption,
  ArmorAppraisalSlot,
  CircuitBoardContribution,
  CircuitBoardInputValue,
  CircuitBoardRulesDocument,
  CircuitBoardRule,
  MasterBeastEffectDocument,
  MasterBeastManualValue,
  MasterBeastOption,
  MasterBeastSelection,
  SpiritRecordBranchBonus,
  SpiritRecordCountValue,
  SpiritRecordEffectDocument,
  SpiritRecordTrait,
  RaidSetEffectDocument,
  RaidSetRule,
  RaidSetTier,
  ResonanceEffectDocument,
  ResonanceEffectRule,
  WeaponGrowthDocument,
  WeaponGrowthLevel,
} from "./equipment-effects.ts";
export { resolveWeaponTransformation, resolveWeaponTransformationsFromCells } from "./weapon-transformations.ts";
export { resolveInnerwearSources } from "./innerwear.ts";
export type { InnerwearRulesDocument, InnerwearSlot } from "./innerwear.ts";
export type {
  WeaponTransformationDocument,
  WeaponTransformationInput,
  WeaponTransformationRule,
} from "./weapon-transformations.ts";
export {
  calculateCriticalRate,
  calculateExtremizationRate,
  criticalTierRate,
  extremizationTierRate,
} from "./probability.ts";
export type {
  CalculationMethod,
  ClassCombatEffectProfile,
  ClassCombatEffectsDocument,
  CombatAttribute,
  CombatRateResults,
  AttributeRule,
  AttackCalculationInput,
  AttackCalculationResult,
  AttackParametersDocument,
  AttackType,
  ClassAttackCoefficients,
  ClassDamagePassivesDocument,
  ResolvedAttackParameters,
  CharacterAttributeInput,
  CharacterAttributeResult,
  FinalDamageInput,
  FinalDamageResult,
  ProductStatEffect,
  ProductStatResult,
  StatContribution,
  EffectValueDetail,
  MultiplierDetail,
  PercentEffect,
  RateCalculationInput,
  RateCalculationResult,
  ResolvedPercentEffect,
} from "./types.ts";
