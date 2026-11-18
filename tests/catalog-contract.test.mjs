import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCatalogIndex, equipmentTransferCode } from '../dist/frontend/catalog-index.js';
import { getEquipmentOptionName } from '../dist/calculation/equipment-catalog.js';
import { attributeLabel } from '../dist/frontend/attribute-label.js';
import { decodeSingle } from '../dist/frontend/loadout-archive.js';
import { exportWorkingLoadout, invalidLoadoutFields, serializeLoadout, parseLoadoutJson } from '../dist/frontend/loadout-transfer.js';
import { clearInvalidAccessoryAppraisals } from '../dist/frontend/loadout-normalization.js';
import { isFieldId } from '../dist/frontend/field-ids.js';
import { readState } from '../dist/frontend/state.js';
import { gameData } from './loadout-evaluation-harness.mjs';
import { uiPage } from './ui-update-harness.mjs';

const historical = JSON.parse(await readFile(new URL('./fixtures/data-contract/equipment-identities-v1.json', import.meta.url)));
const base = { ...readState('KE'), lowerwearAlternativeEnabled:true };
function checkIdentities(data) {
  const index = createCatalogIndex(data);
  for (const [group, contract] of Object.entries(historical)) {
    for (const field of contract.fields) {
      const mapping = index.equipmentMappings.get(field);
      assert.ok(mapping, field + ': missing catalog mapping');
      assert.equal([mapping.catalogFile, mapping.slotId, mapping.application ?? ''].join('|'), group, field);
      for (const [id, name] of Object.entries(contract.items)) {
        const context = field + ': historical ' + name + ' / ' + id;
        assert.deepEqual(index.matchEquipment(mapping, name).map(i=>i.id), [id], context);
        assert.equal(index.resolveEquipmentCode(mapping, equipmentTransferCode(id))?.id, id, context);
      }
    }
  }
}

test('published equipment labels and legacy codes still identify exactly the same items', () => checkIdentities(gameData));

function names(options) { return options.map(option => option.name); }
function selections(fields, options) {
  return options.map(name => Object.fromEntries(fields.map(field => [field, name])));
}

// Each series is independent. Combine one row from each series per page import,
// preserving parents, slot applicability and the alternate lowerwear switch.
function catalogs(data, nephron) {
  const sets = [];
  const index = createCatalogIndex(data);
  function add(slot, variants) {
    if (variants.length) sets.push({slot, variants});
  }
  for (const [field, map] of index.equipmentMappings) {
    const slot = data.layout.slots.find(s => s.selectionField === field || s.stoneFields?.includes(field));
    assert.ok(slot, field + ': missing equipment canvas binding');
    const armor = data.innerwear.slots.find(s => s.id === slot.innerwearId);
    if (armor && !nephron && slot.stoneFields.indexOf(field) >= 4) continue;
    // Read the authoritative raw catalog independently of the picker/index.
    const items = data.catalogs[map.catalogFile].items.filter(i => i.active && i.slotId === map.slotId);
    const appraisal = data.accessoryEffects.groups.find(g => g.selectionField === field);
    const variants = [];
    for (const item of items) {
      const value = getEquipmentOptionName(item,map.application);
      assert.deepEqual(index.matchEquipment(map,value).map(i => i.id),[item.id],field + ': ' + value);
      assert.equal(index.resolveEquipmentCode(map,index.equipmentCode(item.id))?.id,item.id,field + ': ' + item.id);
      const count = item.appraisal?.canAppraise ? item.appraisal.effectCount : 0;
      if (appraisal && count > 0) {
        assert.ok(count <= appraisal.inputFields.length, item.id);
        const options = appraisal.optionsByEquipmentName?.[item.name] ?? appraisal.options;
        for (const effects of selections(appraisal.inputFields.slice(0,count), names(options))) variants.push({[field]:value, ...effects});
      } else variants.push({[field]:value});
    }
    add(slot.id, variants);
  }
  for (const armor of data.innerwear.slots) {
    const slot = data.layout.slots.find(s => s.innerwearId === armor.id);
    add(slot.id, [{[armor.typeField]:nephron ? '內布隆' : '百億'}]);
    add(slot.id, selections([armor.enhancementField],Object.keys(data.innerwear.enhancementStats).map(n => 'Lv.' + n)));
    add(slot.id, selections([armor.forgingField],Object.keys(data.innerwear.forgingAttack)));
    if (!nephron) add(slot.id, selections(data.appraisals.slots.find(s=>s.id === armor.id).inputFields,names(data.appraisals.options)));
  }
  const weapon = data.layout.slots.find(s=>s.weapon).id;
  add(weapon,selections(['Weapon.ENHC'],Object.keys(data.attack.weaponEnhancementFactors).map(n=>'Lv.'+n)));
  add(weapon,selections([data.growth.settingKey],names(data.growth.levels)));
  for (const group of Object.values(data.weaponAppraisals.groups)) add(weapon,selections([group.settingKey],names(group.options)));
  for (const group of data.weaponGrades.colorGroups) add(null,selections(group.settingKeys,names(group.options)));
  add(null,selections(data.giantStones.settingKeys,names(data.giantStones.options)));
  add(null,selections([data.weaponGrades.settingKey],names(data.weaponGrades.options)));
  return sets;
}

const optionsFor = data => ({globals:{fetch:async url => {
  assert.match(String(url), /\/data\/game-data\.json/);
  return {ok:true,json:async()=>structuredClone(data)};
}}});

function openSlot(doc, slot) {
  const button = doc.querySelector('[data-slot-id="' + slot + '"]');
  assert.ok(button, slot);
  button.click();
  for (const node of doc.querySelectorAll('#inspector [data-field-id]')) assert.ok(isFieldId(node.dataset.fieldId),slot + ': unregistered Picker ' + node.dataset.fieldId);
}
function inputFor(doc,field,data) {
  if (field === data.weaponGrades.settingKey) return doc.querySelector('.weapon-magic-stone-grade input');
  return doc.querySelector('[data-field-id="' + field + '"] input');
}
function checkControl(doc, field, value, data) {
  if (data.innerwear.slots.some(s=>s.typeField === field)) {
    assert.equal(doc.querySelector('[data-innerwear-type][aria-pressed="true"]')?.dataset.innerwearType,value,field);
    return;
  }
  const input = inputFor(doc,field,data);
  assert.ok(input,field + ': missing bound picker');
  assert.equal(input.value,attributeLabel(String(value)),field + ': visible selection');
}

for (const nephron of [false,true]) test('all current equipment, stone and applicable appraisal choices survive canvas import/export: ' + (nephron?'內布隆':'百億'), async t => {
  const data = gameData;
  const sets = catalogs(data, nephron);
  const page = await uiPage(base,null);
  const doc = page.dom.window.document;
  let checked = 0;
  try {
    const rounds = Math.max(...sets.map(s=>s.variants.length));
    for (let i=0;i<rounds;i++) {
      const state = {...base,values:{}};
      const controls = new Map();
      for (const {slot,variants} of sets) {
        // Keep each parent selection while other slots finish their longer series.
        const selection = variants[Math.min(i,variants.length-1)];
        Object.assign(state.values,selection);
        if (i >= variants.length) continue;
        if (!controls.has(slot)) controls.set(slot,{});
        Object.assign(controls.get(slot),selection);
      }
      const raw = exportWorkingLoadout(state);
      await page.importJson(raw);
      assert.deepEqual(page.readState(),state,'batch ' + i + ': saved canvas');
      for (const [slot,fields] of controls) {
        if (slot) openSlot(doc,slot);
        for (const [field,value] of Object.entries(fields)) {
          checkControl(doc,field,value,data);
          checked++;
        }
      }
      assert.deepEqual(decodeSingle(await page.exportJson()),state,'batch ' + i + ': exported canvas');
    }
    t.diagnostic(checked + ' field/choice checks across ' + rounds + ' imports');
  } finally { page.close(); }
});

const specialFields = ['Accessory.FaceBottom.Appraisal.1','Accessory.FaceBottom.Appraisal.2','Accessory.FaceBottom.Appraisal.3',
  'Accessory.Ring1.Appraisal.1','Accessory.Ring1.Appraisal.2'];
test('hidden appraisal slots preserve absence and explicit unrelated across reload but reject inapplicable effects', async () => {
  for (const present of [false,true]) {
    const state = {...base,values:present?Object.fromEntries(specialFields.map(f=>[f,'無關傷害'])):{}};
    const page = await uiPage(base,null);
    let reopened;
    try {
      await page.importJson(exportWorkingLoadout(state));
      reopened = await uiPage(page.readState(),null);
      for (const field of specialFields) {
        openSlot(reopened.dom.window.document,field.split('.Appraisal')[0]);
        assert.equal(inputFor(reopened.dom.window.document,field,gameData),null,field + ': hidden without equipment');
        const bad = structuredClone(state);
        bad.values[field] = '極大化%';
        assert.deepEqual(clearInvalidAccessoryAppraisals(gameData,bad),[field],field);
      }
      const restored = decodeSingle(await reopened.exportJson());
      for (const field of specialFields) {
        assert.equal(Object.hasOwn(restored.values,field),present,field);
        if (present) assert.equal(restored.values[field],'無關傷害',field);
      }
    } finally {reopened?.close();page.close();}
  }
});

test('A/B/C: isolated new equipment, magic stone and item-specific appraisal through picker, reload and export', async () => {
  const data = structuredClone(gameData);
  const group = data.accessoryEffects.groups.find(g=>g.selectionField === 'Accessory.FaceBottom');
  const map = data.mapping.selections.find(m=>m.selectionField === group.selectionField);
  const items = data.catalogs[map.catalogFile].items;
  const item = structuredClone(items.find(it=>it.slotId === map.slotId && it.active && it.appraisal?.canAppraise));
  item.id='contract-new-item'; item.name='契約測試面甲'; items.push(item);
  const effect = '契約測試鑑定';
  group.optionsByEquipmentName = {...group.optionsByEquipmentName,[item.name]:[...group.options,{name:effect,stats:{}}]};
  const stones = data.catalogs[data.mapping.magicStoneSelections.catalogFile].items;
  const stone = structuredClone(stones.find(it=>it.active));
  stone.id='contract-new-stone';stone.name='契約測試魔法石';
  for (const [application,target] of Object.entries(stone.targetApplications)) target.sourceName='契約魔法石 '+application;
  stones.push(stone);
  const field = group.inputFields[0], stoneField = data.layout.slots.find(s=>s.weapon).stoneFields[0];
  const state = {...base,values:{[map.selectionField]:item.name,[field]:effect,[stoneField]:stone.targetApplications.weapon.sourceName}};
  const idx = createCatalogIndex(data);
  assert.deepEqual(invalidLoadoutFields(state,data,idx),[]);
  const legacy = serializeLoadout(state,data,idx);
  assert.deepEqual(legacy.omittedFields,[]);
  const back = parseLoadoutJson(legacy.json,base,data,idx);
  assert.deepEqual(back.clearedFields,[]);
  assert.equal(back.state.values[field],effect);
  const page = await uiPage(base,null,optionsFor(data));
  let reopened;
  try {
    await page.importJson(exportWorkingLoadout(state));
    reopened = await uiPage(page.readState(),null,optionsFor(data));
    const doc = reopened.dom.window.document;
    for (const [slot,fields] of [[map.selectionField,[map.selectionField,field]],['weapon',[stoneField]]]) {
      openSlot(doc,slot);
      for (const key of fields) {
        checkControl(doc,key,state.values[key],data);
        const input = inputFor(doc,key,data);
        input.dispatchEvent(new reopened.dom.window.Event('focus'));
        const options = doc.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]');
        assert.ok([...options].some(o=>o.querySelector('span')?.textContent === state.values[key]),key + ': selectable after reload');
      }
    }
    const restored = decodeSingle(await reopened.exportJson());
    for (const [key,value] of Object.entries(state.values)) assert.equal(restored.values[key],value,key);
  } finally {reopened?.close();page.close();}
});

test('F: rename, retirement, replacement and ambiguous labels have explicit compatibility outcomes', () => {
  const mapping = gameData.mapping.selections[0];
  const item = gameData.catalogs[mapping.catalogFile].items.find(i=>i.active && i.slotId===mapping.slotId);
  const field = mapping.selectionField;
  const state = {...base,values:{[field]:item.name}};
  const legacy = serializeLoadout(state,gameData).json;
  for (const change of ['rename','disable','remove','new ID same name','alias only','duplicate name']) {
    const data = structuredClone(gameData);
    const items = data.catalogs[mapping.catalogFile].items;
    const position = items.findIndex(i=>i.id===item.id), target = items[position];
    if (change === 'rename' || change === 'alias only') target.name+='（新版）';
    if (change === 'alias only') target.aliases=[item.name];
    if (change === 'disable') target.active=false;
    if (change === 'remove') items.splice(position,1);
    if (change === 'new ID same name') target.id+='-replacement';
    if (change === 'duplicate name') items.push({...target,id:target.id+'-duplicate'});
    const idx = createCatalogIndex(data);
    assert.throws(()=>checkIdentities(data),undefined,change);
    const old = parseLoadoutJson(legacy,base,data,idx);
    if (['disable','remove','new ID same name','duplicate name'].includes(change)) {
      assert.ok(old.clearedFields.includes(field),change);
      assert.equal(old.state.values[field],undefined);
    } else assert.equal(old.state.values[field],target.name,change);
    if (change !== 'new ID same name') assert.ok(invalidLoadoutFields(state,data,idx).includes(field),change);
  }
});

test('legacy colliding equipment hashes cannot resolve to a different item', () => {
  assert.equal(equipmentTransferCode('costarring'),equipmentTransferCode('liquid'));
  const data = structuredClone(gameData);
  const map = data.mapping.selections[0], items=data.catalogs[map.catalogFile].items;
  const old = items.find(i=>i.active && i.slotId === map.slotId);
  items.push({...old,id:'costarring',name:'契約 A'},{...old,id:'liquid',name:'契約 B'});
  const index=createCatalogIndex(data);
  assert.equal(index.resolveEquipmentCode(map,equipmentTransferCode('costarring')),null);
  assert.deepEqual(invalidLoadoutFields({...base,values:{[map.selectionField]:'契約 A'}},data,index),[map.selectionField]);
});

test('published stone IDs, appraisal names and applicable accessory slots remain readable', async () => {
  const frozen = JSON.parse(await readFile(new URL('./fixtures/data-contract/appraisal-and-stone-choices-v1.json',import.meta.url)));
  function retains(options, previous, scope) {
    for (const [id,name] of Object.entries(previous)) {
      assert.deepEqual(options.filter(o=>o.name===name).map(o=>o.id),[id],scope + ': ' + name + ' / ' + id);
    }
  }
  retains(gameData.appraisals.options,frozen.armor,'armor appraisal');
  retains(gameData.giantStones.options,frozen.giant,'giant stone');
  retains(gameData.weaponGrades.options,frozen.grades,'weapon grade');
  for (const [field,old] of Object.entries(frozen.weapon)) {
    const group=Object.values(gameData.weaponAppraisals.groups).find(g=>g.settingKey===field);
    assert.ok(group,field);
    retains(group.options,old,field);
  }
  for (const [id,old] of Object.entries(frozen.colors)) {
    const group=gameData.weaponGrades.colorGroups.find(g=>g.id===id);
    assert.ok(group,id);
    retains(group.options,old,id);
  }
  for (const [field,old] of Object.entries(frozen.accessories)) {
    const group=gameData.accessoryEffects.groups.find(g=>g.selectionField===field);
    const mapping=gameData.mapping.selections.find(m=>m.selectionField===field);
    assert.ok(group && mapping,field);
    for (const [id,previous] of Object.entries(old.items)) {
      const item=gameData.catalogs[mapping.catalogFile].items.find(i=>i.id===id && i.active && i.slotId===mapping.slotId);
      assert.ok(item?.appraisal?.canAppraise,field + ': ' + id);
      assert.ok(item.appraisal.effectCount>=previous.count,field + ': lost appraisal slot on ' + id);
      assert.deepEqual(group.inputFields.slice(0,previous.count),old.fields.slice(0,previous.count),field);
      const choices=names(group.optionsByEquipmentName?.[item.name] ?? group.options);
      for (const name of previous.options ?? old.options) assert.ok(choices.includes(name),id + ': removed appraisal ' + name);
    }
  }
});

test('removed v4 selection reports the field at import and leaves saved workspace untouched', async () => {
  const data=structuredClone(gameData);
  const mapping=data.mapping.selections[0];
  const item=data.catalogs[mapping.catalogFile].items.find(i=>i.active && i.slotId===mapping.slotId);
  const archive=exportWorkingLoadout({...base,values:{[mapping.selectionField]:item.name}});
  item.active=false;
  const page=await uiPage(base,null,optionsFor(data));
  try {
    const doc=page.dom.window.document, storage=page.dom.window.localStorage;
    const keys=['dab-loadout-v1','dab-baseline-v1','damage-calculator.profiles.v1','damage-calculator.profile-draft.v1'];
    const before=keys.map(k=>storage.getItem(k));
    const file=doc.querySelector('#loadout-file');
    Object.defineProperty(file,'files',{value:[{text:async()=>archive}]});
    file.dispatchEvent(new page.dom.window.Event('change'));
    const status=doc.querySelector('#transfer-status');
    for (let i=0;i<200 && !status.textContent.includes('匯入失敗');i++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(status.textContent.includes(mapping.selectionField),status.textContent);
    assert.deepEqual(keys.map(k=>storage.getItem(k)),before);
    assert.equal(doc.querySelector('.profile-dialog'),null);
  } finally {page.close();}
});
