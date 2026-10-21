import { calculateCombinedAttributeChange, comparableAttributes, createAttributeEquivalenceCalculator, type EquivalenceKey } from '../calculation/attribute-equivalence.ts';
import type { LoadoutCalculationInput, LoadoutCalculationResult } from '../calculation/loadout-engine.ts';
import type { AttributeMetadata } from './data.ts';

const MAX_INPUT = 1_000_000;
const shownDelta = (value: number) => value === 0 ? '0' : value.toFixed(3).replace(/\.?0+$/, '');
const shownEquivalent = (value: number) => {
  if (value === 0) return '0';
  return (Math.ceil(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
};
const shownGain = (value: number) => `${value.toFixed(6).replace(/\.?0+$/, '')}%`;
const readDelta = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number <= MAX_INPUT ? number : null;
};
const readSignedDelta = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^-?(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && Math.abs(number) <= MAX_INPUT ? number : null;
};
const damageFormatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 });
const combinedGainFormatter = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Validate edits before insertion; retain a fallback for autofill and IME commits. */
function bindDecimalInput(input: HTMLInputElement, allowNegative: boolean, onInput: () => void) {
  const pattern = allowNegative ? /^-?\d*(?:\.\d*)?$/ : /^\d*(?:\.\d*)?$/;
  let accepted = input.value;
  let composing = false;
  const canInsert = (text: string) => pattern.test(input.value.slice(0, input.selectionStart ?? input.value.length)
    + text + input.value.slice(input.selectionEnd ?? input.value.length));
  const apply = () => {
    if (!pattern.test(input.value)) { input.value = accepted; return; }
    input.value = input.value.replace(/^(-?\d*\.\d{3})\d+$/, '$1');
    accepted = input.value;
    onInput();
    accepted = input.value;
  };
  input.addEventListener('focus', () => { accepted = input.value; });
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    accepted = input.value;
    if (!canInsert(event.key)) event.preventDefault();
  });
  input.addEventListener('beforeinput', event => {
    const edit = event as InputEvent;
    if (composing || edit.isComposing) return;
    accepted = input.value;
    if (edit.inputType.startsWith('insert') && edit.data !== null && !canInsert(edit.data)) event.preventDefault();
  });
  input.addEventListener('paste', event => {
    accepted = input.value;
    const text = event.clipboardData?.getData('text');
    if (text !== undefined && !canInsert(text)) event.preventDefault();
  });
  input.addEventListener('compositionstart', () => { accepted = input.value; composing = true; });
  input.addEventListener('compositionend', () => { composing = false; apply(); });
  input.addEventListener('input', event => { if (!composing && !(event as InputEvent).isComposing) apply(); });
}

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
  content.id = 'attribute-equivalence-single';
  const note = document.createElement('p');
  note.textContent = '在任一屬性處輸入增加的%數（最多採計到小數後三位）；依目前配裝的傷害反算其他屬性的增幅，此處試算不會修改配裝；顯示至小數後三位、攻擊力取整數，收益可能會有小數點後四位的細微誤差。';
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
  let draft = '';
  let calculator: ReturnType<typeof createAttributeEquivalenceCalculator> | null = null;
  let latestInput: LoadoutCalculationInput | undefined;
  let latestResult: LoadoutCalculationResult | undefined;
  let mode: 'single' | 'combined' = 'single';

  const combinedContent = document.createElement('div');
  combinedContent.className = 'attribute-equivalence-content attribute-combined-content';
  combinedContent.id = 'attribute-equivalence-combined';
  combinedContent.hidden = true;
  const combinedNote = document.createElement('p');
  combinedNote.textContent = '同時輸入各屬性額外增加或減少的百分點（最多小數後三位），依目前配裝與關卡設定計算綜合收益。空白視為 0，試算不會修改配裝或比較基準。';
  const combinedFields = document.createElement('div');
  combinedFields.className = 'attribute-combined-fields';
  const combinedInputs = new Map<EquivalenceKey, HTMLInputElement>();
  const combinedResults = document.createElement('div');
  combinedResults.className = 'attribute-combined-results';
  const resultValues = new Map<string, HTMLElement>();
  for (const [key, text] of [['base', '原始傷害'], ['simulated', '模擬後傷害'], ['gain', '複合收益']]) {
    const card = document.createElement('div'); card.className = 'equipment-damage-card';
    const label = document.createElement('span'); label.textContent = text;
    const value = document.createElement('strong'); value.dataset.combinedResult = key;
    card.append(label, value); combinedResults.append(card); resultValues.set(key, value);
  }
  const combinedStatus = document.createElement('p');
  combinedStatus.className = 'attribute-equivalence-status';
  combinedStatus.setAttribute('role', 'status');
  combinedStatus.setAttribute('aria-live', 'polite');
  combinedContent.append(combinedNote, combinedFields, combinedResults, combinedStatus);

  const renderCombined = () => {
    const deltas: Partial<Record<EquivalenceKey, number>> = {};
    let valid = true;
    for (const [key, input] of combinedInputs) {
      const amount = readSignedDelta(input.value);
      input.setAttribute('aria-invalid', String(amount === null && !['-', '.', '-.'].includes(input.value)));
      if (amount === null) valid = false;
      else deltas[key] = amount;
    }
    const comparison = valid && latestInput && latestResult
      ? calculateCombinedAttributeChange(latestInput, latestResult, deltas) : null;
    const baseDamage = latestResult?.finalDamage.finalDamage;
    resultValues.get('base')!.textContent = baseDamage !== undefined && Number.isFinite(baseDamage) ? damageFormatter.format(baseDamage) : '—';
    resultValues.get('simulated')!.textContent = comparison ? damageFormatter.format(comparison.simulatedDamage) : '—';
    const gain = resultValues.get('gain')!;
    gain.textContent = comparison ? comparison.gainPct === 0 ? '0%' : `${combinedGainFormatter.format(comparison.gainPct)}%` : '—';
    gain.classList.toggle('gain-positive', Boolean(comparison && comparison.gainPct > 0));
    gain.classList.toggle('gain-negative', Boolean(comparison && comparison.gainPct < 0));
    combinedStatus.textContent = !latestInput || !latestResult ? '請先完成可計算傷害的配裝。'
      : !valid ? '請完成數值輸入；可輸入正負數與小數，範圍為 -1,000,000 至 1,000,000。'
      : !comparison ? '目前增減值無法產生有效的傷害結果，請調整輸入。' : '';
  };

  for (const attribute of attributes) {
    const label = document.createElement('label'); label.className = 'field';
    label.append(document.createTextNode(attribute.name));
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; input.placeholder = '0';
    input.setAttribute('aria-label', `綜合計算：${attribute.name}增減數值（百分點）`);
    input.dataset.combinedKey = attribute.key;
    bindDecimalInput(input, true, renderCombined);
    input.addEventListener('blur', () => {
      const amount = readSignedDelta(input.value);
      if (amount !== null && input.value !== '') { input.value = shownDelta(amount); renderCombined(); }
    });
    label.append(input); combinedFields.append(label); combinedInputs.set(attribute.key, input);
  }

  const render = () => {
    const amount = readDelta(draft);
    const comparison = calculator && amount !== null ? calculator.compare(activeKey, amount) : null;
    for (const attribute of attributes) {
      const control = rows.get(attribute.key)!;
      const active = attribute.key === activeKey;
      control.row.classList.toggle('attribute-equivalence-active', active);
      control.label.textContent = active ? `${attribute.name} · 比較基準` : attribute.name;
      if (active) { control.input.value = draft; control.input.placeholder = '0'; }
      const result = comparison?.rows.find(row => row.key === attribute.key);
      let displayedValue = draft;
      if (!active) {
        displayedValue = result?.delta === null || result?.delta === undefined || draft === '' ? '' : shownEquivalent(result.delta);
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

  const renderActive = () => { if (mode === 'combined') renderCombined(); else render(); };
  const modes = document.createElement('div');
  modes.className = 'attribute-equivalence-modes';
  modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '傷害比較方式');
  const modeButtons = new Map<'single' | 'combined', HTMLButtonElement>();
  for (const [key, text, target] of [['single', '等效換算/單項增幅', content], ['combined', '綜合計算', combinedContent]] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.setAttribute('aria-controls', target.id); button.setAttribute('aria-pressed', String(mode === key));
    button.addEventListener('click', () => {
      mode = key; content.hidden = mode !== 'single'; combinedContent.hidden = mode !== 'combined';
      for (const [value, control] of modeButtons) control.setAttribute('aria-pressed', String(value === mode));
      renderActive();
    });
    modeButtons.set(key, button); modes.append(button);
  }

  for (const attribute of attributes) {
    const row = body.insertRow();
    row.dataset.equivalenceKey = attribute.key;
    const label = document.createElement('th'); label.scope = 'row';
    const value = row.insertCell();
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off';
    input.setAttribute('aria-label', `${attribute.name}增加數值（百分點）`);
    bindDecimalInput(input, false, () => {
      activeKey = attribute.key; draft = input.value; render();
    });
    input.addEventListener('blur', () => {
      if (attribute.key !== activeKey) return;
      const amount = readDelta(draft);
      if (amount !== null && draft !== '') { draft = shownDelta(amount); render(); }
    });
    value.append(input);
    const gain = row.insertCell();
    row.prepend(label);
    rows.set(attribute.key, { row, input, label, gain });
  }
  scroll.append(table);
  content.append(note, scroll, status);
  root.append(summary, modes, content, combinedContent);
  root.addEventListener('toggle', () => { if (root.open) onOpen(); });
  render();

  return {
    root,
    isOpen: () => root.open,
    update(input?: LoadoutCalculationInput, result?: LoadoutCalculationResult) {
      latestInput = input; latestResult = result;
      calculator = input && result ? createAttributeEquivalenceCalculator(input, result, attributes) : null;
      if (root.open) renderActive();
    },
  };
}
