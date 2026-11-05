import { renderFinalDamageNumber } from './damage-summary-view.ts';
import type { GameData } from './data.ts';
import { escapeHtml as h, formatNumber as fmt } from './data.ts';
import type { LoadoutState } from './state.ts';
import { DEFAULT_BOSS_HEALTH_CONDITION } from './state.ts';
import type { evaluateLoadout, projectDamage } from './projection.ts';
import { getClassEffects } from '../calculation/class-effects.ts';
import { applyClassSkillVersions } from '../calculation/class-skill-versions.ts';
import { capOverflowPercentage } from './cap-warnings.ts';
import { sourceLabel as resolveSourceLabel, renderSourceRows } from './source-labels.ts';

type Evaluation = ReturnType<typeof evaluateLoadout>;

/** Scope static metadata to the already loaded game data; read selections per render. */
export function createResultCardsView(data: GameData, visibleNumberFormatter: Intl.NumberFormat, classById: (id: string) => GameData['classes']['classes'][number] | undefined, calculationIssue: (error: unknown) => string) {
  const innerwearOrder = new Map(data.innerwear.slots.map((slot, index) => [`innerwear:${slot.id}`, index]));
  return (state: Readonly<LoadoutState>, baseline: Readonly<LoadoutState> | null, currentEvaluation: Evaluation, baselineEvaluation: Evaluation | null): string => {
    const current = currentEvaluation.attributes!;
    const before = baselineEvaluation?.attributes ?? null;
    const currentDamage = currentEvaluation.damage;
    const baselineDamage = baselineEvaluation?.damage ?? null;
    const currentCombatRates = currentEvaluation.combatRates;
    const damageCalculationError = currentEvaluation.damageError;
    const sourceLabel = (id: string) => resolveSourceLabel(id, data, state);
    const sourceRows = (sources: readonly { sourceId: string; valuePct: number }[], percent: boolean) => renderSourceRows(sources, percent, sourceLabel);
    const bossHealthCondition = () => state.bossHealthCondition ?? DEFAULT_BOSS_HEALTH_CONDITION;
    const isLowerwearAveraging = () => state.lowerwearAlternativeEnabled && !bossHealthCondition().enabled;
    const currentClass = classById(state.Job);
    const baselineClass = baseline ? classById(baseline.Job) : undefined;
    const critDamageSupplement = (damage: ReturnType<typeof projectDamage> | null) => damage
      ? damage.result.classCritDamagePassivePct + damage.result.multiplicativeCritDamage.value * 100
      : 0;
    const attackKey = currentClass?.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    const baselineAttackKey = baselineClass?.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    const visibleStats = Object.entries(current.stats)
      .filter(([key]) => !['physicalAttack', 'magicalAttack', 'critRatePct', 'extremizationPct', 'strongerPct', 'heatPct'].includes(key))
      .map(([key, stat]) => ({ key, stat, previousStat: before?.stats[key] }));
    const superAdaptabilityIndex = visibleStats.findIndex(entry => entry.key === 'superAdaptabilityPct');
    if (superAdaptabilityIndex >= 0) {
      const [superAdaptability] = visibleStats.splice(superAdaptabilityIndex, 1);
      const adaptabilityIndex = visibleStats.findIndex(entry => entry.key === 'adaptabilityPct');
      visibleStats.splice(adaptabilityIndex < 0 ? visibleStats.length : adaptabilityIndex + 1, 0, superAdaptability);
    }
    const attackStat = current.stats[attackKey];
    if (attackStat) {
      visibleStats.unshift({ key: 'attackPower', stat: attackStat, previousStat: before?.stats[baselineAttackKey] });
    }
    const percentFormat = (value: number) => visibleNumberFormatter.format(value);
    const signedDelta = (value: number, format: (value: number) => string, suffix = '') => { const magnitude = format(Math.abs(value)); return magnitude === format(0) ? '' : (value > 0 ? '+' : '−') + magnitude + suffix; };
    const probabilityCapWarning = (valueBeforeCap: number) => {
      const overflow = capOverflowPercentage(valueBeforeCap * 100, 100);
      return overflow === null ? '' : `<small class="cap-overflow" role="status">超出上限 ${fmt(overflow)}%</small>`;
    };
    const combatRateCard = (label: string, attribute: 'critRate' | 'extremization', statKey: 'critRatePct' | 'extremizationPct') => {
      if (!currentCombatRates) return `<details class="stat" data-disclosure-key="combat:${attribute}"><summary><span>${h(label)}</span><strong>待補輸入</strong></summary><div class="stat-details"><p class="input-hint">${h(calculationIssue(damageCalculationError))}</p></div></details>`;
      const rate = currentCombatRates[attribute];
      const stat = current.stats[statKey];
      const classDiminishing = getClassEffects(applyClassSkillVersions(data.classCombatEffects, state.Job, state.classSkillVersions), currentCombatRates.classId, attribute)
        .filter(effect => effect.method === 'diminishing');
      const classRows = classDiminishing.map(effect =>
        `<p class="stat-source-row"><span>${h(sourceLabel(effect.sourceId))}（${h(effect.id)}）</span><strong>+${fmt(effect.valuePct)}%</strong></p>`,
      ).join('');
      const multiplierRows = rate.multipliers.map(effect =>
        `<p class="stat-source-row"><span>${h(sourceLabel(effect.sourceId))}</span><strong>+${fmt(effect.valuePct)}%（×${fmt(effect.factor)}）</strong></p>`,
      ).join('');
      const nonDiminishingRows = rate.nonDiminishingSources.map(effect =>
        `<p class="stat-source-row"><span>${h(sourceLabel(effect.sourceId))}</span><strong>+${fmt(effect.valuePct)}%</strong></p>`,
      ).join('');
      const baseRows = stat ? `${sourceRows(stat.sharedSources, true)}${sourceRows(stat.lowerwearASources, true)}${isLowerwearAveraging()
        ? `<p class="stat-detail-heading">強/排褲來源</p>${sourceRows(stat.lowerwearBSources, true)}<p class="stat-average">下衣與強/排褲平均 ${fmt(stat.lowerwearAverage)}%</p>` : ''}` : '';
      const finalAdjustment = rate.finalAdjustmentPct
        ? `<p class="stat-source-row"><span>${attribute === 'critRate' ? '關卡扣致命' : '最終調整'}</span><strong>${fmt(rate.finalAdjustmentPct)}%</strong></p>` : '';
      return `<details class="stat" data-disclosure-key="combat:${attribute}"><summary><span>${h(label)}</span><strong>${fmt(rate.finalRate * 100)}%</strong>${probabilityCapWarning(rate.valueBeforeUpperCap)}</summary><div class="stat-details"><p class="stat-detail-heading">角色屬性來源</p>${baseRows || '<p class="stat-source-empty">目前沒有額外屬性來源</p>'}<p class="stat-average">角色屬性合計 ${fmt(rate.baseRawStatPct)}%</p>${classRows ? `<p class="stat-detail-heading">遞減來源</p>${classRows}` : ''}<p class="stat-average">遞減前 ${fmt(rate.rawStatPct)}% → 遞減後 ${fmt(rate.tierRate * 100)}%</p>${multiplierRows ? `<p class="stat-detail-heading">乘算來源</p>${multiplierRows}<p class="stat-average">乘算合計 ×${fmt(rate.multiplierProduct)}</p>` : ''}${nonDiminishingRows ? `<p class="stat-detail-heading">非遞減來源</p>${nonDiminishingRows}` : ''}${finalAdjustment}<p class="stat-average">上限前 ${fmt(rate.valueBeforeUpperCap * 100)}% → 實戰 ${fmt(rate.finalRate * 100)}%</p></div></details>`;
    };
    const combatRateCards = `<div class="combat-rate-pair">${combatRateCard('實戰致命一擊機率', 'critRate', 'critRatePct')}${combatRateCard('實戰極大化', 'extremization', 'extremizationPct')}</div>`;
    const conditionalDamageCard = (label: string, valuePct: number, sources: readonly { sourceId: string; valuePct: number }[], previousValuePct: number | undefined) => {
      const delta = previousValuePct === undefined ? null : valuePct - previousValuePct;
      const deltaText = delta === null ? '' : signedDelta(delta, percentFormat, '%');
      const deltaClass = delta === null || delta === 0 ? '' : delta > 0 ? 'positive' : 'negative';
      const deltaBadge = deltaText ? '<small class="' + deltaClass + '">' + deltaText + '</small>' : '';
      return '<details class="stat conditional-stat" data-disclosure-key="conditional:' + h(label) + '"><summary><span>' + h(label) + '</span><strong>' + fmt(valuePct) + '%</strong>' + deltaBadge + '</summary><div class="stat-details"><p class="stat-detail-heading">來源</p>' + (sourceRows(sources, true) || '<p class="stat-source-empty">目前沒有此條件的額外來源</p>') + '<p class="stat-average">來源合計 ' + fmt(valuePct) + '%</p></div></details>';
    };
    const baselineConditionalDamage = baselineDamage?.result.attributes.conditionalDamage;
    const conditionalDamageCards = '<div class="conditional-damage-pair">' + conditionalDamageCard('強者（Boss 體力 > 50%）', current.conditionalDamage.strongerPct, current.conditionalDamage.strongerSources, baselineConditionalDamage?.strongerPct) + conditionalDamageCard('排熱（Boss 體力 ≤ 50%）', current.conditionalDamage.heatPct, current.conditionalDamage.heatSources, baselineConditionalDamage?.heatPct) + '</div>';
    const multiplicativeDeltaValue = currentDamage && baselineDamage
      ? currentDamage.result.generalMultiplicativeDamage.value - baselineDamage.result.generalMultiplicativeDamage.value
      : null;
    const multiplicativeDeltaText = multiplicativeDeltaValue === null ? '' : signedDelta(multiplicativeDeltaValue, fmt, '×');
    const multiplicativeDeltaBadge = multiplicativeDeltaText
      ? '<small class="' + (multiplicativeDeltaValue! > 0 ? 'positive' : 'negative') + '">' + multiplicativeDeltaText + '</small>'
      : '';
    const productSourceRows = (kind: 'generalMultiplicativeDamage' | 'multiplicativeCritDamage', excludeBase = false) => {
      if (!currentDamage) return '';
      const result = currentDamage.result;
      const rows = (effects: typeof result.generalMultiplicativeDamage.factors) => effects
        .filter(effect => !excludeBase || effect.sourceId !== 'character-base:crit-damage-product')
        .map(effect => `<p class="stat-source-row"><span>${h(sourceLabel(effect.sourceId))}</span><strong>×${fmt(effect.factor)}</strong></p>`).join('');
      const commonIds = new Set(result[kind].factors.map(effect => effect.sourceId));
      return rows(result[kind].factors) + (result.lowerwearConfigurations ?? []).map(({ configuration, result: variant }) => {
        const effects = variant[kind].factors.filter(effect => !commonIds.has(effect.sourceId));
        return `<p class="stat-detail-heading">${configuration === 'lowerwearA' ? '下衣配置' : '強/排褲配置'}</p>`
          + (rows(effects) || '<p class="stat-source-empty">勳章在此配置沒有額外加成</p>');
      }).join('');
    };
    const productAverageLabel = currentDamage?.result.lowerwearConfigurations ? '（兩套配置平均）' : '';
    const multiplicativeEffectCard = currentDamage
      ? `<details class="stat" data-disclosure-key="multiplicative-effect"><summary><span>乘算效果</span><strong>×${fmt(currentDamage.result.generalMultiplicativeDamage.value)}</strong>${multiplicativeDeltaBadge}</summary><div class="stat-details">${currentDamage.result.generalMultiplicativeDamage.factors.length || currentDamage.result.lowerwearConfigurations
        ? productSourceRows('generalMultiplicativeDamage')
        : '<p class="stat-source-empty">目前沒有額外乘算來源</p>'}<p class="stat-average">乘算效果總倍率${productAverageLabel} ×${fmt(currentDamage.result.generalMultiplicativeDamage.value)}</p></div></details>`
      : `<div class="stat"><p>乘算效果</p><strong>待補輸入</strong><small class="input-hint">${h(calculationIssue(damageCalculationError))}</small></div>`;
    return `<div class="stat-list">${visibleStats.map(({ key, stat, previousStat }) => {
      const meta = data.attributes.attributes.find(entry => entry.key === key);
      const isPercent = meta?.unit === 'percent';
      const isCritDamage = key === 'critDamagePct';
      const currentSupplement = isCritDamage ? critDamageSupplement(currentDamage) : 0;
      const previousSupplement = isCritDamage ? critDamageSupplement(baselineDamage) : 0;
      const displayTotal = stat.finalTotal + currentSupplement;
      const previous = (previousStat?.finalTotal ?? 0) + previousSupplement;
      const delta = before && (!isCritDamage || (currentDamage && baselineDamage)) ? displayTotal - previous : null;
      const deltaText = delta === null ? '' : signedDelta(delta, isPercent ? percentFormat : fmt, isPercent ? '%' : '');
      const relativeDeltaText = delta === null || previous === 0 ? '' : signedDelta(delta / previous * 100, percentFormat, '%');
      const comparison = delta === null ? '' : !deltaText ? '<p>與基準配置相同。</p>' : '<p>基準 ' + fmt(previous) + (isPercent ? '%' : '') + ' → 目前 ' + fmt(displayTotal) + (isPercent ? '%' : '') + '；差異 ' + deltaText + (relativeDeltaText ? '；相對變化 ' + relativeDeltaText : '') + '</p>';
      const deltaBadge = deltaText ? '<small class="' + (delta !== null && delta > 0 ? 'positive' : 'negative') + '">' + deltaText + '</small>' : '';
      const shownName = key === 'attackPower' ? '攻擊力' : meta?.name ?? key;
      const attributeOverflow = stat.cap === undefined ? null : capOverflowPercentage(stat.totalBeforeCap, stat.cap);
      const attributeCapWarning = attributeOverflow === null
        ? ''
        : `<small class="cap-overflow" role="status">超出上限 ${fmt(attributeOverflow)}%</small>`;
      const lowerwearAverageLabel = bossHealthCondition().enabled
        ? bossHealthCondition().lowerwear === 'lowerwearB' ? '強/排褲配置' : '下衣配置'
        : state.lowerwearAlternativeEnabled ? '下衣+強/排褲平均' : '下衣配置';
      const lowerwearAverage = stat.lowerwearAverage + currentSupplement;
      const allCommonSources = [...stat.sharedSources, ...stat.lowerwearASources];
      const firstInnerwearIndex = allCommonSources.findIndex(source => innerwearOrder.has(source.sourceId));
      const innerwearSources = allCommonSources
        .filter(source => innerwearOrder.has(source.sourceId))
        .sort((left, right) => innerwearOrder.get(left.sourceId)! - innerwearOrder.get(right.sourceId)!);
      const commonSources = allCommonSources.filter(source => !innerwearOrder.has(source.sourceId));
      if (firstInnerwearIndex >= 0) commonSources.splice(Math.min(firstInnerwearIndex, commonSources.length), 0, ...innerwearSources);
      else commonSources.push(...innerwearSources);
      const passiveSourceRow = isCritDamage && currentDamage && currentDamage.result.classCritDamagePassivePct > 0
        ? `<p class="stat-source-row"><span>${state.Job === 'CU' ? '精神集中' : h(currentClass?.id ?? state.Job) + '自身技能'}</span><strong>+${fmt(currentDamage.result.classCritDamagePassivePct)}%</strong></p>`
        : '';
      const sharedDetails = commonSources.length || passiveSourceRow
        ? `<p class="stat-detail-heading">共同來源</p>${sourceRows(commonSources, isPercent)}${passiveSourceRow}`
        : '';
      const critDamageBaseFactor = currentDamage?.result.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'character-base:crit-damage-product')?.factor ?? 1.5;
      const critDamageBaselinePct = currentDamage?.result.multiplicativeCritDamage.baselinePct ?? 150;
      const critDamageDetails = isCritDamage && currentDamage
        ? `<p class="stat-detail-heading">乘算來源</p><p class="stat-source-row"><span>乘算暴傷增幅${productAverageLabel}（角色基底 ${fmt(critDamageBaseFactor * 100)}% 扣除 ${fmt(critDamageBaselinePct)}% 基準後）</span><strong>+${fmt(currentDamage.result.multiplicativeCritDamage.value * 100)}%</strong></p>${productSourceRows('multiplicativeCritDamage', true)}`
        : '';
      const lowerwearBDetails = isLowerwearAveraging() && stat.lowerwearBSources.length ? `<p class="stat-detail-heading">強/排褲來源</p>${sourceRows(stat.lowerwearBSources, isPercent)}` : '';
      return `<details class="stat" data-disclosure-key="stat:${h(key)}"><summary><span>${h(shownName)}</span><strong>${fmt(displayTotal)}${isPercent ? '%' : ''}</strong>${attributeCapWarning}${deltaBadge}</summary><div class="stat-details">${sharedDetails}${critDamageDetails}${lowerwearBDetails}<p class="stat-average">${lowerwearAverageLabel} ${fmt(lowerwearAverage)}${isPercent ? '%' : ''}</p>${comparison}</div></details>`;
    }).join('')}${conditionalDamageCards}${multiplicativeEffectCard}${combatRateCards}</div>`;
  };
}

export function renderDamageFormula(result: NonNullable<ReturnType<typeof projectDamage>>['result'], sourceLabel: (id: string) => string, formulaWasOpen: boolean, formatter: Intl.NumberFormat): string {
  const productAverageLabel = result.lowerwearConfigurations ? '（兩套配置平均）' : '';
  const finalDamageFormat = (value: number) => renderFinalDamageNumber(value, formatter);
  const rateSources = (effects: typeof result.combatRates.critRate.multipliers) => effects.map(effect => `${sourceLabel(effect.sourceId)} ×${fmt(effect.factor)}`).join(' · ') || '無';
  const critDamageText = (value: typeof result, calculation: boolean) => {
    const product = value.multiplicativeCritDamage;
    const baseFactor = product.factors.find(effect => effect.sourceId === 'character-base:crit-damage-product')?.factor ?? 1.5;
    const effects = product.factors.filter(effect => effect.sourceId !== 'character-base:crit-damage-product');
    return calculation
      ? `角色基底 ${fmt(baseFactor * 100)}%（×${fmt(baseFactor)}）${effects.map(effect => ` ×${fmt(effect.factor)}`).join('')} − ${fmt(product.baselinePct)}% 基準 = +${fmt(product.value * 100)}%`
      : effects.map(effect => `×${fmt(effect.factor)}（${sourceLabel(effect.sourceId)}）`).join('、') || '無額外來源';
  };
  const configuredCritText = (calculation: boolean) => result.lowerwearConfigurations
    ? result.lowerwearConfigurations.map(({ configuration, result: variant }) => `${configuration === 'lowerwearA' ? '下衣配置' : '強/排褲配置'}：${critDamageText(variant, calculation)}`).join('；')
    : critDamageText(result, calculation);
  const critDamageMultiplier = configuredCritText(false);
  const critDamageCalculation = configuredCritText(true);
  const configurationDetails = result.lowerwearConfigurations
    ? result.lowerwearConfigurations.map(({ configuration, result: variant }) => `<p>${configuration === 'lowerwearA' ? '下衣配置' : '強/排褲配置'}：乘算傷害 ×${fmt(variant.generalMultiplicativeDamage.value)}，最終傷害 ${finalDamageFormat(variant.finalDamage.finalDamage)}</p>`).join('')
      + '<p>兩套配置分別套用勳章加成後，最終傷害取平均。</p>' : '';
  const skillWeighting = result.finalDamage.skillDamageWeighting;
  const skillWeightingText = `超越 ${fmt(skillWeighting.transcendenceSharePct)}% ×${fmt(skillWeighting.transcendenceFactor)} + 強烈 ${fmt(skillWeighting.strongSharePct)}% ×${fmt(skillWeighting.strongFactor)} = ×${fmt(skillWeighting.combinedFactor)}`;
  return `<details class="formula-detail" data-disclosure-key="formula-detail"${formulaWasOpen ? ' open' : ''}><summary>展開傷害計算明細</summary><p>強烈／超越技傷加權：${h(skillWeightingText)}</p><p>致命傷害被動：${fmt(result.classCritDamagePassivePct)}%　乘算暴傷增幅${productAverageLabel}：+${fmt(result.multiplicativeCritDamage.value * 100)}%</p><p>乘算暴傷計算：${h(critDamageCalculation)}</p><p>乘算暴傷來源：${h(critDamageMultiplier)}</p><p>爆擊乘算來源：${h(rateSources(result.combatRates.critRate.multipliers))}</p><p>極大乘算來源：${h(rateSources(result.combatRates.extremization.multipliers))}</p><p>乘算傷害${productAverageLabel}：${fmt(result.generalMultiplicativeDamage.value)} 倍　強者／排熱因子：${fmt(result.finalDamage.conditionalFactor)}</p>${configurationDetails}<p>適應力因子：${fmt(result.finalDamage.adaptationFactor)}　防禦因子：${fmt(result.finalDamage.defenseFactor)}</p></details>`;
}
