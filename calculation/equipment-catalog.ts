import type { StatContribution } from "./types.ts";

export type EquipmentApplication = "armor" | "weapon";

export interface EquipmentAppraisalMetadata {
  /** null means the source data has not confirmed whether this item can be appraised. */
  canAppraise: boolean | null;
  /** null means the number of appraisal effects is not yet confirmed. */
  effectCount: number | null;
}

export interface EquipmentCatalogItem {
  id: string;
  name: string;
  slotId: string;
  active: boolean;
  stats?: Readonly<Record<string, number>>;
  effects?: readonly unknown[];
  appraisal?: EquipmentAppraisalMetadata;
  targetApplications?: Readonly<Record<EquipmentApplication, {
    sourceName: string;
    stats: Readonly<Record<string, number>>;
  }>>;
}

export interface EquipmentCatalogDocument {
  schemaVersion: 1;
  items: readonly EquipmentCatalogItem[];
}

export interface SimulatorEquipmentSelectionMapping {
  selectionCell: string;
  catalogFile: string;
  slotId: string;
  calculationRows: readonly number[];
  application?: EquipmentApplication;
  enabledBy?: string;
  configuration?: "shared" | "lowerwearA" | "lowerwearB";
}

export interface SimulatorMagicStoneSelectionMapping {
  selectionCell: string;
  application: EquipmentApplication;
  calculationRow: number;
  enabledBy?: string;
  configuration?: "shared" | "lowerwearA" | "lowerwearB";
}

export interface SimulatorEquipmentMappingDocument {
  schemaVersion: 1;
  selections: readonly SimulatorEquipmentSelectionMapping[];
  magicStoneSelections: {
    catalogFile: string;
    slotId: string;
    inputGroups: readonly SimulatorMagicStoneSelectionMapping[];
  };
}

export interface SimulatorEquipmentSelectionInput {
  /** Selected visible item names, keyed by the original simulator cell. */
  selectedItems: Readonly<Record<string, string | null | undefined>>;
  /** Named boolean switches such as Lowerwear.Alternative.Enabled. */
  enabledValues?: Readonly<Record<string, boolean | undefined>>;
}

export interface SimulatorEquipmentContributionGroups {
  shared: readonly StatContribution[];
  lowerwearA: readonly StatContribution[];
  lowerwearB: readonly StatContribution[];
  lowerwearAlternativeEnabled?: boolean;
}

/**
 * Resolve an item from a static JSON catalog. Magic stones require an explicit
 * application scope because the workbook assigns different values to armor and weapons.
 */
export function resolveEquipmentItemContribution(
  document: EquipmentCatalogDocument,
  itemId: string,
  expectedSlotId: string,
  sourceId: string,
  application?: EquipmentApplication,
): StatContribution {
  if (!itemId.trim() || !expectedSlotId.trim() || !sourceId.trim()) {
    throw new TypeError("itemId, expectedSlotId, and sourceId must not be empty.");
  }
  const item = document.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new RangeError("Unknown equipment item id: " + itemId);
  if (!item.active) throw new RangeError("Equipment item is inactive: " + item.name);
  if (item.slotId !== expectedSlotId) {
    throw new RangeError(item.name + " belongs to slot " + item.slotId + ", not " + expectedSlotId + ".");
  }

  let stats = item.stats ?? {};
  if (item.targetApplications) {
    if (!application) throw new RangeError("An application scope is required for " + item.name + ".");
    const target = item.targetApplications[application];
    if (!target) throw new RangeError(item.name + " has no " + application + " application.");
    stats = target.stats;
  }
  if (item.effects && item.effects.length > 0) {
    throw new RangeError(item.name + " contains effect rules that need an effect-specific resolver.");
  }
  for (const [key, value] of Object.entries(stats)) {
    if (!key.trim()) throw new TypeError(item.name + " has an empty stat key.");
    if (!Number.isFinite(value)) throw new TypeError(item.name + "." + key + " must be finite.");
  }
  return { sourceId, stats };
}

/** Resolve a spreadsheet-style name selection to its unique item ID and contribution. */
export function resolveEquipmentItemContributionByName(
  document: EquipmentCatalogDocument,
  itemName: string,
  expectedSlotId: string,
  sourceId: string,
  application?: EquipmentApplication,
): StatContribution {
  if (!itemName.trim()) throw new TypeError("itemName must not be empty.");
  const matches = document.items.filter(
    (candidate) => {
      if (candidate.slotId !== expectedSlotId) return false;
      if (application && candidate.targetApplications) {
        return candidate.targetApplications[application]?.sourceName === itemName;
      }
      return candidate.name === itemName;
    },
  );
  if (matches.length === 0) {
    throw new RangeError("No equipment named " + itemName + " exists in slot " + expectedSlotId + ".");
  }
  if (matches.length > 1) {
    throw new RangeError("Equipment name " + itemName + " is ambiguous in slot " + expectedSlotId + ".");
  }
  return resolveEquipmentItemContribution(document, matches[0].id, expectedSlotId, sourceId, application);
}

/** Return the source-sheet label for an application-specific option such as a magic stone. */
export function getEquipmentOptionName(
  item: EquipmentCatalogItem,
  application?: EquipmentApplication,
): string {
  if (item.targetApplications) {
    if (!application) throw new RangeError("An application scope is required for " + item.name + ".");
    const target = item.targetApplications[application];
    if (!target) throw new RangeError(item.name + " has no " + application + " application.");
    return target.sourceName;
  }
  return item.name;
}

/** Convert the spreadsheet's searchable-name selections into engine contributions. */
export function resolveSimulatorEquipmentContributions(
  mapping: SimulatorEquipmentMappingDocument,
  catalogs: Readonly<Record<string, EquipmentCatalogDocument>>,
  input: SimulatorEquipmentSelectionInput,
): SimulatorEquipmentContributionGroups {
  const contributions: Record<"shared" | "lowerwearA" | "lowerwearB", StatContribution[]> = {
    shared: [],
    lowerwearA: [],
    lowerwearB: [],
  };
  const resolveOne = (
    selectionCell: string,
    catalogFile: string,
    slotId: string,
    application?: EquipmentApplication,
    enabledBy?: string,
    configuration: "shared" | "lowerwearA" | "lowerwearB" = "shared",
  ): void => {
    if (enabledBy && input.enabledValues?.[enabledBy] !== true) return;
    const itemName = input.selectedItems[selectionCell];
    if (itemName == null || itemName.trim() === "") return;
    const catalog = catalogs[catalogFile];
    if (!catalog) throw new RangeError("Missing equipment catalog: " + catalogFile);
    contributions[configuration].push(
      resolveEquipmentItemContributionByName(
        catalog,
        itemName,
        slotId,
        "simulator:" + selectionCell,
        application,
      ),
    );
  };

  for (const selection of mapping.selections) {
    resolveOne(
      selection.selectionCell,
      selection.catalogFile,
      selection.slotId,
      selection.application,
      selection.enabledBy,
      selection.configuration,
    );
  }
  const magicStone = mapping.magicStoneSelections;
  for (const selection of magicStone.inputGroups) {
    resolveOne(
      selection.selectionCell,
      magicStone.catalogFile,
      magicStone.slotId,
      selection.application,
      selection.enabledBy,
      selection.configuration,
    );
  }
  return contributions;
}
