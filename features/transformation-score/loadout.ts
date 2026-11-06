import { calculateLoadout } from '../../calculation/loadout-engine.ts';
import { resolveWeaponTransformationsFromFields } from '../../calculation/weapon-transformations.ts';
import type { GameData } from '../../frontend/data.ts';
import { evaluateLoadout } from '../../frontend/projection.ts';
import type { LoadoutState } from '../../frontend/state.ts';
import { compareRolls, ratingRule, type Selection } from './scoring.ts';
import { normalizeTransformationSelections, normalizeTransformationValues, UNRELATED_TRANSFORMATION } from '../../calculation/transformation-selections.ts';

export function readRatingLoadout(data: GameData, state: LoadoutState) {
  const job = data.classes.classes.find(entry => entry.id === state.Job);
  if (!job) throw new Error('目前配裝的職業無法辨識。');
  const transforms = data.transformations;
  const enhancementText = String(state.values[transforms.enhancementField] ?? '');
  const enhancement = Number(enhancementText.match(/\d+/)?.[0]);
  if (![10, 11, 12, 13].includes(enhancement)) throw new Error('請在傷害計算機選擇 +10 至 +13 的武器，再重新讀取配裝。');
  const rules = transforms.rules.map(ratingRule);
  const values = { ...state.values };
  const warnings = normalizeTransformationValues(transforms, values).messages;
  const rawActual = transforms.slots.map(({ choiceField, valueField }) => {
    const choice = String(values[choiceField] ?? '');
    const value = values[valueField];
    delete values[choiceField];
    delete values[valueField];
    const rule = rules.find(item => item.choice === choice);
    const raw = rule && value != null && value !== '' ? Number(value) * rule.valueMultiplier : null;
    const roll = raw === null ? null : rule?.rolls.find(tier => Math.abs(tier - raw) < 1e-8) ?? raw;
    return { choice, roll };
  });
  const actual = normalizeTransformationSelections(rawActual);
  if (actual.some((line, i) => line.choice !== rawActual[i].choice)) warnings.push('重複的有效傷害詞條已在本頁模擬中清空，保留第一條。');
  const evaluation = evaluateLoadout(data, { ...state, values }, false, true);
  const input = 'comparisonInput' in evaluation ? evaluation.comparisonInput : undefined;
  const result = evaluation.damage?.result;
  if (!input || !result) throw evaluation.damageError ?? new Error('目前配裝無法計算。');
  const baselineDamage = result.finalDamage.finalDamage;
  if (!(baselineDamage > 0)) throw new Error('目前配裝的基準傷害必須大於零。');
  const simulatedDamage = (lines: readonly Selection[]) => {
    const simulated: Record<string, string | number> = { [transforms.enhancementField]: enhancementText };
    normalizeTransformationSelections(lines).forEach(({ choice, roll }, i) => {
      if (!choice || choice === UNRELATED_TRANSFORMATION || roll === null) return;
      const rule = rules.find(item => item.choice === choice);
      if (!rule) throw new Error('無法辨識變換屬性。');
      const slot = transforms.slots[i];
      simulated[slot.choiceField] = choice;
      simulated[slot.valueField] = roll / rule.valueMultiplier;
    });
    const sources = resolveWeaponTransformationsFromFields(transforms, simulated);
    if (!sources.length) return baselineDamage;
    try {
      const damage = calculateLoadout({ ...input, sources: { ...input.sources, shared: [...input.sources.shared, ...sources] } }).finalDamage.finalDamage;
      return Number.isFinite(damage) && damage > 0 ? damage : null;
    } catch (error) {
      if (error instanceof RangeError && error.message === 'Defense factor denominator is zero.') return null;
      throw error;
    }
  };
  return { job, enhancement, attackLevel: result.attributes.stats.attackLevel?.finalTotal ?? 0, actual, rules, warnings,
    weighting: result.finalDamage.skillDamageWeighting, bossDefense: input.enemyDefensePct,
    baselineDamage, simulatedDamage, ...compareRolls(baselineDamage, rules, simulatedDamage) };
}
