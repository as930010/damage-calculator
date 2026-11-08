import { DefenseRateError } from '../../calculation/battle-defense.ts';
import { resolveNephronArmorSources } from '../../calculation/nephron-armor.ts';
import { attributeLabel } from '../../frontend/attribute-label.ts';
import { calculateLoadout } from '../../calculation/loadout-engine.ts';
import { resolveWeaponTransformationsFromFields } from '../../calculation/weapon-transformations.ts';
import type { GameData } from '../../frontend/data.ts';
import { evaluateLoadout } from '../../frontend/projection.ts';
import type { LoadoutState } from '../../frontend/state.ts';
import { compareRolls, ratingRule, type Selection } from './scoring.ts';
import { normalizeTransformationSelections, normalizeTransformationValues, UNRELATED_TRANSFORMATION } from '../../calculation/transformation-selections.ts';

export function readRatingLoadout(data: GameData, state: LoadoutState, externalDefenseBreakRate: number | null = 0, defenseIgnoreAdditive: number | null = 0) {
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
  const evaluation = evaluateLoadout(data, { ...state, values }, false, true, externalDefenseBreakRate, defenseIgnoreAdditive);
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
      if (error instanceof DefenseRateError || (error instanceof RangeError && error.message === 'Defense factor denominator is zero.')) return null;
      throw error;
    }
  };
  return { job, enhancement, attackLevel: result.attributes.stats.attackLevel?.finalTotal ?? 0, actual, rules, warnings,
    weighting: result.finalDamage.skillDamageWeighting, bossDefense: input.enemyDefensePct,
    baselineDamage, simulatedDamage, ...compareRolls(baselineDamage, rules, simulatedDamage) };
}

/** Armor field identifiers and tier units are supplied by the same rules as the homepage. */
export function readArmorRatingLoadout(data: GameData, state: LoadoutState, slotId: string, externalDefenseBreakRate: number | null = 0, defenseIgnoreAdditive: number | null = 0) {
  const slot = data.innerwear.slots.find(item => item.id === slotId);
  const field = data.nephronArmor.fields.find(item => item.slotId === slotId);
  if (!slot || !field) throw new Error('無法辨識防具部位。');
  if (state.values[slot.typeField] !== '內布隆') throw new Error(`目前配裝的${slot.name}不是內布隆防具，請先至傷害計算機設定對應裝備。`);
  const condition = state.bossHealthCondition?.enabled ? state.bossHealthCondition : undefined;
  if (field.wearSet !== 'shared' && (condition ? condition.lowerwear !== field.wearSet
      : field.wearSet === 'lowerwearB' && !state.lowerwearAlternativeEnabled)) {
    throw new Error(`${slot.name}未參與首頁目前的下衣計算條件，請調整首頁條件或選擇其他部位。`);
  }
  const job = data.classes.classes.find(item => item.id === state.Job);
  if (!job) throw new Error('目前配裝的職業無法辨識。');
  const enhancement = Number(String(state.values[slot.enhancementField] ?? '').match(/\d+/)?.[0]);
  if (!Number.isSafeInteger(enhancement)) throw new Error(`請先設定${slot.name}的強化等級。`);
  const rules = data.nephronArmor.transformations.filter(item => item.statKey && item.tierValuesPct.length).map(item => ({
    choice: item.name, label: attributeLabel(item.name), statKey: item.statKey!, valueMultiplier: 100,
    minRoll: item.tierValuesPct[0], maxRoll: item.tierValuesPct.at(-1)!,
    step: Number((item.tierValuesPct[1] - item.tierValuesPct[0]).toFixed(8)), rolls: [...item.tierValuesPct],
    scaleByEnhancement: item.multipliesByEnhancementLevel,
  }));
  const values = { ...state.values };
  const warnings: string[] = [];
  const actual = normalizeTransformationSelections(field.transformFields.map(({ attributeField, valueField }, i) => {
    const choice = String(values[attributeField] ?? '');
    const rule = rules.find(item => item.choice === choice);
    const raw = values[valueField];
    const roll = rule && raw !== undefined && raw !== '' ? rule.rolls.find(tier => Math.abs(tier - Number(raw) * 100) < 1e-8) ?? null : null;
    if (choice && choice !== UNRELATED_TRANSFORMATION && (!rule || roll === null)) warnings.push(`${slot.name}第 ${i + 1} 條變換未有有效數值，請重新選擇。`);
    delete values[attributeField]; delete values[valueField];
    return { choice: rule || choice === UNRELATED_TRANSFORMATION ? choice : '', roll };
  }));
  const baseline = evaluateLoadout(data, { ...state, values }, false, true, externalDefenseBreakRate, defenseIgnoreAdditive);
  const input = 'comparisonInput' in baseline ? baseline.comparisonInput : undefined;
  const result = baseline.damage?.result;
  if (!input || !result) throw baseline.damageError ?? new Error('目前配裝無法計算。');
  const baselineDamage = result.finalDamage.finalDamage;
  if (!(baselineDamage > 0) || !Number.isFinite(baselineDamage)) throw new Error('目前配裝的基準傷害無效。');
  const wearSet = condition && field.wearSet !== 'shared' ? 'lowerwearA' : field.wearSet;
  const simulatedDamage = (lines: readonly Selection[]) => {
    const normalized = normalizeTransformationSelections(lines);
    const sources = resolveNephronArmorSources(data.nephronArmor, [{ slotId, enhancement,
      transformations: field.transformFields.map((_, i) => ({ attribute: normalized[i]?.choice ?? '',
        value: normalized[i]?.roll == null ? undefined : normalized[i].roll! / 100 })),
      magazine: '', magazineLevel: undefined }]);
    try {
      const damage = calculateLoadout({ ...input, sources: { ...input.sources, [wearSet]: [...input.sources[wearSet], ...sources] } }).finalDamage.finalDamage;
      return Number.isFinite(damage) && damage > 0 ? damage : null;
    } catch (error) {
      if (error instanceof DefenseRateError || (error instanceof RangeError && error.message === 'Defense factor denominator is zero.')) return null;
      throw error;
    }
  };
  return { job, enhancement, actual, rules, warnings, lineCount: 3, targetLabel: slot.name,
    attackLevel: result.attributes.stats.attackLevel?.finalTotal ?? 0,
    weighting: result.finalDamage.skillDamageWeighting, bossDefense: input.enemyDefensePct,
    baselineDamage, simulatedDamage, ...compareRolls(baselineDamage, rules, simulatedDamage, 3) };
}
