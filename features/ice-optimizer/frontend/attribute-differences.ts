import { formatNumber } from '../../../frontend/data.ts';
import type { GameData } from '../../../frontend/data.ts';
import type { projectDamage } from '../../../frontend/projection.ts';

type DamageProjection = ReturnType<typeof projectDamage>;

/** Compare the effective attribute totals shown by the damage calculator, not individual equipment sources. */
export function attributeDifferences(data: GameData, classId: string,
  before: DamageProjection, after: DamageProjection): string[] {
  const differences: string[] = [];
  const add = (label: string, previous: number, current: number, suffix = '') => {
    const delta = current - previous;
    if (!Number.isFinite(delta)) return;
    const magnitude = formatNumber(Math.abs(delta));
    if (magnitude !== '0') differences.push(`${label} ${delta > 0 ? '+' : '−'}${magnitude}${suffix}`);
  };
  const beforeStats = before.attributes.stats;
  const afterStats = after.attributes.stats;
  const attackKey = data.classes.classes.find(entry => entry.id === classId)?.attackType === 'physical'
    ? 'physicalAttack' : 'magicalAttack';
  add('攻擊力', beforeStats[attackKey]?.finalTotal ?? 0, afterStats[attackKey]?.finalTotal ?? 0);

  for (const attribute of data.attributes.attributes) {
    const { key, name, unit } = attribute;
    if (key === 'physicalAttack' || key === 'magicalAttack'
      || key === 'strongerPct' || key === 'heatPct'
      || key === 'multiplicativeDamagePct' || key === 'multiplicativeCritDamagePct') continue;
    const previous = beforeStats[key]?.finalTotal ?? 0;
    const current = afterStats[key]?.finalTotal ?? 0;
    const supplement = (projection: DamageProjection) => projection.result.classCritDamagePassivePct
      + projection.result.multiplicativeCritDamage.value * 100;
    add(name.replace(/%$/, ''),
      previous + (key === 'critDamagePct' ? supplement(before) : 0),
      current + (key === 'critDamagePct' ? supplement(after) : 0),
      unit === 'percent' ? '%' : '');
  }
  add('強者', before.attributes.conditionalDamage.strongerPct,
    after.attributes.conditionalDamage.strongerPct, '%');
  add('排熱', before.attributes.conditionalDamage.heatPct,
    after.attributes.conditionalDamage.heatPct, '%');
  add('乘算效果倍率', before.result.generalMultiplicativeDamage.value,
    after.result.generalMultiplicativeDamage.value, '×');
  return differences;
}
