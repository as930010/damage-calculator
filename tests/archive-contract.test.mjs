import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { FIELD_ID_TO_CODE, fieldIdForCode, codeForFieldId } from '../dist/frontend/field-ids.js';
import { decodeSingle, encodeSingle, encodeLibrary } from '../dist/frontend/loadout-archive.js';
import { exportWorkingLoadout, parseLoadoutJson } from '../dist/frontend/loadout-transfer.js';
import { LoadoutProfiles, parseProfileBackup, profilesKey } from '../dist/frontend/loadout-profiles.js';
import { createCatalogIndex } from '../dist/frontend/catalog-index.js';
import { gameData, createRuntime } from './loadout-evaluation-harness.mjs';
import { uiPage } from './ui-update-harness.mjs';

const fixture = name => readFile(new URL('./fixtures/data-contract/' + name + '.json', import.meta.url), 'utf8');
const history = JSON.parse(await fixture('field-map-v1'));
const { library } = JSON.parse(await fixture('library-v1'));
const instance = library.profiles[0].loadout;
const catalog = createCatalogIndex(gameData);

function assertRegistry(current, previous) {
  const ids = new Set();
  for (const [field, id] of Object.entries(current)) {
    assert.ok(Number.isSafeInteger(id) && id > 0 && !ids.has(id), field + ': duplicate or invalid ID ' + id);
    ids.add(id);
    if (!(field in previous)) assert.ok(id > Math.max(...Object.values(previous)), field + ': reused historical range');
  }
  for (const [field, id] of Object.entries(previous)) assert.equal(current[field], id, field + ': wire meaning changed');
}

test('field map v1 preserves every published assignment, independent of presentation order', async () => {
  let published = { ...history };
  const files = await readdir(new URL('./fixtures/data-contract/', import.meta.url));
  for (const name of files.filter(f => /^field-map-v1-additions-\d{8}\.json$/.test(f)).sort()) {
    const extension = JSON.parse(await fixture(name.slice(0,-5)));
    for (const field of Object.keys(extension)) assert.ok(!Object.hasOwn(published,field), name + ': duplicate historical field ' + field);
    const next = { ...published, ...extension };
    assertRegistry(next,published);
    published = next;
  }
  assertRegistry(FIELD_ID_TO_CODE, published);
  for (const field of Object.keys(FIELD_ID_TO_CODE)) assert.ok(Object.hasOwn(published,field),field + ': record new ID in a reviewed additions fixture');
  for (const [field, id] of Object.entries(FIELD_ID_TO_CODE)) {
    assert.equal(fieldIdForCode(String(id)), field);
    assert.equal(codeForFieldId(field), id);
  }
  for (const unknown of ['constructor', 'toString', '__proto__', '01', '-1']) assert.equal(fieldIdForCode(unknown), undefined);
  assert.equal(codeForFieldId('constructor'), undefined);
});

test('declared game-data field bindings have registered wire IDs', () => {
  function visit(value, path) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const where = path + '.' + key;
      if (/(?:field(?:id)?s?|settingkeys?)$/i.test(key)) {
        for (const item of Array.isArray(child) ? child : [child]) {
          if (typeof item === 'string') assert.ok(codeForFieldId(item), where + ': unregistered ' + item);
        }
      }
      visit(child, where);
    }
  }
  visit(gameData, 'gameData');
});

test('D/G: additive test-only field uses a fresh ID and preserves scalar types and old archives', async () => {
  const field = 'Example.NewEquipment.Option';
  assert.equal(codeForFieldId(field), undefined);
  const code = Math.max(...Object.values(FIELD_ID_TO_CODE)) + 1;
  const runtime = await createRuntime({ instrument: false, transformSource(file, text) {
    if (file !== 'frontend/field-transfer-codes.ts') return text;
    return text.replace('Object.freeze({', 'Object.freeze({' + JSON.stringify(field) + ':' + code + ',');
  } });
  const extended = await runtime.load('frontend/loadout-archive.ts');
  assertRegistry((await runtime.load('frontend/field-ids.ts')).FIELD_ID_TO_CODE, history);
  assert.deepEqual(structuredClone(extended.decodeSingle(JSON.parse(await fixture('single-v4')))), instance);
  for (const value of ['5', 5, 0, '0', -0.125]) {
    const state = { ...instance, values: { [field]: value }, lowerwearAlternativeEnabled: true };
    const wire = JSON.parse(extended.encodeSingle(state));
    assert.deepEqual(structuredClone(extended.decodeSingle(wire)), state);
    assert.throws(() => decodeSingle(wire), RegExp(String(code)));
  }
  // Schema 3 stores booleans as named flags, never as a values cell.
  const bad = JSON.parse(extended.encodeSingle({ ...instance, values: {} }));
  bad.values[code] = true;
  assert.throws(() => extended.decodeSingle(bad), /欄位值/);
});

test('E: renumbering, renaming, removal and duplicate assignment fail the historical contract', () => {
  const corrupt = { ...history };
  delete corrupt['Stage.Adapt'];
  for (const changed of [corrupt, { ...corrupt, 'Example.Renamed': history['Stage.Adapt'] },
    { ...history, 'Stage.Adapt': 10001 }, { ...history, 'Example.Duplicate': history['Stage.Adapt'] }])
    assert.throws(() => assertRegistry(changed, history));
});

function reversed(value) {
  if (Array.isArray(value)) return value.map(reversed);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k,v]) => [k, reversed(v)]));
  return value;
}

for (const seed of [1597, 65537, 20261118]) test('seed ' + seed + ': typed round trips and deterministic dictionaries, snapshots and deltas', () => {
  let random = seed;
  const draw = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return Math.floor(random / 2 ** 32 * n); };
  const fields = [...catalog.equipmentMappings.values()];
  const profiles = [];
  for (let i = 0; i < 64; i++) {
    const values = {};
    for (const mapping of fields) {
      const items = catalog.equipmentItems(mapping);
      if (items.length && draw(3) === 0) {
        const item = items[draw(items.length)];
        values[mapping.selectionField] = mapping.application ? item.targetApplications[mapping.application].sourceName : item.name;
      }
    }
    for (const field of ['Stage.Adapt','Stage.BossDEF','Stage.CritRatePenalty']) {
      const choices = catalog.resolveFieldChoices(field, values);
      if (choices?.length && draw(2)) {
        const choice = choices[draw(choices.length)];
        values[field] = draw(2) ? String(choice) : choice;
      }
    }
    const state = { ...instance, values, lowerwearAlternativeEnabled: !!draw(2), Job: 'FP',
      classSkillVersions: { 'FP.FatalShotConverted': !!draw(2), 'DN.FieldPowerConverted': (seed % 2) === 0 } };
    const json = exportWorkingLoadout(state);
    const restored = parseLoadoutJson(json, instance, gameData, catalog).state;
    assert.deepEqual(restored, state, 'seed ' + seed + ' case ' + i + ': typed loadout');
    assert.equal(encodeSingle(reversed(state)), json, 'seed ' + seed + ' case ' + i + ': key order');
    const baseline = i % 3 === 0 ? state : i % 3 === 1 ? instance : { ...state, values: {} };
    profiles.push({ ...library.profiles[0], id: String(i), name: 'Seed ' + i, loadout: state, baseline });
  }
  const store = {schemaVersion: 1, activeProfileId: null, profiles};
  assert.deepEqual(parseProfileBackup(encodeLibrary(store)), store, 'seed ' + seed + ': profiles and baselines');
  assert.equal(encodeLibrary(store), encodeLibrary(reversed(store)), 'seed ' + seed + ': library bytes');
});

test('empty, unique and repeated dictionaries keep absence, type and exact snapshot identity', () => {
  const empty = { ...instance, values: {} };
  assert.deepEqual(JSON.parse(encodeSingle(empty)).strings, []);
  const fields = Object.keys(history).filter(field => !field.startsWith('Resonance.'));
  for (const repeated of [false,true]) {
    // Test the wire scalar domain apart from catalog-specific game validation.
    const values = Object.fromEntries(fields.map((field,i) => [field, repeated ? '重複文字' : '文字' + i]));
    const wire = JSON.parse(encodeSingle({ ...instance, values }));
    assert.deepEqual(wire.strings, repeated ? ['重複文字'] : []);
    assert.deepEqual(decodeSingle(wire).values, values);
  }
  const emptyStore = { schemaVersion:1, activeProfileId:null, profiles:[] };
  assert.deepEqual(parseProfileBackup(encodeLibrary(emptyStore)), emptyStore);
  const different = { ...empty, Job:'FP', values:{ 'Stage.BossDEF':'5' } };
  const store = { ...library, profiles:library.profiles.map(p => ({...p, loadout:empty, baseline:different})) };
  const wire = JSON.parse(encodeLibrary(store));
  assert.equal(wire.snapshots.length, 2);
  assert.deepEqual(parseProfileBackup(JSON.stringify(wire)), store);
});

const corruptions = {
  'unknown ID': f => { f.snapshots[0].values['999999'] = 1; },
  'invalid dictionary reference': f => { f.snapshots[0].values['1'] = [f.strings.length]; },
  'invalid type tag': f => { f.snapshots[0].values['1'] = [0, 0]; },
  'unsafe integer': f => { f.snapshots[0].values['1'] = 2**53; },
  'unsupported map': f => { f.fieldMapVersion++; },
  'unsupported value codec': f => { f.valueCodecVersion++; },
  'orphan duplicate snapshot': f => { f.snapshots.push(structuredClone(f.snapshots[0])); },
  'invalid baseline remove': f => { f.snapshots[1].remove.push('999999'); },
  'baseline cycle': f => { f.snapshots[1].base = 1; },
};
for (const [name, mutate] of Object.entries(corruptions)) test('refuse corrupt backup before restoration: ' + name, async () => {
  const bytes = await fixture('library-v1');
  const stored = new Map([[profilesKey, JSON.stringify(JSON.parse(bytes).library)]]);
  const manager = new LoadoutProfiles(() => ({getItem:k => stored.get(k), setItem:() => assert.fail('unexpected write')}));
  assert.ok(manager.reload().ok);
  const wire = JSON.parse(await fixture('library-v2'));
  mutate(wire);
  assert.throws(() => manager.restoreProfiles(parseProfileBackup(JSON.stringify(wire)), 'replace'));
  assert.deepEqual(manager.getStore().value, library);
});

for (const version of ['library-v1','library-v2']) test(version + ' frozen library restores through merge and replace', async () => {
  const archive = parseProfileBackup(await fixture(version));
  assert.deepEqual(archive, library);
  const storage = new Map();
  const manager = new LoadoutProfiles(() => ({getItem:k => storage.get(k) ?? null, setItem:(k,v) => storage.set(k,v)}));
  assert.ok(manager.reload().ok);
  for (const mode of ['merge','merge','replace']) {
    const result = manager.restoreProfiles(archive, mode);
    assert.ok(result.ok, result.error?.message);
    assert.deepEqual(result.value.profiles.slice(0,2), library.profiles);
    assert.equal(new Set(result.value.profiles.map(p=>p.id)).size, result.value.profiles.length);
  }
  assert.deepEqual(manager.reload().value, library);
});

for (const name of ['single-v3','single-v4','profile-v2']) test(name + ' frozen file imports through current entry point', async () => {
  const raw = await fixture(name);
  const result = parseLoadoutJson(raw, instance, gameData, catalog);
  const expected = name === 'single-v3' ? JSON.parse(await fixture('single-v3-expected')) : instance;
  assert.deepEqual(result.state, expected);
  assert.deepEqual(result.clearedFields, []);
  if (name === 'profile-v2') {
    assert.equal(result.name, library.profiles[0].name);
    assert.deepEqual(result.baseline, library.profiles[0].baseline);
    assert.deepEqual(parseProfileBackup(raw).profiles, [library.profiles[0]]);
  }
  const page = await uiPage(instance,null);
  try {
    await page.importJson(raw);
    const canvas = structuredClone(expected);
    if (name === 'single-v3') Object.assign(canvas.values, {
      'Effect.PortraitAwakening.StrongSkillDamagePct': 0, 'Effect.PortraitAwakening.TranscendenceSkillDamagePct': 5,
    });
    assert.deepEqual(decodeSingle(await page.exportJson()), canvas);
  } finally { page.close(); }
});

async function choose(page,label) {
  const doc = page.dom.window.document;
  for (let attempt=0;attempt<200;attempt++) {
    const button = [...doc.querySelectorAll('dialog button')].find(b=>b.textContent === label);
    if (button) {button.click();return;}
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail(label + ': ' + doc.querySelector('#transfer-status').textContent + ' ' + doc.querySelector('#profile-message').textContent);
}
function upload(page,selector,raw) {
  const input = page.dom.window.document.querySelector(selector);
  Object.defineProperty(input,'files',{configurable:true,value:[{size:Buffer.byteLength(raw),text:async()=>raw}]});
  input.dispatchEvent(new page.dom.window.Event('change'));
}
for (const name of ['profile-v2','library-v1','library-v2']) test(name + ' restores via its homepage file input and preserves the working draft',async () => {
  const page = await uiPage(instance,null,{globals:{crypto:globalThis.crypto}});
  try {
    const storage = page.dom.window.localStorage;
    const draft = storage.getItem('dab-loadout-v1');
    const raw = await fixture(name);
    if (name === 'profile-v2') {
      upload(page,'#loadout-file',raw);
      await choose(page,'新增為正式配置');
      await choose(page,'新增');
      const [created] = JSON.parse(storage.getItem(profilesKey)).profiles;
      assert.equal(created.name,library.profiles[0].name);
      assert.deepEqual(created.loadout,instance);
      assert.deepEqual(created.baseline,library.profiles[0].baseline);
    } else {
      for (const action of ['合併匯入','完整取代']) {
        upload(page,'#profile-backup-file',raw);
        await choose(page,action);
        await new Promise(resolve=>setTimeout(resolve,0));
        assert.deepEqual(JSON.parse(storage.getItem(profilesKey)).profiles,library.profiles,action);
      }
    }
    assert.equal(storage.getItem('dab-loadout-v1'),draft);
  } finally {page.close();}
});
