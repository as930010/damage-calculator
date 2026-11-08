export class DefenseRateError extends RangeError {}

/** Rates in this module are fractions: 0.077 means 7.7%. Equipment is summed upstream. */
export function requireDefenseRate(rate: number, label: string): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new DefenseRateError(label + '須介於 0% 與 100%。');
  return rate;
}

export function combineDefenseRates(equipmentRate: number, externalRate = 0, defenseIgnoreAdditive = 0): number {
  requireDefenseRate(equipmentRate, '裝備無視防禦');
  requireDefenseRate(externalRate, '外部綜合破防');
  requireDefenseRate(defenseIgnoreAdditive, '隊伍無視防禦加算');
  const adjustedEquipmentRate = requireDefenseRate(equipmentRate + defenseIgnoreAdditive, '裝備與隊伍加算後無視防禦');
  // Preserve the original floating-point path when no external effects exist.
  return externalRate === 0 ? adjustedEquipmentRate : 1 - (1 - adjustedEquipmentRate) * (1 - externalRate);
}

export function combineExternalSources(rates: readonly number[]): number {
  return 1 - rates.reduce((remaining, rate) => remaining * (1 - requireDefenseRate(rate, '破防來源')), 1);
}

/** Decimal percentages only; retain the raw draft separately from the validated fraction. */
export function parseDefensePercentage(raw: string): number | null {
  if (!/^(?:\d+(?:\.\d{1,8})?|\.\d{1,8})$/.test(raw.trim())) return null;
  const rate = Number(raw) / 100;
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

/** Editing allows blank, a leading dot and a trailing dot, but never other characters or out-of-range rates. */
export function isDefensePercentageDraft(raw: string): boolean {
  return raw === raw.trim() && /^\d*(?:\.\d{0,8})?$/.test(raw) && (raw === '' || raw === '.' || Number(raw) <= 100);
}
