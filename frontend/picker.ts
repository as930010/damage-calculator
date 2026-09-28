export interface PickerOption { value: string; label: string; detail?: string }
let sequence = 0;
/** Only explicit selections are saved; typing filters the list. */
export function createPicker(label: string, options: readonly PickerOption[], value: string, onChange: (value: string) => void): HTMLElement {
  const root = document.createElement('div'); root.className = 'picker field';
  const displayValue = (selected: string) => options.find(option => option.value === selected)?.label ?? selected;
  const caption = document.createElement('label'); caption.textContent = label;
  const input = document.createElement('input'); input.id = `picker-${++sequence}`; caption.htmlFor = input.id;
  input.setAttribute('aria-label', label);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off'; input.placeholder = '搜尋或選擇…'; input.value = displayValue(value);
  const control = document.createElement('div'); control.className = 'picker-control';
  const list = document.createElement('div'); list.id = `${input.id}-list`; list.className = 'picker-list'; list.role = 'listbox'; list.hidden = true;
  const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'picker-clear'; clear.textContent = '×'; clear.title = '清除目前選擇'; clear.setAttribute('aria-label', `清除${label}`); clear.hidden = value === '';
  input.setAttribute('aria-controls', list.id);
  let matches: PickerOption[] = [], index = -1, committed = value;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); input.value = displayValue(committed); clear.hidden = committed === ''; };
  const commit = (option: PickerOption) => { committed = option.value; close(); onChange(option.value); };
  const draw = (query: string) => {
    matches = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    index = -1; list.replaceChildren(); list.hidden = false; input.setAttribute('aria-expanded', 'true');
    for (const [i, option] of matches.entries()) {
      const row = document.createElement('button'); row.type = 'button'; row.role = 'option'; row.id = `${list.id}-${i}`; row.tabIndex = -1;
      const name = document.createElement('span'); name.textContent = option.label; row.append(name);
      if (option.detail) { const detail = document.createElement('small'); detail.textContent = option.detail; row.append(detail); }
      row.addEventListener('mousedown', event => event.preventDefault()); row.addEventListener('click', () => commit(option)); list.append(row);
    }
    if (!matches.length) { const empty = document.createElement('p'); empty.textContent = '找不到符合的選項'; list.append(empty); }
  };
  input.addEventListener('focus', () => { input.select(); draw(''); });
  input.addEventListener('input', () => draw(input.value));
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) close(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (list.hidden) draw(''); if (!matches.length) return;
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === index)));
      input.setAttribute('aria-activedescendant', `${list.id}-${index}`); list.children[index]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !list.hidden && index >= 0) { event.preventDefault(); commit(matches[index]); }
  });
  clear.addEventListener('mousedown', event => event.preventDefault());
  clear.addEventListener('click', () => { committed = ''; input.value = ''; close(); onChange(''); });
  control.append(input, list, clear); root.append(caption, control); return root;
}
