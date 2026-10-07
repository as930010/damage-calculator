import {
  resolveSimulatorEquipmentContributions,
} from "./equipment-catalog.ts";
import type {
  EquipmentCatalogDocument,
  SimulatorEquipmentContributionGroups,
  SimulatorEquipmentMappingDocument,
} from "./equipment-catalog.ts";
import {
  resolveArmorAppraisals,
  resolveAtmaSetEffects,
  resolveCircuitBoardEffects,
  resolveChipContribution,
  resolveMasterBeastEffects,
  resolveNamedStatOption,
  resolveRaidSetEffects,
  resolveResonanceEffects,
  resolveRightIceSetEffects,
  resolveSpiritRecordEffects,
  resolveWeaponGrowth,
} from "./equipment-effects.ts";
import type {
  ArmorAppraisalDocument,
  ArmorAppraisalInput,
  AtmaEffectDocument,
  CircuitBoardInputValue,
  CircuitBoardRulesDocument,
  ChipCatalogDocument,
  MasterBeastEffectDocument,
  MasterBeastSelection,
  NamedStatOption,
  RaidSetEffectDocument,
  ResonanceEffectDocument,
  RightIceSetEffectDocument,
  SpiritRecordEffectDocument,
  WeaponGrowthDocument,
} from "./equipment-effects.ts";
import type { StatContribution } from "./types.ts";
import { resolveWeaponTransformation } from "./weapon-transformations.ts";
import type {
  WeaponTransformationDocument,
  WeaponTransformationInput,
} from "./weapon-transformations.ts";

export interface SimulatorSourceDocuments {
  equipmentMapping: SimulatorEquipmentMappingDocument;
  equipmentCatalogs: Readonly<Record<string, EquipmentCatalogDocument>>;
  rightIceSets: RightIceSetEffectDocument;
  chips: ChipCatalogDocument;
  chipSlots: ChipSlotsDocument;
  weaponGrowth: WeaponGrowthDocument;
  resonance: ResonanceEffectDocument;
  raidSets: RaidSetEffectDocument;
  atma: AtmaEffectDocument;
  masterBeast: MasterBeastEffectDocument;
  spiritRecord: SpiritRecordEffectDocument;
  circuitBoard: CircuitBoardRulesDocument;
  armorAppraisals: ArmorAppraisalDocument;
  weaponTransformations: WeaponTransformationDocument;
  namedOptions: Readonly<Record<string, readonly NamedStatOption[]>>;
}

export interface SelectedChip {
  slotId: string;
  chipId: string;
  tuningLevel: string;
}

export interface ChipSlotsDocument {
  schemaVersion: 1;
  lowerwearAlternativeEnabledBy: string;
  slots: readonly {
    id: string;
    attributeCell: string;
    tuningCell: string;
    wearSet: "shared" | "lowerwearA" | "lowerwearB";
    enabledBy?: string;
  }[];
}

export interface SelectedNamedOption {
  catalogId: string;
  name: string | null | undefined;
  sourceId: string;
  wearSet?: "shared" | "lowerwearA" | "lowerwearB";
}

export interface SimulatorSourceSelections {
  classId: string;
  attackType: "physical" | "magical";
  /** Selected searchable item names, keyed by 裝備模擬區 input cell. */
  selectedItems: Readonly<Record<string, string | null | undefined>>;
  enabledValues?: Readonly<Record<string, boolean | undefined>>;
  rightIceEquippedSetNames: readonly (string | null | undefined)[];
  rightIceSelectedSetNames?: readonly (string | null | undefined)[];
  chips?: readonly (SelectedChip | null | undefined)[];
  weaponGrowthLevel?: string | null;
  resonanceValues?: Readonly<Record<string, number>>;
  raidSetEquippedNames: readonly (string | null | undefined)[];
  atmaPieceCount?: number;
  atmaElement?: string | null;
  atmaColor?: string | null;
  masterBeast?: MasterBeastSelection;
  spiritRecordNames?: readonly (string | null | undefined)[];
  circuitBoardValues?: Readonly<Record<string, CircuitBoardInputValue>>;
  armorAppraisals?: ArmorAppraisalInput;
  weaponTransformations?: readonly WeaponTransformationInput[];
  namedOptions?: readonly SelectedNamedOption[];
}

export interface SimulatorSourceResolution {
  groups: SimulatorEquipmentContributionGroups;
  unmappedCircuitBoardSlots: readonly string[];
}

const emptyGroups = (): Record<"shared" | "lowerwearA" | "lowerwearB", StatContribution[]> => ({
  shared: [],
  lowerwearA: [],
  lowerwearB: [],
});

/**
 * Resolve every already-mapped supplemental worksheet input into the same
 * three contribution groups used by the calculation engine. UI code only
 * passes selected values; all option-to-stat rules remain in JSON and the
 * dedicated resolver functions.
 */
export function resolveSupplementalSimulatorSources(
  documents: SimulatorSourceDocuments,
  selections: SimulatorSourceSelections,
): SimulatorSourceResolution {
  const groups = emptyGroups();
  const lowerwearAlternativeEnabled = selections.enabledValues?.[
    documents.chipSlots.lowerwearAlternativeEnabledBy
  ] === true;
  const selectedEquipment = resolveSimulatorEquipmentContributions(
    documents.equipmentMapping,
    documents.equipmentCatalogs,
    { selectedItems: selections.selectedItems, enabledValues: selections.enabledValues },
  );
  for (const key of ["shared", "lowerwearA", "lowerwearB"] as const) {
    groups[key].push(...selectedEquipment[key]);
  }
  groups.shared.push(
    ...resolveRightIceSetEffects(
      documents.rightIceSets,
      selections.rightIceEquippedSetNames,
      selections.rightIceSelectedSetNames,
    ),
  );

  const selectedChipSlots = new Set<string>();
  (selections.chips ?? []).forEach((chip) => {
    if (!chip) return;
    const slot = documents.chipSlots.slots.find((candidate) => candidate.id === chip.slotId);
    if (!slot) throw new RangeError("Unknown chip slot: " + chip.slotId);
    if (selectedChipSlots.has(slot.id)) throw new RangeError("Chip slot selected more than once: " + slot.id);
    selectedChipSlots.add(slot.id);
    if (slot.enabledBy && selections.enabledValues?.[slot.enabledBy] !== true) return;
    groups[slot.wearSet].push(
      resolveChipContribution(
        documents.chips,
        chip.chipId,
        chip.tuningLevel,
        `chip:${slot.id}:${chip.chipId}:${chip.tuningLevel}`,
      ),
    );
  });

  const growth = resolveWeaponGrowth(documents.weaponGrowth, selections.weaponGrowthLevel);
  if (growth) groups.shared.push(growth);

  groups.shared.push(
    ...resolveResonanceEffects(documents.resonance, selections.resonanceValues ?? {}),
    ...resolveRaidSetEffects(
      documents.raidSets,
      selections.raidSetEquippedNames,
    ),
    ...resolveAtmaSetEffects(
      documents.atma,
      selections.atmaPieceCount ?? 0,
      selections.atmaElement,
      selections.atmaColor,
    ),
    ...resolveMasterBeastEffects(documents.masterBeast, selections.masterBeast ?? {}),
    ...resolveSpiritRecordEffects(
      documents.spiritRecord,
      selections.classId,
      selections.attackType,
      selections.spiritRecordNames ?? [],
    ),
  );

  const circuitBoard = resolveCircuitBoardEffects(
    documents.circuitBoard,
    selections.circuitBoardValues ?? {},
  );
  const unmappedCircuitBoardSlots: string[] = [];
  for (const entry of circuitBoard) {
    if (!entry.contribution) {
      const attribute = selections.circuitBoardValues?.[entry.slot]?.attribute;
      if (attribute?.trim() && !documents.circuitBoard.statKeyBySheetName[attribute]) {
        unmappedCircuitBoardSlots.push(entry.slot);
      }
      continue;
    }
    groups[entry.wearSet].push(entry.contribution);
  }

  if (selections.armorAppraisals) {
    const enabledInputs = { ...selections.armorAppraisals.enabledInputs };
    for (const slot of documents.armorAppraisals.slots) {
      if (slot.wearSet === "lowerwearB" && slot.enabledBy) {
        enabledInputs[slot.enabledBy] = lowerwearAlternativeEnabled;
      }
    }
    for (const entry of resolveArmorAppraisals(documents.armorAppraisals, {
      ...selections.armorAppraisals,
      enabledInputs,
    })) {
      groups[entry.wearSet].push(...entry.contributions);
    }
  }

  for (const input of selections.weaponTransformations ?? []) {
    const contribution = resolveWeaponTransformation(documents.weaponTransformations, input);
    if (contribution) groups.shared.push(contribution);
  }

  for (const selected of selections.namedOptions ?? []) {
    const options = documents.namedOptions[selected.catalogId];
    if (!options) throw new RangeError("Missing named-option catalog: " + selected.catalogId);
    const contribution = resolveNamedStatOption(options, selected.name, selected.sourceId);
    if (contribution) groups[selected.wearSet ?? "shared"].push(contribution);
  }

  if (!lowerwearAlternativeEnabled) groups.lowerwearB = [];
  return {
    groups: { ...groups, lowerwearAlternativeEnabled },
    unmappedCircuitBoardSlots,
  };
}
