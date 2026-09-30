export interface PickerOption { value: string; label: string; detail?: string }
let sequence = 0;
let mobilePickerDialog: HTMLDialogElement | null = null;
let mobilePickerTitle: HTMLElement | null = null;
let mobilePickerSearchToggle: HTMLButtonElement | null = null;
let mobilePickerSearch: HTMLInputElement | null = null;
let mobilePickerList: HTMLElement | null = null;
let mobilePickerReturnTarget: HTMLElement | null = null;

function getMobilePickerDialog() {
  if (mobilePickerDialog) return mobilePickerDialog;
  const dialog = document.createElement('dialog');
  dialog.className = 'mobile-picker-dialog';
  dialog.setAttribute('aria-labelledby', 'mobile-picker-title');
  const shell = document.createElement('div'); shell.className = 'mobile-picker-shell';
  const header = document.createElement('header'); header.className = 'mobile-picker-header';
  const title = document.createElement('h2'); title.id = 'mobile-picker-title';
  const actions = document.createElement('div'); actions.className = 'mobile-picker-actions';
  const searchToggle = document.createElement('button'); searchToggle.type = 'button'; searchToggle.className = 'mobile-picker-search-toggle'; searchToggle.textContent = '搜尋';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'mobile-picker-close'; close.setAttribute('aria-label', '關閉選項'); close.textContent = '×';
  actions.append(searchToggle, close); header.append(title, actions);
  const search = document.createElement('input'); search.type = 'search'; search.className = 'mobile-picker-search'; search.placeholder = '輸入關鍵字篩選'; search.setAttribute('aria-label', '搜尋選項'); search.hidden = true;
  const list = document.createElement('div'); list.className = 'mobile-picker-options'; list.setAttribute('role', 'listbox');
  shell.append(header, search, list); dialog.append(shell); document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    const target = mobilePickerReturnTarget;
    mobilePickerReturnTarget = null;
    if (target?.isConnected) { target.setAttribute('aria-expanded', 'false'); target.focus(); }
  });
  mobilePickerDialog = dialog; mobilePickerTitle = title; mobilePickerSearchToggle = searchToggle; mobilePickerSearch = search; mobilePickerList = list;
  return dialog;
}

/** Only explicit selections are saved; desktop typing filters the list. */
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
  const mobileQuery = window.matchMedia('(max-width: 700px)');
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
  const openMobilePicker = () => {
    const dialog = getMobilePickerDialog();
    mobilePickerReturnTarget = input;
    input.setAttribute('aria-haspopup', 'dialog');
    input.setAttribute('aria-expanded', 'true');
    mobilePickerTitle!.textContent = label;
    mobilePickerSearchToggle!.hidden = options.length <= 28;
    mobilePickerSearch!.hidden = true;
    mobilePickerSearch!.value = '';
    const drawMobileOptions = (query = '') => {
      const normalized = query.toLocaleLowerCase();
      const filtered = options.filter(option => `${option.label} ${option.detail ?? ''}`.toLocaleLowerCase().includes(normalized));
      mobilePickerList!.replaceChildren();
      for (const option of filtered) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'mobile-picker-option'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.value === committed));
        const name = document.createElement('span'); name.textContent = option.label; row.append(name);
        if (option.detail) { const detail = document.createElement('small'); detail.textContent = option.detail; row.append(detail); }
        row.addEventListener('click', () => { committed = option.value; close(); dialog.close(); onChange(option.value); });
        mobilePickerList!.append(row);
      }
      if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'mobile-picker-empty'; empty.textContent = '找不到符合的選項'; mobilePickerList!.append(empty); }
    };
    drawMobileOptions();
    mobilePickerSearch!.oninput = () => drawMobileOptions(mobilePickerSearch!.value);
    mobilePickerSearchToggle!.onclick = () => {
      mobilePickerSearch!.hidden = false;
      mobilePickerSearch!.focus();
    };
    if (!dialog.open) dialog.showModal();
  };
  input.addEventListener('pointerdown', () => { input.readOnly = mobileQuery.matches; });
  input.addEventListener('focus', () => {
    if (mobileQuery.matches) { input.readOnly = true; return; }
    input.readOnly = false; input.select(); draw('');
  });
  input.addEventListener('click', () => {
    if (mobileQuery.matches) { input.readOnly = true; openMobilePicker(); }
  });
  input.addEventListener('input', () => { if (!mobileQuery.matches) draw(input.value); });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) close(); });
  input.addEventListener('keydown', event => {
    if (mobileQuery.matches && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openMobilePicker(); return; }
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