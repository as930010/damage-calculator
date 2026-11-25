import { combineExternalSources, parseDefensePercentage, requireDefenseRate } from '../calculation/battle-defense.ts';
import type { DefenseContribution } from '../features/buff-simulator/calculation/types.ts';

export const BATTLE_DEFENSE_KEY = 'damage-calculator.battle-defense.v1';
export interface ManualDefenseSource { kind: 'manual'; id: string; name: string; percentage: string }
export interface TeamDefenseSource { kind: 'team'; id: string; name?: string; snapshot: TeamDefenseSnapshot }
export type DefenseSource = ManualDefenseSource | TeamDefenseSource;
export interface TeamDefenseSnapshot {
  mode: 'single' | 'challenge'; target: 'single' | 'firstTeam' | 'secondTeam' | 'sharedArena';
  rate: number; defenseIgnoreAdditive?: number;
  contributions?: DefenseContribution[];
  /** Name and ID lists saved before per-source rates were available. */
  sources?: string[]; defenseIgnoreSources?: string[]; sourceIds?: string[];
  sourceRevision: string; dataRevision: string; importedAt: string;
}
export interface BattleDefenseEnvironment {
  schemaVersion: 2; mode: 'manual' | 'sources'; manualPercentage: string;
  sources: DefenseSource[];
  // Sources that were inactive when the legacy team-only mode was saved.
  legacyManualSources?: ManualDefenseSource[];
}
type LegacyDefenseEnvironment = { schemaVersion: 1; mode: 'manual' | 'sources' | 'team'; manualPercentage: string;
  sources: Omit<ManualDefenseSource, 'kind'>[]; teamSnapshot?: TeamDefenseSnapshot | null };

export const defaultBattleDefense = (): BattleDefenseEnvironment => ({ schemaVersion: 2, mode: 'manual', manualPercentage: '0', sources: [] });
export const findTeamDefenseSource = (sources: readonly DefenseSource[]) => sources.find(source => source.kind === 'team');

function validateSnapshot(snapshot: TeamDefenseSnapshot): TeamDefenseSnapshot {
  if (!snapshot || !['single', 'challenge'].includes(snapshot.mode)
    || !['single', 'firstTeam', 'secondTeam', 'sharedArena'].includes(snapshot.target)
    || (snapshot.mode === 'single') !== (snapshot.target === 'single')
    || (snapshot.contributions === undefined && snapshot.sources === undefined)
    || (snapshot.sources !== undefined && (!Array.isArray(snapshot.sources) || snapshot.sources.some(s => typeof s !== 'string')))
    || (snapshot.sourceIds !== undefined && (!Array.isArray(snapshot.sourceIds) || snapshot.sourceIds.some(s => typeof s !== 'string')))
    || typeof snapshot.sourceRevision !== 'string' || typeof snapshot.dataRevision !== 'string' || typeof snapshot.importedAt !== 'string') throw new Error('隊伍破防快照格式無效，請重新引用。');
  if (snapshot.contributions !== undefined) {
    if (!Array.isArray(snapshot.contributions)) throw new Error('隊伍破防來源明細無效。');
    const seen = new Set<string>();
    for (const item of snapshot.contributions) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string' || !item.label.trim()
        || !['class', 'loadout', 'defense-ignore'].includes(item.category) || item.rate <= 0) throw new Error('隊伍破防來源明細無效。');
      requireDefenseRate(item.rate, '隊伍破防來源明細');
      const key = item.category + ':' + item.id;
      if (seen.has(key)) throw new Error('隊伍破防來源明細重複。');
      seen.add(key);
    }
  }
  requireDefenseRate(snapshot.rate, '隊伍破防快照');
  requireDefenseRate(snapshot.defenseIgnoreAdditive ?? 0, '隊伍無視防禦加算');
  if (snapshot.defenseIgnoreSources !== undefined && (!Array.isArray(snapshot.defenseIgnoreSources) || snapshot.defenseIgnoreSources.some(s => typeof s !== 'string'))) throw new Error('隊伍無視防禦來源無效。');
  return snapshot;
}

function invalidEnvironment(): never { throw new Error('戰鬥破防設定資料無效，請重新設定。'); }

function parseManualSource(source: Omit<ManualDefenseSource, 'kind'>): ManualDefenseSource {
  if (!source || typeof source.id !== 'string' || typeof source.name !== 'string' || typeof source.percentage !== 'string') invalidEnvironment();
  return { kind: 'manual', id: source.id, name: source.name, percentage: source.percentage };
}

function teamSourceId(sources: readonly DefenseSource[]): string {
  const ids = new Set(sources.map(source => source.id));
  let id = 'team-reference';
  while (ids.has(id)) id += '-team';
  return id;
}

export function replaceTeamDefenseSource(value: BattleDefenseEnvironment, snapshot: TeamDefenseSnapshot): DefenseSource[] {
  const current = findTeamDefenseSource(value.sources);
  if (current) {
    const sameTarget = current.snapshot.mode === snapshot.mode && current.snapshot.target === snapshot.target;
    const updated: TeamDefenseSource = { kind: 'team', id: current.id, snapshot,
      ...(sameTarget && current.name !== undefined ? { name: current.name } : {}) };
    return value.sources.map(source => source === current ? updated : source);
  }
  const id = teamSourceId([...value.sources, ...(value.legacyManualSources ?? [])]);
  return [...value.sources, { kind: 'team', id, snapshot }];
}

export function parseBattleDefense(raw: string | null): BattleDefenseEnvironment {
  if (raw === null) return defaultBattleDefense();
  const value = JSON.parse(raw) as BattleDefenseEnvironment | LegacyDefenseEnvironment;
  if (!value || typeof value.manualPercentage !== 'string' || !Array.isArray(value.sources)) invalidEnvironment();
  const manualPercentage = value.manualPercentage;
  if (value.schemaVersion === 1) {
    if (!['manual', 'sources', 'team'].includes(value.mode)) invalidEnvironment();
    const sources = value.sources.map(parseManualSource);
    if (new Set(sources.map(source => source.id)).size !== sources.length) invalidEnvironment();
    const snapshot = value.teamSnapshot == null ? null : validateSnapshot(value.teamSnapshot);
    if (value.mode !== 'team') return { schemaVersion: 2, mode: value.mode, manualPercentage, sources };
    // Activating the previously inactive manual rows would change the saved result.
    return { schemaVersion: 2, mode: 'sources', manualPercentage,
      sources: snapshot ? [{ kind: 'team', id: teamSourceId(sources), snapshot }] : [],
      ...(sources.length ? { legacyManualSources: sources } : {}) };
  }
  if (value.schemaVersion !== 2 || !['manual', 'sources'].includes(value.mode)) invalidEnvironment();
  const sources = value.sources.map((source): DefenseSource => {
    if (!source || typeof source.id !== 'string') invalidEnvironment();
    if (source.kind === 'manual') return parseManualSource(source);
    if (source.kind === 'team') {
      if (source.name !== undefined && typeof source.name !== 'string') invalidEnvironment();
      return { kind: 'team', id: source.id, snapshot: validateSnapshot(source.snapshot),
        ...(source.name !== undefined ? { name: source.name } : {}) };
    }
    return invalidEnvironment();
  });
  const legacy = value.legacyManualSources ?? [];
  if (!Array.isArray(legacy) || legacy.some(source => source?.kind !== 'manual')) invalidEnvironment();
  const legacyManualSources = legacy.map(parseManualSource);
  const ids = [...sources, ...legacyManualSources].map(source => source.id);
  if (new Set(ids).size !== ids.length || sources.filter(source => source.kind === 'team').length > 1) invalidEnvironment();
  return { schemaVersion: 2, mode: value.mode, manualPercentage, sources,
    ...(legacyManualSources.length ? { legacyManualSources } : {}) };
}

export function externalDefenseRate(value: BattleDefenseEnvironment): number {
  if (value.mode === 'manual') {
    if (value.manualPercentage.trim() === '') return 0;
    const rate = parseDefensePercentage(value.manualPercentage);
    if (rate === null) throw new Error('裝備以外來源總破防率請填寫 0～100 的十進位數字，最多八位小數。');
    return rate;
  }
  let teamRate: number | undefined, manualIndex = 0;
  const rates = value.sources.map(source => {
    if (source.kind === 'team') return teamRate = requireDefenseRate(source.snapshot.rate, '隊伍破防快照');
    manualIndex++;
    const rate = source.percentage.trim() === '' ? 0 : parseDefensePercentage(source.percentage);
    if (rate === null) throw new Error(`破防來源第 ${manualIndex} 條尚未完成；請填寫 0～100 的有效破防率，名稱可留空。`);
    return rate;
  });
  // Preserve the exact saved fraction when the team is the only effective source.
  if (teamRate !== undefined && value.sources.every((source, i) => source.kind === 'team' || rates[i] === 0)) return teamRate;
  return combineExternalSources(rates);
}

export function teamDefenseIgnoreAdditive(value: BattleDefenseEnvironment): number {
  const source = value.mode === 'sources' ? findTeamDefenseSource(value.sources) : undefined;
  return requireDefenseRate(source?.snapshot.defenseIgnoreAdditive ?? 0, '隊伍無視防禦加算');
}

/** One page store, with explicit same-document notifications and cross-document storage sync. */
export function createBattleDefenseStore(host: Window) {
  let lastRaw: string | null | undefined;
  let value = defaultBattleDefense(); let readError = ''; let storageError = '';
  const listeners = new Set<() => void>();
  const calculationListeners = new Set<() => void>();
  const read = () => {
    try { lastRaw = host.localStorage.getItem(BATTLE_DEFENSE_KEY); value = parseBattleDefense(lastRaw); readError = ''; }
    catch (error) { readError = error instanceof Error ? error.message : '無法讀取戰鬥破防設定。'; }
  };
  const rate = (): number | null => { try { return readError ? null : externalDefenseRate(value); } catch { return null; } };
  const additive = (): number | null => { try { return readError ? null : teamDefenseIgnoreAdditive(value); } catch { return null; } };
  read();
  let currentRate = rate(), currentAdditive = additive();
  const notify = () => {
    const nextRate = rate(), nextAdditive = additive();
    const calculationChanged = nextRate !== currentRate || nextAdditive !== currentAdditive;
    currentRate = nextRate; currentAdditive = nextAdditive;
    listeners.forEach(listener => listener());
    if (calculationChanged) calculationListeners.forEach(listener => listener());
  };
  const synchronize = (event: StorageEvent) => { if (event.key === BATTLE_DEFENSE_KEY || event.key === null) { read(); notify(); } };
  host.addEventListener('storage', synchronize);
  const resume = () => { try { if (host.localStorage.getItem(BATTLE_DEFENSE_KEY) !== lastRaw) { read(); notify(); } } catch { /* Keep the current page value. */ } };
  host.addEventListener('pageshow', resume);
  return {
    get value() { return value; },
    get error() { try { if (readError) return readError; externalDefenseRate(value); return storageError; } catch (error) { return (error as Error).message; } },
    get hasReadError() { return readError !== ''; },
    get rate() { return currentRate; },
    get defenseIgnoreAdditive() { return currentAdditive; },
    set(next: BattleDefenseEnvironment) {
      value = parseBattleDefense(JSON.stringify(next)); readError = ''; storageError = '';
      try { lastRaw = JSON.stringify(value); host.localStorage.setItem(BATTLE_DEFENSE_KEY, lastRaw); }
      catch { storageError = '此瀏覽器無法保存戰鬥破防設定；目前只在本頁生效。'; }
      notify();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribeCalculation(listener: () => void) { calculationListeners.add(listener); return () => { calculationListeners.delete(listener); }; },
    dispose() { host.removeEventListener('storage', synchronize); host.removeEventListener('pageshow', resume); listeners.clear(); calculationListeners.clear(); },
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
