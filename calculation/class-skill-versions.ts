import { resolveClassId } from './class-effects.ts';
import type { ClassCombatEffectsDocument, CombatAttribute } from './types.ts';

interface ClassSkillVersionOption {
  id: string;
  classId: string;
  label: string;
  defaultEnabled: boolean;
  effects: readonly { attribute: CombatAttribute; effectId: string }[];
}

// Options control only their listed effects; independent class passives stay intact.
const classSkillVersionOptions: readonly ClassSkillVersionOption[] = [
  { id: 'FP.FatalShotConverted', classId: 'FP', label: '致命神槍是否轉換', defaultEnabled: true,
    effects: [{ attribute: 'critRate', effectId: 'crit-1' }] },
];

export function getClassSkillVersionOptions(classId: string) {
  return classSkillVersionOptions.filter(option => option.classId === classId);
}

export function isClassSkillVersionEnabled(option: ClassSkillVersionOption, selections?: Readonly<Record<string, boolean>>): boolean {
  const value = selections?.[option.id];
  return typeof value === 'boolean' ? value : option.defaultEnabled;
}

/** Missing legacy settings keep each option's default without adding synthetic state. */
export function normalizeClassSkillVersions(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const entries = classSkillVersionOptions.flatMap(option => {
    const selected = input[option.id];
    return typeof selected === 'boolean' ? [[option.id, selected] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Select a class profile before passing it to the unchanged combat formulas. */
export function applyClassSkillVersions(document: ClassCombatEffectsDocument, requestedClassId: string,
  selections?: Readonly<Record<string, boolean>>): ClassCombatEffectsDocument {
  const classId = resolveClassId(document, requestedClassId);
  const disabled = getClassSkillVersionOptions(classId).filter(option => !isClassSkillVersionEnabled(option, selections));
  if (!disabled.length) return document;
  const profile = { ...document.classes[classId] };
  for (const attribute of ['critRate', 'extremization'] as const) {
    const excluded = new Set(disabled.flatMap(option => option.effects.filter(effect => effect.attribute === attribute).map(effect => effect.effectId)));
    if (excluded.size) profile[attribute] = profile[attribute].filter(effect => !excluded.has(effect.id));
  }
  return { ...document, classes: { ...document.classes, [classId]: profile } };
}
