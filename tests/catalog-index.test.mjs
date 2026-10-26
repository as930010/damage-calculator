import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime, createPage, gameData, normalize, digest, resultHtml } from './loadout-evaluation-harness.mjs';
import { complete, incomplete, legacyStartup, choiceContexts, importCases, candidateTransform, captureCall, monitorCatalogData } from './catalog-index-scenarios.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/catalog-index.json', import.meta.url), 'utf8'));
const runtime = await createRuntime({ transformSource: candidateTransform });
const transfer = await runtime.load('frontend/loadout-transfer.ts');
const { createCatalogIndex, createCatalogIndexScope } = await runtime.load('frontend/catalog-index.ts');
const { normalizeOptionalEffectValues } = await runtime.load('frontend/state.ts');
const index = createCatalogIndex(gameData, 'fixture');

function assertStoredStateMatches(actualJson, expectedJson) {
  const actual = JSON.parse(actualJson), expected = JSON.parse(expectedJson);
  normalizeOptionalEffectValues(expected.values, index);
  assert.equal(actual.Job, expected.Job);
  for (const [fieldId, value] of Object.entries(expected.values)) assert.equal(actual.values[fieldId], value, fieldId);
  for (const key of ['lowerwearAlternativeEnabled', 'masterBeastSpiritStoneColor', 'petSkillAttackEnabled', 'transcendenceSkillDamageSharePct'])
    assert.equal(actual[key], expected[key], key);
}

function normalizeCapturedImport(snapshot, catalogIndex = index) {
  const expected = structuredClone(snapshot);
  if (expected.value?.state?.values) {
    normalizeOptionalEffectValues(expected.value.state.values, catalogIndex);
    expected.value.state.nutProtectionPotionEnabled = false;
    expected.value.state.nephronRaidEnabled = false;
  }
  return expected;
}

// Extend the pre-feature transfer contract only by the two new default-off settings.
// All original numeric field codes, values, omissions and their order stay fixed.
function expectedTransfer(snapshot) {
  const expected = structuredClone(snapshot);
  const { transcendenceSkillDamageSharePct, ...payload } = JSON.parse(expected.json);
  expected.json = JSON.stringify({ ...payload, nutProtectionPotionEnabled: false,
    nephronRaidEnabled: false, transcendenceSkillDamageSharePct }) + '\n';
  return expected;
}

for (const context of choiceContexts()) {
  test(`ordered field choices: ${context.id}`, () => {
    for (const field of Object.keys(fixture.choices[context.id])) {
      const additions = gameData.nephronArmor.fields.some(entry => entry.magazineField === field) ? ['支援彈匣I', '支援彈匣II'] : [];
      const expected = fixture.choices[context.id][field];
      const magicStoneMapping = index.equipmentMappings.get(field);
      const stoneAdditions = magicStoneMapping?.catalogFile === gameData.mapping.magicStoneSelections.catalogFile
        ? magicStoneMapping.application === 'armor'
          ? { '亞特瑪2.5%超越': ['亞特瑪2.5%強烈', '亞特瑪2.5%超越', '亞特瑪2%強烈/超越'] }
          : { '亞特瑪5%超越': ['亞特瑪5%強烈', '亞特瑪5%超越', '亞特瑪4%強烈/超越'] }
        : {};
      const currentExpected = Array.isArray(expected) ? expected.flatMap(choice => stoneAdditions[choice] ?? [choice]) : expected;
      assert.deepEqual(normalize(index.resolveFieldChoices(field, context.values)), additions.length ? [...currentExpected, ...additions] : currentExpected, field);
    }
  });
}

test('complete/incomplete exports retain exact compact v3 JSON, order and omissions', () => {
  for (const [state, expected] of [[complete, fixture.transfers.export], [incomplete, fixture.transfers.incompleteExport]]) {
    const before = digest(state);
    assert.deepEqual(normalize(transfer.serializeLoadout(state, gameData, index)), expectedTransfer(expected));
    assert.deepEqual(normalize(transfer.serializeLoadout(state, gameData)), expectedTransfer(expected));
    assert.equal(digest(state), before);
  }
});

for (const scenario of importCases(fixture.transfers.export.json)) {
  test(`import policy: ${scenario.id}`, () => {
    const before = digest(complete);
    assert.deepEqual(captureCall(() => transfer.deserializeLoadout(scenario.raw, complete, gameData, index)), normalizeCapturedImport(fixture.transfers[scenario.id]));
    assert.equal(digest(complete), before);
  });
}

for (const [id, state] of [['complete', complete], ['legacy-startup', legacyStartup], ['incomplete', incomplete]]) {
  test(`actual main candidates, results and saved states: ${id}`, async () => {
    const choices = [], before = digest(gameData);
    const page = await createPage(state, complete, { transformSource: candidateTransform,
      globals: { __captureChoices: (label, options) => choices.push(normalize({ label, options })) } });
    try {
      assert.equal(digest(choices), fixture.pages[id].choicesHash);
      assert.equal(choices.length, fixture.pages[id].pickerCount);
      assert.equal(digest(resultHtml(page.dom.window.document)), fixture.pages[id].resultHash);
      assertStoredStateMatches(page.dom.window.localStorage.getItem('dab-loadout-v1'), fixture.pages[id].savedState);
      assertStoredStateMatches(page.dom.window.localStorage.getItem('dab-baseline-v1'), fixture.pages[id].savedBaseline);
      assert.equal(page.runtime.counts.createCatalogIndex, 1);
      assert.equal(digest(gameData), before);
    } finally { page.close(); }
  });
}

test('validation index keeps first-match and missing-catalog semantics', async () => {
  const { findValidationCatalog, createValidationCatalogIndex } = await runtime.load('frontend/input-validation.ts');
  const inputs = [{ fieldIds: ['a'], catalogId: 'missing' }, { fieldIds: ['a', 'b'], catalogId: 'same' }];
  const catalogs = [{ id: 'same', options: [{ value: 1 }] }, { id: 'same', options: [{ value: 2 }] }];
  const lookup = createValidationCatalogIndex(inputs, catalogs);
  for (const field of ['a', 'b', 'unknown']) assert.equal(lookup(field), findValidationCatalog(inputs, catalogs, field));
});

test('UI class-code resolver preserves case handling, order and invalid-input policy', async () => {
  const { resolveClassCode, createClassCodeResolver } = await runtime.load('frontend/class-code.ts');
  const codes = index.activeClasses.map(entry => entry.id), resolve = createClassCodeResolver(codes);
  for (const value of [...codes, ...codes.map(code => code.toUpperCase()), ...codes.map(code => code.toLowerCase()), '', '中文', 'KE1', ' KE', gameData.classes.classes[0].name]) {
    assert.equal(resolve(value), resolveClassCode(value, codes), value);
  }
  const duplicate = createClassCodeResolver(['Ke', 'KE']);
  assert.equal(duplicate('ke'), 'Ke');
  assert.equal(index.isActiveClass('ke'), false); // Import requires exact active IDs.
});

test('one revision builds one index; reload and in-place data edits with a new version replace it', () => {
  const scope = createCatalogIndexScope(), data = structuredClone(gameData);
  runtime.resetCounts(); const first = scope.get(data, 1);
  first.resolveFieldChoices('Effect.Title', {});
  assert.equal(scope.get(data, 1), first);
  assert.equal(runtime.counts.createCatalogIndex, 1);
  data.otherEffects.titles[0].name = 'renamed-title';
  const second = scope.get(data, 2);
  assert.notEqual(first, second);
  assert.equal(second.resolveFieldChoices('Effect.Title', {})[0], 'renamed-title');
  assert.equal(runtime.counts.createCatalogIndex, 2);
  assert.notEqual(scope.get(structuredClone(data), 2), second);
  assert.equal(runtime.counts.createCatalogIndex, 3);
  assert.notEqual(scope.get(data, 1), first); // No historical Map of revisions.
  assert.throws(() => transfer.serializeLoadout(complete, data, index), /different data load/);
});

test('cold query only materializes its requested candidates; warm lookups do not scan data', () => {
  const observed = monitorCatalogData(structuredClone(gameData));
  const cold = createCatalogIndex(observed.data);
  observed.reset(); runtime.resetCounts();
  const choices = cold.resolveFieldChoices('Effect.Title', {});
  assert.equal(runtime.counts.staticChoiceArrays, 1);
  assert.equal(observed.counts['otherEffects.titles.map'], 1);
  assert.equal(observed.counts['otherEffects.consumables.map'], undefined);
  observed.reset(); runtime.resetCounts();
  for (let i = 0; i < 100; i++) assert.equal(cold.resolveFieldChoices('Effect.Title', {}), choices);
  assert.equal(runtime.counts.staticChoiceArrays ?? 0, 0);
  assert.deepEqual(observed.counts, {});
  assert.throws(() => choices.push('pollution'), TypeError);
});

test('warm complete export/import reuse equipment, validation and candidate indices', () => {
  const observed = monitorCatalogData(structuredClone(gameData)), prepared = createCatalogIndex(observed.data);
  transfer.serializeLoadout(complete, observed.data, prepared);
  transfer.parseLoadoutJson(fixture.transfers.export.json, complete, observed.data, prepared);
  observed.reset(); runtime.resetCounts();
  assert.deepEqual(normalize(transfer.serializeLoadout(complete, observed.data, prepared)), expectedTransfer(fixture.transfers.export));
  assert.equal(runtime.counts.resolveFieldChoices, fixture.workload.export.candidateQueries);
  assert.equal(observed.counts.elementReads ?? 0, 0);
  observed.reset(); runtime.resetCounts();
  const importedCall = captureCall(() => transfer.parseLoadoutJson(fixture.transfers.export.json, complete, observed.data, prepared));
  const importChoiceLookups = runtime.counts.resolveFieldChoices ?? 0;
  const importScans = { ...observed.counts };
  runtime.resetCounts();
  const expectedImport = normalizeCapturedImport(fixture.transfers.importMonitored);
  assert.deepEqual(importedCall, expectedImport);
  // Import now also validates optional-effect fields to normalize missing values.
  assert.ok(importChoiceLookups >= fixture.workload.import.candidateQueries);
  assert.ok(importScans.elementReads >= gameData.nephronArmor.fields.length
    && importScans.elementReads <= gameData.nephronArmor.fields.length + 20);
  assert.equal(importScans['classes.classes.filter'] ?? 0, 0);
  assert.equal(importScans['simulatorInputs.inputs.find'] ?? 0, 0);
  assert.equal(importScans['simulatorInputs.catalogs.find'] ?? 0, 0);
  assert.ok((importScans.visited ?? 0) < fixture.workload.export.scans.visited);
});

test('equipment label changes/removal remain local; ambiguous IDs/names remain invalid', () => {
  const data = structuredClone(gameData), mapping = data.mapping.selections[0];
  const item = data.catalogs[mapping.catalogFile].items.find(entry => entry.active && entry.slotId === mapping.slotId);
  const state = { ...complete, values: { [mapping.selectionField]: item.name } };
  const json = transfer.serializeLoadout(state, data).json;
  item.name = 'renamed-item';
  assert.equal(transfer.parseLoadoutJson(json, state, data).state.values[mapping.selectionField], item.name);
  data.catalogs[mapping.catalogFile].items = data.catalogs[mapping.catalogFile].items.filter(entry => entry.id !== item.id);
  const removed = transfer.parseLoadoutJson(json, state, data);
  assert.equal(removed.state.values[mapping.selectionField], undefined);
  assert.deepEqual(normalize(removed.clearedFields), [mapping.selectionField]);
  data.catalogs[mapping.catalogFile].items.push(item, { ...item });
  const duplicate = createCatalogIndex(data);
  assert.equal(duplicate.resolveEquipmentCode(mapping, transfer.equipmentTransferCode(item.id)), null);
  assert.equal(duplicate.matchEquipment(mapping, item.name).length, 2);
  assert.ok(transfer.serializeLoadout({ ...state, values: { [mapping.selectionField]: item.name } }, data, duplicate).omittedFields.includes(mapping.selectionField));
});

test('magic stone application labels and stats remain distinct; inactive items do not resolve', () => {
  for (const mapping of index.equipmentMappings.values()) {
    const expected = gameData.catalogs[mapping.catalogFile]?.items.filter(item => item.active && item.slotId === mapping.slotId) ?? [];
    assert.deepEqual(normalize(index.equipmentItems(mapping)), normalize(expected));
    for (const item of expected) assert.equal(index.resolveEquipmentCode(mapping, transfer.equipmentTransferCode(item.id)), item);
  }
  const data = structuredClone(gameData), mapping = data.mapping.magicStoneSelections.inputGroups[0];
  const lookup = createCatalogIndex(data), full = lookup.equipmentMappings.get(mapping.selectionField);
  const item = data.catalogs[full.catalogFile].items[0]; item.active = false;
  assert.equal(createCatalogIndex(data).resolveEquipmentCode(full, transfer.equipmentTransferCode(item.id)), null);
});

test('every selectable magic stone remains valid after input normalization', () => {
  const catalog = gameData.catalogs[gameData.mapping.magicStoneSelections.catalogFile].items.filter(item => item.active);
  let validatedFields = 0;
  for (const mapping of gameData.mapping.magicStoneSelections.inputGroups) {
    const names = catalog.map(item => item.targetApplications?.[mapping.application]?.sourceName ?? item.name);
    const choices = index.resolveFieldChoices(mapping.selectionField, {});
    if (choices) {
      validatedFields++;
      for (const name of names) assert.ok(choices.includes(name), `${mapping.selectionField}: ${name}`);
    }
    for (const name of names.filter(name => name.startsWith('亞特瑪') && name.includes('強烈'))) {
      const values = { [mapping.selectionField]: name };
      normalizeOptionalEffectValues(values, index);
      assert.equal(values[mapping.selectionField], name, mapping.selectionField);
    }
  }
  assert.ok(validatedFields > 0, 'magic stone fields must exercise the validation catalog');
});

test('index queries and current normalization leave saved baseline and cached evaluation unchanged', async () => {
  const { createBaselineEvaluationCache } = await runtime.load('frontend/baseline-evaluation.ts');
  const { normalizePortraitAwakeningValues, migrateLegacyPortraitAwakening } = await runtime.load('frontend/state.ts');
  const cache = createBaselineEvaluationCache(), baseline = structuredClone(complete), revision = Symbol();
  const cached = cache.get(gameData, baseline, revision), before = digest(baseline), current = structuredClone(legacyStartup);
  migrateLegacyPortraitAwakening(current.values, gameData.otherEffects.portraitAwakening);
  normalizePortraitAwakeningValues(current.values, gameData.otherEffects.portraitAwakening);
  for (const context of choiceContexts()) for (const field of Object.keys(fixture.choices[context.id])) index.resolveFieldChoices(field, context.values);
  runtime.resetCounts();
  assert.equal(cache.get(gameData, baseline, revision), cached);
  assert.equal(runtime.counts.evaluateLoadout ?? 0, 0);
  assert.equal(digest(baseline), before);
});

test('actual main import/restore retains baseline and reuses the same index', async () => {
  const page = await createPage(complete, complete);
  try {
    const { document, localStorage, Event, KeyboardEvent } = page.dom.window;
    const baselineBefore = localStorage.getItem('dab-baseline-v1');
    const input = document.querySelector('input[aria-label="Boss防禦"]');
    input.value = '60'; input.dispatchEvent(new Event('input', { bubbles: true }));
    page.runtime.resetCounts(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(page.runtime.counts.evaluateLoadout, 1);
    assert.equal(page.runtime.counts.createCatalogIndex ?? 0, 0);
    const file = document.querySelector('#loadout-file');
    Object.defineProperty(file, 'files', { value: [{ text: async () => fixture.transfers.export.json }] });
    page.runtime.resetCounts(); file.dispatchEvent(new Event('change'));
    for (let i = 0; i < 200 && document.querySelector('#transfer-status').textContent.includes('正在載入'); i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.match(document.querySelector('#transfer-status').textContent, /已匯入/);
    assert.equal(page.runtime.counts.createCatalogIndex ?? 0, 0);
    assert.equal(page.runtime.counts.evaluateLoadout, 1);
    assert.equal(localStorage.getItem('dab-baseline-v1'), baselineBefore);
    const changedBoss = document.querySelector('input[aria-label="Boss防禦"]');
    changedBoss.value = '30'; changedBoss.dispatchEvent(new Event('input', { bubbles: true }));
    changedBoss.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(document.querySelector('#restore-baseline').disabled, false);
    document.querySelector('#restore-baseline').click();
    assert.equal(localStorage.getItem('dab-baseline-v1'), baselineBefore);
    assert.equal(document.querySelector('input[aria-label="Boss防禦"]').value, String(complete.values['Stage.BossDEF']));
    assert.match(document.querySelector('#equipment-damage-summary').textContent, /0.00%/);
  } finally { page.close(); }
});
