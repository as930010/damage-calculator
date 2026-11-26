import { teamRevision } from './battle-defense-state.ts';
import { parseCoreCatalog, type CoreCatalog } from '../features/buff-simulator/frontend/data-loader.ts';
import { parseSavedSimulatorState, resolveSavedMembers, resolveSavedOptions, resolveTeamClass } from '../features/buff-simulator/frontend/saved-state.ts';
import { calculateTeam, calculateChallenge } from '../features/buff-simulator/calculation/engine.ts';
import type { TeamCalculationResult } from '../features/buff-simulator/calculation/types.ts';
import type { TeamDefenseSnapshot } from './battle-defense-state.ts';

export const NO_TEAM = '目前沒有可引用的有效隊伍配置。請先至隊伍增益模擬完成設定。';


/** Reuses the simulator parser, defaults, option resolution, uniqueness and arena aggregation. */
export function teamDefenseReferences(raw: string | null, catalog: CoreCatalog, dataRevision: string, requestedMode?: 'single' | 'challenge') {
  let saved: ReturnType<typeof parseSavedSimulatorState>;
  try { saved = parseSavedSimulatorState(raw, catalog); } catch { throw new Error(NO_TEAM); }
  if (!saved) throw new Error(NO_TEAM);
  const mode = requestedMode ?? saved.mode;
  if (mode !== 'single' && mode !== 'challenge') throw new Error(NO_TEAM);
  const missing = requestedMode ? `目前尚無已保存的${mode === 'single' ? '單隊' : '挑戰雙隊'}配置。` : NO_TEAM;
  const activeTeams = mode === 'single' ? ['single'] as const : ['first', 'second'] as const;
  for (const team of activeTeams) {
    if ((saved.membersByTeam[team] ?? []).some(name => name.trim() && !resolveTeamClass(catalog, name))) throw new Error(NO_TEAM);
  }
  const team = (key: 'single' | 'first' | 'second') => ({
    members: resolveSavedMembers(catalog, saved.membersByTeam[key] ?? [], mode, saved.classSkillVersionsByTeam?.[key]),
    options: resolveSavedOptions(catalog, saved.optionsByTeam[key] ?? {}),
  });
  const single = team('single'), first = team('first'), second = team('second');
  const common = { uniqueClassCodes: catalog.classes.filter(c => c.uniquenessGroup === 'green-control').map(c => c.code),
    actionSpeedCap: catalog.parameters.actionSpeedCap,
    includeDefenseContributions: true, damageBase: catalog.damageBase,
    // This coefficient is only required to run the existing team engine. Its multipliers are never imported.
    defense: { bossDamageReduction: 0, challengeBreakCoefficient: 0 } };
  const optionLabels = new Map(catalog.loadoutOptions.map(option => [option.id, option.label]));
  const reference = (target: TeamDefenseSnapshot['target'], label: string, result: TeamCalculationResult) => ({
    target, label, rate: result.defenseBreak, defenseIgnoreAdditive: result.defenseIgnoreAdditive,
    // The engine has already filtered members and merged arena options. Resolved options arrive in catalog order.
    contributions: (result.defenseContributions ?? []).map(source => ({ ...source,
      label: source.id.startsWith('loadout:') ? optionLabels.get(source.label) ?? source.label : source.label })),
  });
  const refs: ReturnType<typeof reference>[] = [];
  if (mode === 'single') {
    if (!single.members.length) throw new Error(missing);
    const result = calculateTeam({ ...common, ...single, mode: 'single' });
    refs.push(reference('single', '單隊', result));
  } else {
    if (!first.members.length && !second.members.length) throw new Error(missing);
    const result = calculateChallenge({ ...common, firstTeam: first, secondTeam: second });
    if (first.members.length) refs.push(reference('firstTeam', '第一隊', result.firstTeam));
    if (second.members.length) refs.push(reference('secondTeam', '第二隊', result.secondTeam));
    refs.push(reference('sharedArena', '雙隊共用場地', result.sharedArena));
  }
  return { mode, sourceRevision: teamRevision(raw), dataRevision, refs };
}

/** Manifest-only version check: never calculates a team or replaces a saved snapshot. */
async function loadTeamDefenseManifest(teamUrl: URL) {
  const response = await fetch(new URL('asset-manifest.json', teamUrl), { cache: 'no-cache' });
  if (!response.ok) throw new Error(NO_TEAM);
  const manifest = await response.json() as { data?: Record<string, string> } | null;
  const names = ['classes', 'class-effects', 'effect-types', 'loadout-options', 'calculation-parameters'];
  const paths = names.map(name => manifest?.data?.['data/' + name + '.json']);
  if (paths.some(p => typeof p !== 'string' || !/^data\/[\w.-]+\.json$/.test(p))) throw new Error(NO_TEAM);
  const validPaths = paths as string[];
  return { paths: validPaths, dataRevision: validPaths.join('|') };
}

export async function loadTeamDefenseDataRevision(teamUrl: URL): Promise<string> {
  return (await loadTeamDefenseManifest(teamUrl)).dataRevision;
}

/** Load the simulator's existing hashed data only when the user requests an import. */
export async function loadTeamDefenseReferences(raw: string | null, teamUrl: URL, requestedMode?: 'single' | 'challenge') {
  if (!raw) throw new Error(NO_TEAM);
  const { paths, dataRevision } = await loadTeamDefenseManifest(teamUrl);
  const payloads = await Promise.all(paths.map(async path => {
    const result = await fetch(new URL(path, teamUrl));
    if (!result.ok) throw new Error(NO_TEAM);
    return result.json() as Promise<unknown>;
  }));
  const catalog = parseCoreCatalog({ classes: payloads[0], classEffects: payloads[1], effectTypes: payloads[2], loadoutOptions: payloads[3], calculationParameters: payloads[4] });
  return teamDefenseReferences(raw, catalog, dataRevision, requestedMode);
}
