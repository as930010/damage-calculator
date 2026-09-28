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
    row('攻擊下界', 'number', current.attack.lowerDamage, baseline.attack.lowerDamage),
    row('攻擊上界', 'number', current.attack.upperDamage, baseline.attack.upperDamage),
    row('致命一擊', 'percent', current.combatRates.critRate.finalRate * 100, baseline.combatRates.critRate.finalRate * 100),
    row('極大化', 'percent', current.combatRates.extremization.finalRate * 100, baseline.combatRates.extremization.finalRate * 100),
    row('最終傷害', 'number', current.finalDamage.finalDamage, baseline.finalDamage.finalDamage),
  ];
}
