import { codeForFieldId, fieldIdForCode } from './field-ids.ts';
import type { LoadoutState } from './state.ts';
import type { LoadoutProfileStore, SavedLoadoutProfile } from './loadout-profiles.ts';

const utf8 = new TextEncoder();
export const archiveLimit = 5 * 1024 * 1024;
const expandedLimit = 32 * 1024 * 1024;
const versions = { fieldMapVersion: 1, valueCodecVersion: 1 } as const;
type RecordValue = Record<string, unknown>;
type Cell = string | number | [number];
type Block = Omit<LoadoutState, 'values'> & { values: Record<string, Cell> };
type Patch = { base: number; set: Record<string, Cell>; remove: string[] };
type Entry = Omit<SavedLoadoutProfile, 'loadout' | 'baseline'> & { loadout: number; baseline?: number | null };

function fail(reason: string): never { throw new TypeError(reason); }
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('備份物件結構無效。');
  return value as RecordValue;
}
function reference<T>(list: readonly T[], id: unknown): T {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || id >= list.length) fail('備份字典或快照 ID 無效。');
  return list[id];
}
function validNumber(value: number): boolean {
  return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
}
export function parseArchiveJson(raw: string): RecordValue {
  if (utf8.encode(raw).length > archiveLimit) fail('檔案上限為 5 MB。');
  try {
    return record(JSON.parse(raw, (key, value: unknown) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('備份含不支援的欄位名稱。');
      if (typeof value === 'number' && !validNumber(value)) fail('備份含非有限或超出安全範圍的數字。');
      return value;
    }));
  } catch (error) {
    if ((error as Error).name === 'SyntaxError') fail('檔案不是有效的 JSON。');
    throw error;
  }
}
function emit(payload: unknown): string {
  const json = stable(payload);
  if (utf8.encode(json).length > archiveLimit) fail('此備份超過 5 MB，請分別匯出配置。');
  return json;
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function makeDictionary(states: LoadoutState[]) {
  const seen = new Set<string>(), repeated = new Set<string>();
  for (const state of states) for (const value of Object.values(state.values)) {
    if (typeof value !== 'string' || value.length < 3) continue;
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}
function encodeBlock(state: LoadoutState, ids: Map<string, number>): Block {
  const values: Record<string, Cell> = {};
  for (const [field, value] of Object.entries(state.values)) {
    const code = codeForFieldId(field);
    if (code === undefined) fail('未知的配裝欄位：' + field);
    if (typeof value === 'number' && !validNumber(value)) fail('配裝數字無效：' + field);
    const id = typeof value === 'string' ? ids.get(value) : undefined;
    values[code] = id === undefined ? value : [id];
  }
  return { ...state, values };
}
function dictionary(file: RecordValue): string[] {
  if (file.fieldMapVersion !== 1 || file.valueCodecVersion !== 1) fail('不支援的欄位映射或字典編碼版本。');
  const words = file.strings;
  if (!Array.isArray(words) || words.some(word => typeof word !== 'string') || new Set(words).size !== words.length)
    fail('選項字典含有重複或無效項目。');
  return words;
}
function decodeBlock(raw: RecordValue, words: string[]): LoadoutState {
  const values: Record<string, string | number> = {};
  for (const [code, cell] of Object.entries(record(raw.values))) {
    const field = /^\d+$/.test(code) && fieldIdForCode(code);
    if (!field) fail('未知欄位 ID：' + code.slice(0, 40));
    if (Array.isArray(cell) && cell.length === 1) values[field] = reference(words, cell[0]);
    else if (typeof cell === 'string' || typeof cell === 'number' && validNumber(cell)) values[field] = cell;
    else fail('欄位值格式無效：' + field);
  }
  return { ...raw, values } as LoadoutState;
}
export function encodeSingle(state: LoadoutState): string {
  const strings = makeDictionary([state]);
  return emit({ format: 'damage-calculator-loadout', formatVersion: 4, ...versions, strings,
    ...encodeBlock(state, new Map(strings.map((word, i) => [word, i]))) });
}
export function decodeSingle(file: RecordValue): LoadoutState {
  if (file.format !== 'damage-calculator-loadout' || file.formatVersion !== 4) fail('不支援的配裝版本。');
  const words = dictionary(file);
  const { format, formatVersion, fieldMapVersion, valueCodecVersion, strings, ...block } = file;
  const state = decodeBlock(block, words);
  if (cellSize(state) > expandedLimit) fail('還原後的配裝資料過大。');
  return state;
}

function cellSize(state: LoadoutState): number {
  return Object.values(state.values).reduce<number>((n,v) => n + (typeof v === 'string' ? v.length : 1), 0);
}

export function encodeLibrary(store: LoadoutProfileStore, singleProfile = false): string {
  const states: LoadoutState[] = [], bases: (number | undefined)[] = [];
  const known = new Map<string, number>();
  function intern(state: LoadoutState, base?: number): number {
    const key = stable(state);
    const found = known.get(key);
    if (found !== undefined) return found;
    const id = states.length;
    states.push(state); bases.push(base); known.set(key, id);
    return id;
  }
  const profiles: Entry[] = store.profiles.map(({ loadout, baseline, ...meta }) => {
    const id = intern(loadout);
    return { ...meta, loadout: id, ...(baseline === undefined ? {} : { baseline: baseline === null ? null : intern(baseline, id) }) };
  });
  const sizes = states.map(state => utf8.encode(JSON.stringify(state)).length);
  const expanded = profiles.reduce((sum, p) => sum + sizes[p.loadout] + (p.baseline == null ? 0 : sizes[p.baseline]), 0);
  if (expanded + states.reduce((sum, s) => sum + cellSize(s), 0) > expandedLimit) fail('配置庫過大，請分別匯出配置。');
  const strings = makeDictionary(states);
  const ids = new Map(strings.map((word, i) => [word, i]));
  const snapshots: (Block | Patch)[] = [];
  for (const [i, state] of states.entries()) {
    const block = encodeBlock(state, ids);
    const base = bases[i];
    const parent = base === undefined ? undefined : snapshots[base];
    if (base !== undefined && parent && 'values' in parent) {
      const { values, ...meta } = block, { values: original, ...baseMeta } = parent;
      if (stable(meta) === stable(baseMeta)) {
        const set = Object.fromEntries(Object.entries(values).filter(([k,v]) => JSON.stringify(original[k]) !== JSON.stringify(v)));
        const patch = { base, set, remove: Object.keys(original).filter(k => !Object.hasOwn(values,k)) };
        if (utf8.encode(JSON.stringify(patch)).length < utf8.encode(JSON.stringify(block)).length) {
          snapshots.push(patch); continue;
        }
      }
    }
    snapshots.push(block);
  }
  return emit({ format: singleProfile ? 'damage-calculator-profile' : 'damage-calculator-profiles', version: 2,
    schemaVersion: store.schemaVersion, ...versions, strings, snapshots, profiles, activeProfileId: store.activeProfileId });
}
export function decodeLibrary(file: RecordValue): LoadoutProfileStore {
  if (!['damage-calculator-profiles', 'damage-calculator-profile'].includes(String(file.format)) || file.version !== 2)
    fail('配置庫檔案格式或版本無效。');
  const words = dictionary(file);
  if (file.schemaVersion !== 1 || !Array.isArray(file.snapshots) || !Array.isArray(file.profiles)
    || file.format === 'damage-calculator-profile' && file.profiles.length !== 1) fail('配置庫 Schema 無效。');
  const states: LoadoutState[] = [], sizes: number[] = [];
  const used = new Set<number>();
  let remaining = expandedLimit;
  function reserve(size: number) {
    remaining -= size;
    if (remaining < 0) fail('還原後的配置資料過大。');
  }
  for (const item of file.snapshots) {
    const block = record(item);
    let state: LoadoutState;
    if (Object.hasOwn(block,'base')) {
      const parent = reference(states, block.base);
      if (Object.hasOwn(file.snapshots[block.base as number], 'base') || !Array.isArray(block.remove)
        || Object.keys(block).some(k => !['base','set','remove'].includes(k))) fail('比較基準差異格式無效。');
      const set = decodeBlock({ values: block.set }, words).values;
      const values = { ...parent.values };
      for (const code of block.remove) {
        const key = typeof code === 'string' && fieldIdForCode(code);
        if (!key || !Object.hasOwn(values,key) || Object.hasOwn(set,key)) fail('比較基準移除欄位無效。');
        delete values[key];
      }
      state = { ...parent, values: Object.assign(values, set) };
    } else state = decodeBlock(block, words);
    // Count strings before serializing or cloning a potentially expanded snapshot.
    reserve(cellSize(state));
    const size = utf8.encode(JSON.stringify(state)).length;
    sizes.push(size); states.push(state);
  }
  function expand(id: unknown): LoadoutState {
    reserve(reference(sizes,id));
    used.add(id as number);
    return structuredClone(reference(states,id));
  }
  const profiles = file.profiles.map(value => {
    const entry = record(value);
    const { loadout, baseline, ...meta } = entry;
    return { ...meta, loadout: expand(loadout), ...(baseline === undefined ? {} : { baseline: baseline === null ? null : expand(baseline) }) };
  });
  if (used.size !== states.length) fail('備份含未使用的快照。');
  return { schemaVersion: 1, activeProfileId: file.activeProfileId, profiles } as LoadoutProfileStore;
}
