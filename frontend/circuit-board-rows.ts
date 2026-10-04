export interface CircuitBoardRow {
  attribute: string;
  /** Percentage stored as a decimal ratio, matching the other state values. */
  percentageValue: number | null;
}

export const GLOVE_CIRCUIT_ROWS_FIELD = "Left.Armor.Gloves.Circuit.Rows";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Read the new repeatable rows, or migrate the original single gloves circuit values in memory. */
export function readGloveCircuitRows(
  values: Readonly<Record<string, string | number>>,
  legacyAttributeCell: string,
  legacyValueCell: string,
): CircuitBoardRow[] {
  const savedRows = values[GLOVE_CIRCUIT_ROWS_FIELD];
  if (savedRows !== undefined && savedRows !== "") {
    if (typeof savedRows !== "string") throw new TypeError("手套電路板列資料格式無效。");
    let parsed: unknown;
    try { parsed = JSON.parse(savedRows) as unknown; }
    catch { throw new TypeError("手套電路板列資料無法讀取。"); }
    if (!Array.isArray(parsed) || parsed.length < 1) {
      throw new TypeError("手套電路板至少需要一列。");
    }
    return parsed.map((entry, index) => {
      if (!isRecord(entry) || typeof entry.attribute !== "string") {
        throw new TypeError("手套電路板第 " + (index + 1) + " 列資料無效。");
      }
      const percentageValue = entry.percentageValue;
      if (percentageValue !== null && (typeof percentageValue !== "number" || !Number.isFinite(percentageValue))) {
        throw new TypeError("手套電路板第 " + (index + 1) + " 列數值無效。");
      }
      return { attribute: entry.attribute, percentageValue };
    });
  }

  const attribute = String(values[legacyAttributeCell] ?? "");
  const rawValue = values[legacyValueCell];
  const percentageValue = rawValue === undefined || rawValue === "" ? null : Number(rawValue);
  if (percentageValue !== null && !Number.isFinite(percentageValue)) {
    throw new TypeError("手套電路板數值無效。");
  }
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