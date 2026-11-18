import { parseState, type LoadoutState } from './state.ts';
import { snapshot } from './loadout-profiles.ts';

export const draftAssociationKey = 'damage-calculator.profile-draft.v1';
export const draftJournalKey = 'damage-calculator.profile-switch.v1';
const keys = ['dab-loadout-v1', 'dab-baseline-v1', draftAssociationKey] as const;
type Values = (string | null)[];
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function put(storage: DraftStorage, key: string, value: string | null) {
  if (value === null) storage.removeItem(key); else storage.setItem(key, value);
}
function association(raw: string | null): string | null {
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (value.schemaVersion !== 1 || !(value.profileId === null || typeof value.profileId === 'string')) throw Error('草稿關聯格式無效。');
  return value.profileId;
}
/** Recover before readState/startup normalization. Never roll back another tab's newer values. */
export function recoverProfileDraft(storage: DraftStorage): string {
  const raw = storage.getItem(draftJournalKey);
  if (raw === null) return '';
  const journal = JSON.parse(raw);
  for (const entries of [journal.before, journal.after]) {
    if (!Array.isArray(entries) || entries.length !== keys.length || entries.some(v => v !== null && typeof v !== 'string')) throw Error('草稿復原標記無效，已保留原資料。');
    for (const value of entries.slice(0, 2)) if (value !== null && !parseState(value)) throw Error('無效的復原配裝。');
    association(entries[2]);
  }
  const now = keys.map(key => storage.getItem(key));
  if (now.some((v, i) => v !== journal.before[i] && v !== journal.after[i])) throw Error('偵測到其他分頁的草稿與未完成切換；請備份資料後重新整理，未覆寫任何資料。');
  // A fully written switch is committed; otherwise restore the previous complete workspace.
  if (!now.every((v, i) => v === journal.after[i])) keys.forEach((key, i) => put(storage, key, journal.before[i]));
  storage.removeItem(draftJournalKey);
  return '已恢復上次中斷的配置切換。';
}

/** Optimistic multi-key persistence with a recoverable journal, not an atomic database transaction. */
export class ProfileDraft {
  private expected: Values = [];
  profileId: string | null = null;
  error = '';
  notice = '';
  private readonly storage: () => DraftStorage;
  readonly readOnly: boolean;
  constructor(storage: () => DraftStorage = () => localStorage, readOnly = false) {
    this.storage = storage; this.readOnly = readOnly;
    if (readOnly) return;
    try {
      this.notice = recoverProfileDraft(this.storage());
      this.expected = this.read();
      this.profileId = association(this.expected[2]);
    } catch (error) { this.error = error instanceof Error ? error.message : '無法讀取工作草稿。'; }
  }
  private read(): Values { return keys.map(key => this.storage().getItem(key)); }
  get conflicted(): boolean {
    if (this.readOnly) return false;
    try { return this.read().some((v, i) => v !== this.expected[i]) || this.storage().getItem(draftJournalKey) !== null; }
    catch { return true; }
  }
  /** Detach before replacing the library. Draft and baseline payloads never change. */
  replaceLibrary(replace: () => void): void {
    if (this.readOnly || this.error || this.conflicted) throw Error(this.error || '草稿已變更，請先匯出本頁配裝，再重新整理。');
    if (!this.profileId) { replace(); return; }
    const storage = this.storage();
    const previous = this.expected[2];
    storage.removeItem(draftAssociationKey);
    try { replace(); }
    catch (error) {
      if (storage.getItem(draftAssociationKey) === null) put(storage, draftAssociationKey, previous);
      throw error;
    }
    this.expected[2] = null;
    this.profileId = null;
  }
  write(loadout: LoadoutState, baseline: LoadoutState | null, profileId = this.profileId): boolean {
    if (this.readOnly) return false;
    let before: Values = [], after: Values = [];
    let started = false;
    const storage = (() => { try { return this.storage(); } catch { return null; } })();
    if (!storage) { this.error = '此瀏覽器無法儲存草稿；目前內容仍保留在畫面。'; return false; }
    try {
      if (this.error || this.conflicted) throw Error(this.error || '其他分頁已更新工作草稿。請先匯出本頁配裝，再重新整理以讀取最新草稿。');
      snapshot(loadout); if (baseline !== null) snapshot(baseline);
      before = this.read();
      after = [JSON.stringify(loadout), baseline === null ? null : JSON.stringify(baseline), JSON.stringify({schemaVersion: 1, profileId})];
      if (after.every((v, i) => v === before[i])) { this.profileId = profileId; return true; }
      storage.setItem(draftJournalKey, JSON.stringify({before, after})); started = true;
      keys.forEach((key, i) => {
        if (storage.getItem(key) !== before[i]) throw Error('保存期間工作草稿已變更。');
        put(storage, key, after[i]);
      });
      if (this.read().some((v, i) => v !== after[i])) throw Error('保存期間工作草稿已變更。');
      storage.removeItem(draftJournalKey);
      this.expected = after; this.profileId = profileId; this.error = ''; return true;
    } catch (error) {
      if (started) {
        try {
          // Only our own writes may be rolled back. Preserve a journal on recovery failure.
          if (this.read().some((v, i) => v !== before[i] && v !== after[i])) throw Error();
          keys.forEach((key, i) => put(storage, key, before[i]));
          storage.removeItem(draftJournalKey); this.expected = before;
        } catch { this.error = '保存中斷，草稿復原標記已保留；請勿繼續覆寫，重新整理後再檢查。'; return false; }
      }
      this.error = error instanceof Error && error.name === 'QuotaExceededError'
        ? '儲存空間不足。請先匯出本頁配裝，釋放空間後重新整理。'
        : error instanceof Error ? error.message : '無法儲存工作草稿；本頁內容仍保留。';
      return false;
    }
  }
}
