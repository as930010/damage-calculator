import test from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from './loadout-evaluation-harness.mjs';
import { uiPage, stateA, stateB, stageFields, enter, assertStageSync, measureDom, workloadActions } from './ui-update-harness.mjs';

test('import synchronizes all stage controls with actual calculation State and exported JSON', async () => {
  const page = await uiPage();
  try {
    await assertStageSync(page, stateA);
    await page.importState(stateB);
    await assertStageSync(page, stateB);
    const json = await page.exportJson();
    for (const [field] of stageFields) assert.equal(json[field], stateB.values[field]);
  } finally { page.close(); }
});

for (const operation of ['stage', 'percentage']) test(`${operation} keeps unrelated controls and results without repeating evaluations`, async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const ids = ['slots', 'beast-accessory-fields', 'master-beast-controls', 'inspector', 'global-source-fields', 'weapon-magic-stone-fields'];
    const children = ids.map(id => document.getElementById(id).firstElementChild);
    const work = await measureDom(page, () => workloadActions[operation](page));
    ids.forEach((id, i) => assert.equal(document.getElementById(id).firstElementChild, children[i], id));
    for (const name of ['renderSlots', 'renderBeastAccessories', 'renderMasterBeastColorSelector', 'renderInspector', 'renderGlobalInputs', 'createPicker', 'createCatalogIndex'])
      assert.equal(work.calls[name] ?? 0, 0, name);
    assert.equal(work.calls.evaluateLoadout, 1); assert.equal(work.calls.aggregateCharacterAttributes, 2);
    assert.equal(work.calls.renderResults, 1);
    assert.ok(work.added < 500); assert.ok(work.removed < 500); assert.ok(work.innerHTML <= 5);
  } finally { page.close(); }
});

test('equipment selection updates damage and configured state while retaining slot and picker nodes', async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const slot = document.querySelector('.gear-slot[data-slot-id="weapon"]');
    const picker = document.querySelector('input[aria-label="武器強化"]');
    const damage = document.querySelector('#damage-result').textContent;
    const work = await measureDom(page, () => workloadActions.equipment(page));
    assert.equal(page.readState().values['Weapon.ENHC'], 'Lv.13');
    assert.notEqual(document.querySelector('#damage-result').textContent, damage);
    assert.equal(document.querySelector('.gear-slot[data-slot-id="weapon"]'), slot);
    assert.equal(document.querySelector('input[aria-label="武器強化"]'), picker);
    assert.equal(work.calls.createPicker ?? 0, 0); assert.equal(work.calls.renderRightIceSetSelectors ?? 0, 0);
    assert.equal(work.calls.evaluateLoadout, 1);
  } finally { page.close(); }
});

test('beast color updates its committed control and results without replacing other pickers', async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const controls = document.querySelector('#master-beast-controls').firstElementChild;
    const work = await measureDom(page, () => workloadActions.beast(page));
    assert.equal(page.readState().masterBeastSpiritStoneColor, '綠');
    assert.equal(document.querySelector('input[aria-label="聖獸精靈石顏色"]').value, '綠');
    assert.equal(document.querySelector('#master-beast-controls').firstElementChild, controls);
    assert.equal(work.calls.createPicker ?? 0, 0); assert.equal(work.calls.evaluateLoadout, 1);
  } finally { page.close(); }
});

test('expanded result cards remain expanded and formula sources refresh after a parameter change', async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const card = document.querySelector('#results details'); card.open = true;
    const name = card.querySelector('summary span').textContent;
    const formula = document.querySelector('#calculation-details details'); formula.open = true;
    const oldFormula = formula.textContent;
    await workloadActions.percentage(page);
    assert.ok([...document.querySelectorAll('#results details[open]')].some(item => item.querySelector('summary span')?.textContent === name));
    assert.equal(document.querySelector('#calculation-details details').open, true);
    assert.notEqual(document.querySelector('#calculation-details details').textContent, oldFormula);
    assert.match(document.querySelector('#calculation-details').textContent, /50%/);
  } finally { page.close(); }
});

test('stage undo/redo keep complex control subtrees and release no unrelated pickers', async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const roots = ['inspector', 'global-source-fields', 'weapon-magic-stone-fields'].map(id => [id, document.getElementById(id).firstElementChild]);
    await workloadActions.stage(page);
    for (const name of ['undo', 'redo']) {
      const work = await measureDom(page, () => workloadActions[name](page));
      roots.forEach(([id, node]) => assert.equal(document.getElementById(id).firstElementChild, node, id));
      assert.equal(work.calls.createPicker ?? 0, 0); assert.equal(work.calls.disposePicker ?? 0, 0);
      assert.equal(work.calls.evaluateLoadout, 1); assert.equal(work.calls.aggregateCharacterAttributes, 2);
    }
  } finally { page.close(); }
});

test('import/undo/redo dispose detached direct-entry controls immediately and retain one catalog index', async () => {
  const page = await uiPage();
  try {
    const picker = await page.runtime.load('frontend/picker.ts');
    const count = picker.__pickerRegistrations().length;
    page.runtime.resetCounts();
    for (let i = 0; i < 4; i++) {
      await page.importState(i % 2 ? stateA : stateB);
      for (const name of ['undo', 'redo']) {
        await workloadActions[name](page);
        assert.equal(picker.__pickerRegistrations().length, count);
        assert.ok(picker.__pickerRegistrations().every(Boolean));
      }
    }
    // The only new index here is the public serializer's explicit fresh-data scope per import.
    assert.equal(page.runtime.counts.createCatalogIndex, 4);
    assert.ok(page.runtime.counts.disposePicker > 0);
  } finally { page.close(); }
});

test('rapid direct entry and snapshot restore do not commit a stale draft afterwards', async () => {
  const page = await uiPage();
  try {
    for (const value of ['20', '30', '40']) enter(page, 'Boss防禦', value);
    assert.equal(page.readState().values['Stage.BossDEF'], '40');
    const input = page.dom.window.document.querySelector('input[aria-label="Boss防禦"]');
    input.value = '1'; input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    await page.importState(stateB);
    page.dom.window.document.body.dispatchEvent(new page.dom.window.Event('pointerdown', { bubbles: true }));
    await assertStageSync(page, stateB);
  } finally { page.close(); }
});

test('a slower previous import cannot overwrite the newer successful import', async () => {
  const page = await uiPage();
  try {
    const transfer = await page.runtime.load('frontend/loadout-transfer.ts');
    let complete;
    const slow = new Promise(resolve => { complete = resolve; });
    const input = page.dom.window.document.querySelector('#loadout-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: () => slow }] });
    input.dispatchEvent(new page.dom.window.Event('change'));
    await page.importState(stateB); complete(transfer.serializeLoadout(stateA, gameData).json);
    await new Promise(resolve => setTimeout(resolve, 0)); await assertStageSync(page, stateB);
  } finally { page.close(); }
});

test('clearing and restoring the original class cannot leave stale error HTML or missing details', async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const original = document.querySelector('#damage-result').innerHTML;
    const formula = document.querySelector('#calculation-details').innerHTML;
    document.querySelector('#class-picker .picker-clear').click();
    assert.match(document.querySelector('#damage-result').textContent, /尚未計算/);
    assert.equal(document.querySelector('#calculation-details').childNodes.length, 0);
    enter(page, '職業', stateA.Job);
    assert.equal(document.querySelector('#damage-result').innerHTML, original);
    assert.equal(document.querySelector('#calculation-details').innerHTML, formula);
  } finally { page.close(); }
});

test('public sample import/undo/redo restores omitted optional settings without creating a new history branch', async () => {
  const page = await uiPage(undefined, undefined, { url: 'https://loadout.test/?sample=public-example-2026-09-28' });
  try {
    const { document } = page.dom.window;
    const original = structuredClone(page.evaluated.at(-1));
    await page.importState(stateB); await workloadActions.percentage(page);
    document.querySelector('#undo').click(); document.querySelector('#undo').click();
    assert.deepEqual(page.evaluated.at(-1), original);
    assert.equal(document.querySelector('#redo').disabled, false); assert.equal(document.querySelector('#undo').disabled, true);
    document.querySelector('#redo').click();
    assert.equal(document.querySelector('input[aria-label="Boss防禦"]').value, '83.94');
  } finally { page.close(); }
});

test('an unrelated edit after import keeps the imported stage values', async () => {
  const page = await uiPage();
  try {
    await page.importState(stateB);
    const input = page.dom.window.document.querySelector('#transcendence-skill-share-number');
    input.value = '50'; input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    await assertStageSync(page, stateB);
    assert.equal(page.readState().transcendenceSkillDamageSharePct, 50);
  } finally { page.close(); }
});

test('undo and redo synchronize stage controls and calculation after import', async () => {
  const page = await uiPage();
  try {
    await page.importState(stateB);
    page.dom.window.document.querySelector('#undo').click(); await assertStageSync(page, stateA);
    page.dom.window.document.querySelector('#redo').click(); await assertStageSync(page, stateB);
  } finally { page.close(); }
});

test('baseline restore synchronizes stage controls without altering the saved baseline', async () => {
  const page = await uiPage();
  try {
    const original = page.dom.window.localStorage.getItem('dab-baseline-v1');
    await page.importState(stateB);
    page.dom.window.document.querySelector('#restore-baseline').click(); await assertStageSync(page, stateA);
    assert.equal(page.dom.window.localStorage.getItem('dab-baseline-v1'), original);
  } finally { page.close(); }
});

test('reload restores the imported stage and its damage, including legacy decimal boss defense', async () => {
  const page = await uiPage();
  let restored;
  try {
    await page.importState(stateB); restored = page.readState();
  } finally { page.close(); }
  const reload = await uiPage(restored);
  try { await assertStageSync(reload, stateB); } finally { reload.close(); }
});

test('missing stage fields retain the existing import policy rather than copying prior controls', async () => {
  const page = await uiPage();
  try {
    const transfer = await page.runtime.load('frontend/loadout-transfer.ts');
    const { codeForFieldId } = await page.runtime.load('frontend/field-ids.ts');
    const json = JSON.parse(transfer.serializeLoadout(stateB, gameData).json);
    for (const [field] of stageFields) { delete json[field]; delete json.values[String(codeForFieldId(field))]; }
    const expected = transfer.deserializeLoadout(json, page.readState(), gameData).state;
    for (const [field] of stageFields) assert.equal(expected.values[field], undefined);
    await page.importJson(JSON.stringify(json)); await assertStageSync(page, expected);
    // Direct-entry policy remains unchanged: an invalid edit restores the committed value.
    enter(page, 'Boss防禦', 'abc'); await assertStageSync(page, expected);
  } finally { page.close(); }
});
