import type { DamageBase } from '../calculation/types.ts';

export const damageDraftKey = 'dab-loadout-v1';
export const damageDraftJournalKey = 'damage-calculator.profile-switch.v1';

export function validDamageBase(value: unknown): value is DamageBase {
  if (!value || typeof value !== 'object') return false;
  const { critDamagePct, bossDamagePct } = value as Partial<DamageBase>;
  return typeof critDamagePct === 'number' && Number.isFinite(critDamagePct) && critDamagePct > 0
    && typeof bossDamagePct === 'number' && Number.isFinite(bossDamagePct) && bossDamagePct >= 0;
}

export function normalizeDamageBase(value: unknown): DamageBase | undefined {
  if (!validDamageBase(value)) return undefined;
  const normalized = {
    critDamagePct: Number(value.critDamagePct.toFixed(3)),
    bossDamagePct: Number(value.bossDamagePct.toFixed(3)),
  };
  return validDamageBase(normalized) ? normalized : undefined;
}

export function parseDamageBasis(value: unknown, defaults: DamageBase): DamageBase | undefined {
  if (!value || typeof value !== 'object') return undefined;
  // Version 1 of the former reference stored the original pair in reference.base.
  const saved = value as { mode?: string; manual?: unknown; reference?: { version?: number; base?: unknown } };
  const original = saved.mode === 'reference' && saved.reference?.version === 1 ? saved.reference.base : undefined;
  return normalizeDamageBase(value) ?? normalizeDamageBase(original) ?? normalizeDamageBase(saved.manual) ?? defaults;
}
