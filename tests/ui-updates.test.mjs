import test from 'node:test';
import assert from 'node:assert/strict';
import { gameData } from './loadout-evaluation-harness.mjs';
import { uiPage, stateA, stateB, stageFields, enter, assertStageSync, measureDom, workloadActions } from './ui-update-harness.mjs';
import { createRuntime } from './loadout-evaluation-harness.mjs';

test('Battle defense editor has its own disclosure key and does not change loadout/history', async () => {
  const page = await uiPage();
  try {
    const {document, Event} = page.dom.window;
    const panel = document.querySelector('#battle-defense-context');
    assert.equal(panel.previousElementSibling.className,'battle-panel');
    assert.equal(panel.nextElementSibling.className,'equipment-workspace');
    assert.equal(panel.open,false);
    assert.equal(panel.querySelector('.defense-summary-values').children[1].querySelector('span').textContent,'裝備以外的破防來源');
    assert.equal(panel.querySelector('.defense-totals').children[1].querySelector('dt').textContent,'裝備以外的破防來源');
    assert.equal(panel.dataset.disclosureKey,'battle-defense-context');
    assert.equal(document.querySelector('#global-source-settings').dataset.disclosureKey,'global-sources');
    const before=page.dom.window.localStorage.getItem('dab-loadout-v1');
    const baseline=page.dom.window.localStorage.getItem('dab-baseline-v1');
    const undo=document.querySelector('#undo').disabled;
    panel.open=true;
    const input=panel.querySelector('[data-defense-manual]');input.focus();input.value='89.6';input.dispatchEvent(new Event('input',{bubbles:true}));
    assert.equal(document.activeElement,input);assert.equal(panel.querySelector('[data-defense-manual]'),input);
    assert.match(panel.querySelector('.defense-summary-values').textContent,/90.4008%/);
    assert.equal(document.querySelector('#undo').disabled,undo);
    assert.equal(page.dom.window.localStorage.getItem('dab-loadout-v1'),before);
    assert.equal(page.dom.window.localStorage.getItem('dab-baseline-v1'),baseline);
    const ratio=document.querySelector('.equipment-damage-gain strong').textContent;assert.match(ratio,/0\.00%/);
    assert.equal(input.getAttribute('aria-label'),'裝備以外來源總破防率（%）');
    assert.equal(panel.querySelector('.defense-team-link'),null);
    assert.match(panel.textContent,/此區塊獨立保存，不包含在匯入匯出設定中且不受復原、重做按鈕影響/);
    const damage=document.querySelector('#damage-result').textContent;
    for(const raw of ['1e2','中文','abc','-10','48%','101','4..8']) {
      input.value=raw;input.dispatchEvent(new Event('input',{bubbles:true}));
      assert.equal(input.value,'89.6');assert.equal(document.activeElement,input);
      assert.equal(document.querySelector('#damage-result').textContent,damage);
      assert.match(panel.querySelector('.defense-error').textContent,/不需輸入 %/);
    }
    input.setSelectionRange(0,input.value.length);
    const invalidKey=new page.dom.window.InputEvent('beforeinput',{inputType:'insertText',data:'負數-1',bubbles:true,cancelable:true});
    assert.equal(input.dispatchEvent(invalidKey),false);assert.equal(input.value,'89.6');
    const paste=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:()=>'-48%'}});
    assert.equal(input.dispatchEvent(paste),false);assert.equal(input.value,'89.6');
    input.value='50.5';input.dispatchEvent(new Event('input',{bubbles:true}));assert.equal(input.value,'50.5');assert.equal(panel.querySelector('.defense-error').textContent,'');
    // Invalid saved/programmatic state is still rejected independently of the input guard.
    const key='damage-calculator.battle-defense.v1';const saved=JSON.parse(page.dom.window.localStorage.getItem(key));saved.manualPercentage='1e2';
    page.dom.window.localStorage.setItem(key,JSON.stringify(saved));page.dom.window.dispatchEvent(new page.dom.window.StorageEvent('storage',{key}));
    assert.match(document.querySelector('#damage-result').textContent,/戰鬥破防/);assert.match(panel.querySelector('.defense-error').textContent,/十進位/);
  } finally { page.close(); }
});

test('Independent source rows retain editing nodes, validate drafts and combine remaining defense', async () => {
  const page=await uiPage();
  try {
    const {document,Event}=page.dom.window,panel=document.querySelector('#battle-defense-context');panel.open=true;
    panel.querySelector('[data-defense-mode="sources"]').click();
    for(const [i,rate]of [48,50,50,20].entries()){
      panel.querySelector('[data-defense-add]').click();
      const row=panel.querySelectorAll('.defense-source-row')[i],name=row.querySelector('[data-source-name]'),number=row.querySelector('[data-source-percentage]');
      assert.equal(document.activeElement,name);assert.equal(name.value,'');
      assert.equal(panel.querySelector('.defense-error').textContent,'');
      assert.doesNotMatch(document.querySelector('#damage-result').textContent,/戰鬥破防設定尚未完成/);
      number.value=String(rate);number.dispatchEvent(new Event('input',{bubbles:true}));
    }
    assert.match(panel.querySelector('.defense-summary-values').textContent,/89\.6%.*90\.4008%/);
    const rows=[...panel.querySelectorAll('.defense-source-row')];
    const percentage=rows[0].querySelector('[data-source-percentage]');percentage.focus();percentage.value='50%';percentage.dispatchEvent(new Event('input',{bubbles:true}));
    assert.equal(percentage.value,'48');assert.equal(document.activeElement,percentage);assert.match(panel.querySelector('.defense-summary-values').textContent,/89\.6%.*90\.4008%/);
    percentage.value='';percentage.dispatchEvent(new Event('input',{bubbles:true}));
    assert.equal(document.activeElement,percentage);assert.match(panel.querySelector('.defense-summary-values').textContent,/80%/);
    assert.equal(JSON.parse(page.dom.window.localStorage.getItem('damage-calculator.battle-defense.v1')).sources[0].percentage,'');
    percentage.value='48';percentage.dispatchEvent(new Event('input',{bubbles:true}));
    rows[1].querySelector('button').click();
    assert.equal(panel.querySelectorAll('.defense-source-row')[0],rows[0]);assert.equal(panel.querySelectorAll('.defense-source-row')[1],rows[2]);
    while(panel.querySelector('.defense-source-row'))panel.querySelector('.defense-source-row button').click();
    assert.match(panel.querySelector('.defense-summary-values').textContent,/裝備以外的破防來源0%/);
  }finally{page.close();}
});

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

function nephronMagazineState(selections = [], alternate = true) {
  const state = structuredClone(stateA);
  state.lowerwearAlternativeEnabled = alternate;
  for (const field of gameData.nephronArmor.fields) {
    const armor = gameData.innerwear.slots.find(entry => entry.id === field.slotId);
    state.values[armor.typeField] = '內布隆';
    state.values[armor.enhancementField] = 'Lv.10';
    for (const transform of field.transformFields) {
      state.values[transform.attributeField] = '無關傷害';
      state.values[transform.valueField] = 0;
    }
    delete state.values[field.magazineField]; delete state.values[field.magazineLevelField];
  }
  for (const [slotId, name, level] of selections) {
    const field = gameData.nephronArmor.fields.find(entry => entry.slotId === slotId);
    state.values[field.magazineField] = name;
    if (level) state.values[field.magazineLevelField] = level;
  }
  return state;
}

const openMagazineSlot = (page, slotId) => {
  const slot = gameData.layout.slots.find(entry => entry.innerwearId === slotId);
  page.dom.window.document.querySelector(`.gear-slot[data-slot-id="${slot.id}"]`).click();
};
const magazineNames = page => pickerRows(page, '彈匣種類').map(row => row.querySelector('span').textContent);

async function bossHealthFixture(runtime) {
  const { circuitBoardRowsField, serializeCircuitBoardRows } = await runtime.load('frontend/circuit-board-rows.ts');
  const state = nephronMagazineState([
    ['upper', '超級彈匣[極度緩慢]', 'Lv.1'], ['lowerwear', '支援彈匣I', 'Lv.1'],
    ['lowerwearAlternative', '戰鬥彈匣Type - I', 'Lv.2'], ['gloves', '經典彈匣Type - I', 'Lv.1'],
  ]);
  state.values['Accessory.Earring'] = '格雷特的勳章';
  for (const chip of gameData.chipSlots.slots) { delete state.values[chip.attributeField]; delete state.values[chip.tuningField]; }
  for (const circuit of gameData.circuits.inputs) {
    state.values[circuit.attributeField] = '無關傷害'; state.values[circuit.valueField] = 0;
    delete state.values[circuitBoardRowsField(circuit.attributeField)];
  }
  const chip = (slotId, name) => {
    const slot = gameData.chipSlots.slots.find(entry => entry.id === slotId);
    const option = gameData.chips.chips.find(entry => entry.name === name);
    state.values[slot.attributeField] = name; state.values[slot.tuningField] = option.tuningLevels[0].level;
    return option.tuningLevels[0].value;
  };
  chip('upper', '強者%'); chip('gloves', '排熱%');
  chip('lowerwear', '流血%'); chip('lowerwearAlternative', '兩極化%');
  for (const [id, attribute, value, level, forging] of [
    ['lowerwear', '強者%', 0.1, 'Lv.10', 0], ['lowerwearAlternative', '排熱%', 0.14, 'Lv.12', 12],
  ]) {
    const slot = gameData.innerwear.slots.find(entry => entry.id === id);
    state.values[slot.enhancementField] = level; state.values[slot.forgingField] = forging;
    const circuit = gameData.circuits.inputs.find(entry => entry.slot === id);
    state.values[circuitBoardRowsField(circuit.attributeField)] = serializeCircuitBoardRows([{ attribute, percentageValue: value }]);
  }
  return { state, circuitBoardRowsField };
}

test('Boss health mode applies only the selected pants and HP phase while disabled mode stays identical', async () => {
  const runtime = await createRuntime();
  const { state, circuitBoardRowsField } = await bossHealthFixture(runtime);
  const { evaluateLoadout, resolveLoadoutSources } = await runtime.load('frontend/projection.ts');
  const { createAttributeEquivalenceCalculator, comparableAttributes } = await runtime.load('calculation/attribute-equivalence.ts');
  const normalized = value => JSON.parse(JSON.stringify(value));
  const ordinary = evaluateLoadout(gameData, state, false, true);
  assert.ok(ordinary.damage, String(ordinary.damageError));
  const commonSources = resolveLoadoutSources(gameData, state).sources.shared;
  const sharedStrong = commonSources.reduce((sum, source) => sum + (source.stats.strongerPct ?? 0), 0);
  const sharedHeat = commonSources.reduce((sum, source) => sum + (source.stats.heatPct ?? 0), 0);
  assert.deepEqual(normalized(evaluateLoadout(gameData, { ...state,
    bossHealthCondition: { enabled: false, comparison: 'below', lowerwear: 'lowerwearB' } }, false, true)), normalized(ordinary));
  const original = JSON.stringify(state);
  for (const lowerwear of ['lowerwearA', 'lowerwearB']) for (const comparison of ['above', 'below']) {
    const selected = lowerwear === 'lowerwearA' ? 'lowerwear' : 'lowerwearAlternative';
    const excluded = lowerwear === 'lowerwearA' ? 'lowerwearAlternative' : 'lowerwear';
    const condition = { enabled: true, comparison, lowerwear };
    const current = { ...state, bossHealthCondition: condition };
    const evaluation = evaluateLoadout(gameData, current, false, true);
    assert.ok(evaluation.damage, String(evaluation.damageError));
    const result = evaluation.damage.result, attributes = result.attributes;
    assert.equal(result.lowerwearConfigurations, undefined, 'a single pants calculation never averages medal bonuses');
    const expectedStrong = comparison === 'above' ? sharedStrong + (selected === 'lowerwear' ? 10 : 0) : 0;
    const expectedHeat = comparison === 'below' ? sharedHeat + (selected === 'lowerwearAlternative' ? 14 : 0) : 0;
    assert.equal(attributes.conditionalDamage.strongerPct, expectedStrong, JSON.stringify(attributes.conditionalDamage.strongerSources));
    assert.equal(attributes.conditionalDamage.heatPct, expectedHeat, JSON.stringify(attributes.conditionalDamage.heatSources));
    assert.equal(result.finalDamage.conditionalFactor, 1 + (comparison === 'above' ? expectedStrong : expectedHeat) / 100);
    const sources = resolveLoadoutSources(gameData, current).sources;
    assert.equal(sources.lowerwearAlternativeEnabled, false); assert.equal(sources.lowerwearB.length, 0);
    assert.ok(sources.lowerwearA.some(source => source.sourceId === `innerwear:${selected}`));
    assert.ok(sources.lowerwearA.some(source => source.sourceId === `chip:${selected}`));
    assert.ok(![...sources.shared, ...sources.lowerwearA].some(source => source.sourceId.endsWith(`:${excluded}`)
      || source.sourceId.includes(`:${excluded}:`)));
    for (const detail of Object.values(attributes.stats)) {
      assert.equal(detail.lowerwearBSources.length, 0); assert.equal(detail.lowerwearAverage, detail.lowerwearA);
    }
    assert.equal(result.generalMultiplicativeDamage.factors.find(effect => effect.sourceId === 'grett-medal:support-magazines')?.factor,
      selected === 'lowerwear' ? 1.01 : undefined);
    assert.equal(result.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'grett-medal:classic-combat-magazines').factor,
      selected === 'lowerwear' ? 1.005 : 1.01);
    const noSwitch = evaluateLoadout(gameData, { ...current, lowerwearAlternativeEnabled: false }, false, true);
    assert.deepEqual(normalized(noSwitch), normalized(evaluation), 'the selected single pants do not depend on the switching checkbox');
    const corrupt = structuredClone(current);
    const slot = gameData.innerwear.slots.find(entry => entry.id === excluded);
    corrupt.values[slot.enhancementField] = 'Lv.999'; corrupt.values[slot.forgingField] = -99;
    const chip = gameData.chipSlots.slots.find(entry => entry.id === excluded);
    corrupt.values[chip.attributeField] = '無效芯片'; corrupt.values[chip.tuningField] = '無效調校';
    const circuit = gameData.circuits.inputs.find(entry => entry.slot === excluded);
    corrupt.values[circuitBoardRowsField(circuit.attributeField)] = '[{"attribute":"無效電路","percentageValue":9}]';
    const magazine = gameData.nephronArmor.fields.find(entry => entry.slotId === excluded);
    corrupt.values[magazine.magazineField] = '無效彈匣'; corrupt.values[magazine.magazineLevelField] = 'Lv.99';
    for (const entry of gameData.mapping.magicStoneSelections.inputGroups.filter(entry => entry.configuration === (excluded === 'lowerwear' ? 'lowerwearA' : 'lowerwearB'))) corrupt.values[entry.selectionField] = '無效魔法石';
    for (const fieldId of gameData.appraisals.slots.find(entry => entry.id === excluded).inputFields) corrupt.values[fieldId] = '無效鑑定';
    assert.deepEqual(normalized(evaluateLoadout(gameData, corrupt, false, true)), normalized(evaluation), 'unused pants are excluded before validation and combat-rate resolution');
    const calculator = createAttributeEquivalenceCalculator(evaluation.comparisonInput, result, comparableAttributes(gameData.attributes.attributes));
    assert.equal(calculator.compare(comparison === 'above' ? 'heatPct' : 'strongerPct', 10).targetGainPct, null);
    assert.ok(calculator.compare(comparison === 'above' ? 'strongerPct' : 'heatPct', 10).targetGainPct > 0);
  }
  assert.equal(JSON.stringify(state), original, 'selection does not rewrite saved equipment');
});

test('Boss health single-pants mode retains the selected ordinary armor appraisals and magic stones', async () => {
  const runtime = await createRuntime();
  const { state } = await bossHealthFixture(runtime);
  const { evaluateLoadout, resolveLoadoutSources } = await runtime.load('frontend/projection.ts');
  for (const [index, id] of ['lowerwear', 'lowerwearAlternative'].entries()) {
    const armor = gameData.innerwear.slots.find(entry => entry.id === id);
    state.values[armor.typeField] = '百億';
    const appraisals = gameData.appraisals.slots.find(entry => entry.id === id);
    for (const fieldId of appraisals.inputFields) delete state.values[fieldId];
    state.values[appraisals.inputFields[0]] = index ? '極大化+2%' : '致命一擊+1%';
    const magicStones = gameData.mapping.magicStoneSelections.inputGroups.filter(entry => entry.configuration === (index ? 'lowerwearB' : 'lowerwearA'));
    for (const entry of magicStones) delete state.values[entry.selectionField];
    const stone = gameData.catalogs[gameData.mapping.magicStoneSelections.catalogFile].items
      .find(entry => entry.id === (index ? 'magic-stone-sage-extremization' : 'magic-stone-hunting-boss-damage'));
    state.values[magicStones[0].selectionField] = stone.targetApplications.armor.sourceName;
  }
  for (const lowerwear of ['lowerwearA', 'lowerwearB']) {
    const selected = lowerwear === 'lowerwearA' ? 'lowerwear' : 'lowerwearAlternative';
    const current = { ...state, lowerwearAlternativeEnabled: false,
      bossHealthCondition: { enabled: true, comparison: 'above', lowerwear } };
    const evaluation = evaluateLoadout(gameData, current);
    assert.ok(evaluation.damage, String(evaluation.damageError));
    const sources = resolveLoadoutSources(gameData, current).sources;
    assert.equal(sources.lowerwearB.length, 0);
    const appraisal = sources.lowerwearA.find(source => source.sourceId.startsWith('armor-appraisal:'));
    assert.ok(appraisal.sourceId.includes(`:${selected}:`));
    assert.deepEqual(JSON.parse(JSON.stringify(appraisal.stats)), lowerwear === 'lowerwearA' ? { critRatePct: 1 } : { extremizationPct: 2 });
    const magicField = gameData.mapping.magicStoneSelections.inputGroups.find(entry => entry.configuration === lowerwear).selectionField;
    const stone = sources.lowerwearA.find(source => source.sourceId.includes(magicField));
    assert.deepEqual(JSON.parse(JSON.stringify(stone.stats)), lowerwear === 'lowerwearA' ? { bossDamagePct: 2.5 } : { extremizationPct: 6 });
    assert.equal(evaluation.damage.result.generalMultiplicativeDamage.factors.some(effect => effect.sourceId === 'grett-medal:support-magazines'), false);
  }
});

test('Boss health controls preserve HP phase, selected pants and damage through history, baseline, JSON and reload', async () => {
  const runtime = await createRuntime();
  const { state } = await bossHealthFixture(runtime);
  const page = await uiPage(state);
  let reloaded;
  const control = (target, id) => target.dom.window.document.getElementById(id);
  const change = (id, value) => {
    const input = control(page, id);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
  };
  try {
    const { projectDamage } = await page.runtime.load('frontend/projection.ts');
    const damage = target => projectDamage(gameData, target.readState()).result.finalDamage.finalDamage;
    const before = damage(page);
    assert.equal(control(page, 'boss-health-enabled').checked, false);
    assert.equal(control(page, 'boss-health-lowerwear').parentElement.hidden, true);
    await workloadActions.baseline(page);
    change('boss-health-enabled', true);
    assert.equal(control(page, 'boss-health-lowerwear').parentElement.hidden, false);
    openMagazineSlot(page, 'lowerwearAlternative');
    assert.ok(!magazineNames(page).includes('支援彈匣I'), 'magazine uniqueness still covers the unused pants');
    change('boss-health-comparison', 'below'); change('boss-health-lowerwear', 'lowerwearB');
    const expected = { enabled: true, comparison: 'below', lowerwear: 'lowerwearB' };
    assert.deepEqual(page.readState().bossHealthCondition, expected);
    assert.doesNotMatch(page.dom.window.document.querySelector('#results').textContent, /下衣\+強\/排褲平均/);
    const activeDamage = damage(page);
    await workloadActions.undo(page); assert.equal(control(page, 'boss-health-lowerwear').value, 'lowerwearA');
    await workloadActions.redo(page); assert.equal(control(page, 'boss-health-lowerwear').value, 'lowerwearB'); assert.equal(damage(page), activeDamage);
    const exported = await page.exportJson(); assert.deepEqual(exported.bossHealthCondition, expected);
    await page.importJson(JSON.stringify(exported)); assert.deepEqual(page.readState().bossHealthCondition, expected);
    assert.doesNotMatch(page.dom.window.document.querySelector('#transfer-status').textContent, /已留空/);
    reloaded = await uiPage(page.readState());
    assert.equal(control(reloaded, 'boss-health-enabled').checked, true);
    assert.equal(control(reloaded, 'boss-health-comparison').value, 'below');
    assert.equal(control(reloaded, 'boss-health-lowerwear').value, 'lowerwearB'); assert.equal(damage(reloaded), activeDamage);
    await workloadActions.restore(page); assert.equal(control(page, 'boss-health-enabled').checked, false); assert.equal(damage(page), before);
    await workloadActions.undo(page); assert.deepEqual(page.readState().bossHealthCondition, expected);
    delete exported.bossHealthCondition;
    await page.importJson(JSON.stringify(exported));
    assert.equal(control(page, 'boss-health-enabled').checked, false);
    assert.equal(page.readState().bossHealthCondition, undefined); assert.equal(damage(page), before);
  } finally { page.close(); reloaded?.close(); }
});

test('support magazines default to locked level one and only affect damage through the medal across saves and restoration', async () => {
  const initial = nephronMagazineState([], false);
  initial.values['Accessory.Earring'] = '';
  const page = await uiPage(initial);
  let reloaded;
  const upper = gameData.nephronArmor.fields.find(field => field.slotId === 'upper');
  const gloves = gameData.nephronArmor.fields.find(field => field.slotId === 'gloves');
  const levelInput = target => target.dom.window.document.querySelector('input[aria-label="彈匣等級"]');
  const assertFixed = target => {
    assert.equal(levelInput(target).value, 'Lv.1'); assert.equal(levelInput(target).disabled, true);
    assert.equal(levelInput(target).closest('.picker').querySelector('.picker-clear').disabled, true);
  };
  try {
    const { projectDamage } = await page.runtime.load('frontend/projection.ts');
    const result = () => projectDamage(gameData, page.readState()).result;
    const supportFactor = () => result().generalMultiplicativeDamage.factors.find(effect => effect.sourceId === 'grett-medal:support-magazines')?.factor;
    const baseDamage = result().finalDamage.finalDamage;
    openMagazineSlot(page, 'upper'); selectPicker(page, '彈匣種類', '支援彈匣I'); assertFixed(page);
    assert.equal(page.readState().values[upper.magazineLevelField], 'Lv.1');
    assert.equal(result().finalDamage.finalDamage, baseDamage);
    openMagazineSlot(page, 'gloves');
    assert.ok(!magazineNames(page).includes('支援彈匣I')); assert.ok(magazineNames(page).includes('支援彈匣II'));
    selectPicker(page, '彈匣種類', '支援彈匣II'); assertFixed(page);
    assert.equal(result().finalDamage.finalDamage, baseDamage, 'neither support option has an intrinsic damage effect');
    const { createCatalogIndex } = await page.runtime.load('frontend/catalog-index.ts');
    const levels = createCatalogIndex(gameData).resolveFieldChoices(gloves.magazineLevelField, page.readState().values);
    assert.deepEqual(Array.from(levels), ['Lv.1']); assert.ok(Object.isFrozen(levels));
    page.dom.window.document.querySelector('button[data-slot-id="Accessory.Earring"]').click();
    selectPicker(page, '選擇裝備', '格雷特的勳章'); assert.equal(supportFactor(), 1.015);
    openMagazineSlot(page, 'upper');
    page.dom.window.document.querySelector('input[aria-label="彈匣種類"]').closest('.picker').querySelector('.picker-clear').click();
    assert.equal(supportFactor(), 1.01);
    await workloadActions.undo(page); assertFixed(page); assert.equal(supportFactor(), 1.015);
    await workloadActions.redo(page); assert.equal(supportFactor(), 1.01);
    await workloadActions.undo(page); assertFixed(page);
    const exported = await page.exportJson(); await page.importJson(JSON.stringify(exported));
    assertFixed(page); assert.equal(supportFactor(), 1.015);
    assert.doesNotMatch(page.dom.window.document.querySelector('#transfer-status').textContent, /已留空/);
    const saved = page.readState();
    saved.values[upper.magazineLevelField] = 'Lv.6'; delete saved.values[gloves.magazineLevelField];
    reloaded = await uiPage(saved);
    assert.equal(reloaded.readState().values[upper.magazineLevelField], 'Lv.1');
    assert.equal(reloaded.readState().values[gloves.magazineLevelField], 'Lv.1', 'normalization is persisted without requiring another edit');
    openMagazineSlot(reloaded, 'upper'); assertFixed(reloaded);
    selectPicker(reloaded, '彈匣種類', '戰鬥彈匣Type - I');
    assert.equal(levelInput(reloaded).disabled, false); assert.equal(levelInput(reloaded).value, '');
    selectPicker(reloaded, '彈匣等級', 'Lv.4');
    selectPicker(reloaded, '彈匣種類', '支援彈匣I'); assertFixed(reloaded);
  } finally { page.close(); reloaded?.close(); }
});

test('new super magazines are fixed-level choices with no intrinsic damage and count toward the medal', async () => {
  const initial = nephronMagazineState([], false); initial.values['Accessory.Earring'] = '';
  const page = await uiPage(initial);
  try {
    const { projectDamage } = await page.runtime.load('frontend/projection.ts');
    const result = () => projectDamage(gameData, page.readState()).result;
    const before = result().finalDamage.finalDamage;
    for (const [slot, name] of [['upper', '超級彈匣I'], ['gloves', '超級彈匣II']]) {
      openMagazineSlot(page, slot); selectPicker(page, '彈匣種類', name);
      const level = page.dom.window.document.querySelector('input[aria-label="彈匣等級"]');
      assert.equal(level.value, 'Lv.1'); assert.equal(level.disabled, true);
      assert.equal(result().finalDamage.finalDamage, before);
    }
    page.dom.window.document.querySelector('button[data-slot-id="Accessory.Earring"]').click();
    selectPicker(page, '選擇裝備', '格雷特的勳章');
    assert.equal(result().generalMultiplicativeDamage.factors.find(item => item.sourceId === 'grett-medal:super-magazines')?.factor, 1.01);
    const exported = await page.exportJson(); await page.importJson(JSON.stringify(exported));
    assert.equal(result().generalMultiplicativeDamage.factors.find(item => item.sourceId === 'grett-medal:super-magazines')?.factor, 1.01);
  } finally { page.close(); }
});

test('Grett medal magazine bonuses enter the existing damage products independently of basic medal and raid effects', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const data = gameData;
  const state = nephronMagazineState([
    ['upper', '超級彈匣[極度緩慢]', 'Lv.1'], ['lowerwear', '超級彈匣[推進器]', 'Lv.1'],
    ['lowerwearAlternative', '支援彈匣I', 'Lv.1'],
    ['gloves', '經典彈匣Type - I', 'Lv.1'], ['shoes', '戰鬥彈匣Type - I', 'Lv.1'],
  ]);
  state.values['Accessory.Earring'] = '格雷特的勳章'; state.nephronRaidEnabled = true;
  const evaluation = evaluateLoadout(data, state, false, true);
  assert.ok(evaluation.damage, String(evaluation.damageError));
  const result = evaluation.damage.result;
  const general = result.generalMultiplicativeDamage.factors;
  const { calculateLoadout } = await runtime.load('calculation/loadout-engine.ts');
  const expectedBonuses = {
    lowerwearA: [
      { sourceId: 'grett-medal:super-magazines', stats: { multiplicativeDamagePct: 1 } },
      { sourceId: 'grett-medal:classic-combat-magazines', stats: { multiplicativeCritDamagePct: 1 } },
    ],
    lowerwearB: [
      { sourceId: 'grett-medal:super-magazines', stats: { multiplicativeDamagePct: 0.5 } },
      { sourceId: 'grett-medal:support-magazines', stats: { multiplicativeDamagePct: 1 } },
      { sourceId: 'grett-medal:classic-combat-magazines', stats: { multiplicativeCritDamagePct: 1 } },
    ],
  };
  assert.equal(result.lowerwearConfigurations.length, 2);
  for (const { configuration, result: variant } of result.lowerwearConfigurations) {
    const expected = expectedBonuses[configuration];
    assert.deepEqual(JSON.parse(JSON.stringify(evaluation.comparisonInput.lowerwearBonusSources[configuration])), expected);
    const input = evaluation.comparisonInput;
    const oracle = calculateLoadout({ ...input, lowerwearBonusSources: undefined,
      sources: { ...input.sources, shared: [...input.sources.shared, ...expected] } });
    assert.ok(Math.abs(variant.finalDamage.finalDamage - oracle.finalDamage.finalDamage)
      <= oracle.finalDamage.finalDamage * 1e-12, configuration);
  }
  assert.equal(result.finalDamage.finalDamage,
    result.lowerwearConfigurations.reduce((sum, entry) => sum + entry.result.finalDamage.finalDamage, 0) / 2);
  const input = evaluation.comparisonInput;
  const disabledInput = { ...input, sources: { ...input.sources, lowerwearAlternativeEnabled: false } };
  const disabled = calculateLoadout(disabledInput);
  const primaryOnly = calculateLoadout({ ...disabledInput, lowerwearBonusSources: undefined,
    sources: { ...disabledInput.sources, shared: [...disabledInput.sources.shared, ...expectedBonuses.lowerwearA] } });
  assert.equal(disabled.lowerwearConfigurations, undefined);
  assert.ok(Math.abs(disabled.finalDamage.finalDamage - primaryOnly.finalDamage.finalDamage)
    <= primaryOnly.finalDamage.finalDamage * 1e-12, 'disabling switching uses the primary configuration alone');
  assert.equal(general.find(effect => effect.sourceId === 'nephron-raid:grett-medal').factor, 1.03);
  const basicMedal = general.filter(effect => effect.sourceId === 'simulator:Accessory.Earring');
  assert.equal(basicMedal.length, 1, 'basic medal effect remains a separate source');
  assert.equal(basicMedal[0].factor, 1.06);
  assert.equal(general.find(effect => effect.sourceId.includes('super-extreme-slow')).factor, 1.005, 'original magazine effect is unchanged');
  const withoutAlternative = evaluateLoadout(data, { ...state, lowerwearAlternativeEnabled: false }).damage.result;
  assert.ok(!withoutAlternative.generalMultiplicativeDamage.factors.some(effect => effect.sourceId === 'grett-medal:support-magazines'));
  for (const earring of ['', '天線耳環']) {
    const unequipped = evaluateLoadout(data, { ...state, values: { ...state.values, 'Accessory.Earring': earring } }).damage.result;
    assert.ok(![...unequipped.generalMultiplicativeDamage.factors, ...unequipped.multiplicativeCritDamage.factors]
      .some(effect => effect.sourceId.startsWith('grett-medal:')));
  }
});

test('Grett medal lowerwear bonuses average final damages and keep equivalent comparisons on the same basis', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { finalDamageInputs, prepareLoadoutAttributes, evaluatePreparedLoadout } = await runtime.load('calculation/loadout-engine.ts');
  const { calculateFinalDamage } = await runtime.load('calculation/final-damage.ts');
  const { createAttributeEquivalenceCalculator, comparableAttributes } = await runtime.load('calculation/attribute-equivalence.ts');
  const state = nephronMagazineState([
    ['upper', '超級彈匣[極度緩慢]', 'Lv.1'], ['lowerwear', '超級彈匣[推進器]', 'Lv.1'],
    ['lowerwearAlternative', '戰鬥彈匣Type - I', 'Lv.1'], ['gloves', '經典彈匣Type - I', 'Lv.1'],
  ]);
  state.values['Accessory.Earring'] = '格雷特的勳章';
  const original = JSON.stringify(state);
  const evaluation = evaluateLoadout(gameData, state, false, true);
  assert.ok(evaluation.damage, String(evaluation.damageError));
  assert.equal(runtime.counts.aggregateCharacterAttributes, 1, 'configuration bonuses reuse the prepared attributes');
  const result = evaluation.damage.result, input = evaluation.comparisonInput;
  assert.equal(result.lowerwearConfigurations.length, 2);
  const averagedProducts = calculateFinalDamage(finalDamageInputs(input, result)).finalDamage;
  assert.ok(Math.abs(averagedProducts - result.finalDamage.finalDamage) > 1e-6, 'average final damage, not the product of separately averaged bonuses');
  const attributes = comparableAttributes(gameData.attributes.attributes);
  const calculator = createAttributeEquivalenceCalculator(input, result, attributes);
  assert.equal(calculator.baseDamage, result.finalDamage.finalDamage);
  for (const key of ['doubleAttackPct', 'bleedDamagePct', 'multiplicativeDamagePct', 'multiplicativeCritDamagePct']) {
    const changed = { ...input, sources: { ...input.sources, shared: [
      ...input.sources.shared, { sourceId: 'equivalence:test', stats: { [key]: 10 } },
    ] } };
    const full = evaluatePreparedLoadout(changed, prepareLoadoutAttributes(changed)).result;
    assert.ok(full, key);
    assert.ok(Math.abs(calculator.damageWith(key, 10) - full.finalDamage.finalDamage)
      <= full.finalDamage.finalDamage * 1e-12, key);
  }
  const comparison = calculator.compare('bleedDamagePct', 10);
  const equivalent = comparison.rows.find(row => row.key === 'multiplicativeCritDamagePct');
  assert.equal(equivalent.status, 'ok');
  const actualGain = (calculator.damageWith(equivalent.key, equivalent.delta) / calculator.baseDamage - 1) * 100;
  assert.ok(Math.abs(actualGain - comparison.targetGainPct) < 1e-6);
  assert.equal(JSON.stringify(state), original, 'temporary configuration calculations do not change saved selections');
  const matching = nephronMagazineState([
    ['upper', '超級彈匣[極度緩慢]', 'Lv.1'], ['lowerwear', '戰鬥彈匣Type - I', 'Lv.1'],
    ['lowerwearAlternative', '經典彈匣Type - I', 'Lv.1'],
  ]);
  matching.values['Accessory.Earring'] = '格雷特的勳章';
  const same = evaluateLoadout(gameData, matching).damage.result;
  assert.equal(same.lowerwearConfigurations, undefined, 'identical tiers use the existing single evaluation');
  assert.equal(same.generalMultiplicativeDamage.factors.find(effect => effect.sourceId === 'grett-medal:super-magazines').factor, 1.005);
  assert.equal(same.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'grett-medal:classic-combat-magazines').factor, 1.005);
});

test('Grett medal magazine sources and factors update immediately when magazines or the medal change', async () => {
  const state = nephronMagazineState([
    ['upper', '超級彈匣[極度緩慢]', 'Lv.1'], ['lowerwear', '超級彈匣[推進器]', 'Lv.1'],
    ['lowerwearAlternative', '經典彈匣Type - I', 'Lv.1'], ['gloves', '戰鬥彈匣Type - I', 'Lv.1'],
  ]);
  state.values['Accessory.Earring'] = '格雷特的勳章';
  const page = await uiPage(state);
  const rows = () => [...page.dom.window.document.querySelectorAll('#results .stat-source-row')];
  const bonusFactors = label => rows().filter(row => row.querySelector('span')?.textContent === `格雷特的勳章：${label}加成`)
    .map(row => row.querySelector('strong').textContent);
  const clearMagazine = slot => {
    openMagazineSlot(page, slot);
    page.dom.window.document.querySelector('input[aria-label="彈匣種類"]').closest('.picker').querySelector('.picker-clear').click();
  };
  try {
    assert.deepEqual(bonusFactors('超級彈匣'), ['×1.01', '×1.005']);
    assert.deepEqual(bonusFactors('經典／戰鬥彈匣'), ['×1.005', '×1.01']);
    assert.match(page.dom.window.document.querySelector('#calculation-details').textContent, /兩套配置分別套用勳章加成後，最終傷害取平均/);
    clearMagazine('upper');
    assert.deepEqual(bonusFactors('超級彈匣'), ['×1.005']);
    clearMagazine('lowerwear'); assert.deepEqual(bonusFactors('超級彈匣'), []);
    clearMagazine('gloves');
    assert.deepEqual(bonusFactors('經典／戰鬥彈匣'), ['×1.005'], 'enabled alternate lowerwear counts');
    const toggle = page.dom.window.document.querySelector('#alternate');
    toggle.checked = false; toggle.dispatchEvent(new page.dom.window.Event('change'));
    assert.deepEqual(bonusFactors('經典／戰鬥彈匣'), [], 'disabled alternate lowerwear does not count');
    toggle.checked = true; toggle.dispatchEvent(new page.dom.window.Event('change'));
    assert.deepEqual(bonusFactors('經典／戰鬥彈匣'), ['×1.005']);
    page.dom.window.document.querySelector('button[data-slot-id="Accessory.Earring"]').click();
    selectPicker(page, '選擇裝備', '天線耳環');
    assert.deepEqual(bonusFactors('超級彈匣'), []); assert.deepEqual(bonusFactors('經典／戰鬥彈匣'), []);
  } finally { page.close(); }
});

test('Nephron magazines reserve each full name across every slot before choosing a level and release on change or clear', async () => {
  const page = await uiPage(nephronMagazineState());
  const slow = '超級彈匣[極度緩慢]', booster = '超級彈匣[推進器]';
  try {
    for (const magazine of gameData.nephronArmor.magazines) {
      openMagazineSlot(page, 'upper'); selectPicker(page, '彈匣種類', magazine.name);
      for (const field of gameData.nephronArmor.fields.filter(entry => entry.slotId !== 'upper')) {
        openMagazineSlot(page, field.slotId);
        assert.ok(!magazineNames(page).includes(magazine.name), `${field.slotId}: ${magazine.name}`);
        assert.equal(magazineNames(page).length, gameData.nephronArmor.magazines.length - 1);
      }
    }
    openMagazineSlot(page, 'upper'); selectPicker(page, '彈匣種類', slow);
    assert.deepEqual(pickerRows(page, '彈匣等級').map(row => row.querySelector('span').textContent), gameData.nephronArmor.levelLabels);
    selectPicker(page, '彈匣等級', 'Lv.1');
    openMagazineSlot(page, 'lowerwear');
    assert.ok(!magazineNames(page).includes(slow));
    assert.ok(magazineNames(page).includes(booster), 'different full names of the same kind remain available');
    openMagazineSlot(page, 'upper'); selectPicker(page, '彈匣種類', booster);
    openMagazineSlot(page, 'lowerwear');
    assert.ok(magazineNames(page).includes(slow)); assert.ok(!magazineNames(page).includes(booster));
    openMagazineSlot(page, 'upper');
    page.dom.window.document.querySelector('input[aria-label="彈匣種類"]').closest('.picker').querySelector('.picker-clear').click();
    openMagazineSlot(page, 'lowerwear');
    assert.ok(magazineNames(page).includes(slow)); assert.ok(magazineNames(page).includes(booster));
    selectPicker(page, '彈匣種類', slow); selectPicker(page, '彈匣等級', 'Lv.6');
    openMagazineSlot(page, 'upper'); assert.ok(!magazineNames(page).includes(slow));
    await workloadActions.undo(page); assert.ok(!magazineNames(page).includes(slow), 'the name still reserves a slot without its level');
    await workloadActions.undo(page); assert.ok(magazineNames(page).includes(slow));
    await workloadActions.redo(page); assert.ok(!magazineNames(page).includes(slow));
    await workloadActions.redo(page); assert.ok(!magazineNames(page).includes(slow));
  } finally { page.close(); }
});

test('Nephron magazines normalize legacy and imported duplicates in fixed slot order and keep history, baseline and reload consistent', async () => {
  const slow = '超級彈匣[極度緩慢]', booster = '超級彈匣[推進器]';
  const legacy = nephronMagazineState([
    ['upper', slow, 'Lv.1'], ['lowerwear', slow, 'Lv.6'], ['lowerwearAlternative', slow, 'Lv.2'],
    ['gloves', booster, 'Lv.2'], ['shoes', '戰鬥彈匣Type - I', 'Lv.4'],
  ], false);
  const page = await uiPage(legacy, legacy);
  let reloaded;
  const assertSelections = (state, expected) => {
    for (const field of gameData.nephronArmor.fields) {
      assert.equal(state.values[field.magazineField], expected[field.slotId]?.[0], field.magazineField);
      assert.equal(state.values[field.magazineLevelField], expected[field.slotId]?.[1], field.magazineLevelField);
    }
  };
  const original = { upper: [slow, 'Lv.1'], gloves: [booster, 'Lv.2'], shoes: ['戰鬥彈匣Type - I', 'Lv.4'] };
  const imported = { upper: [slow, 'Lv.1'], lowerwear: [booster, 'Lv.6'], lowerwearAlternative: ['戰鬥彈匣Type - II', 'Lv.2'] };
  try {
    assertSelections(page.readState(), original);
    const { evaluateLoadout } = await page.runtime.load('frontend/projection.ts');
    assert.ok(evaluateLoadout(gameData, page.readState()).damage, 'different magazine names remain calculable');
    await page.importState(nephronMagazineState([
      ['upper', slow, 'Lv.1'], ['lowerwear', booster, 'Lv.6'], ['lowerwearAlternative', '戰鬥彈匣Type - II', 'Lv.2'],
      ['gloves', booster, 'Lv.3'], ['shoes', '戰鬥彈匣Type - II', 'Lv.5'],
    ]));
    assertSelections(page.readState(), imported);
    assert.match(page.dom.window.document.querySelector('#transfer-status').textContent, /已留空/);
    await workloadActions.undo(page); assertSelections(page.readState(), original);
    await workloadActions.redo(page); assertSelections(page.readState(), imported);
    await workloadActions.restore(page); assertSelections(page.readState(), original);
    await workloadActions.undo(page); assertSelections(page.readState(), imported);
    const json = await page.exportJson();
    await page.importJson(JSON.stringify(json)); assertSelections(page.readState(), imported);
    assert.doesNotMatch(page.dom.window.document.querySelector('#transfer-status').textContent, /已留空/);
    reloaded = await uiPage(page.readState()); assertSelections(reloaded.readState(), imported);
    openMagazineSlot(reloaded, 'shoes');
    for (const name of [slow, booster, '戰鬥彈匣Type - II']) assert.ok(!magazineNames(reloaded).includes(name));
  } finally { page.close(); reloaded?.close(); }
});

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

const mirrorAttributeField = 'MasterBeast.Head.Mirror.1.Attribute';
const mirrorValueField = 'MasterBeast.Head.Mirror.1.Value';
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
      '支援彈匣I': '僅供格雷特的勳章效果計數，本身不提供傷害屬性',
      '支援彈匣II': '僅供格雷特的勳章效果計數，本身不提供傷害屬性',
      '超級彈匣I': '僅供格雷特的勳章效果計數，本身不提供傷害屬性',
      '超級彈匣II': '僅供格雷特的勳章效果計數，本身不提供傷害屬性',
    };
    assert.deepEqual(rows.map(row => row.querySelector('span').textContent), gameData.nephronArmor.magazines.map(item => item.name));
    for (const row of rows) assert.equal(row.querySelector('small').textContent, expected[row.querySelector('span').textContent]);
    const chip = gameData.chips.chips.find(item => item.name === state.values['Left.Armor.Upper.Chip.Attribute']);
    const tuning = pickerRows(page, '芯片調校等級');
    assert.deepEqual(tuning.map(row => row.querySelector('span').textContent), chip.tuningLevels.map(level => level.level));
    assert.deepEqual(tuning.map(row => row.querySelector('small').textContent), chip.tuningLevels.map(level => `${level.value}%`));
  } finally { page.close(); }
});

test('unset mirrors retain an unselected state without pretending completion', async () => {
  const state = structuredClone(stateA);
  delete state.values[mirrorAttributeField]; delete state.values[mirrorValueField];
  const page = await uiPage(state);
  try {
    openHeadMirrors(page);
    assert.equal(page.dom.window.document.querySelector('input[aria-label="迷鏡效果屬性"]').value, '');
    assert.equal(mirrorInput(page).value, '');
    assert.equal(page.readState().values[mirrorAttributeField], undefined);
    selectPicker(page, '迷鏡效果屬性', '致命一擊%');
    const input = mirrorInput(page);
    assert.equal(input.disabled, false);
    input.value = '0'; input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    assert.equal(page.readState().values[mirrorValueField], 0);
    const zeroJson = await page.exportJson();
    await page.importJson(JSON.stringify(zeroJson)); openHeadMirrors(page);
    assert.equal(page.readState().values[mirrorValueField], 0);
    assert.equal(mirrorInput(page).disabled, false); assert.equal(mirrorInput(page).value, '0');
    const restoredInput = mirrorInput(page);
    restoredInput.value = '0.3'; restoredInput.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    assert.equal(page.readState().values[mirrorValueField], 0.003);
    restoredInput.value = '0.1'; restoredInput.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
    restoredInput.dispatchEvent(new page.dom.window.Event('blur'));
    assert.equal(page.readState().values[mirrorValueField], 0.003);
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
    assert.equal(page.readState().values[mirrorAttributeField], '無關傷害');
    assert.equal(page.readState().values[mirrorValueField], 0);
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
    assert.equal(page.readState().values[mirrorValueField], 0);
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
    assert.equal(work.calls.evaluateLoadout, 1); assert.equal(work.calls.aggregateCharacterAttributes, 1);
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

test('MN second multiplicative crit source is labeled 硝基馬達 without changing either multiplier', async () => {
  const page = await uiPage();
  try {
    selectPicker(page, '職業', 'MN');
    const { document } = page.dom.window;
    const rows = [...document.querySelectorAll('#results .stat-source-row')].map(node => node.textContent);
    assert.ok(rows.some(text => text.includes('MN 爆發模式') && text.includes('×1.1')));
    assert.ok(rows.some(text => text.includes('MN 硝基馬達') && text.includes('×1.15')));
  } finally { page.close(); }
});

test('CU critical damage shows 解放意志 5% multiplicative and 精神集中 15% additive sources', async () => {
  const page = await uiPage();
  try {
    selectPicker(page, '職業', 'CU');
    const { document } = page.dom.window;
    const rows = [...document.querySelectorAll('#results .stat-source-row')].map(node => node.textContent);
    assert.ok(rows.some(text => text.includes('解放意志') && text.includes('×1.05')));
    assert.ok(rows.some(text => text.includes('精神集中') && text.includes('+15%')));
  } finally { page.close(); }
});

test('亞特瑪強烈／超越魔法石 can be selected and restored without reverting to 無關傷害', async () => {
  const page = await uiPage();
  try {
    const fieldId = 'Left.Armor.Upper.MagicStone.1';
    const slot = gameData.layout.slots.find(entry => entry.stoneFields?.includes(fieldId));
    page.dom.window.document.querySelector(`.gear-slot[data-slot-id="${slot.id}"]`).click();
    selectPicker(page, '魔法石 1', '亞特瑪2%強烈/超越');
    assert.equal(page.readState().values[fieldId], '亞特瑪2%強烈/超越');
    const restored = await uiPage(page.readState());
    try { assert.equal(restored.readState().values[fieldId], '亞特瑪2%強烈/超越'); }
    finally { restored.close(); }
  } finally { page.close(); }
});

test('努特的庇護 toggles the 1.3333 crit multiplier and stays synchronized with save, history and JSON', async () => {
  const page = await uiPage();
  try {
    const { document, Event } = page.dom.window;
    const checkbox = () => [...document.querySelectorAll('#global-source-fields label.pet-skill-toggle')]
      .find(label => label.textContent.trim() === '特殊靈藥：努特的庇護')?.querySelector('input');
    const setCheckbox = value => { const input = checkbox(); assert.ok(input); input.checked = value; input.dispatchEvent(new Event('change')); };
    assert.ok(checkbox());
    const { projectDamage } = await page.runtime.load('frontend/projection.ts');
    const damage = () => projectDamage(gameData, page.readState()).result;
    const potionEffect = () => damage()?.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'special-potion:nut-protection');

    assert.equal(checkbox()?.checked, false);
    assert.equal(potionEffect(), undefined);
    setCheckbox(true);
    assert.equal(page.readState().nutProtectionPotionEnabled, true);
    assert.equal(potionEffect()?.valuePct, 33.33);
    assert.equal(potionEffect()?.factor, 1.3333);
    assert.ok([...document.querySelectorAll('#results .stat-source-row span')].some(node => node.textContent === '努特的庇護'));
    const exported = await page.exportJson();
    assert.equal(exported.nutProtectionPotionEnabled, true);

    setCheckbox(false);
    assert.equal(page.readState().nutProtectionPotionEnabled, false);
    assert.equal(potionEffect(), undefined);
    assert.ok(![...document.querySelectorAll('#results .stat-source-row span')].some(node => node.textContent === '努特的庇護'));
    document.querySelector('#undo').click();
    assert.equal(page.readState().nutProtectionPotionEnabled, true);
    assert.equal(checkbox()?.checked, true);
    document.querySelector('#redo').click();
    assert.equal(page.readState().nutProtectionPotionEnabled, false);
    assert.equal(checkbox()?.checked, false);

    await page.importJson(JSON.stringify(exported));
    assert.equal(page.readState().nutProtectionPotionEnabled, true);
    assert.equal(checkbox()?.checked, true);
    assert.equal(potionEffect()?.factor, 1.3333);
  } finally { page.close(); }
});

test('內布隆襲擊戰的3%乘算只在勾選且裝備格雷特的勳章時生效', async () => {
  const initial = structuredClone(stateA);
  initial.values['Accessory.Earring'] = '';
  initial.nephronRaidEnabled = false;
  const page = await uiPage(initial);
  try {
    const { document, Event } = page.dom.window;
    const checkbox = document.querySelector('.battle-panel > .panel-heading input[type="checkbox"]');
    assert.ok(checkbox);
    const selectEarring = name => {
      document.querySelector('button[data-slot-id="Accessory.Earring"]').click();
      selectPicker(page, '選擇裝備', name);
    };
    const { projectDamage } = await page.runtime.load('frontend/projection.ts');
    const damage = () => projectDamage(gameData, page.readState()).result;
    const raidEffect = () => damage()?.generalMultiplicativeDamage.factors.find(effect => effect.sourceId === 'nephron-raid:grett-medal');
    const setRaid = value => { checkbox.checked = value; checkbox.dispatchEvent(new Event('change')); };

    assert.equal(checkbox.checked, false);
    setRaid(true);
    assert.equal(page.readState().nephronRaidEnabled, true);
    assert.equal(raidEffect(), undefined);
    selectEarring('格雷特的勳章');
    assert.equal(raidEffect()?.valuePct, 3);
    assert.equal(raidEffect()?.factor, 1.03);
    assert.ok([...document.querySelectorAll('#results .stat-source-row span')].some(node => node.textContent === '內布隆襲擊戰'));
    const exported = await page.exportJson();
    assert.equal(exported.nephronRaidEnabled, true);

    selectEarring('天線耳環');
    assert.equal(raidEffect(), undefined);
    selectEarring('格雷特的勳章');
    setRaid(false);
    assert.equal(page.readState().nephronRaidEnabled, false);
    assert.equal(raidEffect(), undefined);
    document.querySelector('#undo').click();
    assert.equal(page.readState().nephronRaidEnabled, true);
    assert.equal(checkbox.checked, true);
    assert.equal(raidEffect()?.factor, 1.03);
    document.querySelector('#redo').click();
    assert.equal(page.readState().nephronRaidEnabled, false);
    assert.equal(raidEffect(), undefined);

    await page.importJson(JSON.stringify(exported));
    assert.equal(page.readState().nephronRaidEnabled, true);
    assert.equal(checkbox.checked, true);
    assert.equal(raidEffect()?.factor, 1.03);
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
      assert.equal(work.calls.evaluateLoadout, 1); assert.equal(work.calls.aggregateCharacterAttributes, 1);
    }
  } finally { page.close(); }
});

test('import/undo/redo dispose detached direct-entry controls immediately and retain one catalog index', async () => {
  const page = await uiPage();
  try {
    const potentialField = 'MasterBeast.OverallPotential';
    const changedPotential = gameData.masterBeast.options.find(option => option.category === 'overall' && option.name !== stateA.values[potentialField]);
    assert.ok(changedPotential);
    const alternateState = structuredClone(stateB);
    alternateState.values[potentialField] = changedPotential.name;
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

for (const restoration of ['baseline', 'import']) test(`${restoration} restores edited global effect controls, calculation and history together`, async () => {
  const initial = structuredClone(stateA);
  initial.petSkillAttackEnabled = true;
  initial.nutProtectionPotionEnabled = false;
  Object.assign(initial.values, {
    'Effect.Consumable': '適應靈藥', 'Effect.Environment': '小屋/溫泉', 'Peak.Option': '精神挑戰者',
    'Pet.Passive': gameData.pets.options[0].name, 'Effect.Emblem': '沒有',
    'Effect.PortraitAwakening.StrongSkillDamagePct': 1, 'Effect.PortraitAwakening.TranscendenceSkillDamagePct': 4,
    'Left.Armor.SetColor': '紅', 'Atma.Element': '流水', 'Atma.Color': '米色',
    'GuildFountain.Stage2': '致命一擊+1%', 'GuildFountain.Stage3': '攻擊力+40', 'GuildFountain.Stage4': '排熱+3%',
  });
  for (const effect of gameData.resonance.effects) initial.values[effect.settingKey] = effect.name === '兩極' || effect.name === 'B傷' ? 50 : 100;
  const page = await uiPage(initial, initial);
  let reloaded;
  try {
    const { document, Event } = page.dom.window;
    const controls = target => [...target.dom.window.document.querySelectorAll('#global-source-fields input')]
      .map(input => [input.getAttribute('aria-label'), input.type, input.value, input.checked, input.disabled]);
    const damage = target => target.dom.window.document.querySelector('#damage-result').textContent;
    document.querySelector('#baseline').click();
    const original = { state: page.readState(), controls: controls(page), damage: damage(page), sources: document.querySelector('#results').textContent };
    const originalJson = await page.exportJson();
    const baselineJson = page.dom.window.localStorage.getItem('dab-baseline-v1');
    for (const [label, value] of [
      ['消耗品', '天上甜點'], ['場地', '集合地'], ['巔峰選項', '嗜肉骨斷'],
      ['寵物', gameData.pets.options.find(option => option.name !== initial.values['Pet.Passive']).name],
      ['標誌', '有'], ['百億/內布隆套效', '藍'], ['亞特瑪屬性', '草木'], ['亞特瑪顏色', '藍色'],
      ['2階', '致命一擊+2%'], ['3階', '攻擊力+80'], ['4階', '所有技能傷害+0.6%'],
    ]) selectPicker(page, label, value);
    for (const checkbox of document.querySelectorAll('#global-source-fields input[type="checkbox"]')) {
      checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change'));
    }
    enter(page, '立繪、覺醒強烈技傷%', '3');
    const resonance = [...document.querySelectorAll('#global-source-fields .global-input-group')]
      .find(group => group.querySelector('h3').textContent === '共鳴輸入');
    for (const input of resonance.querySelectorAll('input')) {
      input.value = '27'; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const edited = { state: page.readState(), controls: controls(page), damage: damage(page) };
    assert.notEqual(edited.damage, original.damage);
    assert.notDeepEqual(edited.controls, original.controls);
    const assertRestored = () => {
      assert.deepEqual(page.readState(), original.state, 'saved configuration');
      assert.deepEqual(page.evaluated.at(-1), original.state, 'calculation configuration');
      assert.deepEqual(controls(page), original.controls, 'global controls');
      assert.equal(damage(page), original.damage);
      assert.equal(document.querySelector('#results').textContent, original.sources);
      assert.equal(page.dom.window.localStorage.getItem('dab-baseline-v1'), baselineJson);
    };
    if (restoration === 'baseline') document.querySelector('#restore-baseline').click();
    else await page.importJson(JSON.stringify(originalJson));
    assertRestored();
    document.querySelector('#undo').click();
    assert.deepEqual(page.readState(), edited.state);
    assert.deepEqual(controls(page), edited.controls);
    assert.equal(damage(page), edited.damage);
    document.querySelector('#redo').click(); assertRestored();
    const exported = await page.exportJson();
    assert.equal(exported.nutProtectionPotionEnabled, false);
    reloaded = await uiPage(page.readState(), original.state);
    assert.deepEqual(controls(reloaded), original.controls);
    assert.equal(damage(reloaded), original.damage);
  } finally { page.close(); reloaded?.close(); }
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

test('beast three-state progress survives clears, history, JSON and reload for all five slots', async () => {
  const initial=structuredClone(stateA);
  for(const key of Object.keys(initial.values)) if(key.startsWith('MasterBeast.') && !key.endsWith('OverallPotential')) delete initial.values[key];
  const page=await uiPage(initial); let reloaded;
  try {
    const {beastAccessoryStatus}=await page.runtime.load('frontend/beast-accessory-status.ts');
    const {createCatalogIndex}=await page.runtime.load('frontend/catalog-index.ts');const index=createCatalogIndex(gameData);
    const definitions=[['headwear','Head',true,true],['armor','Armor',false,false],['necklace','Necklace',false,true],['ring-one','Ring1',true,true],['ring-two','Ring2',true,true]];
    for(const[id,part,fixed,stone]of definitions){
      const slot={fixedFields:fixed?[`MasterBeast.${part}.Option1`,`MasterBeast.${part}.Option2`]:[],stoneFields:stone?[`MasterBeast.${part}.CustomAttribute`,`MasterBeast.${part}.CustomValue`]:undefined,mirrorFields:[1,2,3].map(i=>[`MasterBeast.${part}.Mirror.${i}.Attribute`,`MasterBeast.${part}.Mirror.${i}.Value`])};
      const values={};assert.equal(beastAccessoryStatus(slot,values,index),'empty');
      for(const field of slot.fixedFields)values[field]='無關傷害';
      if(stone){const field=slot.stoneFields[0];values[field]=index.resolveFieldChoices(field,{})[0];values[slot.stoneFields[1]]=index.resolveFieldChoices(slot.stoneFields[1],values)[0];}
      const [attr,num]=slot.mirrorFields[0];values[attr]='致命一擊%';assert.equal(beastAccessoryStatus(slot,values,index),'partial');values[num]=0;
      for(const [attr]of slot.mirrorFields) values[attr]='無關傷害';assert.equal(beastAccessoryStatus(slot,values,index),'complete');
      values[attr]='致命一擊%';values[num]=0;assert.equal(beastAccessoryStatus(slot,values,index),'complete');
      delete values[slot.mirrorFields[2][0]];assert.equal(beastAccessoryStatus(slot,values,index),'partial');
      values[slot.mirrorFields[2][0]]='極大化%';values[slot.mirrorFields[2][1]]=0.00001;assert.equal(beastAccessoryStatus(slot,values,index),'partial');
    }
    const card=()=>page.dom.window.document.querySelector('[data-beast-slot-id="armor"]');assert.equal(card().dataset.configuration,'empty');
    card().click();const selectAt=(i,name)=>{const input=page.dom.window.document.querySelectorAll('input[aria-label="迷鏡效果屬性"]')[i];input.dispatchEvent(new page.dom.window.Event('focus'));const list=page.dom.window.document.getElementById(input.getAttribute('aria-controls'));[...list.querySelectorAll('[role="option"]')].find(el=>el.querySelector('span').textContent===name).click();};
    selectAt(0,'無關傷害');assert.equal(card().dataset.configuration,'partial');assert.equal(card().querySelector('i'),null);
    selectAt(1,'無關傷害');selectAt(2,'無關傷害');assert.equal(card().dataset.configuration,'complete');assert.ok(card().querySelector('i'));page.dom.window.document.querySelector('#baseline').click();
    const input=page.dom.window.document.querySelectorAll('input[aria-label="迷鏡效果屬性"]')[2];input.closest('.picker').querySelector('.picker-clear').click();assert.equal(card().dataset.configuration,'partial');assert.equal(card().querySelector('i'),null);
    await workloadActions.undo(page);assert.equal(card().dataset.configuration,'complete');await workloadActions.redo(page);assert.equal(card().dataset.configuration,'partial');
    const exported=await page.exportJson();await page.importJson(JSON.stringify(exported));assert.equal(card().dataset.configuration,'partial');
    reloaded=await uiPage(page.readState());assert.equal(reloaded.dom.window.document.querySelector('[data-beast-slot-id="armor"]').dataset.configuration,'partial');
    page.dom.window.document.querySelector('#restore-baseline').click();assert.equal(card().dataset.configuration,'complete');
  }finally{page.close();reloaded?.close();}
});

test('every canvas slot derives progress from its applicable required fields', async () => {
  const runtime=await createRuntime(),{createCatalogIndex}=await runtime.load('frontend/catalog-index.ts');
  const {equipmentProgress}=await runtime.load('frontend/equipment-progress.ts');const index=createCatalogIndex(gameData);
  const fresh=()=>({...structuredClone(stateA),values:{}});
  const {getEquipmentOptionName}=await runtime.load('calculation/equipment-catalog.ts');
  const pick=(state,field)=>{const mapping=index.equipmentMappings.get(field);const choices=mapping?index.equipmentItems(mapping).map(item=>getEquipmentOptionName(item,mapping.application)):index.resolveFieldChoices(field,state.values);assert.ok(choices?.length,field);state.values[field]=choices[0];};
  const fill=(slot,nephron=false)=>{
    const state=fresh();
    if(slot.selectionField)pick(state,slot.selectionField);
    const armor=gameData.innerwear.slots.find(s=>s.id===slot.innerwearId);
    if(armor){state.values[armor.typeField]=nephron?'內布隆':'百億';pick(state,armor.enhancementField);pick(state,armor.forgingField);
      if(nephron)for(const t of gameData.nephronArmor.fields.find(f=>f.slotId===slot.innerwearId).transformFields)state.values[t.attributeField]='無關傷害';
      else for(const f of gameData.appraisals.slots.find(f=>f.id===slot.innerwearId).inputFields)pick(state,f);
    }
    for(const f of armor&&!nephron?(slot.stoneFields??[]).slice(0,4):slot.stoneFields??[])pick(state,f);
    if(slot.weapon){pick(state,'Weapon.ENHC');pick(state,gameData.growth.settingKey);for(const g of Object.values(gameData.weaponAppraisals.groups))pick(state,g.settingKey);
      gameData.transformations.slots.forEach((f,i)=>{const rule=gameData.transformations.rules[i];state.values[f.choiceField]=rule.choice;state.values[f.valueField]=rule.minRoll/rule.valueMultiplier;});}
    return state;
  };
  for(const slot of gameData.layout.slots){assert.equal(equipmentProgress(slot,fresh(),index),'empty',slot.id);
    if(slot.group==='accessories')continue;
    for(const nephron of slot.innerwearId?[false,true]:[false]){
      const state=fill(slot,nephron);assert.equal(equipmentProgress(slot,state,index),'complete',slot.id+':'+nephron);
      if(slot.stoneFields?.length){delete state.values[slot.stoneFields[0]];assert.equal(equipmentProgress(slot,state,index),'partial');state.values[slot.stoneFields[0]]='not-an-option';assert.equal(equipmentProgress(slot,state,index),'partial');}
    }
  }
  for(const slot of gameData.layout.slots.filter(s=>s.innerwearId)){
    const state=fill(slot,true),chip=gameData.chipSlots.slots.find(s=>s.id===slot.innerwearId),armor=gameData.nephronArmor.fields.find(s=>s.slotId===slot.innerwearId);
    pick(state,chip.attributeField);assert.equal(equipmentProgress(slot,state,index),'partial','selected chip needs tuning');
    pick(state,chip.tuningField);assert.equal(equipmentProgress(slot,state,index),'complete');
    state.values[chip.tuningField]='invalid';assert.equal(equipmentProgress(slot,state,index),'partial');
    delete state.values[chip.attributeField];delete state.values[chip.tuningField];
    const magazine=gameData.nephronArmor.magazines.find(m=>m.fixedLevel===undefined);state.values[armor.magazineField]=magazine.name;
    assert.equal(equipmentProgress(slot,state,index),'partial','selected magazine needs level');pick(state,armor.magazineLevelField);assert.equal(equipmentProgress(slot,state,index),'complete');
    delete state.values[armor.magazineField];delete state.values[armor.magazineLevelField];
    const circuit=gameData.circuits.inputs.find(s=>s.slot===slot.innerwearId),rows=circuit.attributeField.replace(/Attribute$/,'Rows');
    state.values[rows]=JSON.stringify([{attribute:'invalid',percentageValue:0}]);assert.equal(equipmentProgress(slot,state,index),'partial');
    for(const percentageValue of [-0.01,0.19,'invalid']){state.values[rows]=JSON.stringify([{attribute:circuit.attributeOptions.find(a=>a!=='無關傷害'),percentageValue}]);assert.equal(equipmentProgress(slot,state,index),'partial');}
    state.values[rows]=JSON.stringify([{attribute:'無關傷害',percentageValue:0}]);assert.equal(equipmentProgress(slot,state,index),'complete');
    const transform=armor.transformFields[0];state.values[transform.attributeField]=gameData.nephronArmor.transformations.find(t=>t.name!=='無關傷害').name;
    assert.equal(equipmentProgress(slot,state,index),'partial','effective transformation needs a legal tier');pick(state,transform.valueField);assert.equal(equipmentProgress(slot,state,index),'complete');
    state.values[transform.valueField]=Infinity;assert.equal(equipmentProgress(slot,state,index),'partial');
  }
  const pants=gameData.layout.slots.find(s=>s.innerwearId==='lowerwear'),pantsState=fill(pants,true);
  pantsState.lowerwearAlternativeEnabled=true;
  const chips=gameData.chipSlots.slots.filter(s=>['lowerwear','lowerwearAlternative'].includes(s.id));
  for(const chip of chips){pantsState.values[chip.attributeField]='強者%';pick(pantsState,chip.tuningField);}
  assert.equal(equipmentProgress(pants,pantsState,index),'partial');pantsState.lowerwearAlternativeEnabled=false;assert.equal(equipmentProgress(pants,pantsState,index),'complete');
  const weapon=gameData.layout.slots.find(s=>s.weapon),weaponState=fill(weapon);
  for(const field of ['Weapon.ENHC',gameData.growth.settingKey,...Object.values(gameData.weaponAppraisals.groups).map(g=>g.settingKey),...gameData.transformations.slots.flatMap(s=>[s.choiceField,s.valueField])]){
    const saved=weaponState.values[field];delete weaponState.values[field];assert.equal(equipmentProgress(weapon,weaponState,index),'partial',field);weaponState.values[field]=saved;
  }
  const left=gameData.layout.slots.filter(s=>s.group==='leftIce'),leftState=fill(left[0]);
  assert.equal(equipmentProgress(left[0],leftState,index),'complete');for(const other of left.slice(1))assert.equal(equipmentProgress(other,leftState,index),'partial');
  for(const slot of gameData.layout.slots.filter(s=>s.group==='accessories')){
    const mapping=index.equipmentMappings.get(slot.selectionField);
    for(const item of index.equipmentItems(mapping)){
      const state=fresh();state.values[slot.selectionField]=item.name;
      const group=gameData.accessoryEffects.groups.find(g=>g.selectionField===slot.selectionField),meta=item.appraisal;
      if(meta?.canAppraise===false){assert.equal(equipmentProgress(slot,state,index),'complete');continue;}
      assert.equal(equipmentProgress(slot,state,index),'partial');
      if(meta?.canAppraise===true&&meta.effectCount>0&&group&&meta.effectCount<=group.inputFields.length){
        const options=group.optionsByEquipmentName?.[item.name]??group.options;
        for(const field of group.inputFields.slice(0,meta.effectCount))state.values[field]=options[0].name;
        assert.equal(equipmentProgress(slot,state,index),'complete');delete state.values[group.inputFields[0]];assert.equal(equipmentProgress(slot,state,index),'partial');
      }
    }
  }
});

test('canvas completion refreshes stone dependencies while retaining buttons, Inspector, focus and history',async()=>{
  const initial=structuredClone(stateA),slot=gameData.layout.slots.find(s=>s.group==='leftIce'),stone=slot.stoneFields[0];delete initial.values[stone];
  const page=await uiPage(initial);let reload;
  try{const {document,Event}=page.dom.window;const card=document.querySelector(`[data-slot-id="${slot.id}"]`);assert.equal(card.dataset.configuration,'partial');card.click();
    const field=document.querySelector('input[aria-label="魔法石 1"]');selectPicker(page,'魔法石 1',gameData.catalogs['equipment/magic-stones.json'].items.find(i=>i.active&&i.targetApplications?.armor).targetApplications.armor.sourceName);
    assert.equal(card.dataset.configuration,'complete');assert.ok(card.querySelector('i'));assert.equal(document.querySelector('input[aria-label="魔法石 1"]'),field);
    document.querySelector('#baseline').click();field.closest('.picker').querySelector('.picker-clear').click();assert.equal(card.dataset.configuration,'partial');assert.equal(card.querySelector('i'),null);
    await workloadActions.undo(page);assert.equal(card.dataset.configuration,'complete');await workloadActions.redo(page);assert.equal(card.dataset.configuration,'partial');
    document.querySelector('#restore-baseline').click();assert.equal(card.dataset.configuration,'complete');
    const json=await page.exportJson();await page.importJson(JSON.stringify(json));assert.equal(document.querySelector(`[data-slot-id="${slot.id}"]`).dataset.configuration,'complete');
    reload=await uiPage(page.readState());assert.equal(reload.dom.window.document.querySelector(`[data-slot-id="${slot.id}"]`).dataset.configuration,'complete');
    const alt=document.querySelector('[data-slot-id="inner-lowerwearAlternative"]');document.querySelector('#alternate').checked=false;document.querySelector('#alternate').dispatchEvent(new Event('change'));assert.equal(alt.classList.contains('inactive'),true);assert.equal(alt.dataset.configuration,'empty');assert.equal(alt.querySelector('i'),null);
    const savedAlt=Object.fromEntries(Object.entries(page.readState().values).filter(([f])=>f.includes('SwitchBottom')));document.querySelector('#alternate').checked=true;document.querySelector('#alternate').dispatchEvent(new Event('change'));assert.equal(alt.classList.contains('inactive'),false);assert.deepEqual(Object.fromEntries(Object.entries(page.readState().values).filter(([f])=>f.includes('SwitchBottom'))),savedAlt);
  }finally{page.close();reload?.close();}
});
