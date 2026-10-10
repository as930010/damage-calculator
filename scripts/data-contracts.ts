import type { AccessoryEffectDocument, ArmorAppraisalDocument, AtmaEffectDocument, ChipCatalogDocument, CircuitBoardRulesDocument, ColorSetEffectDocument, MasterBeastEffectDocument, NamedStatOption, RaidSetEffectDocument, ResonanceEffectDocument, RightIceSetEffectDocument, SpiritRecordEffectDocument, WeaponGrowthDocument } from '../calculation/equipment-effects.ts';
import type { EquipmentCatalogDocument, SimulatorEquipmentMappingDocument } from '../calculation/equipment-catalog.ts';
import type { ClassCombatEffectsDocument, ClassDamagePassivesDocument, AttackParametersDocument } from '../calculation/types.ts';
import type { InnerwearRulesDocument } from '../calculation/innerwear.ts';
import type { NephronArmorRulesDocument } from '../calculation/nephron-armor.ts';
import type { ChipSlotsDocument } from '../calculation/simulator-sources.ts';
import type { CombatRateSourceRulesDocument } from '../calculation/combat-rate-sources.ts';
import type { WeaponTransformationDocument } from '../calculation/weapon-transformations.ts';
import accessories from '../data/equipment/accessories.json';
import leftIce from '../data/equipment/left-ice.json';
import magicStones from '../data/equipment/magic-stones.json';
import onePieceCostumes from '../data/equipment/one-piece-costumes.json';
import rightIce from '../data/equipment/right-ice.json';
import chips from '../data/equipment/chips.json';
import equipmentMapping from '../data/simulator-equipment-mapping.json';
import attack from '../data/attack-parameters.json';
import classCombat from '../data/class-combat-effects.json';
import classDamage from '../data/class-damage-passives.json';
import appraisals from '../data/armor-appraisals.json';
import accessoryEffects from '../data/accessory-special-effects.json';
import atma from '../data/atma-effects.json';
import circuitBoard from '../data/circuit-board-rules.json';
import colorSet from '../data/color-set-effects.json';
import innerwear from '../data/innerwear-rules.json';
import nephronArmor from '../data/nephron-armor-rules.json';
import masterBeast from '../data/master-beast-effects.json';
import raidSets from '../data/raid-set-effects.json';
import resonance from '../data/resonance-effects.json';
import rightIceSets from '../data/equipment/right-ice-set-effects.json';
import spiritRecord from '../data/spirit-record-effects.json';
import weaponGrowth from '../data/weapon-growth.json';
import weaponTransformations from '../data/weapon-transformations.json';
import chipSlots from '../data/chip-slots.json';
import combatRateSources from '../data/combat-rate-source-rules.json';
import attributes from '../data/attributes.json';
import classes from '../data/classes.json';
import equipmentLayout from '../data/equipment-layout.json';
import slots from '../data/slots.json';
import simulatorInputOptions from '../data/simulator-input-options.json';
import simulatorInputRules from '../data/simulator-input-rules.json';
import weaponAppraisals from '../data/weapon-appraisals.json';
import giantMagicStones from '../data/giant-magic-stones.json';
import weaponGrades from '../data/weapon-grade-options.json';
import sampleLoadout from '../data/examples/public-example-2026-09-28.json';
import parameters from '../data/parameters.json';
import otherEffectOptions from '../data/other-effect-options.json';
import pets from '../data/pet-effects.json';

type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean
  : T extends readonly (infer Item)[] ? readonly Widen<Item>[]
  : T extends object ? { readonly [Key in keyof T]: Key extends 'stats'
      ? Readonly<Record<string, number | undefined>>
      : Key extends 'statsByColor' ? Readonly<Record<string, Readonly<Record<string, number | undefined>>>>
        : Widen<T[Key]> } : T;

// Compile-time contracts keep the JSON documents aligned with calculation interfaces.
const _equipmentCatalogs: Widen<EquipmentCatalogDocument>[] = [accessories, leftIce, magicStones, onePieceCostumes, rightIce];
const _equipmentMapping: Widen<SimulatorEquipmentMappingDocument> = equipmentMapping;
const _attack: Widen<AttackParametersDocument> = attack;
const _classCombat: Widen<ClassCombatEffectsDocument> = classCombat;
const _classDamage: Widen<ClassDamagePassivesDocument> = classDamage;
const _appraisals: Widen<ArmorAppraisalDocument> = appraisals;
const _accessoryEffects: Widen<AccessoryEffectDocument> = accessoryEffects;
const _atma: Widen<AtmaEffectDocument> = atma;
const _circuitBoard: Widen<CircuitBoardRulesDocument> = circuitBoard;
const _colorSet: Widen<ColorSetEffectDocument> = colorSet;
const _innerwear: Widen<InnerwearRulesDocument> = innerwear;
const _nephronArmor: Widen<NephronArmorRulesDocument> = nephronArmor;
const _masterBeast: Widen<MasterBeastEffectDocument> = masterBeast;
const _raidSets: Widen<RaidSetEffectDocument> = raidSets;
const _resonance: Widen<ResonanceEffectDocument> = resonance;
const _rightIceSets: Widen<RightIceSetEffectDocument> = rightIceSets;
const _spiritRecord: Widen<SpiritRecordEffectDocument> = spiritRecord;
const _weaponGrowth: Widen<WeaponGrowthDocument> = weaponGrowth;
const _weaponTransformations: Widen<WeaponTransformationDocument> = weaponTransformations;
const _chipCatalog: Widen<ChipCatalogDocument> = chips;
const _chipSlots: Widen<ChipSlotsDocument> = chipSlots;
const _combatRateSources: Widen<CombatRateSourceRulesDocument> = combatRateSources;
const _attributes: Widen<{ schemaVersion: number; attributes: readonly { key: string; name: string; unit: string; active: boolean; aggregation: string; calculationScope: string }[] }> = attributes;
const _classes: Widen<{ schemaVersion: number; classes: readonly { id: string; name: string; attackType: string; active: boolean; calculationReady: boolean; attackCoefficients: { physical: number; magical: number } }[] }> = classes;
const _layout: Widen<{ schemaVersion: number; groups: readonly { id: string; name: string; color: string }[]; slots: readonly { id: string; label: string; group: string; x: number; y: number; icon: string }[] }> = equipmentLayout;
const _slots: Widen<{ schemaVersion: number; slots: readonly { id: string; name: string; active: boolean }[] }> = slots;
const _simulatorOptions: Widen<{ schemaVersion: number; catalogs: readonly { id: string; options: readonly { value: string | number }[] }[]; inputs: readonly { fieldIds: readonly string[]; inputType: string; catalogId: string }[] }> = simulatorInputOptions;
const _simulatorRules: Widen<{ schemaVersion: number; innerwear: object; lowerwearAlternatives: object; circuitBoards: object; chips: object; weapon: object; rightIceSetEffects: object }> = simulatorInputRules;
const _weaponAppraisals: Widen<{ schemaVersion: number; groups: Readonly<Record<string, { settingKey: string; options: readonly { id: string; name: string; stats: Readonly<Record<string, number | undefined>> }[] }>> }> = weaponAppraisals;
const _giantStones: Widen<{ schemaVersion: number; settingKeys: readonly string[]; options: readonly { id: string; name: string; stats: Readonly<Record<string, number | undefined>> }[] }> = giantMagicStones;
const _weaponGrades: Widen<{ schemaVersion: number; settingKey: string; options: readonly { id: string; name: string; stats: Readonly<Record<string, number | undefined>> }[]; colorGroups: readonly { id: string; name: string; settingKeys: readonly string[]; options: readonly { id: string; name: string; stats: Readonly<Record<string, number | undefined>> }[]; presetByGrade: Readonly<Record<string, string>> }[] }> = weaponGrades;
const _sampleLoadout: Widen<{ schemaVersion: number; Job: string; values: Readonly<Record<string, string | number>>; lowerwearAlternativeEnabled: boolean }> = sampleLoadout;
const _parameters: Widen<{ schemaVersion: number; characterBase: Readonly<Record<string, number>>; fixedEffects: readonly { sourceId: string; stats: Readonly<Record<string, number>> }[]; optionalEffects: readonly { sourceId: string; stateKey: string; defaultEnabled: boolean; stats: Readonly<Record<string, number>> }[]; conditionalEffects: readonly { sourceId: string; settingKey: string; selectorValue: string; stats: Readonly<Record<string, number>> }[]; critDamageProductBasePct: number; critDamageProductBaselinePctToSubtract: number; yellowBeastSpiritStoneRatePct: number }> = parameters;
const _otherEffects: Widen<{ schemaVersion: number; consumables: readonly NamedStatOption[]; environments: readonly NamedStatOption[]; titles: readonly NamedStatOption[]; guildFountain: readonly { stage: number; settingKey: string; options: readonly NamedStatOption[] }[]; binaryEffects: readonly { settingKey: string; name: string; options: readonly NamedStatOption[] }[]; peakOptions: readonly NamedStatOption[] }> = otherEffectOptions;
const _pets: Widen<{ schemaVersion: number; options: readonly NamedStatOption[] }> = pets;

export type DataContractsAreChecked = typeof _equipmentCatalogs | typeof _equipmentMapping | typeof _attack
  | typeof _classCombat | typeof _classDamage | typeof _appraisals | typeof _accessoryEffects | typeof _atma
  | typeof _circuitBoard | typeof _colorSet | typeof _innerwear | typeof _nephronArmor | typeof _masterBeast | typeof _raidSets
  | typeof _resonance | typeof _rightIceSets | typeof _spiritRecord | typeof _weaponGrowth
  | typeof _weaponTransformations | typeof _chipCatalog | typeof _chipSlots | typeof _combatRateSources;
