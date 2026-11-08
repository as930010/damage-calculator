import { combineExternalSources, parseDefensePercentage, requireDefenseRate } from '../calculation/battle-defense.ts';

export const BATTLE_DEFENSE_KEY = 'damage-calculator.battle-defense.v1';
export interface DefenseSource { id: string; name: string; percentage: string }
export interface TeamDefenseSnapshot {
  mode: 'single' | 'challenge'; target: 'single' | 'firstTeam' | 'secondTeam' | 'sharedArena';
  rate: number; sources: string[]; defenseIgnoreAdditive?: number; defenseIgnoreSources?: string[]; sourceIds?: string[]; sourceRevision: string; dataRevision: string; importedAt: string;
}
export interface BattleDefenseEnvironment {
  schemaVersion: 1; mode: 'manual' | 'sources' | 'team'; manualPercentage: string;
  sources: DefenseSource[]; teamSnapshot: TeamDefenseSnapshot | null;
}
export const defaultBattleDefense = (): BattleDefenseEnvironment => ({ schemaVersion: 1, mode: 'manual', manualPercentage: '0', sources: [], teamSnapshot: null });

export function parseBattleDefense(raw: string | null): BattleDefenseEnvironment {
  if (raw === null) return defaultBattleDefense();
  const value = JSON.parse(raw) as BattleDefenseEnvironment;
  if (!value || value.schemaVersion !== 1 || !['manual', 'sources', 'team'].includes(value.mode)
    || typeof value.manualPercentage !== 'string' || !Array.isArray(value.sources)
    || value.sources.some(s => !s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.percentage !== 'string')
    || new Set(value.sources.map(s => s.id)).size !== value.sources.length) throw new Error('戰鬥破防設定資料無效，請重新設定。');
  const snapshot = value.teamSnapshot;
  if (snapshot !== null && (!snapshot || !['single', 'challenge'].includes(snapshot.mode)
    || !['single', 'firstTeam', 'secondTeam', 'sharedArena'].includes(snapshot.target)
    || (snapshot.mode === 'single') !== (snapshot.target === 'single')
    || !Array.isArray(snapshot.sources) || snapshot.sources.some(s => typeof s !== 'string')
    || (snapshot.sourceIds !== undefined && (!Array.isArray(snapshot.sourceIds) || snapshot.sourceIds.some(s => typeof s !== 'string')))
    || typeof snapshot.sourceRevision !== 'string' || typeof snapshot.dataRevision !== 'string' || typeof snapshot.importedAt !== 'string')) throw new Error('隊伍破防快照格式無效，請重新引用。');
  if (snapshot) {
    requireDefenseRate(snapshot.rate, '隊伍破防快照');
    requireDefenseRate(snapshot.defenseIgnoreAdditive ?? 0, '隊伍無視防禦加算');
    if (snapshot.defenseIgnoreSources !== undefined && (!Array.isArray(snapshot.defenseIgnoreSources) || snapshot.defenseIgnoreSources.some(s => typeof s !== 'string'))) throw new Error('隊伍無視防禦來源無效。');
  }
  return { schemaVersion: 1, mode: value.mode, manualPercentage: value.manualPercentage,
    sources: value.sources.map(s => ({ id: s.id, name: s.name, percentage: s.percentage })), teamSnapshot: snapshot };
}

export function externalDefenseRate(value: BattleDefenseEnvironment): number {
  if (value.mode === 'team') {
    if (!value.teamSnapshot) return 0;
    return requireDefenseRate(value.teamSnapshot.rate, '隊伍破防快照');
  }
  if (value.mode === 'manual') {
    if (value.manualPercentage.trim() === '') return 0;
    const rate = parseDefensePercentage(value.manualPercentage);
    if (rate === null) throw new Error('裝備以外來源總破防率請填寫 0～100 的十進位數字，最多八位小數。');
    return rate;
  }
  return combineExternalSources(value.sources.map((source, i) => {
    const rate = source.percentage.trim() === '' ? 0 : parseDefensePercentage(source.percentage);
    if (rate === null) throw new Error(`破防來源第 ${i + 1} 條尚未完成；請填寫 0～100 的有效破防率，名稱可留空。`);
    return rate;
  }));
}

export function teamDefenseIgnoreAdditive(value: BattleDefenseEnvironment): number {
  return value.mode === 'team' ? requireDefenseRate(value.teamSnapshot?.defenseIgnoreAdditive ?? 0, '隊伍無視防禦加算') : 0;
}

/** One page store, with explicit same-document notifications and cross-document storage sync. */
export function createBattleDefenseStore(host: Window) {
  let lastRaw: string | null | undefined;
  let value = defaultBattleDefense(); let readError = ''; let storageError = '';
  const listeners = new Set<() => void>();
  const read = () => {
    try { lastRaw = host.localStorage.getItem(BATTLE_DEFENSE_KEY); value = parseBattleDefense(lastRaw); readError = ''; }
    catch (error) { readError = error instanceof Error ? error.message : '無法讀取戰鬥破防設定。'; }
  };
  read();
  const notify = () => listeners.forEach(listener => listener());
  const synchronize = (event: StorageEvent) => { if (event.key === BATTLE_DEFENSE_KEY || event.key === null) { read(); notify(); } };
  host.addEventListener('storage', synchronize);
  const resume = () => { try { if (host.localStorage.getItem(BATTLE_DEFENSE_KEY) !== lastRaw) { read(); notify(); } } catch { /* Keep the current page value. */ } };
  host.addEventListener('pageshow', resume);
  return {
    get value() { return value; },
    get error() { try { if (readError) return readError; externalDefenseRate(value); return storageError; } catch (error) { return (error as Error).message; } },
    get rate(): number | null { try { return readError ? null : externalDefenseRate(value); } catch { return null; } },
    get defenseIgnoreAdditive(): number | null { try { return readError ? null : teamDefenseIgnoreAdditive(value); } catch { return null; } },
    set(next: BattleDefenseEnvironment) {
      value = parseBattleDefense(JSON.stringify(next)); readError = ''; storageError = '';
      try { lastRaw = JSON.stringify(value); host.localStorage.setItem(BATTLE_DEFENSE_KEY, lastRaw); }
      catch { storageError = '此瀏覽器無法保存戰鬥破防設定；目前只在本頁生效。'; }
      notify();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { host.removeEventListener('storage', synchronize); host.removeEventListener('pageshow', resume); listeners.clear(); },
  };
}
export type BattleDefenseStore = ReturnType<typeof createBattleDefenseStore>;

/** Change hint only; not an authentication or data-integrity hash. */
export function teamRevision(raw: string | null): string {
  let hash = 2166136261;
  for (const char of raw ?? '') hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

/** Freshness is advisory: the saved rate remains active until an explicit re-import. */
export function teamSnapshotUpdateReason(snapshot: TeamDefenseSnapshot, sourceRevision: string, dataRevision?: string): 'data' | 'team' | null {
  if (dataRevision !== undefined && snapshot.dataRevision !== dataRevision) return 'data';
  return snapshot.sourceRevision !== sourceRevision ? 'team' : null;
}
