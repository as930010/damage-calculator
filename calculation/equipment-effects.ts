import type { StatContribution } from "./types.ts";
import { isResonanceInputCell, parseResonancePoints } from "./resonance-input.ts";

export interface RightIceSetEffect {
  id: string;
  setName: string;
  requiredPieces: { operator: "exactly" | "atLeast"; count: number };
  active: boolean;
  stats: Readonly<Record<string, number>>;
}

export interface RightIceSetEffectDocument {
  schemaVersion: 1;
  selectionCells: readonly string[];
  maxSelectedSets: number;
  effects: readonly RightIceSetEffect[];
}

export interface ChipTuningValue {
  level: string;
  value: number;
}

export interface ChipOption {
  id: string;
  name: string;
  attributeKey: string;
  unit: "percent";
  tuningLevels: readonly ChipTuningValue[];
}

export interface ChipCatalogDocument {
  schemaVersion: 1;
  chips: readonly ChipOption[];
}

export interface WeaponGrowthLevel {
  id: string;
  name: string;
  stats: Readonly<Record<string, number>>;
}

export interface WeaponGrowthDocument {
  schemaVersion: 1;
  levels: readonly WeaponGrowthLevel[];
}

export interface ResonanceEffectRule {
  id: string;
  name: string;
  inputCell: string;
  multiplier: number;
  stats: Readonly<Record<string, number>>;
}

export interface ResonanceEffectDocument {
  schemaVersion: 1;
  effects: readonly ResonanceEffectRule[];
}

export interface RaidSetTier {
  requiredPieces: number;
  stats: Readonly<Record<string, number>>;
}

export interface RaidSetRule {
  id: string;
  name: string;
  matchTerms: readonly string[];
  implicitPieces: number;
  pieceCountCap: number;
  tiers: readonly RaidSetTier[];
}

export interface RaidSetEffectDocument {
  schemaVersion: 1;
  sets: readonly RaidSetRule[];
}

export interface AtmaEffectRule {
  id: string;
  when: { element: string | readonly string[]; color: "any" };
  stats?: Readonly<Record<string, number>>;
  statsByColor?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface AtmaEffectDocument {
  schemaVersion: 1;
  activeWhenPieceCountEquals: number;
  rules: readonly AtmaEffectRule[];
}

export interface MasterBeastOption {
  id: string;
  category: "overall" | "head" | "ring";
  name: string;
  stats: Readonly<Record<string, number>>;
}

export interface MasterBeastEffectDocument {
  schemaVersion: 1;
  armorSpiritStoneSetEffect: {
    id: string;
    multiplicativeDamagePct: number;
    source: string;
  };
  spiritStoneColorSelector: {
    defaultColor: "黃" | "綠";
    options: readonly ("黃" | "綠")[];
    yellowRateValuePct: number;
  };
  options: readonly MasterBeastOption[];
  statKeyBySheetName: Readonly<Record<string, string>>;
  customAttributeOptions: {
    head: readonly string[];
    necklace: readonly string[];
    ring: readonly string[];
    mirror: readonly string[];
  };
  mirrorValueRules: {
    default: MasterBeastMirrorValueRule;
    byAttribute: Readonly<Record<string, MasterBeastMirrorValueRule>>;
  };
}

export interface MasterBeastMirrorValueRule {
  minPct: number;
  maxPct: number;
  stepPct: number;
}

export interface MasterBeastManualValue {
  attribute: string | null | undefined;
  value: number | null | undefined;
  fractionToPercentagePoints?: boolean;
}

export interface MasterBeastSelection {
  overallOption?: string | null;
  headOptions?: readonly (string | null | undefined)[];
  ringOptions?: readonly (string | null | undefined)[];
  headManual?: MasterBeastManualValue;
  necklaceManual?: MasterBeastManualValue;
  ringManual?: readonly MasterBeastManualValue[];
  mirrorManual?: readonly MasterBeastManualValue[];
}

export interface SpiritRecordCountValue {
  count?: number;
  minimumCount?: number;
  value: number;
}

export interface SpiritRecordBranchBonus {
  name: string;
  eligibleClasses: readonly string[];
  statKey: string;
  thresholds: readonly { minimumCount: number; value: number }[];
  otherwiseValue: "count" | number;
}

export interface SpiritRecordTrait {
  name: string;
  statKey: string;
  attackType?: "physical" | "magical";
  countValues: readonly SpiritRecordCountValue[];
  otherwiseValue: number;
}

export interface SpiritRecordEffectDocument {
  schemaVersion: 1;
  classSelectors: {
    selectorCells: readonly string[];
    classes: readonly { classCode: string; branch: string; traits: readonly [string, string] }[];
  };
  defaultMaxedStats: Readonly<Record<string, number>>;
  branchBonuses: readonly SpiritRecordBranchBonus[];
  traits: readonly SpiritRecordTrait[];
}

/** Convert the six selected class codes to the branch and trait values found in T4:V9. */
export function resolveSpiritRecordSelections(
  document: SpiritRecordEffectDocument,
  selectedClassCodes: readonly (string | null | undefined)[],
): string[] {
  if (selectedClassCodes.length > document.classSelectors.selectorCells.length) {
    throw new RangeError(`賦靈錄最多接受 ${document.classSelectors.selectorCells.length} 個職業選擇。`);
  }
  const selectedCodes = new Set<string>();
  return selectedClassCodes.flatMap((classCode) => {
    if (classCode == null || classCode.trim() === "") return [];
    const entry = document.classSelectors.classes.find((candidate) => candidate.classCode.toLocaleLowerCase() === classCode.toLocaleLowerCase());
    if (!entry) throw new RangeError(`賦靈錄找不到職業「${classCode}」的支線與特性資料。`);
    const normalizedCode = entry.classCode.toLocaleLowerCase();
    if (selectedCodes.has(normalizedCode)) throw new RangeError(`賦靈錄不可重複選擇職業「${entry.classCode}」。`);
    selectedCodes.add(normalizedCode);
    return [entry.branch, ...entry.traits];
  });
}

export interface CircuitBoardRule {
  slot: string;
  attributeCell: string;
  valueCell: string;
  wearSet: "shared" | "lowerwearA" | "lowerwearB";
  attributeOptions: readonly string[];
}

export interface CircuitBoardRulesDocument {
  schemaVersion: 1;
  statKeyBySheetName: Readonly<Record<string, string | readonly string[]>>;
  inputs: readonly CircuitBoardRule[];
}

export interface CircuitBoardInputValue {
  attribute: string | null | undefined;
  percentageValue: number | null | undefined;
}
export type CircuitBoardInputSelection = CircuitBoardInputValue | readonly CircuitBoardInputValue[];

export interface CircuitBoardContribution {
  slot: string;
  wearSet: CircuitBoardRule["wearSet"];
  contribution: StatContribution | null;
}

export interface ArmorAppraisalOption {
  id: string;
  name: string;
  stats: Readonly<Record<string, number>>;
}

export interface ArmorAppraisalSlot {
  id: string;
  wearSet: "shared" | "lowerwearA" | "lowerwearB";
  enabledBy?: string;
}

export interface ArmorAppraisalDocument {
  schemaVersion: 1;
  options: readonly ArmorAppraisalOption[];
  slots: readonly ArmorAppraisalSlot[];
}

export interface ArmorAppraisalInput {
  optionsBySlot: Readonly<Record<string, readonly (string | null | undefined)[]>>;
  enabledInputs?: Readonly<Record<string, boolean>>;
}

export interface ArmorAppraisalContribution {
  slot: string;
  wearSet: ArmorAppraisalSlot["wearSet"];
  contributions: readonly StatContribution[];
}

export interface NamedStatOption {
  id: string;
  name: string;
  stats: Readonly<Record<string, number>>;
  status?: "mapped" | "needs-user-confirmation";
}

export interface AccessoryEffectOption {
  name: string;
  stats: Readonly<Record<string, number>>;
}

export interface AccessoryEffectGroup {
  id: string;
  label: string;
  selectionCell: string;
  slotId: string;
  inputCells: readonly string[];
  source: string;
  options: readonly AccessoryEffectOption[];
  optionsByEquipmentName?: Readonly<Record<string, readonly AccessoryEffectOption[]>>;
}

export interface AccessoryEffectDocument {
  schemaVersion: 1;
  groups: readonly AccessoryEffectGroup[];
}

export interface ColorSetEffectDocument {
  schemaVersion: 1;
  selectorCell: string;
  source: string;
  options: readonly {
    name: string;
    stats?: Readonly<Record<string, number>>;
    calculatedStat?: {
      outputKey: string;
      sourceAttributeCell: string;
      sourceValueCell: string;
      requiredAttribute: string;
      baseMultiplier: number;
      inputMultiplier: number;
      inputValueToPoints: number;
    };
  }[];
}

function requireNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new TypeError(`${label} must not be empty.`);
}

/**
 * Resolve right-ice set bonuses from selected piece set names.
 * Higher satisfied tiers replace lower tiers of the same set, matching the
 * spreadsheet's T-column mutually-exclusive tier formulas.
 */
export function resolveRightIceSetEffects(
  document: RightIceSetEffectDocument,
  equippedSetNames: readonly (string | null | undefined)[],
  selectedSetNames: readonly (string | null | undefined)[] = [],
): StatContribution[] {
  const selected = selectedSetNames.filter((name): name is string => Boolean(name?.trim()));
  if (!Number.isSafeInteger(document.maxSelectedSets) || document.maxSelectedSets < 0) {
    throw new RangeError("右冰套效的可選套數設定無效。");
  }
  if (document.selectionCells.length !== document.maxSelectedSets
    || new Set(document.selectionCells).size !== document.selectionCells.length) {
    throw new RangeError("右冰套效選擇欄位與可選套數設定不一致。");
  }
  if (selected.length > document.maxSelectedSets) throw new RangeError(`右冰套效最多選擇${document.maxSelectedSets}套。`);
  if (new Set(selected).size !== selected.length) throw new RangeError("右冰套效不可重複選擇。");
  const knownSetNames = new Set(document.effects.map((effect) => effect.setName));
  for (const name of selected) {
    if (!knownSetNames.has(name)) throw new RangeError(`未知的右冰套效：${name}`);
  }
  const selectedSetNamesSet = new Set(selected);
  const counts = new Map<string, number>();
  for (const setName of equippedSetNames) {
    if (setName == null || setName.trim() === "") continue;
    counts.set(setName, (counts.get(setName) ?? 0) + 1);
  }

  const selectedBySet = new Map<string, RightIceSetEffect>();
  for (const effect of document.effects) {
    if (!effect.active) continue;
    requireNonEmpty(effect.id, "rightIceEffect.id");
    requireNonEmpty(effect.setName, "rightIceEffect.setName");
    if (!selectedSetNamesSet.has(effect.setName)) continue;
    if (!Number.isInteger(effect.requiredPieces.count) || effect.requiredPieces.count < 1) {
      throw new RangeError(`${effect.id}.requiredPieces.count must be a positive integer.`);
    }
    for (const value of Object.values(effect.stats)) {
      if (!Number.isFinite(value)) throw new TypeError(`${effect.id} has a non-finite stat.`);
    }

    const count = counts.get(effect.setName) ?? 0;
    const eligible = effect.requiredPieces.operator === "exactly"
      ? count === effect.requiredPieces.count
      : count >= effect.requiredPieces.count;
    if (!eligible) continue;

    const previous = selectedBySet.get(effect.setName);
    if (!previous || effect.requiredPieces.count > previous.requiredPieces.count) {
      selectedBySet.set(effect.setName, effect);
    }
  }

  return [...selectedBySet.values()].map((effect) => ({
    sourceId: effect.id,
    stats: effect.stats,
  }));
}

/** Resolve one selected chip and tuning level into a standard stat source. */
export function resolveChipContribution(
  document: ChipCatalogDocument,
  chipId: string,
  tuningLevel: string,
  sourceId = `chip:${chipId}:${tuningLevel}`,
): StatContribution {
  requireNonEmpty(chipId, "chipId");
  requireNonEmpty(tuningLevel, "tuningLevel");
  requireNonEmpty(sourceId, "sourceId");
  const chip = document.chips.find((candidate) => candidate.id === chipId);
  if (!chip) throw new RangeError(`Unknown chip id: ${chipId}`);
  const level = chip.tuningLevels.find((candidate) => candidate.level === tuningLevel);
  if (!level) throw new RangeError(`Unsupported tuning level ${tuningLevel} for ${chip.name}.`);
  if (!Number.isFinite(level.value)) throw new TypeError(`${chip.id}/${tuningLevel} must be finite.`);
  return { sourceId, stats: { [chip.attributeKey]: level.value } };
}

/** Resolve the selected weapon growth level using the separate L64/U64 mappings. */
export function resolveWeaponGrowth(
  document: WeaponGrowthDocument,
  levelName: string | null | undefined,
  sourceId = "weapon-growth",
): StatContribution | null {
  if (levelName == null || levelName.trim() === "") return null;
  requireNonEmpty(sourceId, "sourceId");
  const level = document.levels.find((candidate) => candidate.name === levelName);
  if (!level) throw new RangeError(`Unknown weapon growth level: ${levelName}`);
  for (const [key, value] of Object.entries(level.stats)) {
    requireNonEmpty(key, "statKey");
    if (!Number.isFinite(value)) throw new TypeError(`${level.id}.${key} must be finite.`);
  }
  return { sourceId, stats: level.stats };
}

/** Resolve the five spreadsheet resonance selectors and their exact multipliers. */
export function resolveResonanceEffects(
  document: ResonanceEffectDocument,
    inputValues: Readonly<Record<string, unknown>>,
): StatContribution[] {
  return document.effects.flatMap((effect) => {
      if (!isResonanceInputCell(effect.inputCell)) {
        throw new RangeError(`${effect.id} 使用了未設定上限的共鳴欄位：${effect.inputCell}`);
      }
    const rawValue = inputValues[effect.inputCell];
      if (rawValue === undefined || rawValue === null || rawValue === "") return [];
      if ((typeof rawValue === "number" && !Number.isFinite(rawValue)) || !Number.isFinite(effect.multiplier)) {
      throw new TypeError(`${effect.inputCell} resonance input and multiplier must be finite.`);
    }
      const points = parseResonancePoints(effect.inputCell, rawValue);
      if (points === null) throw new RangeError(`${effect.inputCell} 共鳴點數必須是範圍內的非負整數。`);
      if (points === 0) return [];
    const stats = Object.fromEntries(
      Object.entries(effect.stats).map(([key, scalar]) => {
        requireNonEmpty(key, "statKey");
        if (!Number.isFinite(scalar)) throw new TypeError(`${effect.id}.${key} must be finite.`);
          return [key, points * effect.multiplier * scalar];
      }),
    );
    return [{ sourceId: effect.id, stats }];
  });
}

/** Apply all raid set tiers whose minimum piece-count conditions are met. */
export function resolveRaidSetEffects(
  document: RaidSetEffectDocument,
  equippedItemNames: readonly (string | null | undefined)[],
): StatContribution[] {
  const names = equippedItemNames.filter((name): name is string => Boolean(name?.trim()));
  const result: StatContribution[] = [];
  for (const set of document.sets) {
    requireNonEmpty(set.id, "raidSet.id");
    if (!Number.isInteger(set.implicitPieces) || set.implicitPieces < 0) {
      throw new RangeError(`${set.id}.implicitPieces must be a non-negative integer.`);
    }
    const matchedItems = names.filter((name) => set.matchTerms.some((term) => name.includes(term))).length;
    const pieceCount = Math.min(set.pieceCountCap, set.implicitPieces + matchedItems);
    for (const tier of set.tiers) {
      if (!Number.isInteger(tier.requiredPieces) || tier.requiredPieces < 1) {
        throw new RangeError(`${set.id}.requiredPieces must be a positive integer.`);
      }
      if (pieceCount >= tier.requiredPieces) {
        result.push({ sourceId: `${set.id}:${tier.requiredPieces}set`, stats: tier.stats });
      }
    }
  }
  return result;
}

/** Resolve the four-piece Atma conditions without assuming partial-set effects. */
export function resolveAtmaSetEffects(
  document: AtmaEffectDocument,
  equippedAtmaPieceCount: number,
  element: string | null | undefined,
  color: string | null | undefined,
): StatContribution[] {
  if (!Number.isInteger(equippedAtmaPieceCount) || equippedAtmaPieceCount < 0) {
    throw new RangeError("equippedAtmaPieceCount must be a non-negative integer.");
  }
  if (equippedAtmaPieceCount !== document.activeWhenPieceCountEquals) return [];
  if (!element) return [];
  const result: StatContribution[] = [];
  for (const rule of document.rules) {
    const elements = Array.isArray(rule.when.element) ? rule.when.element : [rule.when.element];
    if (!elements.includes(element)) continue;
    const stats = rule.statsByColor
      ? color == null ? undefined : rule.statsByColor[color]
      : rule.stats;
    if (!stats) {
      throw new RangeError(`No ${rule.id} values are configured for color ${color ?? "(empty)"}.`);
    }
    result.push({ sourceId: rule.id, stats });
  }
  return result;
}

/** Resolve lookup options and typed values used by 大師聖獸 overall potential. */
export function resolveMasterBeastEffects(
  document: MasterBeastEffectDocument,
  selection: MasterBeastSelection,
): StatContribution[] {
  const result: StatContribution[] = [];
  const setEffect = document.armorSpiritStoneSetEffect;
  if (!Number.isFinite(setEffect.multiplicativeDamagePct)) {
    throw new TypeError("聖獸精靈石套裝增幅必須是有限數值。");
  }
  result.push({ sourceId: setEffect.id, stats: { multiplicativeDamagePct: setEffect.multiplicativeDamagePct } });
  const addOption = (category: MasterBeastOption["category"], name: string | null | undefined, sourceId: string) => {
    if (name == null || name.trim() === "") return;
    const option = document.options.find((candidate) => candidate.category === category && candidate.name === name);
    if (!option) throw new RangeError("Unknown 大師聖獸 " + category + " option: " + name);
    result.push({ sourceId, stats: option.stats });
  };
  if (selection.overallOption?.trim()) {
    const overallOption = document.options.find(candidate => candidate.category === "overall" && candidate.name === selection.overallOption);
    if (!overallOption) throw new RangeError("Unknown 大師聖獸 overall option: " + selection.overallOption);
    for (const [statKey, value] of Object.entries(overallOption.stats)) {
      result.push({ sourceId: `master-beast-potential:${statKey}`, stats: { [statKey]: value } });
    }
  }
  (selection.headOptions ?? []).forEach((name, index) => addOption("head", name, "master-beast:head:" + (index + 1)));
  (selection.ringOptions ?? []).forEach((name, index) => addOption("ring", name, "master-beast:ring:" + (index + 1)));

  const addManual = (entry: MasterBeastManualValue | undefined, sourceId: string) => {
    if (!entry || entry.attribute == null || entry.attribute.trim() === "" || entry.value == null) return;
    if (!Number.isFinite(entry.value)) throw new TypeError(sourceId + " must be finite.");
    const key = document.statKeyBySheetName[entry.attribute];
    if (!key) return;
    const value = entry.fractionToPercentagePoints ? entry.value * 100 : entry.value;
    result.push({ sourceId, stats: { [key]: value } });
  };
  addManual(selection.headManual, "master-beast:head-manual");
  addManual(selection.necklaceManual, "master-beast:necklace-manual");
  (selection.ringManual ?? []).forEach((entry, index) => addManual(entry, "master-beast:ring-manual:" + (index + 1)));
  (selection.mirrorManual ?? []).forEach((entry, index) => {
    const sourceId = "master-beast:mirror:" + (index + 1);
    if (entry.attribute?.trim() && entry.value != null) {
      const rule = document.mirrorValueRules.byAttribute[entry.attribute] ?? document.mirrorValueRules.default;
      if (!rule || ![rule.minPct, rule.maxPct, rule.stepPct].every(Number.isFinite)
        || rule.minPct < 0 || rule.maxPct < rule.minPct || rule.stepPct <= 0) {
        throw new TypeError(`迷鏡效果「${entry.attribute}」的數值規則無效。`);
      }
      const percentagePoints = entry.value * 100;
      const stepIndex = (percentagePoints - rule.minPct) / rule.stepPct;
      if (!Number.isFinite(percentagePoints)
        || percentagePoints < rule.minPct - 1e-9
        || percentagePoints > rule.maxPct + 1e-9
        || Math.abs(stepIndex - Math.round(stepIndex)) > 1e-8) {
        throw new RangeError(`迷鏡效果「${entry.attribute}」數值須為 ${rule.minPct}%～${rule.maxPct}%，每檔 ${rule.stepPct}%。`);
      }
    }
    addManual({ ...entry, fractionToPercentagePoints: true }, sourceId);
  });
  return result;
}

/** Resolve fixed maxed values, class branch bonuses, and counted spirit traits. */
export function resolveSpiritRecordEffects(
  document: SpiritRecordEffectDocument,
  classCode: string,
  attackType: "physical" | "magical",
  selectedRecords: readonly (string | null | undefined)[],
): StatContribution[] {
  requireNonEmpty(classCode, "classCode");
  const normalizedCode = classCode.toLocaleLowerCase();
  const names = selectedRecords.filter((name): name is string => Boolean(name?.trim()));
  const countOf = (name: string) =>
    names.filter((selected) => selected.toLocaleLowerCase() === name.toLocaleLowerCase()).length;
  const contributions: StatContribution[] = [
    { sourceId: "spirit-record:default-maxed", stats: document.defaultMaxedStats },
  ];

  for (const bonus of document.branchBonuses) {
    if (!bonus.eligibleClasses.some((eligible) => eligible.toLocaleLowerCase() === normalizedCode)) continue;
    const count = countOf(bonus.name);
    if (count === 0) continue;
    const threshold = bonus.thresholds.find((candidate) => count >= candidate.minimumCount);
    const value = threshold?.value ?? (bonus.otherwiseValue === "count" ? count : bonus.otherwiseValue);
    contributions.push({ sourceId: "spirit-record:branch:" + bonus.name, stats: { [bonus.statKey]: value } });
  }

  for (const trait of document.traits) {
    if (trait.attackType && trait.attackType !== attackType) continue;
    const count = countOf(trait.name);
    if (count === 0) continue;
    const match = trait.countValues.find((candidate) =>
      candidate.count !== undefined ? count === candidate.count : count >= (candidate.minimumCount ?? Infinity),
    );
    const value = match?.value ?? trait.otherwiseValue;
    if (value !== 0) {
      contributions.push({ sourceId: "spirit-record:trait:" + trait.name, stats: { [trait.statKey]: value } });
    }
  }
  return contributions;
}

/** Map free-text circuit-board attributes and decimal percentages to Calc row 43:47. */
export function resolveCircuitBoardEffects(
  document: CircuitBoardRulesDocument,
  inputValues: Readonly<Record<string, CircuitBoardInputSelection>>,
): CircuitBoardContribution[] {
  return document.inputs.flatMap((rule) => {
    const input = inputValues[rule.slot];
    const multiple = Array.isArray(input);
    const selections: readonly CircuitBoardInputValue[] = multiple ? input : input ? [input] : [];
    if (selections.length === 0) return [{ slot: rule.slot, wearSet: rule.wearSet, contribution: null }];
    return selections.map((selection, index) => {
      if (selection.attribute == null || selection.attribute.trim() === "" || selection.percentageValue == null) {
        return { slot: rule.slot, wearSet: rule.wearSet, contribution: null };
      }
      if (!Number.isFinite(selection.percentageValue)) {
        throw new TypeError(rule.slot + " circuit-board percentage must be finite.");
      }
      const mappedStatKeys = document.statKeyBySheetName[selection.attribute];
      if (!mappedStatKeys) return { slot: rule.slot, wearSet: rule.wearSet, contribution: null };
      const statKeys = Array.isArray(mappedStatKeys) ? mappedStatKeys : [mappedStatKeys];
      return {
        slot: rule.slot,
        wearSet: rule.wearSet,
        contribution: {
          sourceId: multiple ? "circuit-board:" + rule.slot + ":" + (index + 1) : "circuit-board:" + rule.slot,
          stats: Object.fromEntries(statKeys.map(key => [key, selection.percentageValue! * 100])),
        },
      };
    });
  });
}

/** Resolve up to three independent appraisal options on each armor slot. */
export function resolveArmorAppraisals(
  document: ArmorAppraisalDocument,
  input: ArmorAppraisalInput,
): ArmorAppraisalContribution[] {
  return document.slots.map((slot) => {
    if (slot.enabledBy && !input.enabledInputs?.[slot.enabledBy]) {
      return { slot: slot.id, wearSet: slot.wearSet, contributions: [] };
    }
    const selected = input.optionsBySlot[slot.id] ?? [];
    if (selected.length > 3) throw new RangeError(slot.id + " supports at most three appraisal options.");
    const contributions = selected.flatMap((name, index) => {
      if (name == null || name.trim() === "") return [];
      const option = document.options.find((candidate) => candidate.name === name);
      if (!option) throw new RangeError("Unknown armor appraisal option: " + name);
      return [{ sourceId: "armor-appraisal:" + slot.id + ":" + (index + 1), stats: option.stats }];
    });
    return { slot: slot.id, wearSet: slot.wearSet, contributions };
  });
}

/** Resolve data-driven option effects such as weapon appraisals or giant stones. */
export function resolveNamedStatOption(
  options: readonly NamedStatOption[],
  selectedName: string | null | undefined,
  sourceId: string,
): StatContribution | null {
  if (selectedName == null || selectedName.trim() === "") return null;
  requireNonEmpty(sourceId, "sourceId");
  const option = options.find((candidate) => candidate.name === selectedName);
  if (!option) throw new RangeError(`Unknown option: ${selectedName}`);
  if (option.status === "needs-user-confirmation") {
    throw new RangeError(`${selectedName} has no confirmed calculation rule yet.`);
  }
  for (const [key, value] of Object.entries(option.stats)) {
    requireNonEmpty(key, "statKey");
    if (!Number.isFinite(value)) throw new TypeError(`${option.id}.${key} must be finite.`);
  }
  return { sourceId, stats: option.stats };
}

/** Resolve accessory special-effect dropdowns using their individual sheet multipliers. */
export function resolveAccessoryEffectOptions(
  document: AccessoryEffectDocument,
  selections: Readonly<Record<string, string | null | undefined>>,
  equipmentNames: Readonly<Record<string, string | null | undefined>> = {},
): StatContribution[] {
  const result: StatContribution[] = [];
  for (const group of document.groups) {
    for (const cell of group.inputCells) {
      const selectedName = selections[cell];
      if (selectedName == null || selectedName.trim() === "") continue;
      const equipmentName = equipmentNames[group.selectionCell];
      const options = equipmentName ? group.optionsByEquipmentName?.[equipmentName] ?? group.options : group.options;
      const option = options.find((candidate) => candidate.name === selectedName);
      if (!option) throw new RangeError(`${group.label}「${selectedName}」沒有對應的計算資料。`);
      result.push({ sourceId: `accessory-effect:${group.id}:${cell}`, stats: option.stats });
    }
  }
  return result;
}

/** Resolve the color-dependent 百億套效, including its input-sensitive green formula. */
export function resolveColorSetEffect(
  document: ColorSetEffectDocument,
  selectedName: string | null | undefined,
  sourceAttribute: string | null | undefined,
  sourceValue: number | null | undefined,
): StatContribution | null {
  if (selectedName == null || selectedName.trim() === "") return null;
  const option = document.options.find((candidate) => candidate.name === selectedName);
  if (!option) throw new RangeError(`百億/內布隆套效「${selectedName}」沒有對應的計算資料。`);
  if (option.stats) return { sourceId: `color-set:${selectedName}`, stats: option.stats };
  if (!option.calculatedStat) throw new RangeError(`百億/內布隆套效「${selectedName}」沒有計算規則。`);
  const formula = option.calculatedStat;
  const rawValue = sourceAttribute === formula.requiredAttribute ? sourceValue ?? 0 : 0;
  if (!Number.isFinite(rawValue)) throw new TypeError(`${formula.sourceValueCell} 必須是有限數值。`);
  const sourcePoints = rawValue * formula.inputValueToPoints;
  const sourceRatio = sourcePoints / 100;
  const outputPct = (formula.baseMultiplier * (1 + sourceRatio * formula.inputMultiplier) - 1) * 100;
  return { sourceId: `color-set:${selectedName}`, stats: { [formula.outputKey]: outputPct } };
}
