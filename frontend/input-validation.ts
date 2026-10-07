export interface InputValidationReference {
  simulatorCells: string;
  catalogId: string;
}

export interface InputChoiceCatalog<TOption = { value: string | number }> {
  id: string;
  options: readonly TOption[];
}

export function findValidationCatalog<
  TInput extends InputValidationReference,
  TCatalog extends InputChoiceCatalog,
>(inputs: readonly TInput[], catalogs: readonly TCatalog[], fieldId: string): TCatalog | undefined {
  const input = inputs.find(entry => entry.simulatorCells.split(/\s+/).includes(fieldId));
  return input ? catalogs.find(catalog => catalog.id === input.catalogId) : undefined;
}
