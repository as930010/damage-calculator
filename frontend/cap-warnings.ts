/** Percentage points above an upper cap, or null when the value is within it. */
export function capOverflowPercentage(totalPct: number, capPct: number): number | null {
  if (!Number.isFinite(totalPct) || !Number.isFinite(capPct)) {
    throw new TypeError("Cap values must be finite percentages.");
  }
  return totalPct > capPct ? totalPct - capPct : null;
}
