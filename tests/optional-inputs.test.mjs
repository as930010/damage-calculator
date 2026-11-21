import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime, gameData } from './loadout-evaluation-harness.mjs';
import { uiPage, stateA, workloadActions } from './ui-update-harness.mjs';

const rowsField = 'Left.Armor.Gloves.Circuit.Rows';
const upperAttribute = 'Left.Armor.Upper.Circuit.Attribute';
const upperValue = 'Left.Armor.Upper.Circuit.Value';
const boards = [
  { slot: 'upper', gear: 'inner-upper', attribute: 'Left.Armor.Upper.Circuit.Attribute', value: 'Left.Armor.Upper.Circuit.Value', max: 4 },
  { slot: 'lowerwear', gear: 'inner-lowerwear', attribute: 'Left.Armor.Bottom.Circuit.Attribute', value: 'Left.Armor.Bottom.Circuit.Value', max: 5 },
  { slot: 'lowerwearAlternative', gear: 'inner-lowerwearAlternative', attribute: 'Left.Armor.SwitchBottom.Circuit.Attribute', value: 'Left.Armor.SwitchBottom.Circuit.Value', max: 5 },
  { slot: 'gloves', gear: 'inner-gloves', attribute: 'Left.Armor.Gloves.Circuit.Attribute', value: 'Left.Armor.Gloves.Circuit.Value', max: 3 },
  { slot: 'shoes', gear: 'inner-shoes', attribute: 'Left.Armor.Shoes.Circuit.Attribute', value: 'Left.Armor.Shoes.Circuit.Value', max: 2 },
];
const rows = page => JSON.parse(page.readState().values[rowsField]);
const openGloves = page => page.dom.window.document.querySelector('.gear-slot[data-slot-id="inner-gloves"]').click();
const openBoard = (page, board) => page.dom.window.document.querySelector(`.gear-slot[data-slot-id="${board.gear}"]`).click();
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

test('cooldown reset adds upper circuit rows and the blue set without contributing damage', async () => {
  const runtime = await createRuntime();
  const { projectAttributes, evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { finalDamageInputs } = await runtime.load('calculation/loadout-engine.ts');
  const dataWithoutBlueReset = structuredClone(gameData);
  delete dataWithoutBlueReset.colorSetEffects.options.find(option => option.name === '藍').stats.cooldownResetPct;
  const withoutResetStatistic = result => {
    const damage = structuredClone(result);
    delete damage.attributes.stats.cooldownResetPct;
    for (const { result: variant } of damage.lowerwearConfigurations ?? []) delete variant.attributes.stats.cooldownResetPct;
    return damage;
  };
  const rowField = upperAttribute.replace(/\.Attribute$/, '.Rows');
  const scenarios = [
    { color: '', expectedSet: 0, rows: [0.12] },
    { color: '紅', expectedSet: 0, rows: [0.12] },
    { color: '綠', expectedSet: 0, rows: [] },
    { color: '藍', expectedSet: 8, rows: [] },
    { color: '藍', expectedSet: 8, rows: [0.05, 0.07] },
  ];
  for (const { color, expectedSet, rows: resetRows } of scenarios) {
    const state = structuredClone(stateA);
    delete state.values[rowField];
    state.values['Left.Armor.SetColor'] = color;
    state.values[upperAttribute] = resetRows.length ? '重置機率%' : '無關傷害';
    state.values[upperValue] = resetRows[0] ?? 0;
    const reference = structuredClone(state);
    reference.values[upperAttribute] = '無關傷害';
    reference.values[upperValue] = 0;
    if (resetRows.length > 1) {
      const board = resetRows.map(percentageValue => ({ attribute: '重置機率%', percentageValue }));
      const unrelated = { attribute: '無關傷害', percentageValue: 0 };
      const boss = { attribute: 'Boss傷害%', percentageValue: 0.06 };
      state.values[rowField] = JSON.stringify([...board, boss]);
      reference.values[rowField] = JSON.stringify([...board.map(() => unrelated), boss]);
    }
    const result = projectAttributes(gameData, state).stats.cooldownResetPct;
    assert.equal(result.finalTotal, (resetRows.length ? 12 : 0) + expectedSet);
    assert.deepEqual(Array.from(result.sharedSources, ({ sourceId }) => sourceId), [
      ...resetRows.map((_, i) => resetRows.length > 1 ? 'circuit-board:upper:' + (i + 1) : 'circuit-board:upper'),
      ...(expectedSet ? ['color-set:藍'] : []),
    ]);
    // Keep the blue set's damage multiplier in both evaluations and remove only its reset chance.
    const current = evaluateLoadout(gameData, state, true, true);
    const withoutReset = evaluateLoadout(dataWithoutBlueReset, reference, true, true);
    assert.ok(current.damage && withoutReset.damage, 'test loadouts have valid damage results');
    assert.equal(withoutReset.damage.result.attributes.stats.cooldownResetPct.finalTotal, 0);
    assert.deepEqual(finalDamageInputs(current.comparisonInput, current.damage.result),
      finalDamageInputs(withoutReset.comparisonInput, withoutReset.damage.result));
    assert.deepEqual(withoutResetStatistic(current.damage.result), withoutResetStatistic(withoutReset.damage.result));
  }
});

test('upper circuit reset chance can be edited and survives export, import and reload', async () => {
  const page = await uiPage(); let reload;
  try {
    const { document } = page.dom.window;
    openBoard(page, boards[0]);
    select(page, '電路板項目 1', '無關傷害');
    const result = document.querySelector('#damage-result').innerHTML;
    select(page, '電路板項目 1', '重置機率%');
    assert.equal(controls(page)[0].disabled, false);
    input(page, controls(page)[0], '12');
    assert.equal(controls(page)[0].value, '12');
    const resetTotal = () => document.querySelector('#results [data-disclosure-key="stat:cooldownResetPct"]');
    assert.equal(resetTotal().nextElementSibling.dataset.disclosureKey, 'multiplicative-effect');
    assert.equal(resetTotal().querySelector('summary span').textContent, '重置冷卻%');
    assert.equal(resetTotal().querySelector('summary strong').textContent, '12%');
    assert.equal(document.querySelector('#damage-result').innerHTML, result);
    const allRows = () => [...document.querySelectorAll('#calculation-comparison [data-disclosure-key="comparison-all-values"] tbody tr')];
    const comparisonRow = () => allRows().find(row => row.querySelector('th').textContent === '重置冷卻%');
    assert.ok(comparisonRow());
    assert.equal(comparisonRow().nextElementSibling.querySelector('th').textContent, '乘算效果');
    assert.deepEqual([...comparisonRow().querySelectorAll('td')].map(cell => cell.textContent), ['0', '12', '+12']);
    document.querySelector('#global-source-settings').open = true;
    select(page, '百億/內布隆套效', '藍');
    assert.equal(resetTotal().querySelector('summary strong').textContent, '20%');
    assert.deepEqual([...comparisonRow().querySelectorAll('td')].map(cell => cell.textContent), ['0', '20', '+20']);
    assert.deepEqual([...resetTotal().querySelectorAll('.stat-source-row strong')].map(value => value.textContent), ['12%', '8%']);
    assert.doesNotMatch(document.body.textContent, /尚未有屬性對應/);
    const exported = await page.exportJson();
    await page.importJson(JSON.stringify(exported));
    reload = await uiPage(page.readState());
    openBoard(reload, boards[0]);
    assert.equal(reload.dom.window.document.querySelector('input[aria-label="電路板項目 1"]').value, '重置機率%');
    assert.equal(controls(reload)[0].value, '12');
    assert.equal(controls(reload)[0].disabled, false);
    assert.equal(reload.dom.window.document.querySelector('#results [data-disclosure-key="stat:cooldownResetPct"] summary strong').textContent, '20%');
    assert.doesNotMatch(reload.dom.window.document.body.textContent, /尚未有屬性對應/);
  } finally { page.close(); reload?.close(); }
});

test('all unrelated-damage fields normalize empty/invalid values while valid saved choices survive', async () => {
  const runtime = await createRuntime();
  const { createCatalogIndex } = await runtime.load('frontend/catalog-index.ts');
  const { normalizeOptionalEffectValues } = await runtime.load('frontend/state.ts');
  const { FIELD_ID_TO_CODE } = await runtime.load('frontend/field-ids.ts');
  const index = createCatalogIndex(gameData);
  const {equipmentProgressChoiceFields}=await runtime.load('frontend/equipment-progress.ts');
  const progressChoices=equipmentProgressChoiceFields(index);
  const fields = Object.keys(FIELD_ID_TO_CODE).filter(fieldId => index.resolveFieldChoices(fieldId, {})?.includes('無關傷害'));
  for (const invalid of [undefined, null, '', 'not-a-valid-option']) {
    const values = Object.fromEntries(fields.map(fieldId => [fieldId, invalid]));
    normalizeOptionalEffectValues(values, index);
    for (const fieldId of fields) assert.equal(values[fieldId], (fieldId.startsWith('MasterBeast.') || progressChoices.has(fieldId)) ? undefined : '無關傷害', fieldId);
    assert.equal(normalizeOptionalEffectValues(values, index), false, 'normalization is stable');
  }
  for (const fieldId of fields) {
    const choices = gameData.circuits.inputs.find(circuit => circuit.attributeField === fieldId)?.attributeOptions
      ?? index.resolveFieldChoices(fieldId, {});
    const choice = choices.find(value => value !== '無關傷害');
    if (choice === undefined) continue;
    const values = { [fieldId]: choice };
    normalizeOptionalEffectValues(values, index);
    assert.equal(values[fieldId], choice, fieldId);
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
    const attribute = page.dom.window.document.querySelector('input[aria-label="電路板項目 1"]');
    attribute.closest('.picker').querySelector('.picker-clear').click();
    assert.equal(page.readState().values[upperAttribute], '無關傷害');
    assert.equal(page.readState().values[upperValue], 0);
    let value = controls(page)[0];
    assert.equal(value.disabled, true); assert.equal(value.value, '0');
    await workloadActions.undo(page); open();
    assert.equal(page.readState().values[upperValue], 0.11);
    await workloadActions.redo(page); open();
    assert.equal(page.readState().values[upperValue], 0);
    const exported = await page.exportJson(); await page.importJson(JSON.stringify(exported)); open();
    assert.equal(page.readState().values[upperAttribute], '無關傷害');
    reload = await uiPage(page.readState());
    reload.dom.window.document.querySelector('.gear-slot[data-slot-id="inner-upper"]').click();
    value = controls(reload)[0];
    assert.equal(value.value, '0'); assert.equal(value.disabled, true);
    select(page, '電路板項目 1', 'Boss傷害%');
    value = controls(page)[0];
    assert.equal(value.disabled, false); assert.equal(value.value, '0');
    input(page, value, '19'); assert.equal(value.value, '18');
    input(page, value, '-1'); assert.equal(value.value, '0');
    input(page, value, ''); assert.equal(page.readState().values[upperValue], 0);
  } finally { page.close(); reload?.close(); }
});

test('glove circuit edits retain the last field, update peers, preserve focus and restore with history', async () => {
  const state = structuredClone(stateA);
  state.values[rowsField] = JSON.stringify([{ attribute: 'Boss傷害%', percentageValue: 0.11 }, { attribute: '單技傷%', percentageValue: 0.02 }]);
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

test('circuit row budget removes floating point residue from 18% minus 17%', async () => {
  const state = structuredClone(stateA);
  state.values[rowsField] = JSON.stringify([
    { attribute: 'Boss傷害%', percentageValue: 0.18 },
    { attribute: '單技傷%', percentageValue: 0 },
  ]);
  const page = await uiPage(state);
  try {
    openGloves(page);
    const [a, b] = controls(page);
    input(page, b, '17');
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.01, 0.17]);
    assert.equal(a.value, '1');
    assert.equal(b.value, '17');
  } finally { page.close(); }
});

test('all circuit boards support bounded rows and retain them across compact export, import and reload', async () => {
  const state = structuredClone(stateA);
  state.lowerwearAlternativeEnabled = true;
  const page = await uiPage(state); let reload;
  try {
    for (const board of boards) {
      openBoard(page, board);
      const rowField = board.attribute.replace(/\.Attribute$/, '.Rows');
      assert.equal(JSON.parse(page.readState().values[rowField]).length, 1, board.slot);
      const add = page.dom.window.document.querySelector('.circuit-board-add');
      while (JSON.parse(page.readState().values[rowField]).length < board.max) add.click();
      assert.equal(JSON.parse(page.readState().values[rowField]).length, board.max, board.slot);
      assert.equal(add.disabled, true, board.slot);
      const styles = page.dom.window.document.createElement('style');
      styles.textContent = await readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8');
      page.dom.window.document.head.append(styles);
      assert.equal(page.dom.window.getComputedStyle(add).opacity, '0.58', `${board.slot} add button visibly disabled`);
      assert.equal(page.dom.window.getComputedStyle(add).cursor, 'not-allowed', `${board.slot} add button cursor`);
      add.click();
      assert.equal(JSON.parse(page.readState().values[rowField]).length, board.max, `${board.slot} disabled add has no effect`);
      page.dom.window.document.querySelector('.circuit-board-remove:not([disabled])').click();
      assert.equal(JSON.parse(page.readState().values[rowField]).length, board.max - 1, board.slot);
      assert.equal(page.dom.window.document.querySelector('.circuit-board-add').disabled, false, board.slot);
      while (JSON.parse(page.readState().values[rowField]).length > 1) {
        page.dom.window.document.querySelector('.circuit-board-remove:not([disabled])').click();
      }
      assert.equal(page.dom.window.document.querySelector('.circuit-board-remove').disabled, true, board.slot);
      page.dom.window.document.querySelector('.circuit-board-add').click();
      assert.equal(JSON.parse(page.readState().values[rowField]).length, 2, board.slot);
    }

    for (const board of boards) {
      const rowField = board.attribute.replace(/\.Attribute$/, '.Rows');
      const savedRows = page.readState().values[rowField];
      const exported = await page.exportJson();
      const { decodeSingle } = await page.runtime.load('frontend/loadout-archive.ts');
      assert.equal(decodeSingle(exported).values[rowField], savedRows, `${board.slot} rows exported`);
      await page.importJson(JSON.stringify(exported));
      assert.equal(page.readState().values[rowField], savedRows, `${board.slot} rows imported`);
    }
    reload = await uiPage(page.readState());
    for (const board of boards) {
      const rowField = board.attribute.replace(/\.Attribute$/, '.Rows');
      assert.equal(reload.readState().values[rowField], page.readState().values[rowField], `${board.slot} rows reloaded`);
    }
  } finally { page.close(); reload?.close(); }
});

test('lowerwear can combine stronger and heat rows while alternate toggle keeps cross-set exclusion', async () => {
  const state = structuredClone(stateA);
  state.lowerwearAlternativeEnabled = false;
  const page = await uiPage(state);
  try {
    openBoard(page, boards[1]);
    select(page, '電路板項目 1', '強者%');
    page.dom.window.document.querySelector('.circuit-board-add').click();
    select(page, '電路板項目 2', '排熱%');
    input(page, controls(page)[0], '5');
    input(page, controls(page)[1], '4');
    const lowerwearRows = JSON.parse(page.readState().values['Left.Armor.Bottom.Circuit.Rows']);
    assert.deepEqual(lowerwearRows.map(row => row.attribute), ['強者%', '排熱%']);
    const { projectAttributes } = await page.runtime.load('frontend/projection.ts');
    const projected = projectAttributes(gameData, page.readState());
    const sources = projected.calculationSources.lowerwearA.filter(source => source.sourceId.startsWith('circuit-board:lowerwear:'));
    assert.deepEqual(Array.from(sources, source => Object.values(source.stats)[0]), [5, 4]);

    const conditional = structuredClone(stateA);
    conditional.lowerwearAlternativeEnabled = true;
    conditional.values['Left.Armor.Bottom.Circuit.Rows'] = JSON.stringify([{ attribute: '強者%', percentageValue: 0.05 }]);
    const toggledPage = await uiPage(conditional);
    try {
      openBoard(toggledPage, boards[2]);
      const pickerInput = toggledPage.dom.window.document.querySelector('input[aria-label="電路板項目 1"]');
      pickerInput.dispatchEvent(new toggledPage.dom.window.Event('focus'));
      const list = toggledPage.dom.window.document.getElementById(pickerInput.getAttribute('aria-controls'));
      const choices = [...list.querySelectorAll('[role="option"] span')].map(option => option.textContent);
      assert.ok(!choices.includes('強者%'));
      assert.ok(choices.includes('排熱%'));
    } finally { toggledPage.close(); }
  } finally { page.close(); }
});

test('legacy circuit budgets normalize deterministically on import, save/reload, and baseline restore', async () => {
  const page = await uiPage(); let reload;
  try {
    const { serializeLoadout } = await page.runtime.load('frontend/loadout-transfer.ts');
    const exported = JSON.parse(serializeLoadout(page.readState(), gameData).json);
    const { FIELD_ID_TO_CODE } = await page.runtime.load('frontend/field-ids.ts');
    exported.values[FIELD_ID_TO_CODE[rowsField]] = JSON.stringify([
      { attribute: 'Boss傷害%', percentageValue: 0.11 },
      { attribute: '單技傷%', percentageValue: 0.124 },
      { attribute: null, percentageValue: 0.1 },
      { attribute: 'Boss傷害%', percentageValue: 'invalid' },
    ]);
    delete exported.values[FIELD_ID_TO_CODE['Left.Armor.Upper.Circuit.Rows']];
    exported.values[FIELD_ID_TO_CODE[upperAttribute]] = null;
    exported.values[FIELD_ID_TO_CODE[upperValue]] = 0.9;
    await page.importJson(JSON.stringify(exported)); openGloves(page);
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.11, 0.07, 0]);
    assert.equal(page.readState().values[upperValue], 0);
    assert.equal(rows(page)[2].attribute, '無關傷害');
    reload = await uiPage(page.readState()); openGloves(reload);
    assert.deepEqual(controls(reload).map(control => control.value), ['11', '7', '0']);
    page.dom.window.document.querySelector('#baseline').click();
    input(page, controls(page)[0], '18');
    page.dom.window.document.querySelector('#restore-baseline').click(); openGloves(page);
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.11, 0.07, 0]);
    const validExport = await page.exportJson(); await page.importJson(JSON.stringify(validExport));
    assert.deepEqual(rows(page).map(row => row.percentageValue), [0.11, 0.07, 0]);
  } finally { page.close(); reload?.close(); }
});

test('circuit editor remount releases detached row events and commits each active input once', async () => {
  const page = await uiPage(stateA);
  try {
    for (let i = 0; i < 5; i++) {
      openGloves(page);
      const old = page.dom.window.document.querySelector('.circuit-board-add');
      openGloves(page);
      page.runtime.resetCounts();
      const before = JSON.stringify(page.readState());
      old.click();
      assert.equal(JSON.stringify(page.readState()), before);
      assert.equal(page.runtime.counts.renderResults ?? 0, 0);
      const control = controls(page)[0]; control.focus();
      input(page, control, String(1 + i));
      assert.equal(page.runtime.counts.renderResults, 1);
      assert.equal(page.dom.window.document.activeElement, control);
    }
  } finally { page.close(); }
});
