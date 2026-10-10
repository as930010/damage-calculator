import type { CombatAttribute, PercentEffect } from "./types.ts";

export type CombatRateSourceRule =
  | {
      id: string;
      attributes: readonly CombatAttribute[];
      method: "multiplicative";
      valueSource: { kind: "parameter"; key: string };
      condition?: { selectionKey: string; equals: string };
    }
  | {
      id: string;
      attributes: readonly CombatAttribute[];
      method: "multiplicative";
      valueSource: {
        kind: "enhancementText";
        inputFieldId: string;
        bonusPct: number;
        note?: string;
      };
      condition?: { selectionKey: string; equals: string };
    };

export interface CombatRateSourceRulesDocument {
  schemaVersion: 2;
  sources: readonly CombatRateSourceRule[];
}

export interface ResolvedCombatRateSources {
  critRate: readonly PercentEffect[];
  extremization: readonly PercentEffect[];
}

export interface CombatRateSourceValues {
  parameters: Readonly<Record<string, number>>;
  selections: Readonly<Record<string, string | number | null | undefined>>;
}

function resolveRuleValue(rule: CombatRateSourceRule, values: CombatRateSourceValues): number {
  if (rule.valueSource.kind === "parameter") {
    const value = values.parameters[rule.valueSource.key];
    if (value === undefined || !Number.isFinite(value)) {
      throw new RangeError("Missing finite combat-rate parameter: " + rule.valueSource.key);
    }
    return value;
  }

  const raw = values.selections[rule.valueSource.inputFieldId];
  if (raw == null || String(raw).trim() === "") {
    throw new RangeError("Missing enhancement selection: " + rule.valueSource.inputFieldId);
  }
  const levelText = String(raw).match(/[0-9]+/)?.[0];
  if (levelText === undefined) {
    throw new RangeError("No enhancement level found in " + rule.valueSource.inputFieldId + ": " + raw);
  }
  const level = Number(levelText);
  if (!Number.isSafeInteger(level) || !Number.isFinite(rule.valueSource.bonusPct)) {
    throw new TypeError("Invalid enhancement rate source: " + rule.id);
  }
  return level + rule.valueSource.bonusPct;
}

/** Resolve multiplicative rate sources from JSON and simulator inputs. */
export function resolveCombatRateSources(
  document: CombatRateSourceRulesDocument,
  values: CombatRateSourceValues,
): ResolvedCombatRateSources {
  if (document.schemaVersion !== 2) throw new TypeError("Unsupported combat-rate source rules.");
  const result: Record<CombatAttribute, PercentEffect[]> = { critRate: [], extremization: [] };
  const ids = new Set<string>();
  for (const rule of document.sources) {
    if (!rule.id.trim()) throw new TypeError("Combat-rate source id must not be empty.");
    if (ids.has(rule.id)) throw new TypeError("Duplicate combat-rate source id: " + rule.id);
    ids.add(rule.id);
    if (rule.condition && values.selections[rule.condition.selectionKey] !== rule.condition.equals) continue;
    const valuePct = resolveRuleValue(rule, values);
    if (!Number.isFinite(valuePct)) throw new TypeError(rule.id + " must resolve to a finite percentage.");
    for (const attribute of rule.attributes) {
      result[attribute].push({ id: rule.id, method: rule.method, valuePct });
    }
  }
  return result;
}
