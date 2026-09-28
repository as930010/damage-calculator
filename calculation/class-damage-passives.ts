import type { ClassDamagePassivesDocument } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseClassDamagePassives(value: unknown): ClassDamagePassivesDocument {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError("Unsupported class damage passives document.");
  }
  if (typeof value.source !== "string" || value.source.trim() === "") {
    throw new TypeError("Class damage passive source must be a non-empty string.");
  }
  if (!isRecord(value.critDamagePctByClass)) {
    throw new TypeError("critDamagePctByClass must be an object.");
  }
  const critDamagePctByClass: Record<string, number> = {};
  for (const [classId, valuePct] of Object.entries(value.critDamagePctByClass)) {
    if (!classId.trim() || typeof valuePct !== "number" || !Number.isFinite(valuePct)) {
      throw new TypeError(`Class ${classId} must have a finite critical damage passive value.`);
    }
    critDamagePctByClass[classId] = valuePct;
  }
  return { schemaVersion: 1, source: value.source, critDamagePctByClass };
}

/** Missing values remain unconfigured instead of being silently treated as zero. */
export function resolveClassCritDamagePassivePct(
  document: ClassDamagePassivesDocument,
  classId: string,
): number {
  const valuePct = document.critDamagePctByClass[classId];
  if (valuePct === undefined) {
    throw new Error(`Critical damage passive for class ${classId} is not configured.`);
  }
  return valuePct;
}
