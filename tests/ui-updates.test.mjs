import test from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from './loadout-evaluation-harness.mjs';
import { uiPage, stateA, stateB, stageFields, enter, assertStageSync, measureDom, workloadActions } from './ui-update-harness.mjs';
import { createRuntime } from './loadout-evaluation-harness.mjs';

function pickerRows(page, label) {
  const { document, Event } = page.dom.window;
  const input = document.querySelector(`input[aria-label="${label}"]`);
  assert.ok(input, label);
  input.dispatchEvent(new Event('focus'));
  return [...document.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]')];
}

function selectPicker(page, label, value) {
  const row = pickerRows(page, label).find(node => node.querySelector('span')?.textContent === value);
  assert.ok(row, value); row.click();
}

test('FP skill versions change only the 10% diminishing crit effect and preserve legacy results', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { applyClassSkillVersions } = await runtime.load('calculation/class-skill-versions.ts');
  const state = { ...structuredClone(stateA), Job: 'FP' };
  const before = evaluateLoadout(gameData, state);
  const enabled = evaluateLoadout(gameData, { ...state, classSkillVersions: { 'FP.FatalShotConverted': true } });
  const disabled = evaluateLoadout(gameData, { ...state, classSkillVersions: { 'FP.FatalShotConverted': false } });
  assert.deepEqual(JSON.parse(JSON.stringify(enabled)), JSON.parse(JSON.stringify(before)));
  assert.ok(before.damage); assert.ok(disabled.damage);
  assert.equal(before.combatRates.critRate.diminishingAddedPct - disabled.combatRates.critRate.diminishingAddedPct, 10);
  for (const value of [before, enabled, disabled]) {
    const passive = value.combatRates.critRate.nonDiminishingSources.find(source => source.sourceId === 'FP:critRate:crit-2');
    assert.equal(passive.valuePct, 15);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(before.combatRates.extremization)), JSON.parse(JSON.stringify(disabled.combatRates.extremization)));
  assert.equal(gameData.classCombatEffects.classes.FP.critRate.length, 2, 'static class data is unchanged');
  assert.equal(applyClassSkillVersions(gameData.classCombatEffects, 'KE', { 'FP.FatalShotConverted': false }), gameData.classCombatEffects);
});

test('FP skill checkbox preserves sources, history, baseline, JSON round-trip and reload', async () => {
  const page = await uiPage({ ...structuredClone(stateA), Job: 'FP' });
  let reloaded;
  const checkbox = target => target.dom.window.document.querySelector('input[data-class-skill-version="FP.FatalShotConverted"]');
  const critCard = () => page.dom.window.document.querySelector('.combat-rate-pair details');
  try {
    assert.equal(checkbox(page).checked, true);
    assert.equal(checkbox(page).parentElement.textContent, '致命神槍是否轉換');
    assert.equal(checkbox(page).closest('#class-picker') !== null, true);
    assert.match(critCard().textContent, /crit-1/);
    await workloadActions.baseline(page);
    checkbox(page).checked = false;
    checkbox(page).dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    assert.equal(page.readState().classSkillVersions['FP.FatalShotConverted'], false);
    assert.doesNotMatch(critCard().textContent, /crit-1/);
    assert.match(critCard().textContent, /\+15%/);
    const disabledHtml = critCard().innerHTML;
    await workloadActions.undo(page); assert.equal(checkbox(page).checked, true);
    await workloadActions.redo(page); assert.equal(checkbox(page).checked, false);
    await workloadActions.restore(page); assert.equal(checkbox(page).checked, true);
    await workloadActions.undo(page); assert.equal(checkbox(page).checked, false);
    const exported = await page.exportJson();
    assert.equal(exported.classSkillVersions['FP.FatalShotConverted'], false);
    await page.importJson(JSON.stringify(exported));
    assert.doesNotMatch(page.dom.window.document.querySelector('#transfer-status').textContent, /已留空/);
    assert.equal(checkbox(page).checked, false);
    assert.equal(critCard().innerHTML, disabledHtml);
    reloaded = await uiPage(page.readState());
    assert.equal(checkbox(reloaded).checked, false);
    assert.equal(reloaded.dom.window.document.querySelector('.combat-rate-pair details').innerHTML, disabledHtml);
    selectPicker(page, '職業', 'KE'); assert.equal(checkbox(page), null);
    selectPicker(page, '職業', 'FP'); assert.equal(checkbox(page).checked, false);
    const legacy = { ...exported }; delete legacy.classSkillVersions;
    await page.importJson(JSON.stringify(legacy));
    assert.equal(checkbox(page).checked, true, 'legacy import replaces a prior unchecked setting with the default');
    assert.match(critCard().textContent, /crit-1/);
  } finally { page.close(); reloaded?.close(); }
});

const mirrorAttributeCell = 'MasterBeast.Head.Mirror.1.Attribute';
const mirrorValueCell = 'MasterBeast.Head.Mirror.1.Value';
const mirrorInput = page => page.dom.window.document.querySelector('.beast-mirror-grid .field > input');
const openHeadMirrors = page => page.dom.window.document.querySelector('.beast-accessory-slot[data-beast-slot-id="headwear"]').click();

test('magazine kinds show their actual effects and chip tuning shows only percentages', async () => {
  const state = structuredClone(stateA);
  state.values['Innerwear.Upper.Type'] = '內布隆';
  const page = await uiPage(state);
  try {
    page.dom.window.document.querySelector('.gear-slot[data-slot-id="inner-upper"]').click();
    const rows = pickerRows(page, '彈匣種類');
    const expected = {
      '超級彈匣[極度緩慢]': '乘算%',
      '超級彈匣[推進器]': '超適應力% · 兩極化-10%',
      '戰鬥彈匣Type - I': '流血%',
      '戰鬥彈匣Type - II': '所有技能傷害%',
      '戰鬥彈匣Type - III': '強烈、超越技傷%',
      '戰鬥彈匣Type - IV': '致命傷害%',
      '戰鬥彈匣Type - V': 'Boss傷害%',
      '經典彈匣Type - I': '兩極化%',
    };
    assert.deepEqual(rows.map(row => row.querySelector('span').textContent), gameData.nephronArmor.magazines.map(item => item.name));
    for (const row of rows) assert.equal(row.querySelector('small').textContent, expected[row.querySelector('span').textContent]);
    const chip = gameData.chips.chips.find(item => item.name === state.values['Left.Armor.Upper.Chip.Attribute']);
    const tuning = pickerRows(page, '芯片調校等級');
    assert.deepEqual(tuning.map(row => row.querySelector('span').textContent), chip.tuningLevels.map(level => level.level));
    assert.deepEqual(tuning.map(row => row.querySelector('small').textContent), chip.tuningLevels.map(level => `${level.value}%`));
  } finally { page.close(); }
});

test('unset mirrors default to unrelated damage and disabled zero without overwriting saved fields', async () => {
  const state = structuredClone(stateA);
  delete state.values[mirrorAttributeCell]; delete state.values[mirrorValueCell];
  const page = await uiPage(state);
  try {
    openHeadMirrors(page);
    assert.equal(page.dom.window.document.querySelector('input[aria-label="迷鏡效果屬性"]').value, '無關傷害');
    assert.equal(mirrorInput(page).value, '0'); assert.equal(mirrorInput(page).disabled, true);
    assert.equal(page.readState().values[mirrorAttributeCell], '無關傷害');
    selectPicker(page, '迷鏡效果屬性', '致命一擊%');
    const input = mirrorInput(page);
    assert.equal(input.disabled, false);
    input.value = '0'; input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    assert.equal(page.readState().values[mirrorValueCell], 0);
    const zeroJson = await page.exportJson();
    await page.importJson(JSON.stringify(zeroJson)); openHeadMirrors(page);
    assert.equal(page.readState().values[mirrorValueCell], 0);
    assert.equal(mirrorInput(page).disabled, false); assert.equal(mirrorInput(page).value, '0');
    const restoredInput = mirrorInput(page);
    restoredInput.value = '0.3'; restoredInput.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    assert.equal(page.readState().values[mirrorValueCell], 0.003);
    restoredInput.value = '0.1'; restoredInput.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    restoredInput.dispatchEvent(new page.dom.window.Event('blur'));
    assert.equal(page.readState().values[mirrorValueCell], 0.003);
    assert.equal(restoredInput.value, '0.3');
  } finally { page.close(); }
});

test('unrelated mirror selection zeroes its value, survives export/reload and undo/redo', async () => {
  const page = await uiPage();
  let reloaded;
  try {
    openHeadMirrors(page);
    const beforeDamage = page.dom.window.document.querySelector('#damage-result').textContent;
    selectPicker(page, '迷鏡效果屬性', '無關傷害');
    assert.equal(page.readState().values[mirrorAttributeCell], '無關傷害');
    assert.equal(page.readState().values[mirrorValueCell], 0);
    assert.equal(mirrorInput(page).disabled, true); assert.equal(mirrorInput(page).value, '0');
    const afterDamage = page.dom.window.document.querySelector('#damage-result').textContent;
    assert.notEqual(afterDamage, beforeDamage);
    await workloadActions.undo(page); openHeadMirrors(page);
    assert.equal(mirrorInput(page).disabled, false); assert.equal(mirrorInput(page).value, '0.1');
    assert.equal(page.dom.window.document.querySelector('#damage-result').textContent, beforeDamage);
    await workloadActions.redo(page); openHeadMirrors(page);
    assert.equal(mirrorInput(page).disabled, true);
    assert.equal(page.dom.window.document.querySelector('#damage-result').textContent, afterDamage);
    const json = await page.exportJson();
    await page.importJson(JSON.stringify(json));
    assert.equal(page.readState().values[mirrorValueCell], 0);
    reloaded = await uiPage(page.readState()); openHeadMirrors(reloaded);
    assert.equal(mirrorInput(reloaded).disabled, true); assert.equal(mirrorInput(reloaded).value, '0');
    assert.equal(reloaded.dom.window.document.querySelector('#damage-result').textContent, afterDamage);
  } finally { page.close(); reloaded?.close(); }
});

test('mirror calculation accepts zero, ignores unrelated damage and retains positive range/step validation', async () => {
  const runtime = await createRuntime();
  const { resolveMasterBeastEffects } = await runtime.load('calculation/equipment-effects.ts');
  const resolve = (attribute, value) => resolveMasterBeastEffects(gameData.masterBeast, { mirrorManual: [{ attribute, value }] });
  for (const attribute of ['雙攻%', '致命一擊%', '極大化%']) {
    const sources = resolve(attribute, 0).filter(source => source.sourceId.startsWith('master-beast:mirror:'));
    assert.equal(sources.length, 1); assert.deepEqual(Object.values(sources[0].stats), [0]);
  }
  for (const value of [0, 0.5, null, NaN]) assert.equal(resolve('無關傷害', value).filter(source => source.sourceId.startsWith('master-beast:mirror:')).length, 0);
  assert.equal(resolve('雙攻%', 0.001).at(-1).stats.doubleAttackPct, 0.1);
  assert.equal(resolve('致命一擊%', 0.003).at(-1).stats.critRatePct, 0.3);
  for (const value of [-0.001, 0.0005, 0.011, NaN, Infinity]) assert.throws(() => resolve('雙攻%', value), RangeError);
  assert.throws(() => resolve('致命一擊%', 0.001), RangeError);
});

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

test('combat rate cards expand to show individual sources and keep their state after stage changes', async () => {
  const page = await uiPage();
  try {
    const { document } = page.dom.window;
    const projection = await page.runtime.load('frontend/projection.ts');
    const rates = projection.projectCombatRates(gameData, stateA);
    for (const [label, rate] of [
      ['實戰致命一擊機率', rates.critRate], ['實戰極大化', rates.extremization],
    ]) {
      const card = [...document.querySelectorAll('#results .combat-rate-pair details')]
        .find(node => node.querySelector('summary span')?.textContent === label);
      assert.ok(card, label);
      assert.equal(card.querySelector('summary strong').textContent, `${rate.finalRate * 100}%`);
      card.querySelector('summary').click();
      assert.equal(card.open, true);
      const detail = card.querySelector('.stat-details').textContent;
      assert.match(detail, /角色屬性來源/);
      assert.match(detail, /角色屬性合計/);
      assert.match(detail, /遞減前/);
      assert.match(detail, /遞減後/);
      assert.match(detail, /上限前/);
      assert.ok(card.querySelectorAll('.stat-source-row').length >= rate.multipliers.length + rate.nonDiminishingSources.length);
      if (rate.multipliers.length) assert.match(detail, /乘算來源/);
      if (rate.nonDiminishingSources.length) assert.match(detail, /非遞減來源/);
    }
    const before = document.querySelector('#results .combat-rate-pair details .stat-details').textContent;
    enter(page, '關卡扣致命', '10');
    const cards = [...document.querySelectorAll('#results .combat-rate-pair details')];
    assert.equal(cards.length, 2);
    assert.ok(cards.every(card => card.open));
    assert.match(cards[0].querySelector('.stat-details').textContent, /關卡扣致命-10%/);
    assert.notEqual(cards[0].querySelector('.stat-details').textContent, before);
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
    const potentialCell = 'MasterBeast.OverallPotential';
    const changedPotential = gameData.masterBeast.options.find(option => option.category === 'overall' && option.name !== stateA.values[potentialCell]);
    assert.ok(changedPotential);
    const alternateState = structuredClone(stateB);
    alternateState.values[potentialCell] = changedPotential.name;
    const picker = await page.runtime.load('frontend/picker.ts');
    const count = picker.__pickerRegistrations().length;
    page.runtime.resetCounts();
    for (let i = 0; i < 4; i++) {
      await page.importState(i % 2 ? stateA : alternateState);
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
