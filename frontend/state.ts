import { fieldIdForCell, isFieldId } from "./field-ids.ts";

export interface LoadoutState {
  schemaVersion: 3;
  Job: string;
  values: Record<string, string | number>;
  lowerwearAlternativeEnabled: boolean;
  masterBeastSpiritStoneColor: "黃" | "綠" | "";
  petSkillAttackEnabled: boolean;
}
const stateKey = "dab-loadout-v1";
const baselineKey = "dab-baseline-v1";

/** Store semantic IDs while allowing existing UI/calculation code to read or write by input cell during migration. */
export function createFieldValues(entries: Record<string, string | number>): Record<string, string | number> {
  const canonical: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(entries)) {
    const fieldId = isFieldId(key) ? key : fieldIdForCell(key) ?? key;
    canonical[fieldId] = value;
  }
  return new Proxy(canonical, {
    get(target, property, receiver) {
      if (typeof property === "string") return Reflect.get(target, fieldIdForCell(property) ?? property);
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (typeof property === "string") return Reflect.set(target, fieldIdForCell(property) ?? property, value);
      return Reflect.set(target, property, value, receiver);
    },
    deleteProperty(target, property) {
      if (typeof property === "string") return Reflect.deleteProperty(target, fieldIdForCell(property) ?? property);
      return Reflect.deleteProperty(target, property);
    },
  });
}

function parseState(raw: string | null): LoadoutState | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const job = typeof candidate.Job === "string" ? candidate.Job : candidate.classId;
  if (typeof job !== "string") return null;
  const entries = candidate.values ?? candidate.selectedItems;
  const values: Record<string, string | number> = {};
  if (entries && typeof entries === "object") for (const [key, item] of Object.entries(entries)) {
    if (typeof item === "string" || typeof item === "number" && Number.isFinite(item)) values[key] = item;
  }
  const stoneColor = candidate.masterBeastSpiritStoneColor;
  return {
    schemaVersion: 3, Job: job, values: createFieldValues(values),
    lowerwearAlternativeEnabled: candidate.lowerwearAlternativeEnabled === true,
    masterBeastSpiritStoneColor: stoneColor === "綠" || stoneColor === "" ? stoneColor : "黃",
    // Older saved configurations predate this toggle; preserve their former always-on result.
    petSkillAttackEnabled: candidate.petSkillAttackEnabled !== false,
  };
}
export function readState(defaultClass: string): LoadoutState {
  try { const stored = parseState(localStorage.getItem(stateKey)); if (stored) return stored; } catch { /* Storage is optional. */ }
  return { schemaVersion: 3, Job: defaultClass, values: createFieldValues({}), lowerwearAlternativeEnabled: false, masterBeastSpiritStoneColor: "黃", petSkillAttackEnabled: true };
}
export function readBaseline(): LoadoutState | null {
  try { return parseState(localStorage.getItem(baselineKey)); } catch { return null; }
}
export function saveState(state: LoadoutState, baseline = false): boolean {
  try { localStorage.setItem(baseline ? baselineKey : stateKey, JSON.stringify(state)); return true; } catch { return false; }
}
