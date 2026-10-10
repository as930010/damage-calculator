import type { ClassDamagePassivesDocument, StatContribution } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumberMap(value: unknown, field: string): Record<string, number> {
  if (!isRecord(value)) {
    throw new TypeError(field + " must be an object.");
  }
  const parsed: Record<string, number> = {};
  for (const [classId, valuePct] of Object.entries(value)) {
    if (!classId.trim() || typeof valuePct !== "number" || !Number.isFinite(valuePct)) {
      throw new TypeError("Class " + classId + " must have a finite " + field + " value.");
    }
    parsed[classId] = valuePct;
  }
  return parsed;
}

export function parseClassDamagePassives(value: unknown): ClassDamagePassivesDocument {
  if (!isRecord(value) || value.schemaVersion !== 2) {
    throw new TypeError("Unsupported class damage passives document.");
  }

  const critDamagePctByClass = finiteNumberMap(value.critDamagePctByClass, "critDamagePctByClass");
  const bossDamagePctByClass = finiteNumberMap(value.bossDamagePctByClass, "bossDamagePctByClass");
  if (!isRecord(value.multiplicativeCritDamagePctByClass)) {
    throw new TypeError("multiplicativeCritDamagePctByClass must be an object.");
  }
  const multiplicativeCritDamagePctByClass: Record<string, readonly number[]> = {};
  for (const [classId, effects] of Object.entries(value.multiplicativeCritDamagePctByClass)) {
    if (!classId.trim() || !Array.isArray(effects) ||
      effects.some(valuePct => typeof valuePct !== "number" || !Number.isFinite(valuePct))) {
      throw new TypeError(
        "Class " + classId + " must have a list of finite multiplicative critical damage passive values.",
      );
    }
    multiplicativeCritDamagePctByClass[classId] = [...effects];
  }

  return {
    schemaVersion: 2,
    critDamagePctByClass,
    bossDamagePctByClass,
    multiplicativeCritDamagePctByClass,
  };
}

/** Missing values remain unconfigured instead of being silently treated as zero. */
export function resolveClassCritDamagePassivePct(
  document: ClassDamagePassivesDocument,
  classId: string,
): number {
  const valuePct = document.critDamagePctByClass[classId];
  if (valuePct === undefined) {
    throw new Error("Critical damage passive for class " + classId + " is not configured.");
  }
  return valuePct;
}

/** Convert class passive sources into the same additive and product channels as other stat sources. */
export function resolveClassDamagePassiveContributions(
  document: ClassDamagePassivesDocument,
  classId: string,
): StatContribution[] {
  const bossDamagePct = document.bossDamagePctByClass[classId];
  const multiplicativeCritDamagePct = document.multiplicativeCritDamagePctByClass[classId];
  if (bossDamagePct === undefined || multiplicativeCritDamagePct === undefined) {
    throw new Error("Damage passive sources for class " + classId + " are not configured.");
  }

  const contributions: StatContribution[] = [];
  if (bossDamagePct !== 0) {
    contributions.push({
      sourceId: "class-passive:" + classId + ":boss-damage",
      stats: { bossDamagePct },
    });
  }
  multiplicativeCritDamagePct.forEach((valuePct, index) => {
    if (valuePct !== 0) {
      contributions.push({
        sourceId: "class-passive:" + classId + ":multiplicative-crit-damage:" + (index + 1),
        stats: { multiplicativeCritDamagePct: valuePct },
      });
    }
  });
  return contributions;
}
