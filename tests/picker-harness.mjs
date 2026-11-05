import { JSDOM } from 'jsdom';
import { createRuntime } from './loadout-evaluation-harness.mjs';

const choices = Array.from({ length: 100 }, (_value, i) => ({ value: `V${i}`, label: `候選 ${i}`, detail: `Detail ${i}` }));
export async function pickerPage(mobile = false, direct = false) {
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
