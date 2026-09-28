import type { StatContribution } from "./types.ts";

export interface WeaponTransformationRule {
  choice: string;
  statKey: string;
  valueMultiplier: number;
  strengthenByFirstIntegerFrom?: "correspondingEnhancementText";
}

export interface WeaponTransformationDocument {
  schemaVersion: 1;
  rules: readonly WeaponTransformationRule[];
  slots: readonly { choiceCell: string; valueCell: string; scalingTextCell: string }[];
}

export interface WeaponTransformationInput {
  sourceId: string;
  choice: string | null | undefined;
  value: number | null | undefined;
  /** Shared weapon enhancement text from 裝備模擬區!B32. */
  scalingText?: string | null;
}

/** Resolve all four transformations through the JSON cell mapping. */
export function resolveWeaponTransformationsFromCells(
  document: WeaponTransformationDocument,
  values: Readonly<Record<string, string | number | null | undefined>>,
): StatContribution[] {
  return document.slots.flatMap((slot) => {
    const choice = values[slot.choiceCell];
    const value = values[slot.valueCell];
    const result = resolveWeaponTransformation(document, {
      sourceId: `weapon-transform:${slot.choiceCell}`,
      choice: choice == null ? null : String(choice),
      value: value == null || value === "" ? null : Number(value),
      scalingText: String(values[slot.scalingTextCell] ?? ""),
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
  if (rule.strengthenByFirstIntegerFrom) {
    const firstInteger = input.scalingText?.match(/[0-9]+/)?.[0];
    // Mirrors IFERROR(VALUE(REGEXEXTRACT(text, "[0-9]+")), 0) in Sheets.
    factor = firstInteger === undefined ? 0 : Number(firstInteger);
  }

  return {
    sourceId: input.sourceId,
    stats: { [rule.statKey]: input.value * rule.valueMultiplier * factor },
  };
}
