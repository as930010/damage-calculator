import type { GameData } from '../../../frontend/data.ts';

/** Exact catalog names are the right-ice series keys; the catalog has no separate series ID. */
export const DEFAULT_EXCLUDED_ICE_SERIES = ['神埃', '騎士團'] as const;

export interface IceSearchConstraints {
  /** Replace the default policy. An empty list is useful for an unrestricted comparison. */
  excludedSeries?: readonly string[];
  /** Keep these semantic selection fields at their current equipped values. */
  fixedFields?: readonly string[];
  /** Catalog item IDs, keyed by semantic selection field. Overrides exclusion for this field only. */
  requiredItemIds?: Readonly<Record<string, string>>;
}

export interface IceSearchDomain {
  field: string;
  names: string[];
}

export function createIceSearchDomains(data: GameData, currentChoices: Readonly<Record<string, string>>,
  constraints: IceSearchConstraints = {}): IceSearchDomain[] {
  const selections = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  if (!selections.length) throw new RangeError('冰裝資料缺少右冰選擇欄位。');
  const fields = new Set(selections.map(entry => entry.selectionField));
  const fixed = new Set(constraints.fixedFields ?? []);
  const required = constraints.requiredItemIds ?? {};
  for (const field of [...fixed, ...Object.keys(required)]) {
    if (!fields.has(field)) throw new RangeError(`搜尋約束無可行解：未知的右冰部位 ${field}。`);
  }
  const excluded = new Set(constraints.excludedSeries ?? DEFAULT_EXCLUDED_ICE_SERIES);
  return selections.map(selection => {
    const catalog = data.catalogs[selection.catalogFile];
    if (!catalog) throw new RangeError('找不到冰裝候選資料：' + selection.catalogFile);
    const items = catalog.items.filter(item => item.active && item.slotId === selection.slotId);
    const current = String(currentChoices[selection.selectionField] ?? '');
    const requiredId = required[selection.selectionField];
    if (requiredId !== undefined) {
      const item = items.find(item => item.id === requiredId);
      if (!item) throw new RangeError(`搜尋約束無可行解：指定裝備不屬於 ${selection.selectionField} 的有效候選。`);
      if (fixed.has(selection.selectionField) && item.name !== current) {
        throw new RangeError(`搜尋約束無可行解：${selection.selectionField} 的固定裝備與指定裝備衝突。`);
      }
      return { field: selection.selectionField, names: [item.name] };
    }
    if (fixed.has(selection.selectionField)) {
      if (!items.some(item => item.name === current)) {
        throw new RangeError(`搜尋約束無可行解：${selection.selectionField} 的目前裝備無法固定。`);
      }
      return { field: selection.selectionField, names: [current] };
    }
    const names = [...new Set(items.filter(item => !excluded.has(item.name)).map(item => item.name))];
    if (!names.length) throw new RangeError(`搜尋約束無可行解：${selection.selectionField} 沒有可用裝備。`);
    return { field: selection.selectionField, names };
  }).sort((a, b) => a.names.length - b.names.length || a.field.localeCompare(b.field, 'en'));
}

/** Keeps the policy snapshot serializable and detached from a caller's mutable constraints. */
export function snapshotIceSearchConstraints(constraints: IceSearchConstraints = {}): Required<IceSearchConstraints> {
  return { excludedSeries: [...(constraints.excludedSeries ?? DEFAULT_EXCLUDED_ICE_SERIES)],
    fixedFields: [...(constraints.fixedFields ?? [])], requiredItemIds: { ...constraints.requiredItemIds } };
}
