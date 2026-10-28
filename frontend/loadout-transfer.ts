import { getEquipmentOptionName, type EquipmentCatalogItem, type SimulatorEquipmentSelectionMapping } from '../calculation/equipment-catalog.ts';
import { createCatalogIndex, type CatalogData, type CatalogIndex } from './catalog-index.ts';
export { equipmentTransferCode } from './catalog-index.ts';
import { isResonanceInputField, parseResonancePoints } from '../calculation/resonance-input.ts';
import { codeForFieldId, fieldIdForCode, isFieldId } from './field-ids.ts';
import { normalizePortraitAwakeningSplit, normalizeTranscendenceSkillDamageShare, type LoadoutState } from './state.ts';
import { canonicalizeNumber } from './numeric-input.ts';
import { normalizeOptionalEffectValues, isUnrelatedEffectValue, normalizeNephronMagazineSelections, normalizeBossHealthCondition } from './state.ts';
import { normalizeClassSkillVersions } from '../calculation/class-skill-versions.ts';

type TransferData = CatalogData;
type JsonRecord = Record<string, unknown>;

export interface LoadoutImportResult {
  state: LoadoutState;
  clearedFields: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function indexFor(data: TransferData, supplied?: CatalogIndex): CatalogIndex {
  if (supplied && supplied.data !== data) throw new TypeError('CatalogIndex belongs to a different data load.');
  // External callers may mutate their data; without an explicit revision scope use a fresh index.
  return supplied ?? createCatalogIndex(data);
}

function getOptionName(item: EquipmentCatalogItem, mapping: SimulatorEquipmentSelectionMapping): string | null {
  try { return getEquipmentOptionName(item, mapping.application); } catch { return null; }
}

function isValidPrimitive(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
}

function isMasterBeastMirrorValue(fieldId: string): boolean {
  return /^MasterBeast\..+\.Mirror\.\d+\.Value$/.test(fieldId);
}

export function serializeLoadout(state: LoadoutState, data: TransferData, suppliedIndex?: CatalogIndex): { json: string; omittedFields: string[] } {
  const index = indexFor(data, suppliedIndex);
  const mappings = index.equipmentMappings;
  const values: Record<string, string | number> = {};
  const omittedFields: string[] = [];
  const fieldValues = { ...state.values };
  const portrait = data.otherEffects.portraitAwakening;
  const portraitFields = [portrait.strongSettingKey, portrait.transcendenceSettingKey];
  const hasPortraitValues = portraitFields.some(fieldId => fieldValues[fieldId] !== undefined && fieldValues[fieldId] !== '');
  const invalidPortraitFields = new Set(portraitFields.filter(fieldId => {
    const raw = fieldValues[fieldId];
    if (raw === undefined || raw === '') return false;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
    return !Number.isInteger(value) || value < 0 || value > portrait.maxPct;
  }));
  if (hasPortraitValues && invalidPortraitFields.size === 0) {
    const split = normalizePortraitAwakeningSplit(
      fieldValues[portrait.strongSettingKey],
      fieldValues[portrait.transcendenceSettingKey],
      portrait.maxTotalPct,
    );
    fieldValues[portrait.strongSettingKey] = split.strongSkillDamagePct;
    fieldValues[portrait.transcendenceSettingKey] = split.transcendenceSkillDamagePct;
  }

  for (const [key, value] of Object.entries(fieldValues)) {
    if (invalidPortraitFields.has(key)) {
      omittedFields.push(key);
      continue;
    }
    const fieldId = isFieldId(key) ? key : undefined;
    const fieldCode = fieldId ? codeForFieldId(fieldId) : undefined;
    if (!fieldId || !fieldCode || !isValidPrimitive(value)) {
      omittedFields.push(key);
      continue;
    }
    const transferValue = fieldId && isMasterBeastMirrorValue(fieldId) && typeof value === 'number'
      ? canonicalizeNumber(value)
      : value;
    if (typeof transferValue === 'string' && transferValue.trim() === '') continue;

      if (isResonanceInputField(fieldId)) {
        const points = parseResonancePoints(fieldId, transferValue);
        if (points === null) { omittedFields.push(fieldId); continue; }
        values[String(fieldCode)] = points;
        continue;
      }

    const mapping = mappings.get(fieldId);
    if (mapping) {
      if (typeof transferValue !== 'string') { omittedFields.push(fieldId); continue; }
      const matches = index.matchEquipment(mapping, transferValue);
      if (matches.length !== 1) { omittedFields.push(fieldId); continue; }
      values[String(fieldCode)] = index.equipmentCode(matches[0].id);
      continue;
    }

    const choices = index.resolveFieldChoices(fieldId, fieldValues);
    if (choices) {
      if (transferValue === 0 && isUnrelatedEffectValue(fieldId, fieldValues, index)) { values[String(fieldCode)] = 0; continue; }
      if (!choices.some(option => String(option) === String(transferValue))) { omittedFields.push(fieldId); continue; }
      values[String(fieldCode)] = transferValue;
      continue;
    }
    values[String(fieldCode)] = transferValue;
  }

  const classSkillVersions = normalizeClassSkillVersions(state.classSkillVersions);
  const bossHealthCondition = normalizeBossHealthCondition(state.bossHealthCondition);
  const payload = {
    format: 'damage-calculator-loadout',
    formatVersion: 3,
    Job: state.Job,
    // Keep these commonly edited settings readable in the exported JSON.
    // Their numeric transfer codes remain in `values` for compatibility with existing files.
    'Stage.Adapt': state.values['Stage.Adapt'] ?? null,
    'Stage.CritRatePenalty': state.values['Stage.CritRatePenalty'] ?? null,
    'Stage.BossDEF': state.values['Stage.BossDEF'] ?? null,
    values,
    lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
    masterBeastSpiritStoneColor: state.masterBeastSpiritStoneColor ?? data.masterBeast.spiritStoneColorSelector.defaultColor,
    petSkillAttackEnabled: state.petSkillAttackEnabled ?? true,
    nutProtectionPotionEnabled: state.nutProtectionPotionEnabled === true,
    nephronRaidEnabled: state.nephronRaidEnabled === true,
    transcendenceSkillDamageSharePct: normalizeTranscendenceSkillDamageShare(state.transcendenceSkillDamageSharePct),
    ...(classSkillVersions ? { classSkillVersions } : {}),
    ...(bossHealthCondition ? { bossHealthCondition } : {}),
  };
  return { json: `${JSON.stringify(payload)}\n`, omittedFields };
}

export function deserializeLoadout(raw: unknown, current: LoadoutState, data: TransferData, suppliedIndex?: CatalogIndex): LoadoutImportResult {
  if (!isRecord(raw) || raw.format !== 'damage-calculator-loadout' || raw.formatVersion !== 3) {
    throw new TypeError('檔案格式或版本不支援，請使用本網站匯出的 JSON 配裝檔。');
  }
  const candidate = raw;
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== 3) throw new TypeError('配裝資料版本不支援。');

  const index = indexFor(data, suppliedIndex);
  const clearedFields: string[] = [];
  const classes = index.activeClasses;
  const validCurrentClass = index.isActiveClass(current.Job) ? current.Job : classes[0]?.id;
  const candidateJob = candidate.Job;
  const Job = typeof candidateJob === 'string' && index.isActiveClass(candidateJob)
    ? candidateJob
    : validCurrentClass;
  if (Job !== candidateJob) clearedFields.push('職業');

  const values: Record<string, string | number> = {};
  const mappings = index.equipmentMappings;
  const rawValues = candidate.values;
  if (!isRecord(rawValues)) throw new TypeError('配裝檔的欄位資料格式無效。');
  const optionValuesById: Record<string, string | number> = {};
  for (const [code, value] of Object.entries(rawValues)) {
    const fieldId = fieldIdForCode(code);
    if (fieldId && isValidPrimitive(value)) {
      const importedValue = isMasterBeastMirrorValue(fieldId) && typeof value === 'number'
        ? canonicalizeNumber(value)
        : value;
      const candidateValue: Record<string, string | number> = { [fieldId]: importedValue };
      if (isResonanceInputField(fieldId)) {
        const points = parseResonancePoints(fieldId, candidateValue[fieldId]);
        if (points !== null) optionValuesById[fieldId] = points;
      } else optionValuesById[fieldId] = candidateValue[fieldId];
    }
  }
  const optionValues = optionValuesById;
  if (isRecord(rawValues)) {
    for (const [code, value] of Object.entries(rawValues)) {
      const fieldId = fieldIdForCode(code);
      if (!fieldId || !isValidPrimitive(value)) {
        clearedFields.push(fieldId ?? code);
        continue;
      }
      const importedValue = isMasterBeastMirrorValue(fieldId) && typeof value === 'number'
        ? canonicalizeNumber(value)
        : value;
      if (mappings.has(fieldId)) continue;
      if (typeof importedValue === 'string' && importedValue.trim() === '') continue;
      const candidateValue: Record<string, string | number> = { [fieldId]: importedValue };
      const normalizedValue = candidateValue[fieldId];
      if (isResonanceInputField(fieldId)) {
        const points = parseResonancePoints(fieldId, normalizedValue);
        if (points === null) clearedFields.push(fieldId);
        else values[fieldId] = points;
        continue;
      }
      const choices = index.resolveFieldChoices(fieldId, optionValues);
      if (choices) {
        if (normalizedValue === 0 && isUnrelatedEffectValue(fieldId, optionValues, index)
          || choices.some(option => String(option) === String(normalizedValue))) values[fieldId] = normalizedValue;
        else clearedFields.push(fieldId);
      } else values[fieldId] = normalizedValue;
    }
  }

  // Older compact exports use numeric codes 1, 2, and 3. Accept the explicit semantic
  // fields as a fallback so readable exports still round-trip if those codes are absent.
  for (const fieldId of ['Stage.Adapt', 'Stage.CritRatePenalty', 'Stage.BossDEF'] as const) {
    if (values[fieldId] !== undefined) continue;
    const explicitValue = candidate[fieldId];
    if (!isValidPrimitive(explicitValue) || typeof explicitValue === 'string' && explicitValue.trim() === '') continue;
    const choices = index.resolveFieldChoices(fieldId, optionValues);
    if (choices && !choices.some(option => String(option) === String(explicitValue))) {
      clearedFields.push(fieldId);
      continue;
    }
    values[fieldId] = explicitValue;
    const clearedIndex = clearedFields.lastIndexOf(fieldId);
    if (clearedIndex >= 0) clearedFields.splice(clearedIndex, 1);
  }

  const portrait = data.otherEffects.portraitAwakening;
  const portraitFields = [portrait.strongSettingKey, portrait.transcendenceSettingKey];
  for (const fieldId of portraitFields) {
    const value = values[fieldId];
    if (value === undefined || value === '') continue;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > portrait.maxPct) {
      delete values[fieldId];
      clearedFields.push(fieldId);
    } else values[fieldId] = parsed;
  }
  const hasPortraitValues = portraitFields.some(fieldId => values[fieldId] !== undefined && values[fieldId] !== '');
  if (hasPortraitValues) {
    const strongValue = values[portrait.strongSettingKey];
    const transcendenceValue = values[portrait.transcendenceSettingKey];
    if (strongValue !== undefined && strongValue !== '' && transcendenceValue !== undefined && transcendenceValue !== ''
      && Number(strongValue) + Number(transcendenceValue) !== portrait.maxTotalPct) {
      const split = normalizePortraitAwakeningSplit(strongValue, transcendenceValue, portrait.maxTotalPct);
      if (Number(strongValue) !== split.strongSkillDamagePct) clearedFields.push(portrait.strongSettingKey);
      if (Number(transcendenceValue) !== split.transcendenceSkillDamagePct) clearedFields.push(portrait.transcendenceSettingKey);
      values[portrait.strongSettingKey] = split.strongSkillDamagePct;
      values[portrait.transcendenceSettingKey] = split.transcendenceSkillDamagePct;
    } else if (strongValue === undefined || strongValue === '' || transcendenceValue === undefined || transcendenceValue === '') {
      const split = normalizePortraitAwakeningSplit(strongValue, transcendenceValue, portrait.maxTotalPct);
      values[portrait.strongSettingKey] = split.strongSkillDamagePct;
      values[portrait.transcendenceSettingKey] = split.transcendenceSkillDamagePct;
    }
  }


  for (const [fieldId, mapping] of mappings) {
    const fieldCode = codeForFieldId(fieldId)!;
    const selection = rawValues[String(fieldCode)];
    if (selection === undefined || selection === null || selection === '') continue;
    const item = index.resolveEquipmentCode(mapping, selection);
    if (item) values[fieldId] = getOptionName(item, mapping) ?? '';
    else clearedFields.push(fieldId);
  }

  const fallbackColor = data.masterBeast.spiritStoneColorSelector.defaultColor;
  const color = candidate.masterBeastSpiritStoneColor;
  const lowerwearAlternativeEnabled = typeof candidate.lowerwearAlternativeEnabled === 'boolean'
    ? candidate.lowerwearAlternativeEnabled : false;
  const transcendenceSkillDamageSharePct = normalizeTranscendenceSkillDamageShare(candidate.transcendenceSkillDamageSharePct);
  if (candidate.transcendenceSkillDamageSharePct !== undefined && transcendenceSkillDamageSharePct !== candidate.transcendenceSkillDamageSharePct) {
    clearedFields.push('技傷占比');
  }
  clearedFields.push(...normalizeNephronMagazineSelections(values, index).clearedFields);
  const masterBeastSpiritStoneColor = color === '黃' || color === '綠' || color === '' ? color : fallbackColor;
  const petSkillAttackEnabled = typeof candidate.petSkillAttackEnabled === 'boolean' ? candidate.petSkillAttackEnabled : true;
  const nutProtectionPotionEnabled = candidate.nutProtectionPotionEnabled === true;
  const nephronRaidEnabled = candidate.nephronRaidEnabled === true;
  if (typeof candidate.lowerwearAlternativeEnabled !== 'boolean') clearedFields.push('強／排褲切換');
  if (!(color === '黃' || color === '綠' || color === '')) clearedFields.push('聖獸精靈石顏色');
  if (typeof candidate.petSkillAttackEnabled !== 'boolean') clearedFields.push('寵物被動');
  if (candidate.nutProtectionPotionEnabled !== undefined && typeof candidate.nutProtectionPotionEnabled !== 'boolean') clearedFields.push('特殊靈藥：努特的庇護');
  if (candidate.nephronRaidEnabled !== undefined && typeof candidate.nephronRaidEnabled !== 'boolean') clearedFields.push('內布隆襲擊戰');
  normalizeOptionalEffectValues(values, index);

  const classSkillVersions = normalizeClassSkillVersions(candidate.classSkillVersions);
  const bossHealthCondition = normalizeBossHealthCondition(candidate.bossHealthCondition);
  if (candidate.bossHealthCondition !== undefined) {
    const condition = candidate.bossHealthCondition;
    if (!isRecord(condition) || typeof condition.enabled !== 'boolean'
      || !['above', 'below'].includes(String(condition.comparison))
      || !['lowerwearA', 'lowerwearB'].includes(String(condition.lowerwear))) clearedFields.push('Boss 體力條件');
  }
  if (candidate.classSkillVersions !== undefined) {
    if (!isRecord(candidate.classSkillVersions)) clearedFields.push('職業技能版本');
    else for (const [key, value] of Object.entries(candidate.classSkillVersions)) {
      if (classSkillVersions?.[key] !== value) clearedFields.push('classSkillVersions.' + key);
    }
  }

  const uniqueCleared = [...new Set(clearedFields)];
  return {
    state: {
      schemaVersion: 3,
      Job: Job ?? current.Job,
      values,
      lowerwearAlternativeEnabled,
      masterBeastSpiritStoneColor,
      petSkillAttackEnabled,
      nutProtectionPotionEnabled,
      nephronRaidEnabled,
      transcendenceSkillDamageSharePct,
      ...(classSkillVersions ? { classSkillVersions } : {}),
      ...(bossHealthCondition ? { bossHealthCondition } : {}),
    },
    clearedFields: uniqueCleared,
  };
}

export function parseLoadoutJson(json: string, current: LoadoutState, data: TransferData, suppliedIndex?: CatalogIndex): LoadoutImportResult {
  let raw: unknown;
  try { raw = JSON.parse(json) as unknown; }
  catch { throw new TypeError('檔案不是有效的 JSON。'); }
  return deserializeLoadout(raw, current, data, suppliedIndex);
}
