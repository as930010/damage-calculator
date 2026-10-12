import { isFieldId, FIELD_ID_TO_CODE } from "./field-ids.ts";
import type { CatalogIndex } from './catalog-index.ts';
import { GLOVE_CIRCUIT_ROWS_FIELD, readGloveCircuitRows, serializeGloveCircuitRows, normalizeGloveCircuitRows, normalizeCircuitPercentage } from './circuit-board-rows.ts';
import { isResonanceInputCell, parseResonancePoints } from "../calculation/resonance-input.ts";

export const DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT = 100;

const optionalEffectsByCatalog = new WeakMap<CatalogIndex, {
  fields: string[]; choices: Map<string, readonly unknown[]>; circuitChoices: Map<string, readonly unknown[]>;
  valueCells: Map<string, string>;
}>();
function optionalEffectFields(index: CatalogIndex) {
  let fields = optionalEffectsByCatalog.get(index);
  if (fields) return fields;
  const valueCells = new Map<string, string>();
  const choices = new Map<string, readonly unknown[]>();
  const circuitChoices = new Map<string, readonly unknown[]>();
  for (const input of index.data.circuits.inputs) valueCells.set(input.attributeCell, input.valueCell);
  for (const input of index.data.circuits.inputs) circuitChoices.set(input.attributeCell, input.attributeOptions);
  for (const armor of index.data.nephronArmor.fields) for (const input of armor.transformFields) valueCells.set(input.attributeCell, input.valueCell);
  for (const cell of Object.keys(FIELD_ID_TO_CODE)) {
    if (/^MasterBeast\..+\.(?:CustomAttribute|Mirror\.\d+\.Attribute)$/.test(cell)) {
      valueCells.set(cell, cell.replace(/Attribute$/, 'Value'));
    }
  }
  const optionalFields: string[] = [];
  for (const cell of Object.keys(FIELD_ID_TO_CODE)) {
    const fieldChoices = index.resolveFieldChoices(cell, {});
    if (!fieldChoices?.some(choice => String(choice) === '無關傷害')) continue;
    optionalFields.push(cell);
    choices.set(cell, fieldChoices);
  }
  fields = { fields: optionalFields, choices, circuitChoices, valueCells };
  optionalEffectsByCatalog.set(index, fields);
  return fields;
}

/** Shared by startup, import, history and controls; never replaces valid selections. */
export function normalizeOptionalEffectValues(values: Record<string, string | number>, index: CatalogIndex): boolean {
  let changed = false;
  const set = (cell: string, value: string | number) => {
    if (values[cell] !== value) { values[cell] = value; changed = true; }
  };
  const fields = optionalEffectFields(index);
  for (const cell of fields.fields) {
    const choices = fields.circuitChoices.get(cell) ?? fields.choices.get(cell);
    if (!choices?.some(choice => String(choice) === String(values[cell] ?? ''))) set(cell, '無關傷害');
    const valueCell = fields.valueCells.get(cell);
    if (valueCell && values[cell] === '無關傷害') set(valueCell, 0);
  }
  for (const circuit of index.data.circuits.inputs) {
    if (circuit.slot !== 'gloves') set(circuit.valueCell, normalizeCircuitPercentage(values[circuit.valueCell]));
    else {
      const rows = normalizeGloveCircuitRows(readGloveCircuitRows(values, circuit.attributeCell, circuit.valueCell), circuit.attributeOptions);
      set(GLOVE_CIRCUIT_ROWS_FIELD, serializeGloveCircuitRows(rows));
    }
  }
  return changed;
}

export function isUnrelatedEffectValue(cell: string, values: Readonly<Record<string, string | number>>, index: CatalogIndex): boolean {
  return [...optionalEffectFields(index).valueCells].some(([attribute, valueCell]) => valueCell === cell && values[attribute] === '無關傷害');
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

export interface LoadoutState {
  schemaVersion: 3;
  Job: string;
  values: Record<string, string | number>;
  lowerwearAlternativeEnabled: boolean;
  masterBeastSpiritStoneColor: "黃" | "綠" | "";
  petSkillAttackEnabled: boolean;
  transcendenceSkillDamageSharePct: number;
}
const stateKey = "dab-loadout-v1";
const baselineKey = "dab-baseline-v1";

export function normalizeTranscendenceSkillDamageShare(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value * 100) / 100
    : DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT;
}

/** Preserve saved venue choices when legacy labels are replaced in the catalog. */
export function migrateLegacyEnvironmentSelection(values: Record<string, string | number>): "renamed" | "removed" | null {
  const value = values["Effect.Environment"];
  if (value === "小屋") {
    values["Effect.Environment"] = "小屋/溫泉";
    return "renamed";
  }
  if (value === "其他") {
    delete values["Effect.Environment"];
    return "removed";
  }
  return null;
}

/** Shared migration only; callers retain their own validation and cleared-field policy. */
export function migrateLegacyGloveCircuitSkillDamage(values: Record<string, string | number>, attributeCell: string | undefined): boolean {
  if (!attributeCell || values[attributeCell] !== '超越技傷%') return false;
  values[attributeCell] = '單技傷%';
  return true;
}

type PortraitFields = { legacySettingKey: string; strongSettingKey: string; transcendenceSettingKey: string; maxTotalPct: number };
export function migrateLegacyPortraitAwakening(values: Record<string, string | number>, portrait: PortraitFields): boolean {
  const legacyValue = values[portrait.legacySettingKey];
  if (legacyValue === undefined) return false;
  if (legacyValue === '有' && values[portrait.strongSettingKey] === undefined && values[portrait.transcendenceSettingKey] === undefined) {
    values[portrait.transcendenceSettingKey] = portrait.maxTotalPct;
  }
  delete values[portrait.legacySettingKey];
  return true;
}

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
      if (isResonanceInputCell(key)) {
        const points = parseResonancePoints(key, item);
        if (points !== null) values[key] = points;
        continue;
      }
      values[key] = item;
  }
  const stoneColor = candidate.masterBeastSpiritStoneColor;
  return {
    schemaVersion: 3, Job: candidate.Job, values,
    lowerwearAlternativeEnabled: candidate.lowerwearAlternativeEnabled === true,
    masterBeastSpiritStoneColor: stoneColor === "綠" || stoneColor === "" ? stoneColor : "黃",
    // Missing toggle values preserve the previous always-on behavior.
    petSkillAttackEnabled: candidate.petSkillAttackEnabled !== false,
    transcendenceSkillDamageSharePct: normalizeTranscendenceSkillDamageShare(candidate.transcendenceSkillDamageSharePct),
  };
}
export function readState(defaultClass: string): LoadoutState {
  try { const stored = parseState(localStorage.getItem(stateKey)); if (stored) return stored; } catch { /* Storage is optional. */ }
  return { schemaVersion: 3, Job: defaultClass, values: {}, lowerwearAlternativeEnabled: false, masterBeastSpiritStoneColor: "黃", petSkillAttackEnabled: true, transcendenceSkillDamageSharePct: DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT };
}
export function readBaseline(): LoadoutState | null {
  try { return parseState(localStorage.getItem(baselineKey)); } catch { return null; }
}
export function saveState(state: LoadoutState, baseline = false): boolean {
  try { localStorage.setItem(baseline ? baselineKey : stateKey, JSON.stringify(state)); return true; } catch { return false; }
}
