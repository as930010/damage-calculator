import type { WeaponTransformationRule } from '../../calculation/weapon-transformations.ts';
import { transformationRolls, normalizeTransformationSelections, UNRELATED_TRANSFORMATION } from '../../calculation/transformation-selections.ts';

export interface Selection { choice: string; roll: number | null }
export type RatingRule = WeaponTransformationRule & { rolls: number[] };
type DamageFor = (lines: readonly Selection[]) => number | null;

export function ratingRule(rule: WeaponTransformationRule): RatingRule {
  const rolls = transformationRolls(rule);
  return { ...rule, rolls };
}

export function compareRolls(before: number, rules: readonly RatingRule[], damageFor: DamageFor) {
  const comparisons = rules.map(rule => ({
    rule,
    gains: rule.rolls.map(roll => {
      const damage = damageFor([{ choice: rule.choice, roll }]);
      return damage === null ? null : damage / before - 1;
    }),
  }));
  function reference(high: boolean) {
    const candidates = comparisons.flatMap(({ rule, gains }, order) => {
      const index = high ? gains.length - 1 : 0;
      const gain = gains[index];
      return gain === null || !Number.isFinite(gain) || gain < 0 ? [] : [{ choice: rule.choice, roll: rule.rolls[index], gain, order }];
    });
    const top = candidates.sort((a, b) => (high ? b.gain - a.gain : a.gain - b.gain) || a.order - b.order).slice(0, 4);
    const damage = top.length === 4 ? damageFor(top) : null;
    return damage === null ? null : { gain: damage / before - 1, selections: top.map(({ choice, roll }) => ({ choice, roll })) };
  }
  const lowerReference = reference(false);
  const upperReference = reference(true);
  // Keep the original bottom-tier grade boundary independently of the new low-gain reference.
  const gradeCandidates = comparisons.flatMap(({ rule, gains }) => {
    const gain = gains[0];
    return gain === null || !Number.isFinite(gain) || gain < 0 ? [] : [{ choice: rule.choice, roll: rule.rolls[0], gain }];
  }).sort((a, b) => b.gain - a.gain).slice(0, 4);
  const gradingDamage = gradeCandidates.length === 4 ? damageFor(gradeCandidates) : null;
  return {
    comparisons,
    lower: lowerReference?.gain ?? null,
    upper: upperReference?.gain ?? null,
    gradingLower: gradingDamage === null ? null : gradingDamage / before - 1,
    lowerSelection: lowerReference?.selections ?? [],
    upperSelection: upperReference?.selections ?? [],
  };
}

export function gradeGain(gain: number, lower: number, upper: number) {
  if (gain >= upper * .97) return '陽壽-1，或你填錯數值';
  if (gain >= upper * .9) return '大畢業，可考慮不繼續洗';
  if (gain >= upper * .8) return '小畢業，可用備份慢慢提升';
  if (gain >= upper * .65) return '優質，可等有足夠ED再洗';
  if (gain >= lower) return '堪用，ED不夠可以暫留';
  return '我不是針對你，我是說…';
}

export function scoreConfiguration(context: {
  baselineDamage: number; simulatedDamage: DamageFor; rules: readonly RatingRule[];
  lower: number | null; upper: number | null;
  gradingLower?: number | null;
}, lines: readonly Selection[]) {
  if (lines.length !== 4) throw new Error('請設定四個變換欄位。');
  lines = normalizeTransformationSelections(lines);
  for (const line of lines) {
    if (!line.choice || line.choice === UNRELATED_TRANSFORMATION) continue;
    const rule = context.rules.find(item => item.choice === line.choice);
    if (!rule) throw new Error('無法辨識變換屬性。');
    if (line.roll === null || !rule.rolls.includes(line.roll)) throw new Error(rule.label + ' 的數值不在有效檔位內。');
  }
  const before = context.baselineDamage;
  const after = context.simulatedDamage(lines);
  if (after === null) throw new Error('這組變換超出有效傷害計算範圍。');
  const gain = after / before - 1;
  const { lower, upper } = context;
  if (upper === null || lower === null || upper <= 0) throw new Error('目前配裝無法建立有效的評分基準。');
  return { before, after, gain, pr: gain / upper * 100, grade: gradeGain(gain, context.gradingLower ?? lower, upper) };
}
