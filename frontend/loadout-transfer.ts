import { getEquipmentOptionName, type EquipmentCatalogItem, type SimulatorEquipmentSelectionMapping } from '../calculation/equipment-catalog.ts';
import type { GameData } from './data.ts';
import type { LoadoutState } from './state.ts';
import { findValidationCatalog } from './sheet-validation.ts';

type TransferData = Pick<GameData,
  | 'classes' | 'mapping' | 'catalogs' | 'simulatorInputs' | 'manifest' | 'masterBeast'
  | 'layout' | 'attack' | 'innerwear' | 'appraisals' | 'chips' | 'chipSlots' | 'circuits'
  | 'transformations' | 'growth' | 'weaponAppraisals' | 'weaponGrades' | 'giantStones'
  | 'colorSetEffects' | 'spiritRecord' | 'otherEffects' | 'pets' | 'rightIceSets'
>;
type JsonRecord = Record<string, unknown>;

export interface LoadoutImportResult {
  state: LoadoutState;
  clearedFields: string[];
  legacyFormat: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isCellAddress(value: string): boolean {
  return /^[A-Z]+[0-9]+$/.test(value);
}

/** Stable 32-bit numeric transfer code derived from the catalog's stable item ID. */
export function equipmentTransferCode(itemId: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(itemId)) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}

function inputOption(data: TransferData, cell: string) {
  const catalog = findValidationCatalog(data.simulatorInputs.inputs, data.simulatorInputs.catalogs, cell);
  return catalog ? { catalog, options: catalog.options } : null;
}

function localCell(cell: string): string {
  return cell.split('!').at(-1)!.replaceAll('$', '');
}

/** Options for controls whose values are not represented in the imported sheet validation table. */
function customOptions(data: TransferData, cell: string, values: Record<string, unknown>): readonly (string | number)[] | null {
  const address = localCell(cell);
  const direct: Record<string, readonly (string | number)[]> = {
    B2: data.otherEffects.titles.map(option => option.name),
    B4: data.otherEffects.consumables.map(option => option.name),
    B5: data.otherEffects.environments.map(option => option.name),
    S2: data.otherEffects.peakOptions.map(option => option.name),
    S23: data.pets.options.map(option => option.name),
    L9: ['火焰', '流水', '草木'],
    N9: ['藍色', '綠色', '紫色', '米色'],
    S25: data.masterBeast.options.filter(option => option.category === 'overall').map(option => option.name),
  };
  if (address in direct) return direct[address];
  for (const entry of data.otherEffects.binaryEffects) if (localCell(entry.selectorCell) === address) return entry.options.map(option => option.name);
  for (const entry of data.otherEffects.guildFountain) if (localCell(entry.selectorCell) === address) return entry.options.map(option => option.name);
  if (data.colorSetEffects.selectorCell && localCell(data.colorSetEffects.selectorCell) === address) return data.colorSetEffects.options.map(option => option.name);
  if (data.spiritRecord.classSelectors.selectorCells.some(cell => localCell(cell) === address)) return data.spiritRecord.classSelectors.classes.map(entry => entry.classCode);
  for (const slot of data.layout.slots) {
    if (slot.innerwearId) {
      const innerwear = data.innerwear.slots.find(entry => entry.id === slot.innerwearId);
      if (innerwear && localCell(innerwear.enhancementCell) === address) return Object.keys(data.innerwear.enhancementStats).map(level => `Lv.${level}`);
      if (innerwear && localCell(innerwear.forgingCell) === address) return Object.keys(data.innerwear.forgingAttack);
    }
  }
  if (localCell(data.weaponGrades.selectorCell) === address) return data.weaponGrades.options.map(option => option.name);
  if (address === 'B32') return Object.keys(data.attack.weaponEnhancementFactors).map(level => `Lv.${level}`);
  if (localCell(data.growth.selectorCell) === address) return data.growth.levels.map(level => level.name);
  for (const slot of data.appraisals.slots) if (slot.inputCells.some(cell => localCell(cell) === address)) return data.appraisals.options.map(option => option.name);
  for (const input of data.circuits.inputs) if (localCell(input.attributeCell) === address) return [...Object.keys(data.circuits.statKeyBySheetName), '無關傷害'];
  for (const slot of data.chipSlots.slots) {
    if (localCell(slot.attributeCell) === address) return data.chips.chips.map(chip => chip.name);
    if (localCell(slot.tuningCell) === address) {
      const chipName = values[localCell(slot.attributeCell)];
      return data.chips.chips.find(chip => chip.name === chipName)?.tuningLevels.map(level => level.level) ?? [];
    }
  }
  for (const group of Object.values(data.weaponAppraisals.groups)) if (localCell(group.selectorCell) === address) return group.options.map(option => option.name);
  if (data.giantStones.selectorCells.some(cell => localCell(cell) === address)) return data.giantStones.options.map(option => option.name);
  for (const slot of data.transformations.slots) if (localCell(slot.choiceCell) === address) return data.transformations.options;
  if (data.rightIceSets.selectionCells.some(cell => localCell(cell) === address)) {
    return [...new Set(data.rightIceSets.effects.map(effect => effect.setName))];
  }
  const masterBeastAttributes = data.masterBeast.customAttributeOptions;
  const stoneCells: Record<string, readonly string[]> = {
    M27: masterBeastAttributes.head,
    M33: masterBeastAttributes.necklace,
    M36: masterBeastAttributes.ring,
    M39: masterBeastAttributes.ring,
  };
  if (address in stoneCells) return stoneCells[address];
  if (/^O(?:2[7-9]|3\d|4[01])$/.test(address)) return masterBeastAttributes.mirror;
  return null;
}

function cellOptions(data: TransferData, cell: string, values: Record<string, unknown>) {
  const custom = customOptions(data, cell, values);
  if (custom) return custom;
  const sheet = inputOption(data, cell);
  return sheet ? sheet.options.map(option => option.value) : null;
}

function equipmentMappings(data: TransferData): Map<string, SimulatorEquipmentSelectionMapping> {
  const mappings = new Map(data.mapping.selections.map(mapping => [mapping.selectionCell, mapping]));
  for (const mapping of data.mapping.magicStoneSelections.inputGroups) {
    mappings.set(mapping.selectionCell, {
      selectionCell: mapping.selectionCell,
      catalogFile: data.mapping.magicStoneSelections.catalogFile,
      slotId: data.mapping.magicStoneSelections.slotId,
      calculationRows: [mapping.calculationRow],
      application: mapping.application,
      enabledBy: mapping.enabledBy,
      configuration: mapping.configuration,
    });
  }
  return mappings;
}

function getOptionName(item: EquipmentCatalogItem, mapping: SimulatorEquipmentSelectionMapping): string | null {
  try { return getEquipmentOptionName(item, mapping.application); } catch { return null; }
}

function matchEquipment(data: TransferData, mapping: SimulatorEquipmentSelectionMapping, value: string): EquipmentCatalogItem[] {
  const catalog = data.catalogs[mapping.catalogFile];
  return catalog?.items.filter(item => item.active && item.slotId === mapping.slotId && getOptionName(item, mapping) === value) ?? [];
}

function resolveEquipmentCode(data: TransferData, mapping: SimulatorEquipmentSelectionMapping, code: unknown): EquipmentCatalogItem | null {
  if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 0xffffffff) return null;
  const catalog = data.catalogs[mapping.catalogFile];
  const matches = catalog?.items.filter(item => item.active && item.slotId === mapping.slotId && equipmentTransferCode(item.id) === code) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function isValidPrimitive(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
}

export function serializeLoadout(state: LoadoutState, data: TransferData): { json: string; omittedFields: string[] } {
  const mappings = equipmentMappings(data);
  const values: Record<string, string | number> = {};
  const omittedFields: string[] = [];

  for (const [cell, value] of Object.entries(state.values)) {
    if (!isCellAddress(cell) || !isValidPrimitive(value)) {
      omittedFields.push(cell);
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') continue;

    const mapping = mappings.get(cell);
    if (mapping) {
      if (typeof value !== 'string') { omittedFields.push(cell); continue; }
      const matches = matchEquipment(data, mapping, value);
      if (matches.length !== 1) { omittedFields.push(cell); continue; }
      values[cell] = equipmentTransferCode(matches[0].id);
      continue;
    }

    const choices = cellOptions(data, cell, state.values);
    if (choices) {
      if (!choices.some(option => String(option) === String(value))) { omittedFields.push(cell); continue; }
      values[cell] = value;
      continue;
    }
    values[cell] = value;
  }

  const payload = {
    format: 'damage-calculator-loadout',
    formatVersion: 2,
    dataUpdatedAt: data.manifest.dataUpdatedAt,
    classId: state.classId,
    values,
    lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
    masterBeastSpiritStoneColor: state.masterBeastSpiritStoneColor,
    petSkillAttackEnabled: state.petSkillAttackEnabled,
  };
  return { json: `${JSON.stringify(payload)}\n`, omittedFields };
}

export function deserializeLoadout(raw: unknown, current: LoadoutState, data: TransferData): LoadoutImportResult {
  if (!isRecord(raw) || raw.format !== 'damage-calculator-loadout' || (raw.formatVersion !== 1 && raw.formatVersion !== 2)) {
    throw new TypeError('檔案格式或版本不支援，請使用本網站匯出的 JSON 配裝檔。');
  }
  const legacy = raw.formatVersion === 1;
  if (legacy && !isRecord(raw.loadout)) throw new TypeError('舊版配裝檔缺少設定內容。');
  const candidate = legacy ? raw.loadout as JsonRecord : raw;
  if (legacy && candidate.schemaVersion !== 2) throw new TypeError('配裝資料版本不支援。');
  if (!legacy && candidate.schemaVersion !== undefined && candidate.schemaVersion !== 2) throw new TypeError('配裝資料版本不支援。');

  const clearedFields: string[] = [];
  const classes = data.classes.classes.filter(entry => entry.active);
  const validCurrentClass = classes.some(entry => entry.id === current.classId) ? current.classId : classes[0]?.id;
  const classId = typeof candidate.classId === 'string' && classes.some(entry => entry.id === candidate.classId)
    ? candidate.classId
    : validCurrentClass;
  if (classId !== candidate.classId) clearedFields.push('職業');

  const values: Record<string, string | number> = {};
  const mappings = equipmentMappings(data);
  const rawValues = candidate.values;
  if (!isRecord(rawValues)) throw new TypeError('配裝檔的欄位資料格式無效。');
  if (isRecord(rawValues)) {
    for (const [cell, value] of Object.entries(rawValues)) {
      if (!isCellAddress(cell) || !isValidPrimitive(value)) {
        clearedFields.push(cell);
        continue;
      }
      if (mappings.has(cell)) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      const choices = cellOptions(data, cell, rawValues);
      if (choices) {
        if (choices.some(option => String(option) === String(value))) values[cell] = value;
        else clearedFields.push(cell);
      } else values[cell] = value;
    }
  }

  for (const [cell, mapping] of mappings) {
    if (legacy) {
      const selection = isRecord(candidate.values) ? candidate.values[cell] : undefined;
      if (selection == null || selection === '') continue;
      if (typeof selection !== 'string') { clearedFields.push(cell); continue; }
      const matches = matchEquipment(data, mapping, selection);
      if (matches.length === 1) values[cell] = getOptionName(matches[0], mapping) ?? '';
      else clearedFields.push(cell);
      continue;
    }
    const selection = rawValues[cell];
    if (selection === undefined || selection === null || selection === '') continue;
    const item = resolveEquipmentCode(data, mapping, selection);
    if (item) values[cell] = getOptionName(item, mapping) ?? '';
    else clearedFields.push(cell);
  }

  const fallbackColor = data.masterBeast.spiritStoneColorSelector.defaultColor;
  const color = candidate.masterBeastSpiritStoneColor;
  const lowerwearAlternativeEnabled = typeof candidate.lowerwearAlternativeEnabled === 'boolean'
    ? candidate.lowerwearAlternativeEnabled : false;
  const masterBeastSpiritStoneColor = color === '黃' || color === '綠' || color === '' ? color : fallbackColor;
  const petSkillAttackEnabled = typeof candidate.petSkillAttackEnabled === 'boolean' ? candidate.petSkillAttackEnabled : true;
  if (typeof candidate.lowerwearAlternativeEnabled !== 'boolean') clearedFields.push('強／排褲切換');
  if (!(color === '黃' || color === '綠' || color === '')) clearedFields.push('聖獸精靈石顏色');
  if (typeof candidate.petSkillAttackEnabled !== 'boolean') clearedFields.push('寵物被動');

  const uniqueCleared = [...new Set(clearedFields)];
  return {
    state: {
      schemaVersion: 2,
      classId: classId ?? current.classId,
      values,
      lowerwearAlternativeEnabled,
      masterBeastSpiritStoneColor,
      petSkillAttackEnabled,
    },
    clearedFields: uniqueCleared,
    legacyFormat: legacy,
  };
}

export function parseLoadoutJson(json: string, current: LoadoutState, data: TransferData): LoadoutImportResult {
  let raw: unknown;
  try { raw = JSON.parse(json) as unknown; }
  catch { throw new TypeError('檔案不是有效的 JSON。'); }
  return deserializeLoadout(raw, current, data);
}
