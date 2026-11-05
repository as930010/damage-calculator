import type { CatalogIndex } from './catalog-index.ts';
import type { PickerOption } from './picker.ts';
import { getEquipmentOptionName } from '../calculation/equipment-catalog.ts';

/** Reuse the page's existing index; keep candidate identities within this data scope. */
export function createPickerChoices(catalogIndex: CatalogIndex, magicStoneCatalogFile: string, summary: (stats: Readonly<Record<string, number>>) => string) {
  const pickerOptionsByNames = new WeakMap<readonly string[], readonly PickerOption[]>();
  const options = (names: readonly string[]): readonly PickerOption[] => {
    let choices = pickerOptionsByNames.get(names);
    if (!choices) { choices = Object.freeze(names.map(name => Object.freeze({ value: name, label: name }))); pickerOptionsByNames.set(names, choices); }
    return choices;
  };
  const validationPickerChoices = new Map<string, readonly PickerOption[]>();
  const stonePickerChoices = new Map<'armor' | 'weapon', readonly PickerOption[]>();
  const magicStoneChoices = (application: 'armor' | 'weapon'): readonly PickerOption[] => {
    let choices = stonePickerChoices.get(application);
    if (!choices) {
      choices = Object.freeze(catalogIndex.activeCatalogItems(magicStoneCatalogFile).map(item => {
        const name = getEquipmentOptionName(item, application);
        return Object.freeze({ value: name, label: name, detail: summary(item.targetApplications?.[application]?.stats ?? item.stats ?? {}) });
      }));
      stonePickerChoices.set(application, choices);
    }
    return choices;
  };
  const validationChoices = (fieldId: string, percentLabel = false): readonly PickerOption[] => {
    const catalog = catalogIndex.validationCatalog(fieldId);
    if (!catalog) return [];
    const key = JSON.stringify([catalog.id, percentLabel]);
    let choices = validationPickerChoices.get(key);
    if (!choices) {
      choices = Object.freeze(catalog.options.map(option => {
        const value = String(option.value);
        return Object.freeze({ value, label: percentLabel && typeof option.value === 'number' ? value + '%' : value });
      }));
      validationPickerChoices.set(key, choices);
    }
    return choices;
  };
  return { options, magicStoneChoices, validationChoices };
}
