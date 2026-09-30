import type { ControlTimeParameters, ControlTimeResult } from "./types.ts";

/** Mirrors the workbook's resistance-to-control-duration estimate, with its 15-second cap. */
export function calculateControlTimes(
  resistanceReduction: number,
  parameters: ControlTimeParameters,
): ControlTimeResult[] {
  if (!Number.isFinite(resistanceReduction) || resistanceReduction < 0) {
    throw new RangeError("resistanceReduction must be a finite non-negative number");
  }
  if (!(parameters.capSeconds > 0) || !(parameters.secondsPerResistancePoint >= 0)) {
    throw new RangeError("Control-time parameters must be non-negative and have a positive cap");
  }
  return parameters.categories.map((category) => {
    if (!Number.isFinite(category.coefficient) || category.coefficient < 0) {
      throw new RangeError(`Invalid control-time coefficient for ${category.id}`);
    }
    return {
      categoryId: category.id,
      label: category.label,
      coefficient: category.coefficient,
      seconds: Math.min(
        parameters.capSeconds,
        resistanceReduction * parameters.secondsPerResistancePoint * category.coefficient,
      ),
    };
  });
}
