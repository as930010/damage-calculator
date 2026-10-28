import type { GameData } from '../../../frontend/data.ts';
import { ICE_SERIES_ORDER, ICE_UNORDERED_EXCLUDED_ITEMS } from './series-order.ts';

export interface IceSearchConstraints {
  /** Keep these semantic selection fields at their current equipped values. */
  fixedFields?: readonly string[];
  /** Catalog item IDs, keyed by semantic selection field. Overrides exclusion for this field only. */
  requiredItemIds?: Readonly<Record<string, string>>;
  /** IDs of active effects identifying required set series. */
  requiredSetEffectIds?: readonly string[];
  allowedSeries?: readonly string[];
}

export function iceSeriesOrder(data: GameData): string[] {
  const activeSets = new Set(data.rightIceSets.effects.filter(effect => effect.active).map(effect => effect.setName));
  const available = new Set([
    ...activeSets,
    ...(data.catalogs['equipment/right-ice.json']?.items ?? []).filter(item => item.active).map(item => item.name),
  ]);
  const missing = [...available].filter(name => !ICE_SERIES_ORDER.includes(name)
    && (activeSets.has(name) || !ICE_UNORDERED_EXCLUDED_ITEMS.includes(name)));
  if (missing.length) throw new RangeError(`以下冰裝系列尚未設定試算順序：${missing.join('、')}。`);
  return ICE_SERIES_ORDER.filter(name => available.has(name));
}

export function iceSelectedSeries(data: GameData, constraints: IceSearchConstraints = {}): string[] | null {
  if (constraints.allowedSeries === undefined) return null;
  const valid = new Set(data.rightIceSets.effects.filter(effect => effect.active).map(effect => effect.setName));
  if (constraints.allowedSeries.some(name => !valid.has(name))) throw new RangeError('選取的套裝系列已不存在或無法使用。');
  return [...constraints.allowedSeries];
}

export function requiredIceSetNames(data: GameData, constraints: IceSearchConstraints = {}): string[] {
  const ids = constraints.requiredSetEffectIds ?? [];
  if (ids.length > 3) throw new RangeError('最多指定三組必選套效。');
  const names = ids.map(id => {
    const effect = data.rightIceSets.effects.find(entry => entry.id === id && entry.active);
    if (!effect) throw new RangeError('指定的必選套效已不存在或無法使用。');
    return effect.setName;
  });
  if (new Set(names).size !== names.length) throw new RangeError('必選套效不可重複。');
  return names;
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
  if (new Set([...fixed, ...Object.keys(required)]).size > 11) throw new RangeError('最多固定 11 個右冰部位。');
  const requiredSets = new Set(requiredIceSetNames(data, constraints));
  const range = iceSelectedSeries(data, constraints);
  const rangeNames = range ? new Set(range) : null;
  for (const field of [...fixed, ...Object.keys(required)]) {
    if (!fields.has(field)) throw new RangeError(`搜尋約束無可行解：未知的右冰部位 ${field}。`);
  }
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
    const names = [...new Set(items.filter(item => requiredSets.has(item.name)
      || (!rangeNames || rangeNames.has(item.name))).map(item => item.name))];
    if (!names.length) throw new RangeError(`搜尋約束無可行解：${selection.selectionField} 沒有可用裝備。`);
    return { field: selection.selectionField, names };
  }).sort((a, b) => a.names.length - b.names.length || a.field.localeCompare(b.field, 'en'));
}

/** Keeps the policy snapshot serializable and detached from a caller's mutable constraints. */
export function snapshotIceSearchConstraints(constraints: IceSearchConstraints = {}): IceSearchConstraints {
  return { fixedFields: [...(constraints.fixedFields ?? [])], requiredItemIds: { ...constraints.requiredItemIds },
    requiredSetEffectIds: [...(constraints.requiredSetEffectIds ?? [])],
    allowedSeries: constraints.allowedSeries === undefined ? undefined : [...constraints.allowedSeries] };
}
