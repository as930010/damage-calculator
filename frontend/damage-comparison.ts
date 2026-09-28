import type { LoadoutCalculationResult } from '../calculation/loadout-engine.ts';

export interface DamageComparisonRow {
  label: string;
  unit: 'number' | 'percent';
  baseline: number;
  current: number;
  delta: number;
  relativeChangePct: number | null;
}

export function compareDamageResults(
  current: LoadoutCalculationResult,
  baseline: LoadoutCalculationResult,
): DamageComparisonRow[] {
  const row = (label: string, unit: DamageComparisonRow['unit'], currentValue: number, baselineValue: number): DamageComparisonRow => {
    const delta = currentValue - baselineValue;
    return {
      label,
      unit,
      baseline: baselineValue,
      current: currentValue,
      delta,
      relativeChangePct: baselineValue === 0 ? null : delta / baselineValue * 100,
    };
  };
  return [
    row('最小攻擊力', 'number', current.attack.lowerDamage, baseline.attack.lowerDamage),
    row('最大攻擊力', 'number', current.attack.upperDamage, baseline.attack.upperDamage),
    row('最終傷害', 'number', current.finalDamage.finalDamage, baseline.finalDamage.finalDamage),
  ];
}
