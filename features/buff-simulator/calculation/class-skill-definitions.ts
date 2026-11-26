/** Shared option identity and copy. Each tool supplies its own effect model. */
export interface ClassSkillVersionOption {
  id: string;
  classId: string;
  label: string;
  scope: 'both' | 'team';
  sourceLabel?: string;
}

export const classSkillVersionOptions: readonly ClassSkillVersionOption[] = [
  { id: 'FP.FatalShotConverted', classId: 'FP', label: '致命神槍是否轉換', scope: 'both' },
  { id: 'DN.FieldPowerConverted', classId: 'DN', label: '原野力量是否轉換', scope: 'both', sourceLabel: 'DN [轉換]原野力量' },
  { id: 'KE.ArmorBreakConverted', classId: 'KE', label: '防禦破壞是否轉換', scope: 'team' },
  { id: 'CeT.TacticalFieldConverted', classId: 'CeT', label: '機動領域是否轉換', scope: 'team' },
  { id: 'SH.NecromancyConverted', classId: 'SH', label: '術式:降靈是否轉換', scope: 'team' },
  { id: 'ES.WarPreludeConverted', classId: 'ES', label: '戰鬥序曲是否轉換', scope: 'team' },
  { id: 'MP.MindBreakConverted', classId: 'MP', label: '精神崩壞是否轉換', scope: 'team' },
];

export const classSkillSourcePrefix = 'class-skill-version:';

export function getClassSkillVersionOptions(classId: string, page: 'calculator' | 'team') {
  return classSkillVersionOptions.filter(option => option.classId === classId && (page === 'team' || option.scope === 'both'));
}

export function normalizeSkillSelections(value: unknown, options: readonly ClassSkillVersionOption[]): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const entries = options.flatMap(({ id }) => typeof input[id] === 'boolean'
    ? [[id, input[id]] as const] : []);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Use preferences only when a user chooses a class for a configuration, never while replaying it. */
export function initializeSkillSelections(options: readonly ClassSkillVersionOption[], preferences: Readonly<Record<string, boolean>>,
  current?: Readonly<Record<string, boolean>>): Record<string, boolean> | undefined {
  const fallback = options.flatMap(({ id }) => current?.[id] === undefined && typeof preferences[id] === 'boolean'
    ? [[id, preferences[id]] as const] : []);
  return fallback.length ? { ...current, ...Object.fromEntries(fallback) } : undefined;
}
