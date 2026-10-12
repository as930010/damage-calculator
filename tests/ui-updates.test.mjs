import test from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from './loadout-evaluation-harness.mjs';
import { uiPage, stateA, stateB, stageFields, enter, assertStageSync } from './ui-update-harness.mjs';

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
