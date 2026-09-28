export interface LoadoutState {
  schemaVersion: 2;
  classId: string;
  values: Record<string, string | number>;
  lowerwearAlternativeEnabled: boolean;
  masterBeastSpiritStoneColor: "黃" | "綠" | "";
  petSkillAttackEnabled: boolean;
}
const stateKey = "dab-loadout-v1";
const baselineKey = "dab-baseline-v1";
function parseState(raw: string | null): LoadoutState | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("classId" in value) || typeof value.classId !== "string") return null;
  const candidate = value as Record<string, unknown>;
  const entries = candidate.values ?? candidate.selectedItems;
  const values: Record<string, string | number> = {};
  if (entries && typeof entries === "object") for (const [key, item] of Object.entries(entries)) {
    if (typeof item === "string" || typeof item === "number" && Number.isFinite(item)) values[key] = item;
  }
  const stoneColor = candidate.masterBeastSpiritStoneColor;
  return {
    schemaVersion: 2, classId: value.classId, values,
    lowerwearAlternativeEnabled: candidate.lowerwearAlternativeEnabled === true,
    masterBeastSpiritStoneColor: stoneColor === "綠" || stoneColor === "" ? stoneColor : "黃",
    // Older saved configurations predate this toggle; preserve their former always-on result.
    petSkillAttackEnabled: candidate.petSkillAttackEnabled !== false,
  };
}
export function readState(defaultClass: string): LoadoutState {
  try { const stored = parseState(localStorage.getItem(stateKey)); if (stored) return stored; } catch { /* Storage is optional. */ }
  return { schemaVersion: 2, classId: defaultClass, values: {}, lowerwearAlternativeEnabled: false, masterBeastSpiritStoneColor: "黃", petSkillAttackEnabled: true };
}
export function readBaseline(): LoadoutState | null {
  try { return parseState(localStorage.getItem(baselineKey)); } catch { return null; }
}
export function saveState(state: LoadoutState, baseline = false): boolean {
  try { localStorage.setItem(baseline ? baselineKey : stateKey, JSON.stringify(state)); return true; } catch { return false; }
}
