import { comparableAttributes, createAttributeEquivalenceCalculator, type EquivalenceKey } from '../calculation/attribute-equivalence.ts';
import type { LoadoutCalculationInput, LoadoutCalculationResult } from '../calculation/loadout-engine.ts';
import type { AttributeMetadata } from './data.ts';

const MAX_INPUT = 1_000_000;
const shownDelta = (value: number) => value === 0 ? '0' : value.toFixed(3).replace(/\.?0+$/, '');
const shownEquivalent = (value: number) => {
  if (value === 0) return '0';
  return (Math.ceil(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
};
const limitPrecision = (value: string) => value.replace(/^(\d*\.\d{3})\d+$/, '$1');
const shownGain = (value: number) => `${value.toFixed(6).replace(/\.?0+$/, '')}%`;
const readDelta = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number <= MAX_INPUT ? number : null;
};

/** Stable controls preserve focus and the active draft while a loadout is recalculated. */
export function createAttributeEquivalencePanel(metadata: readonly AttributeMetadata[], onOpen: () => void) {
  const attributes = comparableAttributes(metadata);
  const root = document.createElement('details');
  root.className = 'attribute-equivalence-panel';
  root.dataset.disclosureKey = 'attribute-equivalence';
  const summary = document.createElement('summary');
  summary.textContent = '傷害屬性等效比較';
  const content = document.createElement('div');
  content.className = 'attribute-equivalence-content';
  const note = document.createElement('p');
  note.textContent = '選擇任一屬性並輸入額外增加的百分點（最多小數後三位）；依目前配裝的最終傷害，反算其他屬性的等效增量。試算不會修改配裝；顯示值向上取至三位，攻擊類因整數取整，收益可能略高於目標。';
  const scroll = document.createElement('div');
  scroll.className = 'attribute-equivalence-scroll';
  const table = document.createElement('table');
  const head = table.createTHead();
  const header = head.insertRow();
  for (const title of ['屬性名稱', '增加數值（%）', '等效傷害收益']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = title; header.append(cell);
  }
  const body = table.createTBody();
  const status = document.createElement('p');
  status.className = 'attribute-equivalence-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const rows = new Map<EquivalenceKey, { row: HTMLTableRowElement; input: HTMLInputElement; label: HTMLElement; gain: HTMLTableCellElement }>();
  let activeKey: EquivalenceKey = attributes.find(entry => entry.key === 'bossDamagePct')?.key ?? attributes[0]?.key ?? 'bossDamagePct';
  let draft = '0';
  let calculator: ReturnType<typeof createAttributeEquivalenceCalculator> | null = null;

  const render = () => {
    const amount = readDelta(draft);
    const comparison = calculator && amount !== null ? calculator.compare(activeKey, amount) : null;
    for (const attribute of attributes) {
      const control = rows.get(attribute.key)!;
      const active = attribute.key === activeKey;
      control.row.classList.toggle('attribute-equivalence-active', active);
      control.label.textContent = active ? `${attribute.name} · 比較基準` : attribute.name;
      if (active) control.input.value = draft;
      const result = comparison?.rows.find(row => row.key === attribute.key);
      let displayedValue = draft;
      if (!active) {
        displayedValue = result?.delta === null || result?.delta === undefined ? '' : shownEquivalent(result.delta);
        control.input.value = displayedValue;
        control.input.placeholder = !calculator ? '待計算' : amount === null ? '—'
          : result?.status === 'notApplicable' ? '不適用' : result?.status === 'unreachable' ? '無法達成' : '0';
      }
      const displayedDamage = !active && result?.status === 'ok' && calculator
        ? calculator.damageWith(attribute.key, Number(displayedValue)) : null;
      const gain = displayedDamage !== null && calculator ? (displayedDamage / calculator.baseDamage - 1) * 100 : result?.gainPct;
      control.gain.textContent = result?.status === 'ok' && gain !== null && gain !== undefined ? shownGain(gain)
        : result?.status === 'unreachable' ? '無法達成' : result?.status === 'notApplicable' ? '不適用' : '—';
    }
    status.textContent = !calculator ? '請先完成可計算傷害的配裝。'
      : amount === null ? '請輸入 0 到 1,000,000 之間、最多小數後三位的非負數值。'
      : comparison?.targetGainPct === null ? '此屬性在目前配裝下無法產生可比較的傷害收益。'
      : `${attributes.find(attribute => attribute.key === activeKey)?.name ?? ''} +${shownDelta(amount)}%：最終傷害增加 ${shownGain(comparison?.targetGainPct ?? 0)}。`;
  };

  for (const attribute of attributes) {
    const row = body.insertRow();
    row.dataset.equivalenceKey = attribute.key;
    const label = document.createElement('th'); label.scope = 'row';
    const value = row.insertCell();
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off';
    input.setAttribute('aria-label', `${attribute.name}增加數值（百分點）`);
    input.addEventListener('input', () => {
      activeKey = attribute.key; draft = limitPrecision(input.value); render();
    });
    input.addEventListener('blur', () => {
      if (attribute.key !== activeKey) return;
      const amount = readDelta(draft);
      if (amount !== null) { draft = shownDelta(amount); render(); }
    });
    value.append(input);
    const gain = row.insertCell();
    row.prepend(label);
    rows.set(attribute.key, { row, input, label, gain });
  }
  scroll.append(table);
  content.append(note, scroll, status);
  root.append(summary, content);
  root.addEventListener('toggle', () => { if (root.open) onOpen(); });
  render();

  return {
    root,
    isOpen: () => root.open,
    update(input?: LoadoutCalculationInput, result?: LoadoutCalculationResult) {
      calculator = input && result ? createAttributeEquivalenceCalculator(input, result, attributes) : null;
      if (root.open) render();
    },
  };
}
