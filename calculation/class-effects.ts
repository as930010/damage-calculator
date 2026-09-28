import type {
  CalculationMethod,
  ClassCombatEffectProfile,
  ClassCombatEffectsDocument,
  CombatAttribute,
  PercentEffect,
  ResolvedPercentEffect,
} from "./types.ts";

const METHODS = new Set<CalculationMethod>([
  "diminishing",
  "multiplicative",
  "nonDiminishing",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEffectList(value: unknown, context: string): PercentEffect[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array.`);
  }

  const seenIds = new Set<string>();
  return value.map((entry, index) => {
    const itemContext = `${context}[${index}]`;
    if (!isRecord(entry)) {
      throw new TypeError(`${itemContext} must be an object.`);
    }

    const { id, method, valuePct } = entry;
    if (typeof id !== "string" || id.trim() === "") {
      throw new TypeError(`${itemContext}.id must be a non-empty string.`);
    }
    if (seenIds.has(id)) {
      throw new TypeError(`${itemContext}.id duplicates ${id} in the same list.`);
    }
    seenIds.add(id);

    if (typeof method !== "string" || !METHODS.has(method as CalculationMethod)) {
      throw new TypeError(`${itemContext}.method is not a supported calculation method.`);
    }
    if (typeof valuePct !== "number" || !Number.isFinite(valuePct)) {
      throw new TypeError(`${itemContext}.valuePct must be a finite number.`);
    }

    return { id, method: method as CalculationMethod, valuePct };
  });
}

function parseProfile(value: unknown, context: string): ClassCombatEffectProfile {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object.`);
  }

  return {
    critRate: parseEffectList(value.critRate, `${context}.critRate`),
    extremization: parseEffectList(value.extremization, `${context}.extremization`),
  };
}

/** Parse and validate the static class effect JSON before calculation begins. */
export function parseClassCombatEffects(value: unknown): ClassCombatEffectsDocument {
  if (!isRecord(value)) {
    throw new TypeError("Class combat effects document must be an object.");
  }
  if (value.schemaVersion !== 1) {
    throw new TypeError("Unsupported class combat effects schemaVersion.");
  }
  if (typeof value.source !== "string" || value.source.trim() === "") {
    throw new TypeError("Class combat effects source must be a non-empty string.");
  }
  if (!isRecord(value.methods)) {
    throw new TypeError("Class combat effects methods must be an object.");
  }
  const methods = {} as Record<CalculationMethod, string>;
  for (const method of METHODS) {
    const label = value.methods[method];
    if (typeof label !== "string" || label.trim() === "") {
      throw new TypeError(`methods.${method} must be a non-empty display label.`);
    }
    methods[method] = label;
  }
  if (!isRecord(value.classes)) {
    throw new TypeError("Class combat effects classes must be an object.");
  }

  const classes: Record<string, ClassCombatEffectProfile> = {};
  for (const [classId, profile] of Object.entries(value.classes)) {
    if (classId.trim() === "") {
      throw new TypeError("Class ID must be a non-empty string.");
    }
    classes[classId] = parseProfile(profile, `classes.${classId}`);
  }

  let classCodeAliases: Record<string, string> | undefined;
  if (value.classCodeAliases !== undefined) {
    if (!isRecord(value.classCodeAliases)) {
      throw new TypeError("classCodeAliases must be an object when provided.");
    }
    classCodeAliases = {};
    for (const [alias, target] of Object.entries(value.classCodeAliases)) {
      if (alias.trim() === "" || typeof target !== "string" || target.trim() === "") {
        throw new TypeError("Class code aliases must map non-empty strings to non-empty strings.");
      }
      classCodeAliases[alias] = target;
    }
  }

  const document: ClassCombatEffectsDocument = {
    schemaVersion: 1,
    source: value.source,
    methods,
    ...(classCodeAliases ? { classCodeAliases } : {}),
    classes,
  };
  for (const alias of Object.keys(classCodeAliases ?? {})) {
    resolveClassId(document, alias);
  }
  return document;
}

/** Resolve known abbreviations without guessing unknown class codes. */
export function resolveClassId(
  document: ClassCombatEffectsDocument,
  requestedClassId: string,
): string {
  const visited = new Set<string>();
  let current = requestedClassId;

  while (document.classCodeAliases?.[current]) {
    if (visited.has(current)) {
      throw new Error(`Class code alias cycle detected at ${current}.`);
    }
    visited.add(current);
    current = document.classCodeAliases[current];
  }

  if (!document.classes[current]) {
    throw new Error(`No combat effect profile is configured for class ${requestedClassId}.`);
  }
  return current;
}

/**
 * Return class effects with composite source IDs. Effects sharing a method are
 * intentionally kept as separate entries so each passive remains traceable.
 */
export function getClassEffects(
  document: ClassCombatEffectsDocument,
  requestedClassId: string,
  attribute: CombatAttribute,
): readonly ResolvedPercentEffect[] {
  const classId = resolveClassId(document, requestedClassId);
  return document.classes[classId][attribute].map((effect) => ({
    ...effect,
    sourceId: `${classId}:${attribute}:${effect.id}`,
  }));
}
