import type {
  CalculationParameters,
  LoadoutOptionDefinition,
  SelectedOption,
} from "./types.ts";

export function resolveLoadoutOption(
  definition: LoadoutOptionDefinition,
  parameters: CalculationParameters,
  selected = definition.defaultSelected,
): SelectedOption {
  const effects: SelectedOption["effects"] = {};

  for (const [key, spec] of Object.entries(definition.effects)) {
    if (spec === undefined) continue;
    if (spec.kind === "fixed") {
      effects[key as keyof typeof effects] = spec.value;
      continue;
    }

    const base = parameters[spec.parameter];
    if (spec.kind === "relative-parameter-increase") {
      if (base === 0) {
        throw new RangeError(`Cannot resolve ${definition.id}: ${spec.parameter} is zero`);
      }
      effects[key as keyof typeof effects] = (base + spec.additiveIncrease) / base - 1;
    } else {
      effects[key as keyof typeof effects] = base * spec.factor;
    }
  }

  if (!selected) {
    for (const key of Object.keys(effects) as Array<keyof typeof effects>) effects[key] = 0;
  }
  return { id: definition.id, effects };
}
