import type { WeaponTransformationDocument, WeaponTransformationRule } from './weapon-transformations.ts';

export const UNRELATED_TRANSFORMATION = '無關傷害';
export interface TransformationSelection { choice: string; roll: number | null }

export function transformationRolls(rule: WeaponTransformationRule): number[] {
  const count = Math.round((rule.maxRoll - rule.minRoll) / rule.step) + 1;
  return Array.from({ length: count }, (_, i) => (rule.minRoll * 10 + i * rule.step * 10) / 10);
}

/** Stored percentages are fractions; levels are unscaled numeric values. */
export function validTransformationValue(rule: WeaponTransformationRule, raw: unknown): boolean {
  if (typeof raw !== 'number' && typeof raw !== 'string') return false;
  if (typeof raw === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) return false;
  const roll = Number(raw) * rule.valueMultiplier;
  return Number.isFinite(roll) && transformationRolls(rule).some(tier => Math.abs(tier - roll) <= 1e-8);
}

export function normalizeTransformationValues(document: WeaponTransformationDocument,
  values: Record<string, unknown>, rules: ReadonlyMap<string, WeaponTransformationRule> = new Map(document.rules.map(rule => [rule.choice, rule]))): { fields: string[]; messages: string[] } {
  const fields: string[] = [], messages: string[] = [];
  document.slots.forEach((slot, index) => {
    const choice = String(values[slot.choiceField] ?? '');
    const raw = values[slot.valueField];
    if (raw === undefined || raw === '') return;
    const rule = rules.get(choice);
    if (rule && validTransformationValue(rule, raw)) return;
    delete values[slot.valueField];
    fields.push(slot.valueField);
    const numeric = Number(raw);
    const display = rule && Number.isFinite(numeric)
      ? String(Number((numeric * rule.valueMultiplier).toFixed(8))) + (rule.valueMultiplier === 1 ? ' 級' : '%') : String(raw);
    const reason = rule ? '不符合 ' + rule.minRoll + '～' + rule.maxRoll + (rule.valueMultiplier === 1 ? ' 級' : '%') + '、步進 ' + rule.step + ' 的有效檔位'
      : '沒有可對應的有效傷害屬性';
    messages.push('武器變換第 ' + (index + 1) + ' 條「' + (rule?.label ?? (choice || '未設定')) + '」的數值 ' + display + ' ' + reason + '，已清空。');
  });
  return { fields, messages };
}

/** Keep the first effective choice. Blank and explicitly unrelated slots have no roll. */
export function normalizeTransformationSelections(lines: readonly TransformationSelection[]): TransformationSelection[] {
  const used = new Set<string>();
  return lines.map(line => {
    if (!line.choice || line.choice === UNRELATED_TRANSFORMATION) return { choice: line.choice, roll: null };
    if (used.has(line.choice)) return { choice: '', roll: null };
    used.add(line.choice);
    return { ...line };
  });
}
