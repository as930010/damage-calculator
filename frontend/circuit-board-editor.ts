import { createPicker, disposePickers, type PickerOption } from './picker.ts';
import { canonicalizeNumber, preventScientificNotation } from './numeric-input.ts';
import { formatNumber as fmt } from './data.ts';
import { circuitBoardRowsTotal, normalizeCircuitBoardRows, normalizeCircuitPercentage, type CircuitBoardRow } from './circuit-board-rows.ts';

/** Own the row controls; application persistence and history remain in commitRows. */
export function mountCircuitBoardEditor(
  board: HTMLElement,
  attributeOptions: readonly string[],
  readRows: () => CircuitBoardRow[],
  commitRows: (rows: CircuitBoardRow[]) => void,
  choicesForRow: (rows: CircuitBoardRow[], index: number) => readonly PickerOption[],
) {
  const AbortController = board.ownerDocument.defaultView!.AbortController;
  const lifetime = new AbortController();
  let rowsEvents = new AbortController();
  const note = document.createElement('p');
  note.className = 'panel-note circuit-board-limit-note';
  note.textContent = '可依需求新增或移除項目列；所有列的數值總和上限為 18.0%。';
  const rowList = document.createElement('div');
  rowList.className = 'circuit-board-rows';
  const totalStatus = document.createElement('p');
  totalStatus.className = 'circuit-board-total';
  totalStatus.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div');
  actions.className = 'circuit-board-actions';
  const addRowButton = document.createElement('button');
  addRowButton.type = 'button';
  addRowButton.className = 'circuit-board-add';
  addRowButton.textContent = '新增電路板列';
  actions.append(addRowButton);
  board.append(note, rowList, totalStatus, actions);

  const refreshTotal = (rows: ReturnType<typeof readRows>) => {
    const totalPct = canonicalizeNumber(circuitBoardRowsTotal(rows) * 100);
    if (totalPct > 18 + 1e-9) {
      totalStatus.textContent = '目前總和 ' + fmt(totalPct) + '%，已超過 18.0% 上限。';
      totalStatus.classList.add('input-warning');
    } else {
      totalStatus.textContent = '目前總和：' + fmt(totalPct) + '% / 18.0%';
      totalStatus.classList.remove('input-warning');
    }
    addRowButton.disabled = rows.length >= attributeOptions.length;
    addRowButton.title = addRowButton.disabled ? '已達可選項目數量上限' : '新增電路板列';
    [...rowList.querySelectorAll<HTMLInputElement>('input[type="number"]')].forEach(input => {
      input.max = '18';
    });
  };
  const renderCircuitRows = () => {
    rowsEvents.abort();
    rowsEvents = new AbortController();
    const rows = readRows();
    disposePickers(rowList);
    rowList.replaceChildren();
    rows.forEach((row, index) => {
      const rowElement = document.createElement('div');
      rowElement.className = 'circuit-board-row';
      const picker = createPicker('電路板項目 ' + (index + 1), choicesForRow(rows, index), row.attribute, value => {
        rows[index] = { ...rows[index], attribute: value, percentageValue: value === '無關傷害' ? 0 : rows[index].percentageValue };
        commitRows(rows);
        renderCircuitRows();
      });
      rowElement.append(picker);

      const valueField = document.createElement('label');
      valueField.className = 'field circuit-board-value';
      valueField.append(document.createTextNode('電路板數值 ' + (index + 1) + '（%）'));
      const input = document.createElement('input');
      input.type = 'number';
      preventScientificNotation(input);
      input.min = '0';
      input.step = 'any';
      input.placeholder = row.attribute ? '請填寫數值' : '請先選擇屬性';
      input.value = row.percentageValue === null ? '' : String(canonicalizeNumber(row.percentageValue * 100));
      input.disabled = !row.attribute || row.attribute === '無關傷害';
      valueField.append(input);
      rowElement.append(valueField);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'circuit-board-remove';
      removeButton.textContent = '移除';
      removeButton.setAttribute('aria-label', '移除第 ' + (index + 1) + ' 列電路板');
      removeButton.disabled = rows.length === 1;
      removeButton.title = rows.length === 1 ? '至少保留一列' : '移除此列';
      removeButton.addEventListener('click', () => {
        rows.splice(index, 1);
        commitRows(rows);
        renderCircuitRows();
        addRowButton.focus();
      }, { signal: rowsEvents.signal });
      rowElement.append(removeButton);
      rowList.append(rowElement);

      input.addEventListener('input', () => {
        if (input.validity.badInput) return;
        const percentageValue = normalizeCircuitPercentage(Number(input.value) / 100);
        const candidateRows = rows.map((entry, rowIndex) => rowIndex === index ? { ...entry, percentageValue } : entry);
        input.setCustomValidity('');
        rows.splice(0, rows.length, ...normalizeCircuitBoardRows(candidateRows, attributeOptions, index));
        [...rowList.querySelectorAll<HTMLInputElement>('input[type="number"]')].forEach((control, rowIndex) => {
          const displayed = canonicalizeNumber((rows[rowIndex].percentageValue ?? 0) * 100);
          if (rowIndex !== index || control.value === '' || Number(control.value) !== displayed) control.value = String(displayed);
        });
        commitRows(rows);
        refreshTotal(rows);
      }, { signal: rowsEvents.signal });
    });
    refreshTotal(rows);
  };
  addRowButton.addEventListener('click', () => {
    const rows = readRows();
    if (rows.length >= attributeOptions.length) return;
    rows.push({ attribute: '無關傷害', percentageValue: 0 });
    commitRows(rows);
    renderCircuitRows();
    rowList.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
  }, { signal: lifetime.signal });
  renderCircuitRows();
  return { dispose() { lifetime.abort(); rowsEvents.abort(); disposePickers(rowList); } };
}
