import type { ProductStatEffect, ProductStatResult } from "./types.ts";

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

/**
 * Mirrors the spreadsheet product columns: PRODUCT(1 + sourcePct / 100),
 * optionally followed by subtracting a percentage-point baseline as a ratio.
 * For example, T1 uses baselinePctToSubtract=150.
 */
export function calculateProductStat(
  effects: readonly ProductStatEffect[],
  baselinePctToSubtract = 0,
): ProductStatResult {
  requireFinite(baselinePctToSubtract, "baselinePctToSubtract");
  const seen = new Set<string>();
  const factors = effects.map(({ sourceId, valuePct }) => {
    if (!sourceId.trim()) {
      throw new TypeError("Product effect sourceId must be non-empty.");
    }
    if (seen.has(sourceId)) {
      throw new TypeError(`Duplicate product effect sourceId ${sourceId}.`);
    }
    seen.add(sourceId);
    requireFinite(valuePct, `${sourceId}.valuePct`);
    return { sourceId, valuePct, factor: 1 + valuePct / 100 };
  });

  const productBeforeBaseline = factors.reduce(
    (product, effect) => product * effect.factor,
    1,
  );
  const value = productBeforeBaseline - baselinePctToSubtract / 100;
  requireFinite(value, "productStat.value");
  return { factors, productBeforeBaseline, baselinePct: baselinePctToSubtract, value };
}
