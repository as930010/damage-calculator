import { calculateLoadout } from "./loadout-engine.ts";
import type { LoadoutCalculationInput, LoadoutCalculationResult } from "./loadout-engine.ts";
import { resolveSupplementalSimulatorSources } from "./simulator-sources.ts";
import type {
  SimulatorSourceDocuments,
  SimulatorSourceSelections,
} from "./simulator-sources.ts";

export interface SimulatorCalculationInput
  extends Omit<LoadoutCalculationInput, "sources" | "classId" | "attackType"> {
  sourceDocuments: SimulatorSourceDocuments;
  sourceSelections: SimulatorSourceSelections;
}

export interface SimulatorCalculationResult extends LoadoutCalculationResult {
  diagnostics: {
    unmappedCircuitBoardSlots: readonly string[];
  };
}

/** Resolve JSON-backed selections, then run the standalone calculation engine. */
export function calculateSimulatorLoadout(
  input: SimulatorCalculationInput,
): SimulatorCalculationResult {
  const { sourceDocuments, sourceSelections, ...calculationInput } = input;
  const resolved = resolveSupplementalSimulatorSources(sourceDocuments, sourceSelections);
  const result = calculateLoadout({
    ...calculationInput,
    classId: sourceSelections.classId,
    attackType: sourceSelections.attackType,
    sources: resolved.groups,
  });
  return { ...result, diagnostics: { unmappedCircuitBoardSlots: resolved.unmappedCircuitBoardSlots } };
}
