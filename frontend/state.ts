import { isFieldId } from "./field-ids.ts";
import { isResonanceInputCell, parseResonancePoints } from "../calculation/resonance-input.ts";

export const DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT = 100;

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
