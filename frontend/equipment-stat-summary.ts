import { formatNumber, type AttributeMetadata } from './data.ts';

export const equipmentStatOrder = [
  // Base attack and attack modifiers.
  'physicalAttack', 'magicalAttack', 'attackLevel', 'doubleAttackPct',
  // Adaptability and general encounter modifiers.
  'adaptabilityPct', 'superAdaptabilityPct', 'polarizationPct', 'defenseIgnorePct',
  // Critical hits and combat rates.
  'critRatePct', 'extremizationPct', 'critDamagePct', 'actionSpeedPct', 'cooldownResetPct',
  // Boss and skill damage.
  'bossDamagePct', 'skillTypeAttackPct', 'allSkillDamagePct', 'strongSkillDamagePct', 'transcendenceSkillDamagePct',
  // Conditional and product effects.
  'strongerPct', 'heatPct', 'bleedDamagePct', 'fullHealthKillDamagePct',
  'multiplicativeDamagePct', 'multiplicativeCritDamagePct',
] as const;

export function createEquipmentStatSummary(attributes: readonly Pick<AttributeMetadata, 'key' | 'name' | 'unit'>[]) {
  const rankByKey = new Map<string, number>(equipmentStatOrder.map((key, index) => [key, index]));
  const displayByKey = new Map(attributes.map(({ key, name, unit }) => [
    key,
    unit === 'percent'
      ? { name: name.trimEnd().replace(/\s*[%％]$/u, ''), suffix: '%' }
      : { name, suffix: '' },
  ]));

  return (stats: Readonly<Record<string, number>>) => Object.entries(stats)
    .filter(([, value]) => value !== 0)
    .sort(([left], [right]) => {
      const byRank = (rankByKey.get(left) ?? equipmentStatOrder.length)
        - (rankByKey.get(right) ?? equipmentStatOrder.length);
      return byRank || (left < right ? -1 : left > right ? 1 : 0);
    })
    .map(([key, value]) => {
      const display = displayByKey.get(key);
      return `${display?.name ?? key} ${formatNumber(value)}${display?.suffix ?? ''}`;
    })
    .join(' · ');
}
