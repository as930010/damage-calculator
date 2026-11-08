import { normalizeSupportMagazineLevel, supportMagazineLevelKey } from '../calculation/support-magazines.ts';
import type { CoreCatalog } from './data-loader.ts';
import type { SelectedMember, SelectedOption, TeamMode } from '../calculation/types.ts';
import { resolveLoadoutOption } from '../calculation/options.ts';

export const TEAM_STATE_KEY = 'buff-team-simulator.state.v1';
export type TeamKey = 'single' | 'first' | 'second';
export interface SavedSimulatorState {
  version: 1; mode: TeamMode;
  membersByTeam: Partial<Record<TeamKey, string[]>>;
  optionsByTeam: Partial<Record<TeamKey, Record<string, boolean | number>>>;
  bossReductions: Partial<Record<TeamMode, number>>;
  optionDisclosureOpen: Partial<Record<TeamKey, boolean>>;
}

/** Shared with snapshot consumers; invalid values follow the simulator's existing defaults. */
export function parseSavedSimulatorState(raw: string | null, catalog: CoreCatalog): SavedSimulatorState | null {
  if (!raw) return null;
  const saved = JSON.parse(raw) as Partial<SavedSimulatorState> | null;
  if (!saved || saved.version !== 1 || !['single', 'challenge'].includes(saved.mode ?? '')) return null;
  const result: SavedSimulatorState = { version: 1, mode: saved.mode!, membersByTeam: {}, optionsByTeam: {}, bossReductions: {}, optionDisclosureOpen: {} };
  for (const team of ['single', 'first', 'second'] as const) {
    const members = saved.membersByTeam?.[team];
    result.membersByTeam[team] = Array.from({ length: team === 'single' ? 6 : 4 }, (_, i) =>
      Array.isArray(members) && typeof members[i] === 'string' ? members[i].slice(0, 120) : '');
    const options: Record<string, boolean | number> = {};
    for (const option of catalog.loadoutOptions) {
      const value = saved.optionsByTeam?.[team]?.[option.id];
      if (option.userInput?.kind === 'support-magazine') {
        const levelKey = supportMagazineLevelKey(option.id), previous = saved.optionsByTeam?.[team];
        if (previous && (Object.hasOwn(previous, option.id) || Object.hasOwn(previous, levelKey))) {
          options[option.id] = typeof value === 'boolean' ? value : false;
          options[levelKey] = normalizeSupportMagazineLevel(previous[levelKey]);
        }
      } else if (option.userInput?.kind === 'percentage') {
        const defaultValue = catalog.parameters[option.userInput.parameter] * 100;
        options[option.id] = typeof value === 'number' && Number.isFinite(value) && value >= 0
          ? Math.abs(value - defaultValue) < 1e-7 ? Number(defaultValue.toFixed(6)) : value : defaultValue;
      } else if (option.presentation !== 'background') options[option.id] = typeof value === 'boolean' ? value : option.defaultSelected;
    }
    result.optionsByTeam[team] = options;
    if (typeof saved.optionDisclosureOpen?.[team] === 'boolean') result.optionDisclosureOpen[team] = saved.optionDisclosureOpen[team];
  }
  for (const mode of ['single', 'challenge'] as const) {
    const value = saved.bossReductions?.[mode];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) result.bossReductions[mode] = value;
  }
  return result;
}

export function resolveSavedMembers(catalog: CoreCatalog, names: readonly string[], mode: TeamMode): SelectedMember[] {
  return names.flatMap(value => {
    const record = catalog.classes.find(item => item.enabled && [item.code, item.name].some(name => name.toLocaleLowerCase() === value.trim().toLocaleLowerCase()));
    if (!record) return [];
    const profile = catalog.classEffects.find(item => item.classId === record.id && item.mode === mode);
    return [{ classId: record.id, classCode: record.code, effects: profile?.effects ?? {}, uniquenessGroup: record.uniquenessGroup }];
  });
}

export function resolveSavedOptions(catalog: CoreCatalog, values: Record<string, boolean | number>): SelectedOption[] {
  return catalog.loadoutOptions.map(option => {
    if (option.userInput?.kind === 'support-magazine') return resolveLoadoutOption(option, catalog.parameters, values[option.id] === true, values[supportMagazineLevelKey(option.id)]);
    if (option.userInput?.kind === 'percentage') {
      const parameter = option.userInput.parameter;
      return resolveLoadoutOption(option, { ...catalog.parameters, [parameter]: Number(values[option.id] ?? catalog.parameters[parameter] * 100) / 100 }, true);
    }
    return resolveLoadoutOption(option, catalog.parameters, option.presentation === 'background' || Boolean(values[option.id] ?? option.defaultSelected));
  });
}
