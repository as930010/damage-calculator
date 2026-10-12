export interface InputValidationReference {
  fieldIds: readonly string[];
  catalogId: string;
}

export interface InputChoiceCatalog<TOption = { value: string | number }> {
  id: string;
  options: readonly TOption[];
}

/** Preserve the original first-input / first-catalog match, including missing catalogs. */
export function createValidationCatalogIndex<TInput extends InputValidationReference, TCatalog extends InputChoiceCatalog>(
  inputs: readonly TInput[], catalogs: readonly TCatalog[],
) {
  const byId = new Map<string, TCatalog>();
  for (const catalog of catalogs) if (!byId.has(catalog.id)) byId.set(catalog.id, catalog);
  const byField = new Map<string, TCatalog | undefined>();
  for (const input of inputs) for (const fieldId of input.fieldIds) {
    if (!byField.has(fieldId)) byField.set(fieldId, byId.get(input.catalogId));
  }
  return (fieldId: string): TCatalog | undefined => byField.get(fieldId);
}

export function findValidationCatalog<
  TInput extends InputValidationReference,
  TCatalog extends InputChoiceCatalog,
>(inputs: readonly TInput[], catalogs: readonly TCatalog[], fieldId: string): TCatalog | undefined {
  const input = inputs.find(entry => entry.fieldIds.includes(fieldId));
  return input ? catalogs.find(catalog => catalog.id === input.catalogId) : undefined;
}
