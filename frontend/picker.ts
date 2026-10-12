export interface PickerOption { value: string; label: string; detail?: string }
let sequence = 0;
let mobilePickerDialog: HTMLDialogElement | null = null;
let mobilePickerTitle: HTMLElement | null = null;
let mobilePickerSearchToggle: HTMLButtonElement | null = null;
let mobilePickerSearch: HTMLInputElement | null = null;
let mobilePickerList: HTMLElement | null = null;
let mobilePickerReturnTarget: HTMLElement | null = null;
let activeMobileSuggestionsRepositioner: (() => void) | null = null;
let mobileSuggestionsResizeListenerInstalled = false;
type OutsideCommitPicker = { root: HTMLElement; commitOrClose: () => void };
const outsideCommitPickers = new Set<OutsideCommitPicker>();
let outsideCommitListenerInstalled = false;
const pickerHandles = new WeakMap<HTMLElement, { update: (value: string, resetDraft: boolean) => void; dispose: () => void }>();

/** Synchronize a committed value without replacing a control or its event listeners. */
export function updatePicker(root: HTMLElement, value: string, resetDraft = false) {
  pickerHandles.get(root)?.update(value, resetDraft);
}

/** Owners call this before replacing their control subtree. It is safe to call twice. */
export function disposePickers(container: HTMLElement) {
  pickerHandles.get(container)?.dispose();
  container.querySelectorAll<HTMLElement>('.picker').forEach(root => pickerHandles.get(root)?.dispose());
}

function releaseMobilePickerContent() {
  mobilePickerReturnTarget = null;
  if (mobilePickerSearch) mobilePickerSearch.oninput = null;
  if (mobilePickerSearchToggle) mobilePickerSearchToggle.onclick = null;
  mobilePickerList?.replaceChildren();
}

function normalizeSearchText(text: string) { return text.toLocaleLowerCase(); }

function setActiveMobileSuggestionsRepositioner(reposition: () => void) {
  activeMobileSuggestionsRepositioner = reposition;
  if (mobileSuggestionsResizeListenerInstalled) return;
  const sync = () => activeMobileSuggestionsRepositioner?.();
  window.addEventListener('resize', sync, { passive: true });
  window.visualViewport?.addEventListener('resize', sync, { passive: true });
  mobileSuggestionsResizeListenerInstalled = true;
}

function clearActiveMobileSuggestionsRepositioner(reposition: (() => void) | null) {
  if (reposition && activeMobileSuggestionsRepositioner === reposition) activeMobileSuggestionsRepositioner = null;
}

function registerOutsidePointerCommit(picker: OutsideCommitPicker) {
  if (!outsideCommitListenerInstalled) {
    document.addEventListener("pointerdown", event => {
      // A commit can replace a subtree and register new controls during this event.
      for (const entry of [...outsideCommitPickers]) {
        if (!outsideCommitPickers.has(entry)) continue;
        if (!entry.root.isConnected) { outsideCommitPickers.delete(entry); continue; }
        if (!entry.root.contains(event.target as Node | null)) entry.commitOrClose();
      }
    }, true);
    outsideCommitListenerInstalled = true;
  }
  outsideCommitPickers.add(picker);
}

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
    releaseMobilePickerContent();
    if (target?.isConnected) { target.setAttribute('aria-expanded', 'false'); target.focus(); }
  });
  mobilePickerDialog = dialog; mobilePickerTitle = title; mobilePickerSearchToggle = searchToggle; mobilePickerSearch = search; mobilePickerList = list;
  return dialog;
}

/** Only explicit selections are saved; desktop typing filters the list. */
export interface PickerDirectEntry { sanitize: (value: string) => string; resolve: (value: string) => string | null; onInvalid: (value: string) => void; onInput?: () => void; allowCharacter?: (character: string) => boolean }
export function createPicker(label: string, options: readonly PickerOption[], value: string, onChange: (value: string) => void, directEntry?: PickerDirectEntry): HTMLElement {
  const controller = new window.AbortController();
  let disposed = false;
  const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void) =>
    target.addEventListener(type, handler, { signal: controller.signal });
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
  let directEntryDirty = false;
  let desktopSearchTexts: string[] | undefined, mobileSearchTexts: string[] | undefined;
  let repositionMobileSuggestions: (() => void) | null = null;
  const mobileQuery = window.matchMedia('(max-width: 700px)');
  const close = () => { list.hidden = true; clearActiveMobileSuggestionsRepositioner(repositionMobileSuggestions); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); input.value = displayValue(committed); clear.hidden = committed === ''; };
  const commit = (option: PickerOption) => { directEntryDirty = false; committed = option.value; close(); onChange(option.value); };
  const commitDirectEntry = () => {
    if (!directEntry || disposed) return;
    if (!directEntryDirty) { close(); return; }
    const typedValue = input.value;
    const resolved = directEntry.resolve(typedValue);
    const option = resolved ? options.find(entry => entry.value === resolved) ?? { value: resolved, label: resolved } : undefined;
    directEntryDirty = false;
    if (option) commit(option);
    else { directEntry.onInvalid(typedValue); close(); }
  };
  const outsideEntry = { root, commitOrClose: commitDirectEntry };
  if (directEntry) registerOutsidePointerCommit(outsideEntry);
  const readMobilePosition = () => {
    const actionBar = document.querySelector<HTMLElement>('.toolbar-actions');
    const inputRect = input.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const visibleTop = visualViewport?.offsetTop ?? 0;
    const visibleBottom = Math.min(window.innerHeight, visibleTop + (visualViewport?.height ?? window.innerHeight));
    const actionBarTop = Math.min(actionBar?.getBoundingClientRect().top ?? visibleBottom, visibleBottom);
    const spaceBelow = Math.max(0, actionBarTop - inputRect.bottom - 8);
    const spaceAbove = Math.max(0, inputRect.top - visibleTop - 8);
    const opensAbove = spaceBelow < 200 && spaceAbove > spaceBelow;
    const availableSpace = opensAbove ? spaceAbove : spaceBelow;
    return { opensAbove, maxHeight: `${Math.max(96, Math.min(300, availableSpace))}px` };
  };
  const applyMobilePosition = (position: ReturnType<typeof readMobilePosition>) => {
    list.classList.toggle('opens-above', position.opensAbove);
    list.style.maxHeight = position.maxHeight;
  };
  repositionMobileSuggestions = () => {
    if (!list.isConnected || list.hidden || disposed) {
      clearActiveMobileSuggestionsRepositioner(repositionMobileSuggestions); return;
    }
    if (mobileQuery.matches && directEntry) applyMobilePosition(readMobilePosition());
  };
  const draw = (query: string) => {
    if (disposed) return;
    // These measurements depend on the anchor/toolbar, not on the candidate rows.
    const position = mobileQuery.matches && directEntry ? readMobilePosition() : null;
    desktopSearchTexts ??= options.map(option => normalizeSearchText(option.label + (directEntry ? ' ' + option.value : '')));
    const normalized = normalizeSearchText(query);
    const next = options.filter((_option, i) => desktopSearchTexts![i].includes(normalized));
    const unchanged = list.childNodes.length > 0 && next.length === matches.length && next.every((option, i) => option === matches[i]);
    matches = next; index = -1;
    input.removeAttribute('aria-activedescendant');
    if (!unchanged) {
      list.replaceChildren();
      for (const [i, option] of matches.entries()) {
        const row = document.createElement('button'); row.type = 'button'; row.role = 'option'; row.id = `${list.id}-${i}`; row.tabIndex = -1;
        const name = document.createElement('span'); name.textContent = option.label; row.append(name);
        if (option.detail) { const detail = document.createElement('small'); detail.textContent = option.detail; row.append(detail); }
        row.addEventListener('mousedown', event => event.preventDefault()); row.addEventListener('click', () => commit(option)); list.append(row);
      }
      if (!matches.length) { const empty = document.createElement('p'); empty.textContent = '找不到符合的選項'; list.append(empty); }
    } else [...list.children].forEach(row => row.removeAttribute('aria-selected'));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (position) { applyMobilePosition(position); setActiveMobileSuggestionsRepositioner(repositionMobileSuggestions); }
    else { list.classList.remove('opens-above'); list.style.removeProperty('max-height'); }
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
      mobileSearchTexts ??= options.map(option => normalizeSearchText(`${option.label} ${option.detail ?? ''}`));
      const normalized = normalizeSearchText(query);
      const filtered = options.filter((_option, i) => mobileSearchTexts![i].includes(normalized));
      mobilePickerList!.replaceChildren();
      for (const option of filtered) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'mobile-picker-option'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(option.value === committed));
        const name = document.createElement('span'); name.textContent = option.label; row.append(name);
        if (option.detail) {
          const detail = document.createElement('small'); detail.textContent = option.detail; row.append(detail);
          if (root.classList.contains('right-ice-set-picker')) row.classList.add('right-ice-set-count-option');
        }
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
  listen(input, 'pointerdown', () => { input.readOnly = mobileQuery.matches && !directEntry; });
  listen(input, 'focus', () => {
    directEntryDirty = false;
    if (mobileQuery.matches && !directEntry) { input.readOnly = true; return; }
    input.readOnly = false; input.select(); draw('');
  });
  listen(input, 'click', () => {
    if (mobileQuery.matches && !directEntry) { input.readOnly = true; openMobilePicker(); }
  });
  listen(input, 'keydown', event => { if (directEntry?.allowCharacter && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !directEntry.allowCharacter(event.key)) event.preventDefault(); });
  listen(input, 'beforeinput', event => { const data = (event as InputEvent).data; if (directEntry?.allowCharacter && data && [...data].some(character => !directEntry.allowCharacter!(character))) event.preventDefault(); });
  listen(input, 'paste', event => { const text = (event as ClipboardEvent).clipboardData?.getData('text') ?? ''; if (directEntry?.allowCharacter && [...text].some(character => !directEntry.allowCharacter!(character))) event.preventDefault(); });
  listen(input, 'input', () => { if (directEntry) { directEntryDirty = true; const sanitized = directEntry.sanitize(input.value); if (sanitized !== input.value) input.value = sanitized; directEntry.onInput?.(); } if (!mobileQuery.matches || directEntry) draw(input.value); });
  listen(root, 'focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) { if (directEntry && directEntryDirty) commitDirectEntry(); else close(); } });
  listen(input, 'keydown', event => {
    if (mobileQuery.matches && !directEntry && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openMobilePicker(); return; }
    if (event.key === 'Escape') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (list.hidden) draw(''); if (!matches.length) return;
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === index)));
      input.setAttribute('aria-activedescendant', `${list.id}-${index}`); list.children[index]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !list.hidden && index >= 0) { event.preventDefault(); commit(matches[index]); } else if (event.key === 'Enter' && directEntry) { event.preventDefault(); commitDirectEntry(); }
  });
  listen(clear, 'mousedown', event => event.preventDefault());
  listen(clear, 'click', () => { directEntryDirty = false; committed = ''; input.value = ''; close(); onChange(''); });
  pickerHandles.set(root, {
    update(value, resetDraft) {
      if (disposed || !resetDraft && committed === value && !directEntryDirty) return;
      committed = value; directEntryDirty = false; close();
      if (mobilePickerReturnTarget === input) { releaseMobilePickerContent(); mobilePickerDialog?.close(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; controller.abort(); outsideCommitPickers.delete(outsideEntry);
      clearActiveMobileSuggestionsRepositioner(repositionMobileSuggestions);
      if (mobilePickerReturnTarget === input) { releaseMobilePickerContent(); mobilePickerDialog?.close(); }
      matches = []; desktopSearchTexts = undefined; mobileSearchTexts = undefined;
      list.replaceChildren(); pickerHandles.delete(root);
    },
  });
  control.append(input, list, clear); root.append(caption, control); return root;
}
