import type { StatContribution } from "./types.ts";

export interface WeaponTransformationRule {
  choice: string;
  statKey: string;
  valueMultiplier: number;
  scaleByEnhancement?: boolean;
}

export interface WeaponTransformationDocument {
  schemaVersion: 2;
  rules: readonly WeaponTransformationRule[];
  enhancementField: string;
  slots: readonly { choiceField: string; valueField: string }[];
}

export interface WeaponTransformationInput {
  sourceId: string;
  choice: string | null | undefined;
  value: number | null | undefined;
  /** Weapon enhancement selection used by level-scaled transformations. */
  enhancementText?: string | null;
}

/** Resolve all four transformations through the configured field mapping. */
export function resolveWeaponTransformationsFromFields(
  document: WeaponTransformationDocument,
  values: Readonly<Record<string, string | number | null | undefined>>,
): StatContribution[] {
  return document.slots.flatMap((slot) => {
    const choice = values[slot.choiceField];
    const value = values[slot.valueField];
    const result = resolveWeaponTransformation(document, {
      sourceId: `weapon-transform:${slot.choiceField}`,
      choice: choice == null ? null : String(choice),
      value: value == null || value === "" ? null : Number(value),
      enhancementText: String(values[document.enhancementField] ?? ""),
    });
    return result ? [result] : [];
  });
}

/** Resolve a user-entered weapon transformation using the imported JSON rules. */
export function resolveWeaponTransformation(
  document: WeaponTransformationDocument,
  input: WeaponTransformationInput,
): StatContribution | null {
  if (input.choice == null || input.choice.trim() === "") return null;
  if (!input.sourceId.trim()) throw new TypeError("sourceId must not be empty.");

  const rule = document.rules.find((candidate) => candidate.choice === input.choice);
  if (!rule) throw new RangeError(`Unsupported weapon transformation: ${input.choice}`);
  if (input.value == null || !Number.isFinite(input.value)) {
    throw new TypeError(`${input.choice} requires a finite entered value.`);
  }
  if (!Number.isFinite(rule.valueMultiplier)) {
    throw new TypeError(`${input.choice} has an invalid value multiplier.`);
  }

  let factor = 1;
  if (rule.scaleByEnhancement) {
    const firstInteger = input.enhancementText?.match(/[0-9]+/)?.[0];
    // Missing enhancement digits preserve the existing zero scaling behavior.
    factor = firstInteger === undefined ? 0 : Number(firstInteger);
  }

  return {
    sourceId: input.sourceId,
    stats: { [rule.statKey]: input.value * rule.valueMultiplier * factor },
  };
}
