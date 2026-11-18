import { archiveLimit, encodeLibrary, decodeLibrary, parseArchiveJson } from './loadout-archive.ts';
import { isFieldId } from './field-ids.ts';
import { parseState, type LoadoutState } from './state.ts';

export const profilesKey = 'damage-calculator.profiles.v1';
export interface SavedLoadoutProfile {
  id: string;
  name: string;
  loadout: LoadoutState;
  baseline?: LoadoutState | null;
  createdAt: string;
  updatedAt: string;
}
export interface LoadoutProfileStore {
  schemaVersion: 1;
  profiles: SavedLoadoutProfile[];
  activeProfileId: string | null;
}
export type ProfileErrorCode = 'invalid-data' | 'invalid-name' | 'duplicate-name' | 'not-found' | 'read-failed' | 'write-failed' | 'quota-exceeded' | 'conflict' | 'not-loaded' | 'read-only';
export class ProfileError extends Error {
  readonly code: ProfileErrorCode;
  constructor(code: ProfileErrorCode, message: string) { super(message); this.code = code; this.name = 'ProfileError'; }
}
export type ProfileResult<T> = { ok: true; value: T } | { ok: false; error: ProfileError };
type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;
const emptyStore = (): LoadoutProfileStore => ({ schemaVersion: 1, profiles: [], activeProfileId: null });

// Sort every object level, including optional skill versions and Boss conditions.
function canonical(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new ProfileError('invalid-data', '配裝含無效數值。');
  const result = JSON.stringify(value);
  if (result === undefined) throw new ProfileError('invalid-data', '配裝含無法保存的資料。');
  return result;
}
export function snapshot(value: unknown): LoadoutState {
  const raw = canonical(value);
  const parsed = parseState(raw);
  const candidate = JSON.parse(raw) as LoadoutState;
  if (!parsed || !candidate.values || Array.isArray(candidate.values) || typeof candidate.values !== 'object') {
    throw new ProfileError('invalid-data', '配裝必須是完整有效的 Schema 3 狀態。');
  }
  for (const [key, item] of Object.entries(candidate.values)) {
    if (!isFieldId(key) || !(typeof item === 'string' || typeof item === 'number' && Number.isFinite(item))
      || item !== '' && !Object.hasOwn(parsed.values, key)) {
      throw new ProfileError('invalid-data', '配裝含無效欄位（' + key.slice(0,100) + '）。');
    }
  }
  // Preserve blank editing fields and numeric strings after the shared parser validates them.
  parsed.values = candidate.values;
  if (canonical(parsed) !== raw) throw new ProfileError('invalid-data', '配裝必須是完整有效的 Schema 3 狀態。');
  return parsed;
}
function profileName(value: string): string {
  if (typeof value !== 'string') throw new ProfileError('invalid-name', '配置名稱必須為文字。');
  const name = value.trim();
  if (!name || Array.from(name).length > 40) throw new ProfileError('invalid-name', '配置名稱需為 1～40 字元。');
  return name;
}
export function parseProfileStore(raw: string | null): LoadoutProfileStore {
  if (raw === null) return emptyStore();
  let data: LoadoutProfileStore;
  try { data = JSON.parse(raw); }
  catch { throw new ProfileError('invalid-data', '配置庫 JSON 語法無效。'); }
  return validateProfileStore(data);
}

function validateProfileStore(data: LoadoutProfileStore): LoadoutProfileStore {
  try {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.profiles)) throw Error();
    const ids = new Set<string>(), names = new Set<string>();
    for (const profile of data.profiles) {
      if (!profile || typeof profile.id !== 'string' || !profile.id.trim()) throw new ProfileError('invalid-data','配置 ID 無效。');
      const name = profileName(profile.name);
      if (ids.has(profile.id)) throw new ProfileError('invalid-data','「' + name + '」的配置 ID 重複。');
      if (name !== profile.name || names.has(name)) throw new ProfileError('invalid-data','配置名稱無效或重複（' + name + '）。');
      ids.add(profile.id); names.add(name);
      for (const date of [profile.createdAt, profile.updatedAt]) {
        if (typeof date !== 'string' || !Number.isFinite(Date.parse(date))) throw Error();
      }
      if (Date.parse(profile.updatedAt) < Date.parse(profile.createdAt)) throw Error();
      for (const [field,value] of [['loadout',profile.loadout],['baseline',profile.baseline]] as const) {
        if (field === 'baseline' && value == null) continue;
        try { snapshot(value); }
        catch (error) { throw new ProfileError('invalid-data','「' + name + '」的 ' + field + ' 無效。' + (error instanceof ProfileError ? error.message : '請檢查資料格式。')); }
      }
      if (Object.keys(profile).some(key => !['id','name','loadout','baseline','createdAt','updatedAt'].includes(key))) throw Error();
    }
    if (data.activeProfileId !== null && !ids.has(data.activeProfileId)) throw Error();
    if (Object.keys(data).some(key => !['schemaVersion','profiles','activeProfileId'].includes(key))) throw Error();
    return data;
  } catch (error) {
    if (error instanceof ProfileError) throw error;
    throw new ProfileError('invalid-data', '配置庫 Schema、時間或關聯資料無效；原資料已保留。');
  }
}

/** Compare the working loadout and its baseline; omitted/null means no current baseline. */
export function isProfileDirty(profile: SavedLoadoutProfile, current: LoadoutState, baseline: LoadoutState | null = null): boolean {
  return canonical(snapshot(profile.loadout)) !== canonical(snapshot(current))
    || canonical(profile.baseline ?? null) !== canonical(baseline === null ? null : snapshot(baseline));
}

/** Explicit persistence only. No constructor reads, startup writes or draft/history integration. */
export class LoadoutProfiles {
  private state: LoadoutProfileStore | null = null;
  private stored: string | null = null;
  private readonly storage: () => ProfileStorage;
  private readonly readOnly: boolean;
  constructor(storage: () => ProfileStorage = () => localStorage, readOnly = false) { this.storage = storage; this.readOnly = readOnly; }

  private result<T>(operation: () => T): ProfileResult<T> {
    try { return { ok: true, value: operation() }; }
    catch (error) { return { ok: false, error: error instanceof ProfileError ? error : new ProfileError('invalid-data', '配置操作失敗。') }; }
  }
  private read(): string | null {
    try { return this.storage().getItem(profilesKey); }
    catch { throw new ProfileError('read-failed', '無法讀取配置庫。'); }
  }
  /** Call explicitly after a conflict to review the latest library before retrying. */
  reload(): ProfileResult<LoadoutProfileStore> {
    return this.result(() => {
      const raw = this.read();
      const next = parseProfileStore(raw);
      this.stored = raw; this.state = next;
      return structuredClone(next);
    });
  }
  checkCurrent(): ProfileResult<void> {
    return this.result(() => {
      this.current();
      if (this.read() !== this.stored) throw new ProfileError('conflict', '配置庫已在其他分頁更新。請先匯出本頁配裝，再重新整理。');
    });
  }
  private current(): LoadoutProfileStore {
    if (!this.state) throw new ProfileError('not-loaded', '請先讀取配置庫。');
    return this.state;
  }
  getStore(): ProfileResult<LoadoutProfileStore> { return this.result(() => structuredClone(this.current())); }
  private find(store: LoadoutProfileStore, id: string): SavedLoadoutProfile {
    const profile = store.profiles.find(item => item.id === id);
    if (!profile) throw new ProfileError('not-found', '找不到指定配置。');
    return profile;
  }
  getProfile(id: string): ProfileResult<SavedLoadoutProfile> {
    return this.result(() => structuredClone(this.find(this.current(), id)));
  }
  private uniqueName(store: LoadoutProfileStore, name: string, id?: string): string {
    if (typeof name === 'string' && !name.trim()) {
      const used = new Set(store.profiles.filter(entry => entry.id !== id).map(entry => entry.name));
      let suffix = 0;
      while (used.has('未命名' + (suffix || ''))) suffix++;
      return '未命名' + (suffix || '');
    }
    const normalized = profileName(name);
    if (store.profiles.some(item => item.id !== id && item.name === normalized)) throw new ProfileError('duplicate-name', '已有同名配置。');
    return normalized;
  }
  private mutate<T>(change: (next: LoadoutProfileStore) => T): ProfileResult<T> {
    return this.result(() => {
      if (this.readOnly) throw new ProfileError('read-only', '範例模式不保存命名配置。');
      const next = structuredClone(this.current());
      const value = change(next);
      const raw = JSON.stringify(next);
      parseProfileStore(raw);
      if (this.read() !== this.stored) throw new ProfileError('conflict', '配置庫已有更新，請重新讀取後再操作。');
      try { this.storage().setItem(profilesKey, raw); }
      catch (error) {
        const quota = error instanceof Error && error.name === 'QuotaExceededError';
        throw new ProfileError(quota ? 'quota-exceeded' : 'write-failed', quota ? '儲存空間不足；配置未更新。' : '無法保存配置。');
      }
      // Detect intervening writes where observable; localStorage has no atomic compare-and-swap.
      if (this.read() !== raw) throw new ProfileError('conflict', '保存期間配置庫已有更新，請重新讀取。');
      this.state = next; this.stored = raw;
      return structuredClone(value);
    });
  }
  createProfile(name: string, loadout: LoadoutState, baseline?: LoadoutState | null): ProfileResult<SavedLoadoutProfile> {
    return this.mutate(store => {
      const date = new Date().toISOString();
      const profile: SavedLoadoutProfile = { id: crypto.randomUUID(), name: this.uniqueName(store, name), loadout: snapshot(loadout), createdAt: date, updatedAt: date };
      if (baseline !== undefined) profile.baseline = baseline === null ? null : snapshot(baseline);
      store.profiles.push(profile);
      return profile;
    });
  }
  renameProfile(id: string, name: string): ProfileResult<SavedLoadoutProfile> {
    return this.mutate(store => {
      const profile = this.find(store, id);
      profile.name = this.uniqueName(store, name, id);
      profile.updatedAt = new Date(Math.max(Date.now(), Date.parse(profile.updatedAt))).toISOString();
      return profile;
    });
  }
  duplicateProfile(id: string): ProfileResult<SavedLoadoutProfile> {
    return this.mutate(store => {
      const original = this.find(store, id);
      let name = '', number = 1;
      do {
        const suffix = number === 1 ? '（副本）' : '（副本 ' + number + '）';
        name = Array.from(original.name).slice(0, 40 - Array.from(suffix).length).join('') + suffix;
        number++;
      } while (store.profiles.some(profile => profile.name === name));
      const date = new Date().toISOString();
      const profile = { ...structuredClone(original), id: crypto.randomUUID(), name, createdAt: date, updatedAt: date };
      store.profiles.push(profile);
      return profile;
    });
  }
  deleteProfile(id: string): ProfileResult<void> {
    return this.mutate(store => {
      this.find(store, id);
      store.profiles = store.profiles.filter(profile => profile.id !== id);
      if (store.activeProfileId === id) store.activeProfileId = null;
    });
  }
  /** Omit baseline to retain it; pass null to explicitly remove it. */
  saveProfile(id: string, loadout: LoadoutState, baseline?: LoadoutState | null): ProfileResult<SavedLoadoutProfile> {
    return this.mutate(store => {
      const profile = this.find(store, id);
      profile.loadout = snapshot(loadout);
      if (baseline !== undefined) profile.baseline = baseline === null ? null : snapshot(baseline);
      profile.updatedAt = new Date(Math.max(Date.now(), Date.parse(profile.updatedAt))).toISOString();
      return profile;
    });
  }
  /** Validate a complete backup before a single optimistic library write. */
  restoreProfiles(incoming: LoadoutProfileStore, mode: 'merge' | 'replace'): ProfileResult<LoadoutProfileStore> {
    return this.mutate(store => {
      const validated = validateProfileStore(incoming);
      if (mode !== 'merge' && mode !== 'replace') throw new ProfileError('invalid-data', '請選擇還原方式。');
      if (mode === 'replace') {
        store.profiles = structuredClone(validated.profiles);
        store.activeProfileId = validated.activeProfileId;
      } else for (const entry of validated.profiles) {
        const profile = structuredClone(entry);
        if (store.profiles.some(item => item.id === profile.id)) profile.id = crypto.randomUUID();
        const base = profile.name;
        let count = 1;
        while (store.profiles.some(item => item.name === profile.name)) {
          const suffix = '（匯入 ' + count++ + '）';
          profile.name = Array.from(base).slice(0, 40 - Array.from(suffix).length).join('') + suffix;
        }
        store.profiles.push(profile);
      }
      return store;
    });
  }

}

export const profileBackupLimit = archiveLimit;
export function exportProfileBackup(store: LoadoutProfileStore): string {
  return encodeLibrary(validateProfileStore(store));
}
export function exportNamedProfile(profile: SavedLoadoutProfile): string {
  return encodeLibrary(validateProfileStore({schemaVersion: 1, activeProfileId: null, profiles: [profile]}), true);
}
export function readProfileArchive(file: Record<string, unknown>): LoadoutProfileStore {
  if (file.format === 'damage-calculator-profiles' && file.version === 1)
    return validateProfileStore(file.library as LoadoutProfileStore);
  return validateProfileStore(decodeLibrary(file));
}
export function parseProfileBackup(raw: string): LoadoutProfileStore {
  return readProfileArchive(parseArchiveJson(raw));
}
