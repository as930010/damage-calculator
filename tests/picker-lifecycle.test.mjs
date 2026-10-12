import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRuntime } from './loadout-evaluation-harness.mjs';

const choices = Array.from({ length: 100 }, (_value, i) => ({ value: `V${i}`, label: `候選 ${i}`, detail: `Detail ${i}` }));
async function pickerPage(mobile = false, direct = false) {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://picker.test/', pretendToBeVisual: true });
  const runtime = await createRuntime({ dom, transformSource(file, source) {
    if (file !== 'frontend/picker.ts') return source;
    return source.replace(/(function normalizeSearchText[^\{]+\{)/, "$1\n__count('normalize');")
      + '\nexport const __registrations = () => [...outsideCommitPickers].map(entry => entry.root.isConnected);';
  } });
  const { window } = dom, commits = [], invalid = [];
  let pointerListeners = 0;
  const addListener = window.document.addEventListener;
  window.document.addEventListener = function (type, ...args) {
    if (type === 'pointerdown') pointerListeners++; return addListener.call(this, type, ...args);
  };
  window.matchMedia = () => ({ matches: mobile });
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new window.Event('close')); };
  const api = await runtime.load('frontend/picker.ts');
  const entry = direct ? { sanitize: text => text.toUpperCase(), resolve: text => /^V\d+$/.test(text) ? text : null,
    onInvalid: text => invalid.push(text) } : undefined;
  const make = (label = '測試') => {
    const root = api.createPicker(label, choices, 'V0', value => commits.push(value), entry);
    window.document.querySelector('#app').append(root); return root;
  };
  const root = make(), input = root.querySelector('input'), list = root.querySelector('[role="listbox"]');
  const type = text => { input.value = text; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const key = name => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  return { dom, runtime, api, root, input, list, commits, invalid, make, type, key, listenerCount: () => pointerListeners, close: () => dom.window.close() };
}

test('desktop selection, search order, Escape and clear retain their behavior', async () => {
  const page = await pickerPage();
  try {
    page.input.focus(); page.type('候選 9');
    assert.deepEqual([...page.list.querySelectorAll('button span')].map(node => node.textContent), ['候選 9', ...Array.from({ length: 10 }, (_, i) => `候選 9${i}`)]);
    page.list.querySelector('button').click(); assert.deepEqual(page.commits, ['V9']);
    page.type('不存在'); assert.equal(page.list.querySelector('p').textContent, '找不到符合的選項');
    page.key('Escape'); assert.equal(page.input.value, '候選 9'); assert.equal(page.list.hidden, true);
    page.root.querySelector('.picker-clear').click(); assert.equal(page.commits.at(-1), ''); assert.equal(page.input.value, '');
  } finally { page.close(); }
});

test('keyboard arrows, active descendant, Enter and blur preserve selection/focus', async () => {
  const page = await pickerPage();
  try {
    page.input.focus(); page.key('ArrowDown');
    assert.equal(page.input.getAttribute('aria-activedescendant'), `${page.list.id}-0`);
    page.key('ArrowDown'); page.key('ArrowUp'); page.key('Enter'); assert.equal(page.commits.at(-1), 'V0');
    assert.equal(page.dom.window.document.activeElement, page.input);
    page.type('候選 5'); page.input.blur(); assert.equal(page.input.value, '候選 0'); assert.equal(page.list.hidden, true);
  } finally { page.close(); }
});

test('direct entry commits once on outside pointerdown and never commits again on later blur', async () => {
  const page = await pickerPage(false, true);
  try {
    page.input.focus(); page.type('v7');
    page.dom.window.document.body.dispatchEvent(new page.dom.window.Event('pointerdown', { bubbles: true }));
    page.input.blur(); assert.deepEqual(page.commits, ['V7']);
    page.input.focus(); page.type('bad'); page.key('Enter');
    assert.deepEqual(page.invalid, ['BAD']); assert.equal(page.input.value, '候選 7');
  } finally { page.close(); }
});

test('update synchronizes the committed value without replacing DOM and snapshot reset discards drafts', async () => {
  const page = await pickerPage(false, true);
  try {
    page.input.focus(); page.type('v9'); page.api.updatePicker(page.root, 'V2', true);
    assert.equal(page.root.querySelector('input'), page.input); assert.equal(page.input.value, '候選 2');
    page.dom.window.document.body.dispatchEvent(new page.dom.window.Event('pointerdown', { bubbles: true }));
    assert.deepEqual(page.commits, []);
    page.type('v3'); page.api.updatePicker(page.root, 'V2', true); page.key('Enter');
    assert.deepEqual(page.commits, []);
  } finally { page.close(); }
});

test('dispose removes registrations and callbacks immediately, is idempotent and leaves siblings active', async () => {
  const page = await pickerPage(false, true);
  try {
    const sibling = page.make('另一欄');
    page.input.focus(); page.type('v3'); page.api.disposePickers(page.root); page.api.disposePickers(page.root);
    assert.deepEqual([...page.api.__registrations()], [true]);
    page.root.remove(); page.key('Enter'); assert.deepEqual(page.commits, []);
    const input = sibling.querySelector('input'); input.value = 'V4'; input.dispatchEvent(new page.dom.window.Event('input'));
    page.dom.window.document.body.dispatchEvent(new page.dom.window.Event('pointerdown', { bubbles: true }));
    assert.deepEqual(page.commits, ['V4']);
  } finally { page.close(); }
});

test('repeated mount/dispose leaves zero registrations and installs only one document listener', async () => {
  const page = await pickerPage(false, true);
  try {
    let listeners = 0;
    const original = page.dom.window.document.addEventListener;
    page.dom.window.document.addEventListener = function (type, ...args) { if (type === 'pointerdown') listeners++; return original.call(this, type, ...args); };
    const container = page.dom.window.document.querySelector('#app');
    for (let i = 0; i < 20; i++) { page.api.disposePickers(container); container.replaceChildren(); page.make(); }
    assert.equal(listeners, 0); assert.deepEqual([...page.api.__registrations()], [true]);
    assert.equal(page.listenerCount(), 1);
    page.api.disposePickers(container); assert.equal(page.api.__registrations().length, 0);
  } finally { page.close(); }
});

test('fixed candidate text is normalized once and identical matches retain candidate buttons', async () => {
  const page = await pickerPage();
  try {
    page.runtime.resetCounts(); page.input.focus(); const rows = [...page.list.children];
    for (const text of ['候', '選', '候']) page.type(text);
    assert.deepEqual([...page.list.children], rows);
    assert.equal(page.runtime.counts.normalize, 104); // 100 fixed texts + four queries, originally 800 lower-case calls.
    page.type('9'); assert.equal(page.runtime.counts.normalize, 105);
  } finally { page.close(); }
});

test('Chinese composition search uses the latest text and retains the existing matching semantics', async () => {
  const page = await pickerPage();
  try {
    page.input.focus(); page.input.dispatchEvent(new page.dom.window.CompositionEvent('compositionstart'));
    page.type('候'); page.type('候選 99'); page.input.dispatchEvent(new page.dom.window.CompositionEvent('compositionend'));
    assert.equal(page.list.querySelectorAll('button').length, 1); assert.equal(page.list.querySelector('span').textContent, '候選 99');
    page.type(''); assert.equal(page.list.querySelectorAll('button').length, 100);
  } finally { page.close(); }
});

test('mobile dialog supports detail search, selection, close and focus return', async () => {
  const page = await pickerPage(true);
  try {
    page.input.focus(); page.input.click();
    const dialog = page.dom.window.document.querySelector('dialog'); assert.ok(dialog.open);
    const toggle = dialog.querySelector('.mobile-picker-search-toggle'); toggle.click();
    const input = dialog.querySelector('input'); input.value = 'detail 99'; input.dispatchEvent(new page.dom.window.Event('input'));
    assert.equal(dialog.querySelectorAll('[role="option"]').length, 1);
    dialog.querySelector('[role="option"]').click(); assert.deepEqual(page.commits, ['V99']);
    assert.equal(dialog.open, false); assert.equal(page.dom.window.document.activeElement, page.input);
    assert.equal(input.oninput, null); assert.equal(dialog.querySelector('.mobile-picker-options').childNodes.length, 0);
  } finally { page.close(); }
});

test('disposing the mobile owner releases dialog callbacks without affecting another mounted picker', async () => {
  const page = await pickerPage(true);
  try {
    const sibling = page.make('第二欄'); page.input.click();
    const dialog = page.dom.window.document.querySelector('dialog');
    page.api.disposePickers(page.root); page.root.remove();
    assert.equal(dialog.open, false); assert.equal(dialog.querySelector('input').oninput, null);
    assert.equal(dialog.querySelector('.mobile-picker-search-toggle').onclick, null);
    sibling.querySelector('input').click(); assert.equal(dialog.open, true);
    dialog.querySelector('.mobile-picker-close').click();
    assert.equal(page.dom.window.document.activeElement, sibling.querySelector('input'));
    assert.deepEqual(page.commits, []);
  } finally { page.close(); }
});

test('mobile direct-entry reads anchor geometry before candidate DOM writes and releases resize ownership', async () => {
  const page = await pickerPage(true, true);
  try {
    const events = [];
    page.input.getBoundingClientRect = () => { events.push('read'); return { top: 500, bottom: 530 }; };
    const original = page.list.replaceChildren;
    page.list.replaceChildren = function (...args) { events.push('write'); return original.apply(this, args); };
    page.input.focus(); assert.ok(events.indexOf('read') < events.indexOf('write'));
    assert.equal(page.list.classList.contains('opens-above'), false);
    page.api.disposePickers(page.root); events.length = 0;
    page.dom.window.dispatchEvent(new page.dom.window.Event('resize')); assert.deepEqual(events, []);
  } finally { page.close(); }
});
