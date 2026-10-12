import { canonicalizeNumber } from './numeric-input.ts';

export interface CircuitBoardRow {
  attribute: string;
  /** Percentage stored as a decimal ratio, matching the other state values. */
  percentageValue: number | null;
}

export const GLOVE_CIRCUIT_ROWS_FIELD = "Left.Armor.Gloves.Circuit.Rows";

/** Values are decimal ratios; each board has an independent 18% budget. */
export function normalizeCircuitPercentage(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.min(0.18, Math.max(0, parsed)) : 0;
}

export function normalizeGloveCircuitRows(rows: readonly CircuitBoardRow[], options: readonly string[], preferredIndex?: number): CircuitBoardRow[] {
  const normalized = rows.map(row => {
    const attribute = options.includes(row.attribute) ? row.attribute : '無關傷害';
    return { attribute, percentageValue: attribute === '無關傷害' ? 0 : normalizeCircuitPercentage(row.percentageValue) };
  });
  // Without an edit record, earlier rows retain their values first.
  const order = normalized.map((_, index) => index);
  if (preferredIndex !== undefined && order.includes(preferredIndex)) {
    order.splice(order.indexOf(preferredIndex), 1); order.unshift(preferredIndex);
  }
  let remaining = 0.18;
  for (const index of order) {
    normalized[index].percentageValue = Math.min(normalized[index].percentageValue, remaining);
    remaining = Math.max(0, canonicalizeNumber(remaining - normalized[index].percentageValue));
  }
  return normalized;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Read the new repeatable rows, or migrate the original single gloves circuit values in memory. */
export function readGloveCircuitRows(
  values: Readonly<Record<string, string | number>>,
  legacyAttributeCell: string,
  legacyValueCell: string,
): CircuitBoardRow[] {
  const savedRows = values[GLOVE_CIRCUIT_ROWS_FIELD];
  if (savedRows != null && savedRows !== "") {
    if (typeof savedRows !== "string") throw new TypeError("手套電路板列資料格式無效。");
    let parsed: unknown;
    try { parsed = JSON.parse(savedRows) as unknown; }
    catch { throw new TypeError("手套電路板列資料無法讀取。"); }
    if (!Array.isArray(parsed) || parsed.length < 1) {
      throw new TypeError("手套電路板至少需要一列。");
    }
    return parsed.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new TypeError("手套電路板第 " + (index + 1) + " 列資料無效。");
      }
      const percentageValue = entry.percentageValue;
      return { attribute: typeof entry.attribute === 'string' ? entry.attribute : '', percentageValue: percentageValue === null ? null : normalizeCircuitPercentage(percentageValue) };
    });
  }

  const attribute = String(values[legacyAttributeCell] ?? "");
  const rawValue = values[legacyValueCell];
  const percentageValue = rawValue === undefined || rawValue === "" ? null : normalizeCircuitPercentage(rawValue);
  if (!attribute && percentageValue === null) return [{ attribute: "", percentageValue: null }];
  return [{ attribute, percentageValue }];
}

export function serializeGloveCircuitRows(rows: readonly CircuitBoardRow[]): string {
  if (rows.length < 1) throw new RangeError("手套電路板至少需要一列。");
  return JSON.stringify(rows);
}

export function gloveCircuitRowsTotal(rows: readonly CircuitBoardRow[]): number {
  return rows.reduce((total, row) => total + (row.percentageValue ?? 0), 0);
}

export function validateGloveCircuitRows(rows: readonly CircuitBoardRow[]): void {
  if (rows.length < 1) throw new RangeError("手套電路板至少需要一列。");
  let total = 0;
  for (const [index, row] of rows.entries()) {
    const hasAttribute = row.attribute.trim() !== "";
    const hasValue = row.percentageValue !== null;
    if (hasAttribute !== hasValue) {
      throw new RangeError("請填完整手套電路板第 " + (index + 1) + " 列的項目與數值。");
    }
    if (!hasValue) continue;
    if (!Number.isFinite(row.percentageValue) || row.percentageValue! < 0) {
      throw new RangeError("手套電路板第 " + (index + 1) + " 列數值不得小於 0。");
    }
    total += row.percentageValue!;
  }
  if (total > 0.18 + 1e-12) {
    throw new RangeError("手套電路板各列總和不可超過 18.0%。");
  }
}
