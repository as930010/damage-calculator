import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { ProfileDraft, recoverProfileDraft, draftAssociationKey, draftJournalKey } from '../dist/frontend/profile-draft.js';
import { LoadoutProfiles, profilesKey, exportProfileBackup, parseProfileBackup } from '../dist/frontend/loadout-profiles.js';
import { LoadoutHistory } from '../dist/frontend/history.js';
import { parseState } from '../dist/frontend/state.js';
import { uiPage, stateA, enter } from './ui-update-harness.mjs';
// Use the real homepage's current normalization, rather than obsolete fields in the public sample.
const initialPage=await uiPage(stateA,null,{globals:{crypto:webcrypto}});
const original=parseState(initialPage.dom.window.localStorage.getItem('dab-loadout-v1'));
initialPage.close();
const other={...structuredClone(original),Job:'KE'};
const ok=r=>{assert.equal(r.ok,true,r.error?.message);return r.value;};
function fixture() {
 const map=new Map([['dab-loadout-v1',JSON.stringify(original)],['dab-baseline-v1',JSON.stringify(original)]]);
 const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 return {map,storage,draft:new ProfileDraft(()=>storage)};
}
function libraryFixture() {
 const f=fixture(),lib=new LoadoutProfiles(()=>f.storage);ok(lib.reload());
 const a=ok(lib.createProfile('角色 A',original,original)),b=ok(lib.createProfile('角色 B',other,null));
 return {...f,lib,a,b};
}
test('draft association survives reopening without loading saved profile over unsaved edits',()=>{
 const {storage,map,draft}=fixture();assert.equal(draft.write(other,null,'A'),true);
 const again=new ProfileDraft(()=>storage);assert.equal(again.profileId,'A');assert.equal(JSON.parse(map.get('dab-loadout-v1')).Job,'KE');assert.equal(map.has('dab-baseline-v1'),false);assert.equal(map.has(draftJournalKey),false);
});
for(const key of [draftJournalKey,'dab-loadout-v1','dab-baseline-v1',draftAssociationKey])test('failed write rolls back complete workspace: '+key,()=>{
 const {storage,map,draft}=fixture(),before=new Map(map);let once=true;const set=storage.setItem,remove=storage.removeItem;
 storage.setItem=(k,v)=>{if(k===key&&once){once=false;throw Error('quota');}return set(k,v);};
 storage.removeItem=k=>{if(k===key&&once){once=false;throw Error('quota');}return remove(k);};
 assert.equal(draft.write(other,null,'B'),false);assert.deepEqual(map,before);assert.equal(draft.profileId,null);
});
test('unrecoverable write failure retains journal and blocks more writes until recovery',()=>{
 const {map,storage,draft}=fixture();const set=storage.setItem;let fail=false;
 storage.setItem=(k,v)=>{if(k===draftAssociationKey)fail=true;if(fail)throw Error('blocked');return set(k,v);};
 assert.equal(draft.write(other,other,'B'),false);assert.equal(map.has(draftJournalKey),true);
 storage.setItem=set;assert.match(recoverProfileDraft(storage),/恢復/);assert.equal(JSON.parse(map.get('dab-loadout-v1')).Job,original.Job);
});
test('interrupted switch rolls back; complete switch finishes; newer foreign draft is never overwritten',()=>{
 for(const state of ['partial','complete','foreign']){
  const {map,storage}=fixture();const keys=['dab-loadout-v1','dab-baseline-v1',draftAssociationKey];
  const before=keys.map(k=>storage.getItem(k)),after=[JSON.stringify(other),null,JSON.stringify({schemaVersion:1,profileId:'B'})];
  map.set(draftJournalKey,JSON.stringify({before,after}));map.set(keys[0],after[0]);
  if(state==='complete'){map.delete(keys[1]);map.set(keys[2],after[2]);}
  if(state==='foreign'){map.set(keys[0],JSON.stringify({...other,Job:'TB'}));assert.throws(()=>recoverProfileDraft(storage));assert.equal(JSON.parse(map.get(keys[0])).Job,'TB');}
  else{recoverProfileDraft(storage);assert.deepEqual(keys.map(k=>storage.getItem(k)),state==='partial'?before:after);}
 }
});
test('stale working tab rejects writes and reopens the latest association',()=>{
 const {map,storage,draft}=fixture();const second=new ProfileDraft(()=>storage);assert.equal(second.write(other,null,'B'),true);
 const before=new Map(map);assert.equal(draft.write(original,original,'A'),false);assert.deepEqual(map,before);
 assert.equal(draft.write(original,original,'A'),false);assert.equal(new ProfileDraft(()=>storage).profileId,'B');
});
test('blocked storage and sample mode never clear user data',()=>{
 const blocked=new ProfileDraft(()=>{throw Error('blocked');});assert.equal(blocked.write(original,null),false);
 const {storage,map}=fixture();const before=new Map(map);const sample=new ProfileDraft(()=>storage,true);assert.equal(sample.write(other,null,'sample'),false);assert.deepEqual(map,before);
});
test('backup preserves complete formal loadouts, baselines, IDs and timestamps',()=>{
 const {lib}=libraryFixture(),store=ok(lib.getStore());assert.deepEqual(parseProfileBackup(exportProfileBackup(store)),store);
});
test('merge resolves both ID and Unicode name conflicts; replace is a single validated operation',()=>{
 const {lib,a,b}=libraryFixture(),backup=ok(lib.getStore());const merged=ok(lib.restoreProfiles(backup,'merge'));
 assert.equal(merged.profiles.length,4);assert.equal(new Set(merged.profiles.map(p=>p.id)).size,4);assert.equal(new Set(merged.profiles.map(p=>p.name)).size,4);assert.deepEqual(merged.profiles[2].loadout,a.loadout);
 assert.deepEqual(ok(lib.restoreProfiles(backup,'replace')).profiles,[a,b]);
});
for(const raw of ['{','{}','{"format":"wrong","version":1}','x'.repeat(5*1024*1024+1)])test('bad backup is rejected without changing stored library: '+raw.slice(0,15),()=>{
 const {lib,map}=libraryFixture(),before=new Map(map);assert.throws(()=>parseProfileBackup(raw));assert.deepEqual(map,before);
});
test('backup restore failure and cross-tab conflict preserve library and working keys',()=>{
 const {lib,map,storage}=libraryFixture(),store=ok(lib.getStore()),before=new Map(map);storage.setItem=()=>{throw Error('full');};assert.equal(lib.restoreProfiles(store,'replace').ok,false);assert.deepEqual(map,before);
 map.set(profilesKey,JSON.stringify({...store,activeProfileId:store.profiles[0].id}));assert.equal(lib.restoreProfiles(store,'merge').error.code,'conflict');
});
test('history reset isolates characters and baseline switching is not an undo step',()=>{
 const history=new LoadoutHistory(original);history.record({...original,Job:'TB'});history.undo();assert.equal(history.canRedo,true);
 history.reset(other);assert.equal(history.canUndo,false);assert.equal(history.canRedo,false);assert.equal(history.matches(other),true);assert.equal(history.retainedSnapshots,1);
});
const flush=()=>new Promise(r=>setTimeout(r,5));
async function pageFor({linked=true,draftState=original,baseline=original,extra={},sample=false}={}){
 const {lib,a,b}=libraryFixture();const storage={ [profilesKey]:JSON.stringify(ok(lib.getStore())),...(linked?{[draftAssociationKey]:JSON.stringify({schemaVersion:1,profileId:a.id})}:{}),...extra};
 const page=await uiPage(draftState,baseline,{storage,globals:{crypto:webcrypto},...(sample?{url:'https://loadout.test/?sample=public-example-2026-09-28'}:{})});
 return {...page,a,b,doc:page.dom.window.document,storage:page.dom.window.localStorage};
}
async function settle(page){for(let i=0;i<400;i++){await flush();if(page.doc.querySelector('.profile-dialog')||page.doc.querySelector('#profile-manager').getAttribute('aria-busy')!=='true')return;}throw Error('UI did not settle');}
async function click(page,id){page.doc.querySelector('#'+id).click();await settle(page);}
async function choose(page,label){const b=[...page.doc.querySelectorAll('.profile-dialog button')].find(b=>b.textContent===label);assert.ok(b,label);b.click();await settle(page);}
function chips(page) { return [...page.doc.querySelectorAll('[data-profile-id]')]; }
function activeChip(page) { return chips(page).find(chip => chip.getAttribute('aria-pressed') === 'true'); }
async function switchTo(page,id) {
  const chip = chips(page).find(button => button.dataset.profileId === id);
  assert.ok(chip, id);
  chip.click();
  await settle(page);
}
function saved(page){return JSON.parse(page.storage.getItem(profilesKey));}
function working(page){return JSON.parse(page.storage.getItem('dab-loadout-v1'));}
function name(page,value){page.doc.querySelector('#profile-name').value=value;}
function manage(page,id) {
  const toggle = page.doc.querySelector('#profile-manage');
  if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
  const target = [...page.doc.querySelectorAll('[data-manage-id]')].find(button => button.dataset.manageId === id);
  assert.ok(target, id);
  target.click();
}

test('first-time empty library keeps unnamed legacy draft and creates no formal save',async()=>{
 const p=await pageFor({linked:false,extra:{[profilesKey]:JSON.stringify({schemaVersion:1,profiles:[],activeProfileId:null})}});try{assert.match(p.doc.querySelector('#profile-current').textContent,/未命名/);assert.equal(saved(p).profiles.length,0);assert.equal(working(p).Job,original.Job);}finally{p.close();}
});
test('save as saves the current draft, associates it and leaves the original formal save intact',async()=>{
 const p=await pageFor({draftState:other});try{await click(p,'profile-save-as');name(p,'團本配置');await choose(p,'儲存');assert.equal(saved(p).profiles.length,3);assert.equal(saved(p).profiles[0].loadout.Job,original.Job);assert.equal(saved(p).profiles[2].loadout.Job,'KE');assert.equal(JSON.parse(p.storage.getItem(draftAssociationKey)).profileId,saved(p).profiles[2].id);assert.match(p.doc.querySelector('#profile-current').textContent,/團本配置.*已儲存/);}finally{p.close();}
});
test('rename validates in-place, preserves input and never recalculates or resets history',async()=>{
 const p=await pageFor();try{manage(p,p.a.id);await click(p,'profile-rename');p.runtime.resetCounts();name(p,'角色 B');await choose(p,'確認');assert.ok(p.doc.querySelector('.profile-dialog'));assert.equal(p.doc.querySelector('#profile-name').value,'角色 B');name(p,'我的主力');await choose(p,'確認');assert.equal(saved(p).profiles[0].name,'我的主力');assert.equal(p.runtime.counts.renderResults??0,0);assert.equal(p.doc.querySelector('#undo').disabled,true);}finally{p.close();}
});
test('duplicate uses formal saved snapshot, preserving unsaved canvas and baseline',async()=>{
 const p=await pageFor({draftState:other});try{manage(p,p.a.id);await click(p,'profile-duplicate');assert.equal(saved(p).profiles[2].loadout.Job,original.Job);assert.equal(saved(p).profiles[2].name,'角色 A（副本）');assert.equal(working(p).Job,'KE');assert.match(p.doc.querySelector('#profile-current').textContent,/未儲存/);}finally{p.close();}
});
for(const choice of ['取消','放棄修改並切換','儲存並切換'])test('dirty switching: '+choice,async()=>{
 const changed=structuredClone(original);changed.values['Stage.BossDEF']='50';const p=await pageFor({draftState:changed});try{
  await switchTo(p,p.b.id);assert.ok(p.doc.querySelector('.profile-dialog'));await choose(p,choice);
  assert.equal(working(p).Job,choice==='取消'?original.Job:'KE');assert.equal(saved(p).profiles[0].loadout.values['Stage.BossDEF'],choice==='儲存並切換'?'50':original.values['Stage.BossDEF']);
  if(choice!=='取消'){assert.equal(p.storage.getItem('dab-baseline-v1'),null);assert.equal(p.doc.querySelector('#undo').disabled,true);assert.equal(p.doc.querySelector('#redo').disabled,true);}
 }finally{p.close();}
});
test('baseline-only changes are dirty and independent baselines restore A -> B -> A',async()=>{
 const p=await pageFor({baseline:other});try{assert.match(p.doc.querySelector('#profile-current').textContent,/未儲存/);await switchTo(p,p.b.id);await choose(p,'放棄修改並切換');assert.equal(p.storage.getItem('dab-baseline-v1'),null);await switchTo(p,p.a.id);assert.equal(JSON.parse(p.storage.getItem('dab-baseline-v1')).Job,original.Job);assert.match(p.doc.querySelector('#profile-current').textContent,/已儲存/);}finally{p.close();}
});
test('edits changed back become saved; save and rename do not add history steps',async()=>{
 const p=await pageFor();try{await enter(p,'Boss防禦','50');assert.match(p.doc.querySelector('#profile-current').textContent,/未儲存/);await click(p,'undo');assert.match(p.doc.querySelector('#profile-current').textContent,/已儲存/);const before=p.doc.querySelector('#undo').disabled;await click(p,'profile-save');assert.equal(p.doc.querySelector('#undo').disabled,before);}finally{p.close();}
});
test('save failure stops switching and preserves history, baseline and draft',async()=>{
 const p=await pageFor();try{await enter(p,'Boss防禦','50');const state=p.storage.getItem('dab-loadout-v1'),base=p.storage.getItem('dab-baseline-v1');const prototype=Object.getPrototypeOf(p.storage),set=prototype.setItem;prototype.setItem=function(k,v){if(k===profilesKey)throw Error('quota');return set.call(this,k,v);};
  await switchTo(p,p.b.id);await choose(p,'儲存並切換');assert.equal(p.storage.getItem('dab-loadout-v1'),state);assert.equal(p.storage.getItem('dab-baseline-v1'),base);assert.equal(p.doc.querySelector('#undo').disabled,false);assert.match(p.doc.querySelector('#profile-message').textContent,/無法保存/);
 }finally{p.close();}
});
test('delete active and final profiles keeps current workspace and baseline',async()=>{
 const p=await pageFor();try{const before=p.storage.getItem('dab-loadout-v1'),base=p.storage.getItem('dab-baseline-v1');manage(p,p.a.id);await click(p,'profile-delete');await choose(p,'確認刪除');assert.match(p.doc.querySelector('#profile-current').textContent,/未命名/);assert.equal(p.storage.getItem('dab-loadout-v1'),before);assert.equal(p.storage.getItem('dab-baseline-v1'),base);manage(p,p.b.id);await click(p,'profile-delete');await choose(p,'確認刪除');assert.equal(saved(p).profiles.length,0);}finally{p.close();}
});
test('reopening restores dirty draft and its association; missing profile detaches safely',async()=>{
 const p=await pageFor({draftState:other});try{assert.equal(working(p).Job,'KE');assert.match(p.doc.querySelector('#profile-current').textContent,/角色 A.*未儲存/);}finally{p.close();}
 const missing=await pageFor({draftState:other,extra:{[draftAssociationKey]:JSON.stringify({schemaVersion:1,profileId:'missing'})}});try{assert.equal(working(missing).Job,'KE');assert.match(missing.doc.querySelector('#profile-current').textContent,/未命名/);assert.equal(JSON.parse(missing.storage.getItem(draftAssociationKey)).profileId,null);}finally{missing.close();}
});
test('library cross-tab conflict is shown and target is not partially applied',async()=>{
 const p=await pageFor();try{const store=saved(p);store.profiles=store.profiles.filter(v=>v.id!==p.b.id);p.storage.setItem(profilesKey,JSON.stringify(store));await switchTo(p,p.b.id);assert.equal(working(p).Job,original.Job);assert.match(p.doc.querySelector('#profile-message').textContent,/更新/);}finally{p.close();}
});
test('sample mode disables every profile write control and preserves storage',async()=>{
 const p=await pageFor({sample:true});try{assert.ok([...p.doc.querySelectorAll('#profile-manager button')].every(b=>b.disabled));assert.equal(saved(p).profiles.length,2);assert.match(p.doc.querySelector('#profile-message').textContent,/範例/);}finally{p.close();}
});

test('numeric picker strings equal existing numeric fields without rewriting stored profile',async()=>{
 const p=await pageFor();try{await enter(p,'關卡適應力','50');await enter(p,'關卡適應力',String(original.values['Stage.Adapt']));assert.match(p.doc.querySelector('#profile-current').textContent,/已儲存/);assert.deepEqual(saved(p).profiles[0].loadout,original);}finally{p.close();}
});

test('restore preview can cancel, merge collision copies, and replace without loading the canvas',async()=>{
 const p=await pageFor();try{
  const before=p.storage.getItem('dab-loadout-v1'),base=p.storage.getItem('dab-baseline-v1');
  const formal=saved(p);
  for(const state of [formal.profiles[0].loadout,formal.profiles[0].baseline]){
    for(const field of ['Accessory.FaceBottom.Appraisal.1','Accessory.FaceBottom.Appraisal.2','Accessory.FaceBottom.Appraisal.3','Accessory.Ring1.Appraisal.1','Accessory.Ring1.Appraisal.2']) state.values[field]='無關傷害';
    state.values['Stage.Adapt']='0';
    state.values['Stage.CritRatePenalty']='';
  }
  const json=exportProfileBackup(formal);const input=p.doc.querySelector('#profile-backup-file');
  async function upload(){Object.defineProperty(input,'files',{configurable:true,value:[{size:json.length,text:async()=>json}]});input.dispatchEvent(new p.dom.window.Event('change'));await settle(p);}
  await upload();assert.ok(p.doc.querySelector('.profile-dialog'),p.doc.querySelector('#profile-message').textContent);assert.match(p.doc.querySelector('.profile-dialog').textContent,/2 筆/);await choose(p,'取消');assert.equal(saved(p).profiles.length,2);
  await upload();await choose(p,'合併匯入');assert.equal(saved(p).profiles.length,4);assert.equal(new Set(saved(p).profiles.map(p=>p.id)).size,4);
  await upload();await choose(p,'完整取代');assert.deepEqual(saved(p).profiles,formal.profiles);assert.equal(p.storage.getItem('dab-loadout-v1'),before);assert.equal(p.storage.getItem('dab-baseline-v1'),base);assert.match(p.doc.querySelector('#profile-current').textContent,/未命名/);
 }finally{p.close();}
});
test('malformed import and invalid current-game target preserve entire workspace and history',async()=>{
 const p=await pageFor();try{
  await enter(p,'關卡適應力','50');const before=p.storage.getItem('dab-loadout-v1'),base=p.storage.getItem('dab-baseline-v1'),store=p.storage.getItem(profilesKey);
  const input=p.doc.querySelector('#profile-backup-file');Object.defineProperty(input,'files',{value:[{size:1,text:async()=>'{'}]});input.dispatchEvent(new p.dom.window.Event('change'));await settle(p);
  assert.equal(p.storage.getItem(profilesKey),store);assert.match(p.doc.querySelector('#profile-message').textContent,/無效|有效/);
  const changed=saved(p);changed.profiles[1].loadout.values['Stage.BossDEF']='corrupted';p.storage.setItem(profilesKey,JSON.stringify(changed));p.dom.window.dispatchEvent(new p.dom.window.StorageEvent('storage',{key:profilesKey}));await switchTo(p,p.b.id);
  assert.match(p.doc.querySelector('#profile-message').textContent,/無效/);assert.equal(p.storage.getItem('dab-loadout-v1'),before);assert.equal(p.storage.getItem('dab-baseline-v1'),base);assert.equal(p.doc.querySelector('#undo').disabled,false);
 }finally{p.close();}
});
test('switch persistence failure preserves active association, working baseline and undo branch',async()=>{
 const p=await pageFor();try{
  await enter(p,'關卡適應力','50');const before=p.storage.getItem('dab-loadout-v1'),base=p.storage.getItem('dab-baseline-v1'),association=p.storage.getItem(draftAssociationKey);
  const proto=Object.getPrototypeOf(p.storage),set=proto.setItem;let once=true;proto.setItem=function(k,v){if(k===draftAssociationKey&&once){once=false;throw Error('quota');}return set.call(this,k,v);};
  await switchTo(p,p.b.id);await choose(p,'放棄修改並切換');assert.equal(p.storage.getItem('dab-loadout-v1'),before);assert.equal(p.storage.getItem('dab-baseline-v1'),base);assert.equal(p.storage.getItem(draftAssociationKey),association);assert.equal(p.doc.querySelector('#undo').disabled,false);assert.match(p.doc.querySelector('#profile-current').textContent,/角色 A/);
 }finally{p.close();}
});
test('cross-tab workspace change blocks autosave and explains how to preserve the local canvas',async()=>{
 const p=await pageFor();try{
  const before=p.storage.getItem(profilesKey);p.storage.setItem('dab-loadout-v1',JSON.stringify(other));p.dom.window.dispatchEvent(new p.dom.window.StorageEvent('storage',{key:'dab-loadout-v1'}));
  await enter(p,'關卡適應力','50');assert.equal(working(p).Job,'KE');assert.match(p.doc.querySelector('#profile-message').textContent,/其他分頁/);
  assert.equal(p.doc.querySelector('#profile-reload,#profile-takeover'),null);assert.match(p.doc.querySelector('#profile-message').textContent,/匯出.*重新整理/);assert.equal(working(p).values['Stage.Adapt'],other.values['Stage.Adapt']);assert.equal(p.storage.getItem(profilesKey),before);
 }finally{p.close();}
});
test('cancelled switch preserves undo/redo, successful switch blocks Ctrl+Z across characters',async()=>{
 const p=await pageFor();try{
  await enter(p,'關卡適應力','50');await switchTo(p,p.b.id);await choose(p,'取消');assert.equal(p.doc.querySelector('#undo').disabled,false);
  await switchTo(p,p.b.id);await choose(p,'放棄修改並切換');p.doc.body.dispatchEvent(new p.dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));assert.equal(working(p).Job,'KE');assert.equal(p.doc.querySelector('#undo').disabled,true);
 }finally{p.close();}
});
test('same-class loadouts and conditional settings switch without changing global battle environment',async()=>{
 const p=await pageFor();try{
  const store=saved(p);const target=store.profiles[1];target.loadout.Job=original.Job;target.loadout.lowerwearAlternativeEnabled=true;target.loadout.bossHealthCondition={enabled:true,comparison:'below',lowerwear:'lowerwearB'};target.loadout.masterBeastSpiritStoneColor='綠';target.loadout.petSkillAttackEnabled=false;
  p.storage.setItem(profilesKey,JSON.stringify(store));const defense=p.storage.getItem('damage-calculator.battle-defense.v1');p.dom.window.dispatchEvent(new p.dom.window.StorageEvent('storage',{key:profilesKey}));await switchTo(p,p.b.id);
  assert.deepEqual(working(p).bossHealthCondition,target.loadout.bossHealthCondition);assert.equal(working(p).masterBeastSpiritStoneColor,'綠');assert.equal(working(p).petSkillAttackEnabled,false);assert.equal(p.storage.getItem('damage-calculator.battle-defense.v1'),defense);
 }finally{p.close();}
});
test('unrelated deletion leaves active draft, baseline and history intact',async()=>{
 const p=await pageFor();try{await enter(p,'關卡適應力','50');const before=p.storage.getItem('dab-loadout-v1');manage(p,p.b.id);await click(p,'profile-delete');await choose(p,'確認刪除');assert.equal(p.storage.getItem('dab-loadout-v1'),before);assert.equal(p.doc.querySelector('#undo').disabled,false);assert.match(p.doc.querySelector('#profile-current').textContent,/角色 A.*未儲存/);}finally{p.close();}
});

test('dialog cancel returns keyboard focus after the triggering control is re-enabled',async()=>{
 const p=await pageFor();try{manage(p,p.a.id);const trigger=p.doc.querySelector('#profile-rename');trigger.focus();await click(p,'profile-rename');assert.equal(p.doc.activeElement,p.doc.querySelector('#profile-name'));p.doc.querySelector('.profile-dialog').dispatchEvent(new p.dom.window.Event('cancel',{cancelable:true}));await settle(p);assert.equal(trigger.disabled,false);assert.equal(p.doc.activeElement,trigger);}finally{p.close();}
});

for (const count of [0, 1]) test('exported library restores unchanged: ' + count + ' profile(s)', () => {
  const { lib, a, b } = libraryFixture();
  ok(lib.deleteProfile(b.id));
  if (count === 0) ok(lib.deleteProfile(a.id));
  const store = ok(lib.getStore());
  const backup = parseProfileBackup(exportProfileBackup(store));
  const target = libraryFixture();
  assert.deepEqual(ok(target.lib.restoreProfiles(backup, 'replace')).profiles, store.profiles);
});

test('failed full replacement restores the association and keeps working data', () => {
  const { lib, draft, map, storage, a } = libraryFixture();
  assert.equal(draft.write(other, original, a.id), true);
  const before = new Map(map);
  const backup = parseProfileBackup(exportProfileBackup(ok(lib.getStore())));
  const write = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === profilesKey) throw new DOMException('full', 'QuotaExceededError');
    return write(key, value);
  };
  assert.throws(() => draft.replaceLibrary(() => {
    const result = lib.restoreProfiles(backup, 'replace');
    if (!result.ok) throw Error(result.error.message);
  }), /空間不足/);
  assert.deepEqual(map, before);
  assert.equal(draft.profileId, a.id);
  assert.equal(draft.conflicted, false);
});

test('overflowing JSON number cannot turn into an absent baseline during validation', () => {
  const { lib, map } = libraryFixture();
  const before = new Map(map);
  const json = JSON.stringify({format:'damage-calculator-profiles',version:1,library:ok(lib.getStore())}).replace('"baseline":null','"baseline":1e999');
  assert.match(json, /1e999/);
  assert.throws(() => parseProfileBackup(json), /非有限/);
  assert.deepEqual(map, before);
});

import { exportNamedProfile } from '../dist/frontend/loadout-profiles.js';
import { encodeSingle, decodeSingle, parseArchiveJson } from '../dist/frontend/loadout-archive.js';
import { FIELD_ID_TO_CODE } from '../dist/frontend/field-ids.js';

test('unnamed profiles fill the smallest gap without renaming existing or overwriting duplicates', () => {
  const {lib} = libraryFixture();
  const created = ['', '  ', '', ''].map(name => ok(lib.createProfile(name, original)));
  assert.deepEqual(created.map(p => p.name), ['未命名','未命名1','未命名2','未命名3']);
  ok(lib.deleteProfile(created[2].id));
  assert.equal(ok(lib.renameProfile(created[3].id, ' ')).name, '未命名2');
  assert.equal(ok(lib.saveProfile(created[1].id, other)).name, '未命名1');
  assert.equal(lib.createProfile('未命名',original).error.code,'duplicate-name');
});

test('shared archive preserves types, omitted fields, baseline deltas and independent records', () => {
  const {lib} = libraryFixture();
  const store = ok(lib.getStore());
  const a = store.profiles[0];
  a.loadout.values['Stage.Adapt'] = 0;
  a.loadout.values['Stage.CritRatePenalty'] = '5';
  a.loadout.values['Accessory.FaceBottom.Appraisal.1'] = '無關傷害';
  delete a.loadout.values['Accessory.FaceBottom.Appraisal.2'];
  a.baseline = structuredClone(a.loadout);
  a.baseline.values['Stage.Adapt'] = '0';
  a.baseline.values['Stage.CritRatePenalty'] = 5;
  a.baseline.values['Accessory.FaceBottom.Appraisal.2'] = '無關傷害';
  delete a.baseline.values['Accessory.FaceBottom.Appraisal.1'];
  const b = store.profiles[1];
  b.loadout = {...a.loadout, values:Object.fromEntries(Object.entries(a.loadout.values).reverse())};
  b.baseline = null;
  const archive = JSON.parse(exportProfileBackup(store));
  assert.equal(archive.snapshots.length, 2);
  assert.equal(archive.snapshots[1].base, 0);
  assert.deepEqual(parseProfileBackup(JSON.stringify(archive)), store);
  const restored = parseProfileBackup(JSON.stringify(archive));
  restored.profiles[0].loadout.values['Stage.Adapt'] = 90;
  assert.equal(restored.profiles[1].loadout.values['Stage.Adapt'], 0);
  assert.deepEqual(decodeSingle(JSON.parse(encodeSingle(a.loadout))), a.loadout);
  assert.deepEqual(parseProfileBackup(exportNamedProfile(a)).profiles, [a]);
  delete a.baseline;
  assert.equal(Object.hasOwn(parseProfileBackup(exportNamedProfile(a)).profiles[0], 'baseline'), false);
});

for (const [message, corrupt] of [
  ['container version', a => a.version++],
  ['field mapping version', a => a.fieldMapVersion++],
  ['value encoding version', a => a.valueCodecVersion++],
  ['unknown field ID', a => a.snapshots[0].values['999999'] = 0],
  ['invalid dictionary reference', a => a.snapshots[0].values['1'] = [a.strings.length]],
  ['duplicate dictionary entry', a => a.strings.push(a.strings[0])],
  ['invalid snapshot reference', a => a.profiles[0].loadout = -1],
  ['duplicate profile ID', a => a.profiles[1].id = a.profiles[0].id],
  ['duplicate profile name', a => a.profiles[1].name = a.profiles[0].name],
]) test('reject damaged archive: ' + message, () => {
  const {lib, map} = libraryFixture(), before = new Map(map);
  const archive = JSON.parse(exportProfileBackup(ok(lib.getStore())));
  corrupt(archive);
  assert.throws(() => parseProfileBackup(JSON.stringify(archive)));
  assert.deepEqual(map, before);
});

test('unsafe numbers are rejected before copying or stringifying the input', () => {
  for (const value of ['1e999','-1e999','9007199254740992','NaN','Infinity'])
    assert.throws(() => parseArchiveJson('{"value":'+value+'}'));
  assert.equal(parseArchiveJson('{"value":"0.002"}').value, '0.002');
});

test('explicit unrelated appraisals survive legacy decode, restart and a second export; absent fields stay absent', async () => {
  const keys = ['Accessory.FaceBottom.Appraisal.1','Accessory.FaceBottom.Appraisal.2','Accessory.FaceBottom.Appraisal.3','Accessory.Ring1.Appraisal.1','Accessory.Ring1.Appraisal.2'];
  const { gameData } = await import('./loadout-evaluation-harness.mjs');
  const p = await pageFor();
  let reopened;
  try {
    const transfer = await p.runtime.load('frontend/loadout-transfer.ts');
    const json = JSON.parse(transfer.serializeLoadout(original,gameData).json);
    for (const key of keys) json.values[FIELD_ID_TO_CODE[key]] = '無關傷害';
    await p.importJson(JSON.stringify(json));
    reopened = await pageFor({draftState:working(p)});
    const restored = decodeSingle(await reopened.exportJson());
    for (const key of keys) assert.equal(restored.values[key], '無關傷害');
    assert.doesNotMatch(reopened.doc.querySelector('#transfer-status').textContent,/鑑定選項/);
    delete json.values[FIELD_ID_TO_CODE[keys[0]]];
    json.values[FIELD_ID_TO_CODE[keys[1]]] = '非法鑑定值';
    await p.importJson(JSON.stringify(json));
    assert.equal(Object.hasOwn(working(p).values,keys[0]),false);
    assert.match(p.doc.querySelector('#transfer-status').textContent,/已留空/);
  } finally { reopened?.close(); p.close(); }
});

test('import as a new profile preserves existing draft, baseline, history and association', async () => {
  const p = await pageFor();
  try {
    const before = [...['dab-loadout-v1','dab-baseline-v1',draftAssociationKey]].map(k=>p.storage.getItem(k));
    const from = {...p.b, name:'匯入的角色', baseline:original};
    const input=p.doc.querySelector('#loadout-file');
    Object.defineProperty(input,'files',{value:[{text:async()=>exportNamedProfile(from)}]});
    input.dispatchEvent(new p.dom.window.Event('change'));
    for (const label of ['新增為正式配置','新增']) {
      let button;
      for (let attempt = 0; attempt < 200 && !button; attempt++) {
        await flush();
        button = [...p.doc.querySelectorAll('dialog button')].find(b => b.textContent === label);
      }
      assert.ok(button, p.doc.querySelector('#transfer-status').textContent);
      button.click();
    }
    await flush();
    const created = saved(p).profiles.at(-1);
    assert.equal(created.name,from.name); assert.notEqual(created.id,from.id);
    assert.deepEqual(created.loadout,from.loadout); assert.deepEqual(created.baseline,from.baseline);
    assert.deepEqual(['dab-loadout-v1','dab-baseline-v1',draftAssociationKey].map(k=>p.storage.getItem(k)),before);
    assert.equal(p.doc.querySelector('#undo').disabled,true);
  } finally {p.close();}
});

test('collapse preserves draft and baseline and reopens according to the saved preference', async () => {
  const p = await pageFor();
  try {
    const panel = p.doc.querySelector('#profile-manager');
    assert.equal(panel.tagName, 'DETAILS');
    assert.equal(panel.querySelector(':scope > summary h2').textContent, '我的角色與配裝');
    const before = [...['dab-loadout-v1','dab-baseline-v1',profilesKey]].map(k => p.storage.getItem(k));
    panel.open = false;
    panel.dispatchEvent(new p.dom.window.Event('toggle'));
    assert.equal(JSON.parse(p.storage.getItem('damage-calculator.disclosures.v1'))['loadout-profiles'],false);
    assert.deepEqual(['dab-loadout-v1','dab-baseline-v1',profilesKey].map(k => p.storage.getItem(k)),before);
    const second = await pageFor({extra:{'damage-calculator.disclosures.v1':p.storage.getItem('damage-calculator.disclosures.v1')}});
    try { assert.equal(second.doc.querySelector('#profile-manager').open,false); }
    finally {second.close();}
  } finally {p.close();}
});

test('failed canvas import preserves the workbook, association and history before repaint', async () => {
  const p = await pageFor();
  try {
    const before = [profilesKey,'dab-loadout-v1','dab-baseline-v1',draftAssociationKey].map(k=>p.storage.getItem(k));
    const json = encodeSingle(other);
    const proto = Object.getPrototypeOf(p.storage), set = proto.setItem;
    proto.setItem = function(k,v) {
      if (k === draftJournalKey) throw new DOMException('full','QuotaExceededError');
      return set.call(this,k,v);
    };
    const input = p.doc.querySelector('#loadout-file');
    Object.defineProperty(input,'files',{value:[{text:async()=>json}]});
    input.dispatchEvent(new p.dom.window.Event('change'));
    for (let i=0;i<200&&!p.doc.querySelector('dialog');i++) await flush();
    await choose(p,'套用至畫布');
    assert.match(p.doc.querySelector('#transfer-status').textContent,/匯入失敗/);
    assert.deepEqual([profilesKey,'dab-loadout-v1','dab-baseline-v1',draftAssociationKey].map(k=>p.storage.getItem(k)),before);
    assert.equal(p.doc.querySelector('#undo').disabled,true);
  } finally {p.close();}
});

test('saving an active character from a stale working tab leaves both saved versions intact', async () => {
  const p = await pageFor();
  try {
    const library = p.storage.getItem(profilesKey);
    const incoming = JSON.stringify(other);
    p.storage.setItem('dab-loadout-v1',incoming);
    await click(p,'profile-save');
    assert.match(p.doc.querySelector('#profile-message').textContent,/其他分頁/);
    assert.equal(p.storage.getItem(profilesKey),library);
    assert.equal(p.storage.getItem('dab-loadout-v1'),incoming);
  } finally {p.close();}
});

test('empty library offers direct save and creates one selected, automatically named chip', async () => {
  const p = await pageFor({linked:false, extra:{[profilesKey]:JSON.stringify({schemaVersion:1,profiles:[],activeProfileId:null})}});
  try {
    assert.equal(chips(p).length, 0);
    assert.match(p.doc.querySelector('.profile-empty').textContent, /尚無/);
    assert.equal(p.doc.querySelector('#profile-manager select'), null);
    await click(p, 'profile-save');
    await choose(p, '儲存');
    assert.deepEqual(chips(p).map(button => button.textContent), ['未命名']);
    assert.equal(activeChip(p).dataset.profileId, saved(p).profiles[0].id);
    assert.equal(p.doc.querySelector('.profile-empty').hidden, true);
  } finally { p.close(); }
});

test('profile manager orders actions, plain saved names and the management accordion', async () => {
  const page = await pageFor();
  try {
    const panel = page.doc.querySelector('#profile-manager');
    const actions = [...panel.querySelectorAll('.profile-actions button')];
    assert.deepEqual(actions.map(button => button.textContent), ['儲存', '另存為新配置', '上傳配置備份']);
    const management = panel.querySelector('#profile-manage');
    assert.equal(management.tagName, 'BUTTON');
    assert.equal(management.textContent, '管理已儲存配置');
    assert.equal(panel.querySelector('h3'), null);
    const firstChip = chips(page)[0];
    const { DOCUMENT_POSITION_FOLLOWING } = page.dom.window.Node;
    assert.ok(actions.at(-1).compareDocumentPosition(firstChip) & DOCUMENT_POSITION_FOLLOWING);
    assert.ok(firstChip.compareDocumentPosition(management) & DOCUMENT_POSITION_FOLLOWING);
    const pressed = activeChip(page);
    assert.equal(pressed.dataset.profileId, page.a.id);
    assert.equal(pressed.getAttribute('aria-pressed'), 'true');
    for (const chip of panel.querySelectorAll('.profile-chip')) {
      assert.equal(chip.children.length, 1);
      assert.ok(chip.firstElementChild.matches('.profile-chip-label'));
      assert.equal(chip.textContent, chip.title);
    }
    const body = panel.querySelector('#profile-management');
    assert.equal(body.previousElementSibling, management);
    assert.equal(body.getAttribute('aria-labelledby'), management.id);
    assert.equal(management.getAttribute('aria-controls'), body.id);
    assert.equal(management.querySelector('.profile-manage-arrow').getAttribute('aria-hidden'), 'true');
    assert.equal(management.getAttribute('aria-expanded'), 'false');
    assert.equal(body.hidden, true);
    management.click();
    assert.equal(management.getAttribute('aria-expanded'), 'true');
    assert.equal(body.hidden, false);
    assert.equal(page.doc.activeElement.dataset.manageId, page.a.id);
    management.click();
    assert.equal(management.getAttribute('aria-expanded'), 'false');
    assert.equal(body.hidden, true);
    assert.equal(page.doc.activeElement, management);
  } finally { page.close(); }
});

test('management accordion keeps page-local state and restores focus after Escape', async () => {
  const page = await pageFor();
  try {
    const panel = page.doc.querySelector('#profile-manager');
    const summary = panel.querySelector('summary');
    const header = panel.querySelector('#profile-manage');
    const region = panel.querySelector('#profile-management');
    const keys = [profilesKey, 'dab-loadout-v1', 'dab-baseline-v1', draftAssociationKey];
    const before = keys.map(key => page.storage.getItem(key));

    header.click();
    summary.click();
    assert.equal(panel.open, false);
    assert.equal(header.getAttribute('aria-expanded'), 'true');
    summary.click();
    assert.equal(panel.open, true);
    assert.equal(region.hidden, false);

    const action = region.querySelector('#profile-rename');
    action.focus();
    action.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert.equal(region.hidden, true);
    assert.equal(page.doc.activeElement, header);
    assert.deepEqual(keys.map(key => page.storage.getItem(key)), before);

    header.click();
    const reloaded = await pageFor({extra:{
      'damage-calculator.disclosures.v1': page.storage.getItem('damage-calculator.disclosures.v1'),
    }});
    try {
      assert.equal(reloaded.doc.querySelector('#profile-manager').open, true);
      assert.equal(reloaded.doc.querySelector('#profile-management').hidden, true);
    } finally { reloaded.close(); }
  } finally { page.close(); }
});

test('opened management accordion exports the selected profile and the complete library', async () => {
  const page = await pageFor();
  try {
    const names = [];
    page.dom.window.HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
    manage(page, page.b.id);
    await click(page, 'profile-export');
    assert.equal(activeChip(page).dataset.profileId, page.a.id);
    await click(page, 'profile-backup');
    assert.equal(names.length, 2);
    assert.match(names[0], /^damage-calculator-profile-\d{4}-/);
    assert.match(names[1], /^damage-calculator-profiles-\d{4}-/);
  } finally { page.close(); }
});

test('chip navigation renders 30 named profiles in store order with a unique active button', async () => {
  const {lib, a, b} = libraryFixture();
  const profiles = ok(lib.getStore()).profiles;
  const fullName = '長名稱'.repeat(13) + '甲';
  ok(lib.renameProfile(b.id, fullName));
  for (let i = 0; i < 28; i++) ok(lib.createProfile('配置 ' + i, original, original));
  const bank = ok(lib.getStore());
  const p = await pageFor({extra:{[profilesKey]:JSON.stringify(bank),[draftAssociationKey]:JSON.stringify({schemaVersion:1,profileId:a.id})}});
  try {
    const buttons = chips(p);
    assert.equal(buttons.length, 30);
    assert.deepEqual(buttons.map(chip => chip.textContent), bank.profiles.map(profile => profile.name));
    assert.equal(buttons[0].textContent, profiles[0].name);
    assert.equal(buttons[1].title, fullName);
    assert.equal(buttons[1].querySelector('.profile-chip-label').textContent, fullName);
    assert.ok(buttons.every(button => button.tagName === 'BUTTON' && button.tabIndex === 0 && !button.disabled));
    assert.equal(activeChip(p), buttons[0]);

    const last = bank.profiles.at(-1);
    await switchTo(p, last.id);
    assert.equal(activeChip(p).dataset.profileId, last.id);
    assert.equal(chips(p).filter(button => button.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(p.doc.activeElement, buttons.at(-1));

    const panel = p.doc.querySelector('#profile-manager');
    panel.querySelector('summary').click();
    assert.equal(panel.open, false);
    panel.querySelector('summary').click();
    assert.equal(panel.open, true);
    assert.equal(activeChip(p).dataset.profileId, last.id);

    const reopened = await pageFor({draftState:working(p), extra:{
      [profilesKey]:p.storage.getItem(profilesKey), [draftAssociationKey]:p.storage.getItem(draftAssociationKey),
    }});
    try { assert.equal(activeChip(reopened).dataset.profileId, last.id); }
    finally { reopened.close(); }
  } finally { p.close(); }
});

test('cancelled or rejected chip switch preserves the selected profile and returns focus to the activated button', async () => {
  const p = await pageFor({draftState:other});
  try {
    await switchTo(p, p.b.id);
    assert.equal(activeChip(p).dataset.profileId, p.a.id);
    await choose(p, '取消');
    assert.equal(activeChip(p).dataset.profileId, p.a.id);
    assert.equal(p.doc.activeElement.dataset.profileId, p.b.id);

    const store = saved(p);
    store.profiles[1].loadout.values['Stage.BossDEF'] = 'corrupted';
    p.storage.setItem(profilesKey,JSON.stringify(store));
    p.dom.window.dispatchEvent(new p.dom.window.StorageEvent('storage',{key:profilesKey}));
    await switchTo(p, p.b.id);
    assert.equal(activeChip(p).dataset.profileId, p.a.id);
    assert.equal(p.doc.activeElement.dataset.profileId, p.b.id);
    assert.match(p.doc.querySelector('#profile-message').textContent, /無效/);
  } finally { p.close(); }
});

test('management targets a saved profile without switching and refreshes chips after each change', async () => {
  const p = await pageFor();
  try {
    manage(p,p.b.id);
    assert.equal(activeChip(p).dataset.profileId,p.a.id);
    await click(p,'profile-rename');
    name(p,p.a.name);
    await choose(p,'確認');
    assert.ok(p.doc.querySelector('.profile-dialog [role="alert"]').textContent);
    assert.equal(chips(p)[1].textContent,p.b.name);
    name(p,'已重新命名');
    await choose(p,'確認');
    assert.equal(chips(p)[1].textContent,'已重新命名');
    await click(p,'profile-delete');
    await choose(p,'確認刪除');
    assert.deepEqual(chips(p).map(button => button.dataset.profileId),[p.a.id]);

    await click(p,'profile-save-as');
    await choose(p,'儲存');
    assert.equal(chips(p)[1].textContent,'未命名');
    assert.equal(activeChip(p),chips(p)[1]);
    const stableId = activeChip(p).dataset.profileId;
    await click(p,'profile-save');
    assert.equal(chips(p).length,2);
    assert.equal(activeChip(p).dataset.profileId,stableId);
  } finally { p.close(); }
});

test('safe cross-tab refresh updates a renamed chip and preserves its focus, conflicts retain current selection', async () => {
  const p = await pageFor();
  try {
    chips(p)[1].focus();
    const updated = saved(p);
    updated.profiles[1].name = '其他分頁另存名稱';
    p.storage.setItem(profilesKey,JSON.stringify(updated));
    p.dom.window.dispatchEvent(new p.dom.window.StorageEvent('storage',{key:profilesKey}));
    assert.equal(chips(p)[1].textContent,updated.profiles[1].name);
    assert.equal(p.doc.activeElement,chips(p)[1]);

    updated.profiles[0].name = '其他分頁修改目前配置';
    p.storage.setItem(profilesKey,JSON.stringify(updated));
    p.dom.window.dispatchEvent(new p.dom.window.StorageEvent('storage',{key:profilesKey}));
    await switchTo(p,p.b.id);
    assert.equal(activeChip(p).dataset.profileId,p.a.id);
    assert.equal(activeChip(p).textContent,p.a.name);
    assert.match(p.doc.querySelector('#profile-message').textContent,/其他分頁/);
  } finally { p.close(); }
});
