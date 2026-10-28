import { isFieldId, FIELD_ID_TO_CODE } from "./field-ids.ts";
import type { CatalogIndex } from './catalog-index.ts';
import { normalizeClassSkillVersions } from '../calculation/class-skill-versions.ts';
import { circuitBoardRowsField, readCircuitBoardRows, serializeCircuitBoardRows, normalizeCircuitBoardRows, normalizeCircuitPercentage } from './circuit-board-rows.ts';
import { isResonanceInputField, parseResonancePoints } from "../calculation/resonance-input.ts";

export const DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT = 100;

/** Keep the first valid full magazine name in catalog slot order, including the alternate lowerwear. */
export function normalizeNephronMagazineSelections(values: Record<string, string | number>, index: CatalogIndex): { clearedFields: string[]; changed: boolean } {
  const seen = new Set<string>();
  const clearedFields: string[] = [];
  let changed = false;
  const rules = index.data.nephronArmor;
  for (const field of rules.fields) {
    const armor = index.innerwearById(field.slotId);
    if (!armor || values[armor.typeField] !== '內布隆') continue;
    const name = String(values[field.magazineField] ?? '');
    const magazine = rules.magazines.find(entry => entry.name === name);
    const level = magazine?.fixedLevel === undefined ? String(values[field.magazineLevelField] ?? '') : `Lv.${magazine.fixedLevel}`;
    if (!name && !level) continue;
    // A selected name reserves its slot while the user is still choosing a level.
    if (!magazine
      || (level !== '' && !rules.levelLabels.includes(level)) || seen.has(name)) {
      delete values[field.magazineField]; delete values[field.magazineLevelField];
      clearedFields.push(field.magazineField, field.magazineLevelField);
      changed = true;
    } else {
      seen.add(name);
      if (magazine.fixedLevel !== undefined && values[field.magazineLevelField] !== level) {
        values[field.magazineLevelField] = level;
        changed = true;
      }
    }
  }
  return { clearedFields, changed };
}

const optionalEffectsByCatalog = new WeakMap<CatalogIndex, {
  fields: string[]; choices: Map<string, readonly unknown[]>; circuitChoices: Map<string, readonly unknown[]>;
  valueFields: Map<string, string>;
}>();
function optionalEffectFields(index: CatalogIndex) {
  let fields = optionalEffectsByCatalog.get(index);
  if (fields) return fields;
  const valueFields = new Map<string, string>();
  const choices = new Map<string, readonly unknown[]>();
  const circuitChoices = new Map<string, readonly unknown[]>();
  for (const input of index.data.circuits.inputs) valueFields.set(input.attributeField, input.valueField);
  for (const input of index.data.circuits.inputs) circuitChoices.set(input.attributeField, input.attributeOptions);
  for (const armor of index.data.nephronArmor.fields) for (const input of armor.transformFields) valueFields.set(input.attributeField, input.valueField);
  for (const fieldId of Object.keys(FIELD_ID_TO_CODE)) {
    if (/^MasterBeast\..+\.(?:CustomAttribute|Mirror\.\d+\.Attribute)$/.test(fieldId)) {
      valueFields.set(fieldId, fieldId.replace(/Attribute$/, 'Value'));
    }
  }
  const optionalFields: string[] = [];
  for (const fieldId of Object.keys(FIELD_ID_TO_CODE)) {
    const fieldChoices = index.resolveFieldChoices(fieldId, {});
    if (!fieldChoices?.some(choice => String(choice) === '無關傷害')) continue;
    optionalFields.push(fieldId);
    choices.set(fieldId, fieldChoices);
  }
  fields = { fields: optionalFields, choices, circuitChoices, valueFields };
  optionalEffectsByCatalog.set(index, fields);
  return fields;
}

/** Shared by startup, import, history and controls; never replaces valid selections. */
export function normalizeOptionalEffectValues(values: Record<string, string | number>, index: CatalogIndex): boolean {
  let changed = false;
  const set = (fieldId: string, value: string | number) => {
    if (values[fieldId] !== value) { values[fieldId] = value; changed = true; }
  };
  const fields = optionalEffectFields(index);
  for (const fieldId of fields.fields) {
    const choices = fields.circuitChoices.get(fieldId) ?? fields.choices.get(fieldId);
    if (!choices?.some(choice => String(choice) === String(values[fieldId] ?? ''))) set(fieldId, '無關傷害');
    const valueField = fields.valueFields.get(fieldId);
    if (valueField && values[fieldId] === '無關傷害') set(valueField, 0);
  }
  for (const circuit of index.data.circuits.inputs) {
    const rows = normalizeCircuitBoardRows(
      readCircuitBoardRows(values, circuit.attributeField, circuit.valueField),
      circuit.attributeOptions,
    );
    set(circuitBoardRowsField(circuit.attributeField), serializeCircuitBoardRows(rows));
    // Keep the original single-row fields synchronized for old readers and transfers.
    set(circuit.attributeField, rows[0].attribute);
    set(circuit.valueField, normalizeCircuitPercentage(rows[0].percentageValue));
  }
  return changed;
}

export function isUnrelatedEffectValue(fieldId: string, values: Readonly<Record<string, string | number>>, index: CatalogIndex): boolean {
  return [...optionalEffectFields(index).valueFields].some(([attribute, valueField]) => valueField === fieldId && values[attribute] === '無關傷害');
}

export interface PortraitAwakeningSplit {
  strongSkillDamagePct: number;
  transcendenceSkillDamagePct: number;
}

export function normalizePortraitAwakeningSplit(
  strongValue: unknown,
  transcendenceValue: unknown,
  maxTotalPct = 5,
): PortraitAwakeningSplit {
  const readInteger = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= maxTotalPct ? parsed : undefined;
  };
  const strong = readInteger(strongValue);
  const transcendence = readInteger(transcendenceValue);
  if (strong === undefined && transcendence === undefined) {
    return { strongSkillDamagePct: 0, transcendenceSkillDamagePct: maxTotalPct };
  }
  if (strong === undefined) {
    return { strongSkillDamagePct: maxTotalPct - transcendence!, transcendenceSkillDamagePct: transcendence! };
  }
  if (transcendence === undefined) {
    return { strongSkillDamagePct: strong, transcendenceSkillDamagePct: maxTotalPct - strong };
  }
  if (strong + transcendence === maxTotalPct) {
    return { strongSkillDamagePct: strong, transcendenceSkillDamagePct: transcendence };
  }
  if (transcendence > 0) {
    return { strongSkillDamagePct: maxTotalPct - transcendence, transcendenceSkillDamagePct: transcendence };
  }
  if (strong > 0) {
    return { strongSkillDamagePct: strong, transcendenceSkillDamagePct: maxTotalPct - strong };
  }
  return { strongSkillDamagePct: 0, transcendenceSkillDamagePct: maxTotalPct };
}

export interface BossHealthCondition {
  enabled: boolean;
  comparison: 'above' | 'below';
  lowerwear: 'lowerwearA' | 'lowerwearB';
}
export const DEFAULT_BOSS_HEALTH_CONDITION: Readonly<BossHealthCondition> = Object.freeze({
  enabled: false, comparison: 'above', lowerwear: 'lowerwearA',
});
export function normalizeBossHealthCondition(value: unknown): BossHealthCondition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  return { enabled: candidate.enabled === true,
    comparison: candidate.comparison === 'below' ? 'below' : 'above',
    lowerwear: candidate.lowerwear === 'lowerwearB' ? 'lowerwearB' : 'lowerwearA' };
}

export interface LoadoutState {
  schemaVersion: 3;
  Job: string;
  values: Record<string, string | number>;
  lowerwearAlternativeEnabled: boolean;
  masterBeastSpiritStoneColor: "黃" | "綠" | "";
  petSkillAttackEnabled: boolean;
  nutProtectionPotionEnabled: boolean;
  nephronRaidEnabled: boolean;
  transcendenceSkillDamageSharePct: number;
  classSkillVersions?: Record<string, boolean>;
  bossHealthCondition?: BossHealthCondition;
}
const stateKey = "dab-loadout-v1";
const baselineKey = "dab-baseline-v1";

export function normalizeTranscendenceSkillDamageShare(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value * 100) / 100
    : DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT;
}

type PortraitFields = { legacySettingKey: string; strongSettingKey: string; transcendenceSettingKey: string; maxTotalPct: number };
/** Startup/restore policy; imports still report invalid and corrected fields separately. */
export function normalizePortraitAwakeningValues(values: Record<string, string | number>, portrait: PortraitFields): boolean {
  const split = normalizePortraitAwakeningSplit(values[portrait.strongSettingKey], values[portrait.transcendenceSettingKey], portrait.maxTotalPct);
  const changed = values[portrait.strongSettingKey] !== split.strongSkillDamagePct || values[portrait.transcendenceSettingKey] !== split.transcendenceSkillDamagePct;
  values[portrait.strongSettingKey] = split.strongSkillDamagePct;
  values[portrait.transcendenceSettingKey] = split.transcendenceSkillDamagePct;
  return changed;
}

export function parseTranscendenceSkillDamageShareInput(raw: string): number | null {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{0,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function parseState(raw: string | null): LoadoutState | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 3 || typeof candidate.Job !== "string") return null;
  const entries = candidate.values;
  const values: Record<string, string | number> = {};
    if (entries && typeof entries === "object") for (const [key, item] of Object.entries(entries)) {
      if (!isFieldId(key) || !(typeof item === "string" || typeof item === "number" && Number.isFinite(item))) continue;
      if (isResonanceInputField(key)) {
        const points = parseResonancePoints(key, item);
        if (points !== null) values[key] = points;
        continue;
      }
      values[key] = item;
  }
  const stoneColor = candidate.masterBeastSpiritStoneColor;
  const classSkillVersions = normalizeClassSkillVersions(candidate.classSkillVersions);
  const bossHealthCondition = normalizeBossHealthCondition(candidate.bossHealthCondition);
  return {
    schemaVersion: 3, Job: candidate.Job, values,
    lowerwearAlternativeEnabled: candidate.lowerwearAlternativeEnabled === true,
    masterBeastSpiritStoneColor: stoneColor === "綠" || stoneColor === "" ? stoneColor : "黃",
    // Missing toggle values preserve the previous always-on behavior.
    petSkillAttackEnabled: candidate.petSkillAttackEnabled !== false,
    nutProtectionPotionEnabled: candidate.nutProtectionPotionEnabled === true,
    nephronRaidEnabled: candidate.nephronRaidEnabled === true,
    transcendenceSkillDamageSharePct: normalizeTranscendenceSkillDamageShare(candidate.transcendenceSkillDamageSharePct),
    ...(classSkillVersions ? { classSkillVersions } : {}),
    ...(bossHealthCondition ? { bossHealthCondition } : {}),
  };
}
export function readState(defaultClass: string): LoadoutState {
  try { const stored = parseState(localStorage.getItem(stateKey)); if (stored) return stored; } catch { /* Storage is optional. */ }
  return { schemaVersion: 3, Job: defaultClass, values: {}, lowerwearAlternativeEnabled: false, masterBeastSpiritStoneColor: "黃", petSkillAttackEnabled: true, nutProtectionPotionEnabled: false, nephronRaidEnabled: false, transcendenceSkillDamageSharePct: DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT };
}
export function readBaseline(): LoadoutState | null {
  try { return parseState(localStorage.getItem(baselineKey)); } catch { return null; }
}
export function saveState(state: LoadoutState, baseline = false): boolean {
  try { localStorage.setItem(baseline ? baselineKey : stateKey, JSON.stringify(state)); return true; } catch { return false; }
}
