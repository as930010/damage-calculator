import { teamRevision } from './battle-defense-state.ts';
import { applyUniquenessScope } from '../features/buff-simulator/calculation/team-uniqueness.ts';
import { parseCoreCatalog, type CoreCatalog } from '../features/buff-simulator/frontend/data-loader.ts';
import { parseSavedSimulatorState, resolveSavedMembers, resolveSavedOptions } from '../features/buff-simulator/frontend/saved-state.ts';
import { calculateTeam, calculateChallenge } from '../features/buff-simulator/calculation/engine.ts';
import type { TeamDefenseSnapshot } from './battle-defense-state.ts';

export const NO_TEAM = '目前沒有可引用的有效隊伍配置。請先至隊伍增益模擬完成設定。';


/** Reuses the simulator parser, defaults, option resolution, uniqueness and arena aggregation. */
export function teamDefenseReferences(raw: string | null, catalog: CoreCatalog, dataRevision: string) {
  const saved = parseSavedSimulatorState(raw, catalog);
  if (!saved) throw new Error(NO_TEAM);
  const activeTeams = saved.mode === 'single' ? ['single'] as const : ['first', 'second'] as const;
  for (const team of activeTeams) {
    if ((saved.membersByTeam[team] ?? []).some(name => name.trim() && !resolveSavedMembers(catalog, [name], saved.mode).length)) throw new Error(NO_TEAM);
  }
  const team = (key: 'single' | 'first' | 'second') => ({
    members: resolveSavedMembers(catalog, saved.membersByTeam[key] ?? [], saved.mode),
    options: resolveSavedOptions(catalog, saved.optionsByTeam[key] ?? {}),
  });
  const single = team('single'), first = team('first'), second = team('second');
  const common = { uniqueClassCodes: catalog.classes.filter(c => c.uniquenessGroup === 'green-control').map(c => c.code),
    actionSpeedCap: catalog.parameters.actionSpeedCap,
    // This coefficient is only required to run the existing team engine. Its multipliers are never imported.
    defense: { bossDamageReduction: 0, challengeBreakCoefficient: 0 } };
  const refs: { target: TeamDefenseSnapshot['target']; label: string; rate: number; sources: string[] }[] = [];
  const sourceIds = (teams: typeof single[]) => [...new Set(teams.flatMap(t => [
    ...applyUniquenessScope(teams.flatMap(t => t.members), common.uniqueClassCodes).activeMembers.filter(m => (m.effects.defenseBreak ?? 0) > 0).map(m => '職業：' + m.classCode),
    ...t.options.filter(o => (o.effects.defenseBreak ?? 0) > 0).map(o => '配置效果：' + o.id),
  ]))];
  if (saved.mode === 'single') {
    if (!single.members.length) throw new Error(NO_TEAM);
    refs.push({ target: 'single', label: '單隊', rate: calculateTeam({ ...common, ...single, mode: 'single' }).defenseBreak, sources: sourceIds([single]) });
  } else {
    if (!first.members.length && !second.members.length) throw new Error(NO_TEAM);
    const result = calculateChallenge({ ...common, firstTeam: first, secondTeam: second });
    if (first.members.length) refs.push({ target: 'firstTeam', label: '第一隊', rate: result.firstTeam.defenseBreak, sources: sourceIds([first]) });
    if (second.members.length) refs.push({ target: 'secondTeam', label: '第二隊', rate: result.secondTeam.defenseBreak, sources: sourceIds([second]) });
    refs.push({ target: 'sharedArena', label: '雙隊共用場地', rate: result.sharedArena.defenseBreak, sources: sourceIds([first, second]) });
  }
  const references = refs.map(ref => ({ ...ref, sourceIds: ref.sources, sources: ref.sources.map(source => {
    const optionId = source.startsWith('配置效果：') ? source.slice('配置效果：'.length) : '';
    return optionId ? '配置效果：' + (catalog.loadoutOptions.find(option => option.id === optionId)?.label ?? optionId) : source;
  }) }));
  return { mode: saved.mode, sourceRevision: teamRevision(raw), dataRevision, refs: references };
}

/** Load the simulator's existing hashed data only when the user requests an import. */
export async function loadTeamDefenseReferences(raw: string | null, teamUrl: URL) {
  if (!raw) throw new Error(NO_TEAM);
  const response = await fetch(new URL('asset-manifest.json', teamUrl), { cache: 'no-cache' });
  if (!response.ok) throw new Error(NO_TEAM);
  const manifest = await response.json() as { data: Record<string, string> };
  const names = ['classes', 'class-effects', 'effect-types', 'loadout-options', 'calculation-parameters'];
  const paths = names.map(name => manifest.data?.['data/' + name + '.json']);
  if (paths.some(p => !p || !/^data\/[\w.-]+\.json$/.test(p))) throw new Error(NO_TEAM);
  const payloads = await Promise.all(paths.map(async path => {
    const result = await fetch(new URL(path, teamUrl));
    if (!result.ok) throw new Error(NO_TEAM);
    return result.json() as Promise<unknown>;
  }));
  const catalog = parseCoreCatalog({ classes: payloads[0], classEffects: payloads[1], effectTypes: payloads[2], loadoutOptions: payloads[3], calculationParameters: payloads[4] });
  return teamDefenseReferences(raw, catalog, paths.join('|'));
}
