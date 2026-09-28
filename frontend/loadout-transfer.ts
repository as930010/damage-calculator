import { getEquipmentOptionName, type EquipmentCatalogItem, type SimulatorEquipmentSelectionMapping } from '../calculation/equipment-catalog.ts';
import type { GameData } from './data.ts';
import { codeForFieldId, fieldIdForCode, isFieldId } from './field-ids.ts';
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
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

/** Options for controls whose values are not represented in the imported sheet validation table. */
function customOptions(data: TransferData, cell: string, values: Record<string, unknown>): readonly (string | number)[] | null {
  const address = cell;
  const direct: Record<string, readonly (string | number)[]> = {
    'Effect.Title': data.otherEffects.titles.map(option => option.name),
    'Effect.Consumable': data.otherEffects.consumables.map(option => option.name),
    'Effect.Environment': data.otherEffects.environments.map(option => option.name),
    'Peak.Option': data.otherEffects.peakOptions.map(option => option.name),
    'Pet.Passive': data.pets.options.map(option => option.name),
    'Atma.Element': ['火焰', '流水', '草木'],
    'Atma.Color': ['藍色', '綠色', '紫色', '米色'],
    'MasterBeast.OverallPotential': data.masterBeast.options.filter(option => option.category === 'overall').map(option => option.name),
  };
  if (address in direct) return direct[address];
  for (const entry of data.otherEffects.binaryEffects) if (entry.selectorCell === address) return entry.options.map(option => option.name);
  for (const entry of data.otherEffects.guildFountain) if (entry.selectorCell === address) return entry.options.map(option => option.name);
  if (data.colorSetEffects.selectorCell && data.colorSetEffects.selectorCell === address) return data.colorSetEffects.options.map(option => option.name);
  if (data.spiritRecord.classSelectors.selectorCells.some(cell => cell === address)) return data.spiritRecord.classSelectors.classes.map(entry => entry.classCode);
  for (const slot of data.layout.slots) {
    if (slot.innerwearId) {
      const innerwear = data.innerwear.slots.find(entry => entry.id === slot.innerwearId);
      if (innerwear && innerwear.enhancementCell === address) return Object.keys(data.innerwear.enhancementStats).map(level => `Lv.${level}`);
      if (innerwear && innerwear.forgingCell === address) return Object.keys(data.innerwear.forgingAttack);
    }
  }
  if (data.weaponGrades.selectorCell === address) return data.weaponGrades.options.map(option => option.name);
  if (address === 'Weapon.ENHC') return Object.keys(data.attack.weaponEnhancementFactors).map(level => `Lv.${level}`);
  if (data.growth.selectorCell === address) return data.growth.levels.map(level => level.name);
  for (const slot of data.appraisals.slots) if (slot.inputCells.some(cell => cell === address)) return data.appraisals.options.map(option => option.name);
  for (const input of data.circuits.inputs) if (input.attributeCell === address) return [...Object.keys(data.circuits.statKeyBySheetName), '無關傷害'];
  for (const slot of data.chipSlots.slots) {
    if (slot.attributeCell === address) return data.chips.chips.map(chip => chip.name);
    if (slot.tuningCell === address) {
      const chipName = values[slot.attributeCell];
      return data.chips.chips.find(chip => chip.name === chipName)?.tuningLevels.map(level => level.level) ?? [];
    }
  }
  for (const group of Object.values(data.weaponAppraisals.groups)) if (group.selectorCell === address) return group.options.map(option => option.name);
  if (data.giantStones.selectorCells.some(cell => cell === address)) return data.giantStones.options.map(option => option.name);
  for (const slot of data.transformations.slots) if (slot.choiceCell === address) return data.transformations.options;
  if (data.rightIceSets.selectionCells.some(cell => cell === address)) {
    return [...new Set(data.rightIceSets.effects.map(effect => effect.setName))];
  }
  const masterBeastAttributes = data.masterBeast.customAttributeOptions;
  const stoneCells: Record<string, readonly string[]> = {
    'MasterBeast.Head.CustomAttribute': masterBeastAttributes.head,
    'MasterBeast.Necklace.CustomAttribute': masterBeastAttributes.necklace,
    'MasterBeast.Ring1.CustomAttribute': masterBeastAttributes.ring,
    'MasterBeast.Ring2.CustomAttribute': masterBeastAttributes.ring,
  };
  if (address in stoneCells) return stoneCells[address];
  if (/^MasterBeast\..+\.Mirror\.\d+\.Attribute$/.test(address)) return masterBeastAttributes.mirror;
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
  const fieldValues = state.values;

  for (const [key, value] of Object.entries(fieldValues)) {
    const fieldId = isFieldId(key) ? key : undefined;
    const fieldCode = fieldId ? codeForFieldId(fieldId) : undefined;
    if (!fieldId || !fieldCode || !isValidPrimitive(value)) {
      omittedFields.push(key);
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') continue;

    const mapping = mappings.get(fieldId);
    if (mapping) {
      if (typeof value !== 'string') { omittedFields.push(fieldId); continue; }
      const matches = matchEquipment(data, mapping, value);
      if (matches.length !== 1) { omittedFields.push(fieldId); continue; }
      values[String(fieldCode)] = equipmentTransferCode(matches[0].id);
      continue;
    }

    const choices = cellOptions(data, fieldId, fieldValues);
    if (choices) {
      if (!choices.some(option => String(option) === String(value))) { omittedFields.push(fieldId); continue; }
      values[String(fieldCode)] = value;
      continue;
    }
    values[String(fieldCode)] = value;
  }

  const payload = {
    format: 'damage-calculator-loadout',
    formatVersion: 3,
    dataUpdatedAt: data.manifest.dataUpdatedAt,
    Job: state.Job,
    values,
    lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
    masterBeastSpiritStoneColor: state.masterBeastSpiritStoneColor,
    petSkillAttackEnabled: state.petSkillAttackEnabled,
  };
  return { json: `${JSON.stringify(payload)}\n`, omittedFields };
}

export function deserializeLoadout(raw: unknown, current: LoadoutState, data: TransferData): LoadoutImportResult {
  if (!isRecord(raw) || raw.format !== 'damage-calculator-loadout' || raw.formatVersion !== 3) {
    throw new TypeError('檔案格式或版本不支援，請使用本網站匯出的 JSON 配裝檔。');
  }
  const candidate = raw;
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== 3) throw new TypeError('配裝資料版本不支援。');

  const clearedFields: string[] = [];
  const classes = data.classes.classes.filter(entry => entry.active);
  const validCurrentClass = classes.some(entry => entry.id === current.Job) ? current.Job : classes[0]?.id;
  const candidateJob = candidate.Job;
  const Job = typeof candidateJob === 'string' && classes.some(entry => entry.id === candidateJob)
    ? candidateJob
    : validCurrentClass;
  if (Job !== candidateJob) clearedFields.push('職業');

  const values: Record<string, string | number> = {};
  const mappings = equipmentMappings(data);
  const rawValues = candidate.values;
  if (!isRecord(rawValues)) throw new TypeError('配裝檔的欄位資料格式無效。');
  const optionValuesById: Record<string, string | number> = {};
  for (const [code, value] of Object.entries(rawValues)) {
    const fieldId = fieldIdForCode(code);
    if (fieldId && isValidPrimitive(value)) optionValuesById[fieldId] = value;
  }
  const optionValues = optionValuesById;
  if (isRecord(rawValues)) {
    for (const [code, value] of Object.entries(rawValues)) {
      const fieldId = fieldIdForCode(code);
      if (!fieldId || !isValidPrimitive(value)) {
        clearedFields.push(fieldId ?? code);
        continue;
      }
      if (mappings.has(fieldId)) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      const choices = cellOptions(data, fieldId, optionValues);
      if (choices) {
        if (choices.some(option => String(option) === String(value))) values[fieldId] = value;
        else clearedFields.push(fieldId);
      } else values[fieldId] = value;
    }
  }

  for (const [cell, mapping] of mappings) {
    const fieldId = cell;
    const fieldCode = codeForFieldId(fieldId)!;
    const selection = rawValues[String(fieldCode)];
    if (selection === undefined || selection === null || selection === '') continue;
    const item = resolveEquipmentCode(data, mapping, selection);
    if (item) values[fieldId] = getOptionName(item, mapping) ?? '';
    else clearedFields.push(fieldId);
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
      schemaVersion: 3,
      Job: Job ?? current.Job,
      values,
      lowerwearAlternativeEnabled,
      masterBeastSpiritStoneColor,
      petSkillAttackEnabled,
    },
    clearedFields: uniqueCleared,
  };
}

export function parseLoadoutJson(json: string, current: LoadoutState, data: TransferData): LoadoutImportResult {
  let raw: unknown;
  try { raw = JSON.parse(json) as unknown; }
  catch { throw new TypeError('檔案不是有效的 JSON。'); }
  return deserializeLoadout(raw, current, data);
}
