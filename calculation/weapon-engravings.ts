import type { StatContribution } from './types.ts';

const fixedValues = ['4', '5'] as const;
const dynamicValue = 'enhancement';
const scalableValues = [...fixedValues, dynamicValue] as const;

export const weaponEngravingEffects = [
  { id: 'attack', label: '攻擊力%', statKey: 'multiplicativeDamagePct', values: scalableValues },
  { id: 'critical-damage', label: '致命一擊傷害%', statKey: 'multiplicativeCritDamagePct', values: scalableValues },
  { id: 'defense-ignore', label: '無視防禦力%', statKey: 'defenseIgnorePct', values: fixedValues },
  { id: 'boss-damage', label: 'Boss 傷害增加%', statKey: 'bossDamagePct', values: fixedValues },
  { id: 'all-skill-damage', label: '所有技能傷害%', statKey: 'multiplicativeDamagePct', values: scalableValues },
  { id: 'unrelated', label: '無關傷害', statKey: null, values: [] },
] as const;

export const weaponEngravingSlots = [1, 2, 3].map(line => ({
  line,
  enabledField: `Weapon.Engraving.${line}.Enabled`,
  effectField: `Weapon.Engraving.${line}.Effect`,
  valueField: `Weapon.Engraving.${line}.Value`,
  sourceId: `weapon-engraving:${line}`,
}));

type FieldValues = Readonly<Record<string, unknown>>;

export function weaponEngravingEffect(id: unknown) {
  return weaponEngravingEffects.find(effect => effect.id === id);
}

export function weaponEngravingValueLabel(value: string): string {
  return value === dynamicValue ? '強化×0.5%' : `${value}%`;
}

export function availableWeaponEngravingEffects(values: FieldValues, effectField: string) {
  const reserved = new Set(weaponEngravingSlots
    .filter(slot => slot.effectField !== effectField)
    .map(slot => values[slot.effectField]));
  return weaponEngravingEffects.filter(effect => effect.statKey === null || !reserved.has(effect.id));
}

export function invalidWeaponEngravingFields(values: FieldValues): string[] {
  const invalid: string[] = [];
  const reserved = new Set<string>();
  for (const { enabledField, effectField, valueField } of weaponEngravingSlots) {
    const enabled = String(values[enabledField] ?? '');
    if (enabled !== '' && enabled !== '0' && enabled !== '1') invalid.push(enabledField);

    const chosen = values[effectField];
    const effect = weaponEngravingEffect(chosen);
    const duplicate = !!effect?.statKey && reserved.has(effect.id);
    if (chosen !== undefined && chosen !== '' && (!effect || duplicate)) invalid.push(effectField);
    const value = String(values[valueField] ?? '');
    if (value && (duplicate || !effect?.values.some(option => option === value))) invalid.push(valueField);
    if (effect?.statKey) reserved.add(effect.id);
  }
  return invalid;
}

export function clearInvalidWeaponEngravingFields(values: Record<string, string | number>): string[] {
  const invalid = invalidWeaponEngravingFields(values);
  for (const field of invalid) delete values[field];
  return invalid;
}

export function resolveWeaponEngravingSources(
  values: FieldValues,
  enhancementFactors: Readonly<Record<string, number>>,
): StatContribution[] {
  const invalid = invalidWeaponEngravingFields(values);
  if (invalid.length) throw new RangeError(`刻印石含無效或重複欄位（${invalid.join('、')}）。`);

  const sources: StatContribution[] = [];
  for (const { enabledField, effectField, valueField, sourceId } of weaponEngravingSlots) {
    if (String(values[enabledField]) !== '1') continue;
    const effect = weaponEngravingEffect(values[effectField]);
    const value = String(values[valueField] ?? '');
    if (!effect?.statKey || !value) continue;
    let valuePct = Number(value);
    if (value === dynamicValue) {
      const level = String(values['Weapon.ENHC'] ?? '').match(/^(?:Lv\.|\+)?(\d+)$/)?.[1];
      if (!level || !Object.hasOwn(enhancementFactors, level)) continue;
      valuePct = Number(level) * 0.5;
    }
    sources.push({ sourceId, stats: { [effect.statKey]: valuePct } });
  }
  return sources;
}
