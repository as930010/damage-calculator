/** Allowed point totals for the five resonance inputs shown by the calculator. */
export const RESONANCE_INPUT_MAX_POINTS: Readonly<Record<string, number>> = Object.freeze({
  "Resonance.AllATK.Points": 999,
  "Resonance.TranscendenceSkillDMG.Points": 100,
  "Resonance.Polarization.Points": 50,
  "Resonance.BossDMG.Points": 50,
  "Resonance.Adapt.Points": 100,
});

export function isResonanceInputCell(inputCell: string): boolean {
  return Object.hasOwn(RESONANCE_INPUT_MAX_POINTS, inputCell);
}

/** Return an integer point value, or null when the value is absent or invalid. */
export function parseResonancePoints(inputCell: string, rawValue: unknown): number | null {
  const maximum = RESONANCE_INPUT_MAX_POINTS[inputCell];
  if (maximum === undefined || rawValue === undefined || rawValue === null || rawValue === "") return null;

  const value = typeof rawValue === "number"
    ? rawValue
    : typeof rawValue === "string" && /^\d+$/.test(rawValue.trim())
      ? Number(rawValue.trim())
      : Number.NaN;
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}
