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

export const GAME_DATA_FILES = {
  layout: "equipment-layout.json",
  classes: "classes.json",
  attributes: "attributes.json",
  parameters: "parameters.json",
  manifest: "manifest.json",
  mapping: "simulator-equipment-mapping.json",
  attack: "attack-parameters.json",
  innerwear: "innerwear-rules.json",
  appraisals: "armor-appraisals.json",
  chips: "equipment/chips.json",
  chipSlots: "chip-slots.json",
  circuits: "circuit-board-rules.json",
  transformations: "weapon-transformations.json",
  growth: "weapon-growth.json",
  weaponAppraisals: "weapon-appraisals.json",
  weaponGrades: "weapon-grade-options.json",
  giantStones: "giant-magic-stones.json",
  accessoryEffects: "accessory-special-effects.json",
  classCombatEffects: "class-combat-effects.json",
  classDamagePassives: "class-damage-passives.json",
  combatRateSources: "combat-rate-source-rules.json",
  simulatorInputs: "simulator-input-options.json",
  rightIceSets: "equipment/right-ice-set-effects.json",
  resonance: "resonance-effects.json",
  raidSets: "raid-set-effects.json",
  atma: "atma-effects.json",
  masterBeast: "master-beast-effects.json",
  spiritRecord: "spirit-record-effects.json",
  otherEffects: "other-effect-options.json",
  pets: "pet-effects.json",
  colorSetEffects: "color-set-effects.json",
} as const satisfies Record<Exclude<keyof GameData, "catalogs">, string>;

export async function readJson<T>(path: string, cache: RequestCache = "no-store"): Promise<T> {
  const buildRevision = document.querySelector<HTMLMetaElement>('meta[name="build-revision"]')?.content ?? "dev";
  const response = await fetch(`./data/${path}?v=${encodeURIComponent(buildRevision)}`, { cache });
  if (!response.ok) throw new Error(`無法讀取 ${path}：${response.status}`);
  return response.json() as Promise<T>;
}
export async function loadGameData(): Promise<GameData> {
  return readJson<GameData>("game-data.json", "force-cache");
}
export const localCell = (cell: string): string => cell.split("!").at(-1)!.replaceAll("$", "");
export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export const formatNumber = (value: number): string => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 5 }).format(value);
