import type { AttackType } from '../calculation/types.ts';
import type { CalculationComparisonRow } from './calculation-comparison.ts';
import { escapeHtml as h } from './data.ts';

const preciseNumberFormatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 10 });

/** Format comparison rows without reading application state or touching the DOM. */
export function renderCalculationComparisonHtml(
  rows: readonly CalculationComparisonRow[],
  activeAttackType: AttackType | undefined,
  finalDamageFormatter: Intl.NumberFormat,
): string {
  const precise = (value: number) => preciseNumberFormatter.format(value);
  const visiblePrecise = (value: number) => finalDamageFormatter.format(value);
  const displayComparisonValue = (row: CalculationComparisonRow, value: number) => {
    if (row.key === 'critRate' || row.key === 'extremizationRate') return `${precise(value * 100)}%`;
    return row.key === 'finalDamage' ? visiblePrecise(value) : precise(value);
  };
  const displayComparisonDelta = (row: CalculationComparisonRow) => {
    const sign = row.delta > 0 ? '+' : '';
    if (row.key === 'critRate' || row.key === 'extremizationRate') return `${sign}${precise(row.delta * 100)}%`;
    return `${sign}${row.key === 'finalDamage' ? visiblePrecise(row.delta) : precise(row.delta)}`;
  };
  const visibleRows = rows.filter(row =>
    (!['physicalAttack', 'magicalAttack'].includes(row.key)
      || row.key === (activeAttackType === 'physical' ? 'physicalAttack' : 'magicalAttack'))
    && (!['weaponPhysicalBase', 'weaponMagicalBase'].includes(row.key)
      || row.key === (activeAttackType === 'physical' ? 'weaponPhysicalBase' : 'weaponMagicalBase')),
  );
  const mismatches = visibleRows.filter(row => !row.matches);
  const table = (items: readonly CalculationComparisonRow[]) => `<div class="calculation-comparison-scroll"><table><thead><tr><th>項目</th><th>基準配置</th><th>目前配置</th><th>差異</th></tr></thead><tbody>${items.map(row => {
    const rowClass = row.matches ? '' : `calculation-comparison-difference ${row.delta > 0 ? 'calculation-comparison-positive' : row.delta < 0 ? 'calculation-comparison-negative' : ''}`;
    return `<tr class="${rowClass}"><th scope="row">${h(row.label)}</th><td>${displayComparisonValue(row, row.expected)}</td><td>${displayComparisonValue(row, row.actual)}</td><td class="${row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}">${displayComparisonDelta(row)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  const differences = mismatches.length ? table(mismatches) : '<p>目前配置與比較基準的計算值相同。</p>';
  return `<p>依比較基準與目前配裝的未格式化數值比對 ${visibleRows.length} 項：${visibleRows.length - mismatches.length} 項相同、${mismatches.length} 項不同。</p>${differences}<details data-disclosure-key="comparison-all-values"><summary>查看全部比較值（${visibleRows.length} 項）</summary>${table(visibleRows)}</details>`;
}
