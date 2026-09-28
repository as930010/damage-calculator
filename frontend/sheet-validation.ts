export interface SheetInputReference {
  simulatorCells: string;
  catalogId: string;
}

export interface SheetChoiceCatalog<TOption = { value: string | number }> {
  id: string;
  options: readonly TOption[];
}

export function findValidationCatalog<
  TInput extends SheetInputReference,
  TCatalog extends SheetChoiceCatalog,
>(inputs: readonly TInput[], catalogs: readonly TCatalog[], fieldId: string): TCatalog | undefined {
  const input = inputs.find(entry => entry.simulatorCells.split(/\s+/).includes(fieldId));
  return input ? catalogs.find(catalog => catalog.id === input.catalogId) : undefined;
}
