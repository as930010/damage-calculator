import assert from 'node:assert/strict';
import { createPage, sample, gameData, normalize } from './loadout-evaluation-harness.mjs';

export const stageFields = [
  ['Stage.Adapt', '關卡適應力'], ['Stage.CritRatePenalty', '關卡扣致命'], ['Stage.BossDEF', 'Boss防禦'],
];
export const stateA = structuredClone(sample);
export const stateB = { ...structuredClone(sample), values: { ...sample.values,
  'Stage.Adapt': '80', 'Stage.CritRatePenalty': '10', 'Stage.BossDEF': '83.94' } };

export async function uiPage(state = stateA, baseline = stateA, options = {}) {
  const evaluated = [], blobs = [];
  class ExportURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return 'https://loadout.test/#export'; }
    static revokeObjectURL() {}
  }
  const page = await createPage(state, baseline, { ...options,
    globals: { URL: ExportURL, __observeEvaluation: value => evaluated.push(normalize(value)), ...options.globals },
    transformSource(file, source) {
      if (file === 'frontend/projection.ts') source = source.replace(
        /(export function evaluateLoadout[^\{]+\{)/, '$1\nif (includeFallbackRates) __observeEvaluation(state);');
      if (file === 'frontend/main.ts') {
        source = source.replace('const skillWeightingText =', "__count('formulaHtml'); const skillWeightingText =");
        for (const name of ['renderSlots', 'renderBeastAccessories', 'renderMasterBeastColorSelector',
          'renderInspector', 'renderTitleInput', 'renderGlobalInputs', 'renderWeaponMagicStones',
          'renderRightIceSetSelectors', 'renderCalculationComparison']) source = source.replace(
          new RegExp(`(function ${name}\\([^\\{]*\\)\\s*\\{)`), `$1\n__count('${name}');`);
        for (const name of ['renderClassPicker', 'renderBattleSettings']) source = source.replace(
          new RegExp(`(const ${name} = \\([^\\)]*\\) => \\{)`), `$1\n__count('${name}');`);
      }
      if (file === 'frontend/picker.ts') {
        source = source.replace(/(export function createPicker[^\{]+\{)/, "$1\n__count('createPicker');");
        source = source.replace('disposed = true; controller.abort();', "__count('disposePicker'); disposed = true; controller.abort();");
        source = source.replace(/(function normalizeSearchText[^\{]+\{)/, "$1\n__count('normalizeSearchText');");
        source += '\nexport const __pickerRegistrations = () => [...outsideCommitPickers].map(entry => entry.root.isConnected);';
      }
      return options.transformSource?.(file, source) ?? source;
    },
  });
  const { document } = page.dom.window;
  document.addEventListener('click', event => { if (event.target.closest('a[download]')) event.preventDefault(); });
  return { ...page, evaluated,
    readState: () => JSON.parse(page.dom.window.localStorage.getItem('dab-loadout-v1')),
    async importState(state) {
      const transfer = await page.runtime.load('frontend/loadout-transfer.ts');
      return this.importJson(transfer.serializeLoadout(state, gameData).json);
    },
    async importJson(json) {
      const input = document.querySelector('#loadout-file');
      Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => json }] });
      input.dispatchEvent(new page.dom.window.Event('change'));
      for (let i = 0; i < 200 && document.querySelector('#transfer-status').textContent.includes('正在載入'); i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.match(document.querySelector('#transfer-status').textContent, /已匯入/);
    },
    async exportJson() {
      const before = blobs.length;
      document.querySelector('#export-loadout').click();
      for (let i = 0; i < 100 && blobs.length === before; i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(blobs.length, before + 1, 'export completes after optional module loading');
      const reader = new page.dom.window.FileReader();
      return new Promise((resolve, reject) => {
        reader.onload = () => resolve(JSON.parse(reader.result)); reader.onerror = reject;
        reader.readAsText(blobs.at(-1));
      });
    },
  };
}

/** Test-only observation of real DOM writes, including text nodes in replaced subtrees. */
export async function measureDom(page, action) {
  const { document, Element, MutationObserver } = page.dom.window;
  const records = [];
  const observer = new MutationObserver(batch => records.push(...batch));
  observer.observe(document.querySelector('#app'), { subtree: true, childList: true, attributes: true, characterData: true });
  let innerHTML = 0;
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor,
    set(value) { innerHTML++; descriptor.set.call(this, value); },
  });
  page.runtime.resetCounts();
  try {
    await action();
    records.push(...observer.takeRecords());
    const countNodes = node => 1 + [...node.childNodes].reduce((total, child) => total + countNodes(child), 0);
    const count = key => records.reduce((total, record) => total + [...record[key]].reduce((sum, node) => sum + countNodes(node), 0), 0);
    return { added: count('addedNodes'), removed: count('removedNodes'), mutations: records.length,
      innerHTML, calls: { ...page.runtime.counts } };
  } finally {
    observer.disconnect(); Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
  }
}

export const workloadActions = {
  stage: async page => enter(page, 'Boss防禦', '50'),
  percentage: async page => {
    const input = page.dom.window.document.querySelector('#transcendence-skill-share-number');
    input.value = '50'; input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
  },
  equipment: async page => {
    const input = page.dom.window.document.querySelector('input[aria-label="武器強化"]');
    input.dispatchEvent(new page.dom.window.Event('focus'));
    const option = [...page.dom.window.document.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]')]
      .find(node => node.querySelector('span')?.textContent === 'Lv.13'); assert.ok(option); option.click();
  },
  class: async page => enter(page, '職業', 'KE'),
  beast: async page => {
    const input = page.dom.window.document.querySelector('input[aria-label="聖獸精靈石顏色"]');
    input.dispatchEvent(new page.dom.window.Event('focus'));
    const row = [...page.dom.window.document.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]')]
      .find(option => option.textContent === '綠'); assert.ok(row); row.click();
  },
  import: async page => page.importJson(page.workloadImportJson),
  undo: async page => page.dom.window.document.querySelector('#undo').click(),
  redo: async page => page.dom.window.document.querySelector('#redo').click(),
  baseline: async page => page.dom.window.document.querySelector('#baseline').click(),
  restore: async page => page.dom.window.document.querySelector('#restore-baseline').click(),
  expand: async page => {
    const detail = page.dom.window.document.querySelector('#results details');
    detail.open = !detail.open; detail.dispatchEvent(new page.dom.window.Event('toggle'));
  },
};

export async function prepareWorkload(page, name) {
  if (name === 'import') {
    const transfer = await page.runtime.load('frontend/loadout-transfer.ts');
    page.workloadImportJson = transfer.serializeLoadout(stateB, gameData).json;
  }
  if (['undo', 'redo', 'restore'].includes(name)) await workloadActions.stage(page);
  if (name === 'redo') await workloadActions.undo(page);
}

export function enter(page, label, value) {
  const { document, Event, KeyboardEvent } = page.dom.window;
  const input = document.querySelector(`input[aria-label="${label}"]`);
  assert.ok(input, label);
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return input;
}

export async function assertStageSync(page, expected) {
  const { document } = page.dom.window;
  const current = page.readState(), used = page.evaluated.at(-1);
  for (const [field, label] of stageFields) {
    assert.equal(String(current.values[field] ?? ''), String(expected.values[field] ?? ''), 'saved State ' + field);
    assert.equal(String(used.values[field] ?? ''), String(expected.values[field] ?? ''), 'calculation State ' + field);
    assert.equal(document.querySelector(`input[aria-label="${label}"]`).value, String(expected.values[field] ?? ''), 'control ' + field);
  }
  const { evaluateLoadout } = await page.runtime.load('frontend/projection.ts');
  const evaluation = evaluateLoadout(gameData, current);
  assert.ok(evaluation.damage);
  assert.equal(document.querySelector('#damage-result .final-damage strong').textContent,
    evaluation.damage.result.finalDamage.finalDamage.toLocaleString('en-US', { maximumFractionDigits: 3 }), 'displayed damage');
}
