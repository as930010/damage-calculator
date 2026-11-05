import { escapeHtml as h } from './data.ts';

export function renderEquipmentDamageSummary(currentFinalDamage: number | undefined, baselineFinalDamage: number | undefined, numberFormatter: Intl.NumberFormat, percentFormatter: Intl.NumberFormat): string {
  const summaryDamageNumber = (value: number) => numberFormatter.format(value);
  const summaryPercent = (value: number) => percentFormatter.format(value);
  const damageGainRatio = baselineFinalDamage !== undefined && currentFinalDamage !== undefined && baselineFinalDamage !== 0
    ? currentFinalDamage / baselineFinalDamage - 1
    : undefined;
  const damageGain = damageGainRatio === undefined ? '—' : summaryPercent(damageGainRatio * 100) + '%';
  const damageGainClass = damageGainRatio === undefined || damageGainRatio === 0 ? '' : damageGainRatio > 0 ? 'gain-positive' : 'gain-negative';
  return '<div class="equipment-damage-card"><span>基準配置</span><strong>' + (baselineFinalDamage === undefined ? '—' : summaryDamageNumber(baselineFinalDamage)) + '</strong></div><div class="equipment-damage-card"><span>新配置</span><strong>' + (currentFinalDamage === undefined ? '—' : summaryDamageNumber(currentFinalDamage)) + '</strong></div><div class="equipment-damage-card equipment-damage-gain"><span>增幅</span><strong class="' + damageGainClass + '">' + damageGain + '</strong></div>';
}

export function renderFinalDamageNumber(value: number, formatter: Intl.NumberFormat): string {
      const parts = formatter.formatToParts(value);
      const integer = parts.filter(part => part.type !== 'decimal' && part.type !== 'fraction').map(part => part.value).join('');
      const decimal = parts.filter(part => part.type === 'decimal' || part.type === 'fraction').map(part => part.value).join('');
      return `<span class="damage-integer">${h(integer)}</span>${decimal ? `<span class="damage-decimal">${h(decimal)}</span>` : ''}`;
    }

export function renderDamageRatio(currentFinalDamage: number, previousFinalDamage: number | undefined, formatter: Intl.NumberFormat): string {
  const damageRatio = previousFinalDamage === undefined || previousFinalDamage === 0
    ? null
    : currentFinalDamage / previousFinalDamage * 100;
  const damageDifference = damageRatio === null ? null : damageRatio - 100;
  const damageDifferenceClass = damageDifference === null || damageDifference === 0 ? '' : damageDifference > 0 ? 'positive' : 'negative';
  const damageRatioClass = damageDifference === null || damageDifference === 0 ? '' : damageDifference > 0 ? 'damage-ratio-positive' : 'damage-ratio-negative';
  const damageDifferenceLabel = damageDifference === null ? '—' : (damageDifference > 0 ? '+' : '') + formatter.format(damageDifference) + '%';
  return '<div class="damage-ratio ' + damageRatioClass + '"><div class="damage-ratio-group"><span>新配置是舊配置的</span><strong>' + (damageRatio === null ? '無法計算' : formatter.format(damageRatio) + '%') + '</strong></div><div class="damage-ratio-group"><span>與基準差異</span><strong class="' + damageDifferenceClass + '">' + damageDifferenceLabel + '</strong></div></div>';
}
