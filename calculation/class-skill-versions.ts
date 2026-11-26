import { resolveClassId } from './class-effects.ts';
import type { ClassCombatEffectsDocument, CombatAttribute, StatContribution } from './types.ts';
import { classSkillSourcePrefix, classSkillVersionOptions, getClassSkillVersionOptions, type ClassSkillVersionOption } from '../features/buff-simulator/calculation/class-skill-definitions.ts';

export { getClassSkillVersionOptions };

// Each option controls only its own effects.
const convertedCombatEffects: Readonly<Record<string, readonly { attribute: CombatAttribute; effectId: string }[]>> = {
  'FP.FatalShotConverted': [{ attribute: 'critRate', effectId: 'crit-1' }],
};
const convertedStatEffects: Readonly<Record<string, StatContribution['stats']>> = {
  'DN.FieldPowerConverted': { critDamagePct: 9.2 },
};

export function classSkillVersionSourceLabel(sourceId: string): string | undefined {
  if (sourceId.startsWith(classSkillSourcePrefix)) return classSkillVersionOptions.find(option => option.id === sourceId.slice(classSkillSourcePrefix.length))?.sourceLabel;
}

export function resolveClassSkillVersionContributions(classId: string,
  selections?: Readonly<Record<string, boolean>>): StatContribution[] {
  return getClassSkillVersionOptions(classId).flatMap(option => {
    const effect = convertedStatEffects[option.id];
    return effect && isClassSkillVersionEnabled(option, selections)
      ? [{ sourceId: classSkillSourcePrefix + option.id, stats: effect }] : [];
  });
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
  const excludedEffects = getClassSkillVersionOptions(classId).flatMap(option =>
    isClassSkillVersionEnabled(option, selections) ? [] : convertedCombatEffects[option.id] ?? []);
  if (!excludedEffects.length) return document;
  const profile = { ...document.classes[classId] };
  for (const attribute of ['critRate', 'extremization'] as const) {
    const excluded = new Set(excludedEffects.filter(effect => effect.attribute === attribute).map(effect => effect.effectId));
    if (excluded.size) profile[attribute] = profile[attribute].filter(effect => !excluded.has(effect.id));
  }
  return { ...document, classes: { ...document.classes, [classId]: profile } };
}
