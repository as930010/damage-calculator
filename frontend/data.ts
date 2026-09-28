import type { AttributeRule, AttackParametersDocument, StatContribution } from "../calculation/types.ts";
import type { EquipmentCatalogDocument, SimulatorEquipmentMappingDocument } from "../calculation/equipment-catalog.ts";
import type { InnerwearRulesDocument } from "../calculation/innerwear.ts";
import type { ChipSlotsDocument } from "../calculation/simulator-sources.ts";
import type { WeaponTransformationDocument } from "../calculation/weapon-transformations.ts";
import type { ClassCombatEffectsDocument, ClassDamagePassivesDocument } from "../calculation/types.ts";
import type { CombatRateSourceRulesDocument } from "../calculation/combat-rate-sources.ts";
import type { AccessoryEffectDocument, ArmorAppraisalDocument, AtmaEffectDocument, ChipCatalogDocument, CircuitBoardRulesDocument, ColorSetEffectDocument, MasterBeastEffectDocument, NamedStatOption, RaidSetEffectDocument, ResonanceEffectDocument, RightIceSetEffectDocument, SpiritRecordEffectDocument, WeaponGrowthDocument } from "../calculation/equipment-effects.ts";

export interface LayoutSlot {
  id: string; label: string; group: string; x: number; y: number; icon: string;
  selectionCell?: string; stoneCells?: string[]; innerwearId?: string;
  sharedSelection?: boolean; enabledBy?: string; weapon?: boolean;
}
export interface LayoutDocument {
  schemaVersion: 1;
  groups: { id: string; name: string; color: string }[];
  slots: LayoutSlot[];
}
export interface AttributeMetadata {
  key: string; name: string; unit: "flat" | "percent"; active: boolean;
  aggregation: "sum" | "product"; calculationScope: string; cap?: AttributeRule["cap"];
}
export interface GameData {
  layout: LayoutDocument;
  classes: { classes: { id: string; name: string; active: boolean; attackType: "physical" | "magical" }[] };
  attributes: { attributes: AttributeMetadata[] };
  parameters: {
    characterBase: Record<string, number>;
    fixedEffects: StatContribution[];
    conditionalEffects: { sourceId: string; selectorCell: string; selectorValue: string; stats: Readonly<Record<string, number>> }[];
    optionalEffects: { sourceId: string; stateKey: "petSkillAttackEnabled"; defaultEnabled: boolean; stats: Readonly<Record<string, number>> }[];
    critDamageProductBasePct: number;
    critDamageProductBaselinePctToSubtract: number;
    yellowBeastSpiritStoneRatePct: number;
  };
  manifest: { displayDate: string; dataUpdatedAt: string };
  mapping: SimulatorEquipmentMappingDocument;
  catalogs: Record<string, EquipmentCatalogDocument>;
  attack: AttackParametersDocument;
  innerwear: InnerwearRulesDocument;
  appraisals: Omit<ArmorAppraisalDocument, "slots"> & { slots: (ArmorAppraisalDocument["slots"][number] & { inputCells: string[] })[] };
  chips: ChipCatalogDocument;
  chipSlots: ChipSlotsDocument;
  circuits: CircuitBoardRulesDocument;
  transformations: WeaponTransformationDocument & { options: string[] };
  growth: WeaponGrowthDocument & { selectorCell: string };
  weaponAppraisals: { groups: Record<string, { selectorCell: string; options: NamedStatOption[] }> };
  weaponGrades: { selectorCell: string; options: NamedStatOption[] };
  giantStones: { selectorCells: string[]; options: NamedStatOption[] };
  accessoryEffects: AccessoryEffectDocument;
  colorSetEffects: ColorSetEffectDocument;
  classCombatEffects: ClassCombatEffectsDocument;
  classDamagePassives: ClassDamagePassivesDocument;
  combatRateSources: CombatRateSourceRulesDocument;
  rightIceSets: RightIceSetEffectDocument;
  resonance: ResonanceEffectDocument;
  raidSets: RaidSetEffectDocument;
  atma: AtmaEffectDocument;
  masterBeast: MasterBeastEffectDocument;
  spiritRecord: SpiritRecordEffectDocument;
  otherEffects: {
    consumables: NamedStatOption[]; environments: NamedStatOption[]; titles: NamedStatOption[];
    guildFountain: { stage: number; selectorCell: string; options: NamedStatOption[] }[];
    peakOptions: NamedStatOption[];
    binaryEffects: { selectorCell: string; name: string; options: NamedStatOption[]; source: string }[];
  };
  pets: { options: NamedStatOption[] };
  simulatorInputs: { catalogs: { id: string; source?: { sheet?: string; range?: string }; options: { value: string | number }[] }[]; inputs: { simulatorCells: string; inputType: string; catalogId: string }[] };
}

export async function readJson<T>(path: string): Promise<T> {
  const buildRevision = document.querySelector<HTMLMetaElement>('meta[name="build-revision"]')?.content ?? "dev";
  const response = await fetch(`./data/${path}?v=${encodeURIComponent(buildRevision)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`無法讀取 ${path}：${response.status}`);
  return response.json() as Promise<T>;
}
export async function loadGameData(): Promise<GameData> {
  const [layout, classes, attributes, parameters, manifest, mapping, attack, innerwear, appraisals,
    chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, accessoryEffects,
    classCombatEffects, classDamagePassives, combatRateSources, simulatorInputs, rightIceSets, resonance,
    raidSets, atma, masterBeast, spiritRecord, otherEffects, pets, colorSetEffects] = await Promise.all([
    readJson<GameData["layout"]>("equipment-layout.json"), readJson<GameData["classes"]>("classes.json"),
    readJson<GameData["attributes"]>("attributes.json"), readJson<GameData["parameters"]>("parameters.json"),
    readJson<GameData["manifest"]>("manifest.json"), readJson<GameData["mapping"]>("simulator-equipment-mapping.json"),
    readJson<GameData["attack"]>("attack-parameters.json"), readJson<GameData["innerwear"]>("innerwear-rules.json"),
    readJson<GameData["appraisals"]>("armor-appraisals.json"), readJson<GameData["chips"]>("equipment/chips.json"),
    readJson<GameData["chipSlots"]>("chip-slots.json"), readJson<GameData["circuits"]>("circuit-board-rules.json"),
    readJson<GameData["transformations"]>("weapon-transformations.json"), readJson<GameData["growth"]>("weapon-growth.json"),
    readJson<GameData["weaponAppraisals"]>("weapon-appraisals.json"), readJson<GameData["weaponGrades"]>("weapon-grade-options.json"),
    readJson<GameData["giantStones"]>("giant-magic-stones.json"), readJson<GameData["accessoryEffects"]>("accessory-special-effects.json"),
    readJson<GameData["classCombatEffects"]>("class-combat-effects.json"), readJson<GameData["classDamagePassives"]>("class-damage-passives.json"),
    readJson<GameData["combatRateSources"]>("combat-rate-source-rules.json"), readJson<GameData["simulatorInputs"]>("simulator-input-options.json"),
    readJson<GameData["rightIceSets"]>("equipment/right-ice-set-effects.json"), readJson<GameData["resonance"]>("resonance-effects.json"),
    readJson<GameData["raidSets"]>("raid-set-effects.json"), readJson<GameData["atma"]>("atma-effects.json"),
    readJson<GameData["masterBeast"]>("master-beast-effects.json"), readJson<GameData["spiritRecord"]>("spirit-record-effects.json"),
    readJson<GameData["otherEffects"]>("other-effect-options.json"), readJson<GameData["pets"]>("pet-effects.json"),
    readJson<GameData["colorSetEffects"]>("color-set-effects.json"),
  ]);
  const files = [...new Set([...mapping.selections.map((entry) => entry.catalogFile), mapping.magicStoneSelections.catalogFile])];
  const catalogs = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readJson<EquipmentCatalogDocument>(file)])));
  return { layout, classes, attributes, parameters, manifest, mapping, catalogs, attack, innerwear, appraisals,
    chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, accessoryEffects,
    classCombatEffects, classDamagePassives, combatRateSources, simulatorInputs, rightIceSets, resonance,
    raidSets, atma, masterBeast, spiritRecord, otherEffects, pets, colorSetEffects };
}
export const localCell = (cell: string): string => cell.split("!").at(-1)!.replaceAll("$", "");
export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export const formatNumber = (value: number): string => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 5 }).format(value);
