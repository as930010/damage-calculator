import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, gameData } from './loadout-evaluation-harness.mjs';
import { uiPage, stateA, workloadActions } from './ui-update-harness.mjs';

const rowsCell = 'Left.Armor.Gloves.Circuit.Rows';
const upperAttribute = 'Left.Armor.Upper.Circuit.Attribute';
const upperValue = 'Left.Armor.Upper.Circuit.Value';
const rows = page => JSON.parse(page.readState().values[rowsCell]);
const openGloves = page => page.dom.window.document.querySelector('.gear-slot[data-slot-id="inner-gloves"]').click();
const controls = page => [...page.dom.window.document.querySelectorAll('.circuit-board-row input[type="number"]')];
function input(page, control, value) {
  control.value = value;
  control.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
}
function select(page, label, value) {
  const control = page.dom.window.document.querySelector(`input[aria-label="${label}"]`);
  control.dispatchEvent(new page.dom.window.Event('focus'));
  const list = page.dom.window.document.getElementById(control.getAttribute('aria-controls'));
  const option = [...list.querySelectorAll('[role="option"]')].find(node => node.querySelector('span')?.textContent === value);
  assert.ok(option, value); option.click();
}

test('all unrelated-damage fields normalize empty/invalid values while valid saved choices survive', async () => {
  const runtime = await createRuntime();
  const { createCatalogIndex } = await runtime.load('frontend/catalog-index.ts');
  const { normalizeOptionalEffectValues } = await runtime.load('frontend/state.ts');
  const { FIELD_ID_TO_CODE } = await runtime.load('frontend/field-ids.ts');
  const index = createCatalogIndex(gameData);
  const fields = Object.keys(FIELD_ID_TO_CODE).filter(cell => index.resolveFieldChoices(cell, {})?.includes('無關傷害'));
  for (const invalid of [undefined, null, '', 'not-a-valid-option']) {
    const values = Object.fromEntries(fields.map(cell => [cell, invalid]));
    normalizeOptionalEffectValues(values, index);
    for (const cell of fields) assert.equal(values[cell], '無關傷害', cell);
    assert.equal(normalizeOptionalEffectValues(values, index), false, 'normalization is stable');
  }
  for (const cell of fields) {
    const choices = gameData.circuits.inputs.find(circuit => circuit.attributeCell === cell)?.attributeOptions
      ?? index.resolveFieldChoices(cell, {});
    const choice = choices.find(value => value !== '無關傷害');
    if (choice === undefined) continue;
    const values = { [cell]: choice };
    normalizeOptionalEffectValues(values, index);
    assert.equal(values[cell], choice, cell);
  }
  const invalidCircuit = { [upperAttribute]: '物攻', [upperValue]: 0.11 };
  normalizeOptionalEffectValues(invalidCircuit, index);
  assert.equal(invalidCircuit[upperAttribute], '無關傷害'); assert.equal(invalidCircuit[upperValue], 0);
});

test('unrelated-damage X resets paired inputs to disabled zero and survives import/history/reload', async () => {
  const state = structuredClone(stateA);
  state.values[upperAttribute] = 'Boss傷害%'; state.values[upperValue] = 0.11;
  const page = await uiPage(state);
  let reload;
  try {
    const open = () => page.dom.window.document.querySelector('.gear-slot[data-slot-id="inner-upper"]').click();
    open();
    const attribute = page.dom.window.document.querySelector('input[aria-label="電路板項目"]');
    attribute.closest('.picker').querySelector('.picker-clear').click();
    assert.equal(page.readState().values[upperAttribute], '無關傷害');
    assert.equal(page.readState().values[upperValue], 0);
    let value = page.dom.window.document.querySelector('.attribute-value-grid input[type="number"][max="18"]');
    assert.equal(value.disabled, true); assert.equal(value.value, '0');
    await workloadActions.undo(page); open();
    assert.equal(page.readState().values[upperValue], 0.11);
    await workloadActions.redo(page); open();
    assert.equal(page.readState().values[upperValue], 0);
    const exported = await page.exportJson(); await page.importJson(JSON.stringify(exported)); open();
    assert.equal(page.readState().values[upperAttribute], '無關傷害');
    reload = await uiPage(page.readState());
    reload.dom.window.document.querySelector('.gear-slot[data-slot-id="inner-upper"]').click();
    value = reload.dom.window.document.querySelector('.attribute-value-grid input[type="number"][max="18"]');
    assert.equal(value.value, '0'); assert.equal(value.disabled, true);
    select(page, '電路板項目', 'Boss傷害%');
    value = page.dom.window.document.querySelector('.attribute-value-grid input[type="number"][max="18"]');
    assert.equal(value.disabled, false); assert.equal(value.value, '0');
    input(page, value, '19'); assert.equal(value.value, '18');
    input(page, value, '-1'); assert.equal(value.value, '0');
    input(page, value, ''); assert.equal(page.readState().values[upperValue], 0);
  } finally { page.close(); reload?.close(); }
});

test('glove circuit edits retain the last field, update peers, preserve focus and restore with history', async () => {
  const state = structuredClone(stateA);
  state.values[rowsCell] = JSON.stringify([{ attribute: 'Boss傷害%', percentageValue: 0.11 }, { attribute: '單技傷%', percentageValue: 0.02 }]);
  const page = await uiPage(state);
  try {
    openGloves(page); const [a, b] = controls(page); b.focus(); input(page, b, '12.4');
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.056, 0.124]);
    assert.equal(a.value, '5.6'); assert.equal(b.value, '12.4');
    assert.equal(page.dom.window.document.activeElement, b);
    input(page, a, '18');
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.18, 0]);
    assert.equal(b.value, '0');
    await workloadActions.undo(page); openGloves(page);
    assert.deepEqual(controls(page).map(control => control.value), ['5.6', '12.4']);
    await workloadActions.redo(page); openGloves(page);
    assert.deepEqual(controls(page).map(control => control.value), ['18', '0']);
    input(page, controls(page)[0], ''); assert.equal(rows(page)[0].percentageValue, 0);
    select(page, '電路板項目 1', '無關傷害');
    assert.equal(controls(page)[0].disabled, true); assert.equal(controls(page)[0].value, '0');
    select(page, '電路板項目 1', 'Boss傷害%');
    assert.equal(controls(page)[0].disabled, false); assert.equal(controls(page)[0].value, '0');
  } finally { page.close(); }
});

test('legacy circuit budgets normalize deterministically on import, save/reload, and baseline restore', async () => {
  const page = await uiPage(); let reload;
  try {
    const exported = await page.exportJson();
    const { FIELD_ID_TO_CODE } = await page.runtime.load('frontend/field-ids.ts');
    exported.values[FIELD_ID_TO_CODE[rowsCell]] = JSON.stringify([
      { attribute: 'Boss傷害%', percentageValue: 0.11 },
      { attribute: '單技傷%', percentageValue: 0.124 },
      { attribute: null, percentageValue: 0.1 },
      { attribute: 'Boss傷害%', percentageValue: 'invalid' },
    ]);
    exported.values[FIELD_ID_TO_CODE[upperAttribute]] = null;
    exported.values[FIELD_ID_TO_CODE[upperValue]] = 0.9;
    await page.importJson(JSON.stringify(exported)); openGloves(page);
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.11, 0.07, 0, 0]);
    assert.equal(page.readState().values[upperValue], 0);
    assert.equal(rows(page)[2].attribute, '無關傷害');
    reload = await uiPage(page.readState()); openGloves(reload);
    assert.deepEqual(controls(reload).map(control => control.value), ['11', '7', '0', '0']);
    page.dom.window.document.querySelector('#baseline').click();
    input(page, controls(page)[0], '18');
    page.dom.window.document.querySelector('#restore-baseline').click(); openGloves(page);
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.11, 0.07, 0, 0]);
    const validExport = await page.exportJson(); await page.importJson(JSON.stringify(validExport));
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.11, 0.07, 0, 0]);
  } finally { page.close(); reload?.close(); }
});
