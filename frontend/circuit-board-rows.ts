export interface CircuitBoardRow {
  attribute: string;
  /** Percentage stored as a decimal ratio, matching the other state values. */
  percentageValue: number | null;
}

export const GLOVE_CIRCUIT_ROWS_FIELD = "Left.Armor.Gloves.Circuit.Rows";

export function circuitBoardRowsField(attributeField: string): string {
  return attributeField.replace(/\.Attribute$/, ".Rows");
}

/** Values are decimal ratios; each board has an independent 18% budget. */
export function normalizeCircuitPercentage(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(parsed) ? Math.min(0.18, Math.max(0, parsed)) : 0;
}

// Round at percentage precision so subtracting decimal budgets (18 - 17) does not
// leave a binary floating-point tail such as 0.999999999999998 in the next row.
function canonicalizeCircuitRatio(value: number): number {
  return Number(value.toPrecision(12));
}

export function normalizeCircuitBoardRows(
  rows: readonly CircuitBoardRow[],
  options: readonly string[],
  preferredIndex?: number,
): CircuitBoardRow[] {
  const normalized = rows.slice(0, options.length).map(row => {
    const attribute = options.includes(row.attribute) ? row.attribute : '無關傷害';
    return {
      attribute,
      percentageValue: attribute === '無關傷害'
        ? 0
        : canonicalizeCircuitRatio(normalizeCircuitPercentage(row.percentageValue)),
    };
  });
  if (!normalized.length) normalized.push({ attribute: '無關傷害', percentageValue: 0 });

  // Without an edit record, earlier rows retain their values first.
  const order = normalized.map((_, index) => index);
  if (preferredIndex !== undefined && order.includes(preferredIndex)) {
    order.splice(order.indexOf(preferredIndex), 1);
    order.unshift(preferredIndex);
  }
  let remaining = 0.18;
  for (const index of order) {
    normalized[index].percentageValue = canonicalizeCircuitRatio(
      Math.min(normalized[index].percentageValue ?? 0, remaining),
    );
    remaining = Math.max(0, canonicalizeCircuitRatio(remaining - normalized[index].percentageValue));
  }
  return normalized;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Read repeatable rows, or migrate the original single attribute/value pair in memory. */
export function readCircuitBoardRows(
  values: Readonly<Record<string, string | number>>,
  legacyAttributeField: string,
  legacyValueField: string,
): CircuitBoardRow[] {
  const savedRows = values[circuitBoardRowsField(legacyAttributeField)];
  if (savedRows != null && savedRows !== "") {
    if (typeof savedRows !== "string") throw new TypeError("電路板列資料格式無效。");
    let parsed: unknown;
    try { parsed = JSON.parse(savedRows) as unknown; }
    catch { throw new TypeError("電路板列資料無法讀取。"); }
    if (!Array.isArray(parsed) || parsed.length < 1) {
      throw new TypeError("電路板至少需要一列。");
    }
    return parsed.map((entry, index) => {
      if (!isRecord(entry)) throw new TypeError("電路板第 " + (index + 1) + " 列資料無效。");
      const percentageValue = entry.percentageValue;
      return {
        attribute: typeof entry.attribute === 'string' ? entry.attribute : '',
        percentageValue: percentageValue === null ? null : normalizeCircuitPercentage(percentageValue),
      };
    });
  }

  const attribute = String(values[legacyAttributeField] ?? "");
  const rawValue = values[legacyValueField];
  const percentageValue = rawValue === undefined || rawValue === "" ? null : normalizeCircuitPercentage(rawValue);
  if (!attribute && percentageValue === null) return [{ attribute: "", percentageValue: null }];
  return [{ attribute, percentageValue }];
}

export function serializeCircuitBoardRows(rows: readonly CircuitBoardRow[]): string {
  if (rows.length < 1) throw new RangeError("電路板至少需要一列。");
  return JSON.stringify(rows);
}

export function circuitBoardRowsTotal(rows: readonly CircuitBoardRow[]): number {
  return rows.reduce((total, row) => total + (row.percentageValue ?? 0), 0);
}

export function validateCircuitBoardRows(rows: readonly CircuitBoardRow[], options: readonly string[], slotName = '電路板'): void {
  if (rows.length < 1) throw new RangeError(slotName + "至少需要一列。");
  if (rows.length > options.length) throw new RangeError(slotName + "列數不可超過可選項目數量。");
  let total = 0;
  for (const [index, row] of rows.entries()) {
    const hasAttribute = row.attribute.trim() !== "";
    const hasValue = row.percentageValue !== null;
    if (hasAttribute !== hasValue) {
      throw new RangeError("請填完整" + slotName + "第 " + (index + 1) + " 列的項目與數值。");
    }
    if (!hasValue) continue;
    if (!options.includes(row.attribute)) throw new RangeError(slotName + "第 " + (index + 1) + " 列項目無效。");
    if (!Number.isFinite(row.percentageValue) || row.percentageValue! < 0) {
      throw new RangeError(slotName + "第 " + (index + 1) + " 列數值不得小於 0。");
    }
    total += row.percentageValue!;
  }
  if (total > 0.18 + 1e-12) throw new RangeError(slotName + "各列總和不可超過 18.0%。");
}

// Backwards-compatible names retained for callers and existing fixtures.
export function normalizeGloveCircuitRows(rows: readonly CircuitBoardRow[], options: readonly string[], preferredIndex?: number): CircuitBoardRow[] {
  return normalizeCircuitBoardRows(rows, options, preferredIndex);
}
export function readGloveCircuitRows(values: Readonly<Record<string, string | number>>, legacyAttributeField: string, legacyValueField: string): CircuitBoardRow[] {
  return readCircuitBoardRows(values, legacyAttributeField, legacyValueField);
}
export function serializeGloveCircuitRows(rows: readonly CircuitBoardRow[]): string {
  return serializeCircuitBoardRows(rows);
}
export function gloveCircuitRowsTotal(rows: readonly CircuitBoardRow[]): number {
  return circuitBoardRowsTotal(rows);
}
export function validateGloveCircuitRows(rows: readonly CircuitBoardRow[], options: readonly string[] = ['單技傷%', 'Boss傷害%', '無關傷害']): void {
  validateCircuitBoardRows(rows, options, '手套電路板');
}
