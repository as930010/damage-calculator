import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LoadoutProfiles, profilesKey, parseProfileStore, isProfileDirty } from '../dist/frontend/loadout-profiles.js';
import { parseState } from '../dist/frontend/state.js';
import { LoadoutHistory } from '../dist/frontend/history.js';
const original = parseState(await readFile(new URL('../data/examples/public-example-2026-09-28.json', import.meta.url),'utf8'));
const ok = result => { assert.equal(result.ok,true, result.error?.message); return result.value; };
function setup() {
  const map = new Map([['dab-loadout-v1','draft'],['dab-baseline-v1','baseline'],['buff-team-simulator.state.v1','team']]);
  const storage = {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const manager = new LoadoutProfiles(()=>storage);
  ok(manager.reload());
  return {map,storage,manager};
}
test('initial library is empty and has no startup persistence or legacy migration',()=>{
  const {manager,map}=setup();assert.deepEqual(ok(manager.getStore()),{schemaVersion:1,profiles:[],activeProfileId:null});assert.equal(map.has(profilesKey),false);
  assert.equal(map.get('dab-loadout-v1'),'draft');assert.equal(map.get('dab-baseline-v1'),'baseline');
});
test('complete state and baseline round-trip with independent profiles for multiple jobs',()=>{
  const {manager,storage}=setup();
  for(const Job of ['DaB','TB','LA','DN']){
    const state=structuredClone(original);state.Job=Job;
    state.bossHealthCondition={enabled:true,comparison:'below',lowerwear:'lowerwearB'};
    state.classSkillVersions={'FP.FatalShotConverted':false,'DN.FieldPowerConverted':Job==='DN'};
    state.lowerwearAlternativeEnabled=true;state.petSkillAttackEnabled=false;state.nephronRaidEnabled=true;
    state.nutProtectionPotionEnabled=true;state.masterBeastSpiritStoneColor='綠';
    state.values['Stage.BossDEF']='';
    const profile=ok(manager.createProfile(Job,state,state));
    assert.deepEqual(profile.loadout,state);assert.deepEqual(profile.baseline,state);
    state.values['Stage.BossDEF']='1';assert.equal(ok(manager.getProfile(profile.id)).loadout.values['Stage.BossDEF'],'');
  }
  const restored=new LoadoutProfiles(()=>storage);assert.deepEqual(ok(restored.reload()),ok(manager.getStore()));
  const full=ok(manager.getStore());assert.ok(Object.keys(full.profiles[0].loadout.values).length>100);
});
test('explicit unrelated choices and blank registered fields survive internal snapshots',async()=>{
  const {manager}=setup();const data=JSON.parse(await readFile(new URL('../dist/data/game-data.json',import.meta.url),'utf8'));
  const state=structuredClone(original);
  for(const armor of data.nephronArmor.fields) for(const field of armor.transformFields){state.values[field.attributeField]='無關傷害';state.values[field.valueField]='';}
  const p=ok(manager.createProfile('空白與無關傷害',state));assert.deepEqual(ok(manager.getProfile(p.id)).loadout,state);
});
test('rename validates trimmed Unicode length, duplicates and stable identity',()=>{
  const {manager}=setup();const a=ok(manager.createProfile(' A ',original));const b=ok(manager.createProfile('B',original));
  for(const name of ['字'.repeat(41), 'B']){assert.equal(manager.renameProfile(a.id,name).ok,false);assert.equal(ok(manager.getProfile(a.id)).name,'A');}
  const renamed=ok(manager.renameProfile(a.id,' 🌳'.trim().repeat(40)));
  assert.equal(renamed.id,a.id);assert.deepEqual(renamed.loadout,a.loadout);assert.equal(renamed.createdAt,a.createdAt);assert.deepEqual(ok(manager.getProfile(b.id)),b);
});
test('duplicate copies saved state and baseline with unique bounded names and deep isolation',()=>{
  const {manager}=setup();const a=ok(manager.createProfile('字'.repeat(40),original,original));
  const b=ok(manager.duplicateProfile(a.id)),c=ok(manager.duplicateProfile(a.id));
  assert.notEqual(a.id,b.id);assert.notEqual(b.name,c.name);assert.ok(Array.from(b.name).length<=40);assert.match(c.name,/副本 2/);
  assert.deepEqual(b.loadout,a.loadout);assert.deepEqual(b.baseline,a.baseline);
  b.loadout.values['Stage.BossDEF']=0;b.baseline.values['Stage.BossDEF']=0;
  ok(manager.saveProfile(b.id,b.loadout,b.baseline));assert.deepEqual(ok(manager.getProfile(a.id)),a);
});
test('save targets one profile, retains metadata and defines explicit baseline removal',()=>{
  const {manager}=setup();const a=ok(manager.createProfile('A',original,original)),b=ok(manager.createProfile('B',original));
  const current=structuredClone(original);current.values['Stage.BossDEF']=0;
  const updated=ok(manager.saveProfile(a.id,current));assert.equal(updated.name,a.name);assert.equal(updated.createdAt,a.createdAt);assert.deepEqual(updated.baseline,original);assert.deepEqual(ok(manager.getProfile(b.id)),b);
  assert.equal(ok(manager.saveProfile(a.id,current,null)).baseline,null);
  updated.loadout.values['Stage.BossDEF']=100;assert.equal(ok(manager.getProfile(a.id)).loadout.values['Stage.BossDEF'],0);
});
test('deleting associated and last profiles clears association and preserves draft and history',()=>{
  const {manager,storage,map}=setup();const history=new LoadoutHistory(original);const changed=structuredClone(original);changed.Job='TB';history.record(changed);
  const a=ok(manager.createProfile('A',original)),b=ok(manager.createProfile('B',original));const saved=ok(manager.getStore());saved.activeProfileId=a.id;storage.setItem(profilesKey,JSON.stringify(saved));ok(manager.reload());
  ok(manager.deleteProfile(b.id));ok(manager.deleteProfile(a.id));assert.deepEqual(ok(manager.getStore()),{schemaVersion:1,profiles:[],activeProfileId:null});
  assert.equal(map.get('dab-loadout-v1'),'draft');assert.equal(map.get('dab-baseline-v1'),'baseline');assert.equal(map.get('buff-team-simulator.state.v1'),'team');assert.deepEqual(history.undo(),original);assert.deepEqual(history.redo(),changed);
  assert.equal(manager.deleteProfile('missing').error.code,'not-found');assert.equal(manager.getProfile('missing').error.code,'not-found');
});
test('dirty comparison ignores key order but detects every state property and baseline',()=>{
  const {manager}=setup();const p=ok(manager.createProfile('A',original,original));const reversed=Object.fromEntries(Object.entries(original).reverse());reversed.values=Object.fromEntries(Object.entries(original.values).reverse());assert.equal(isProfileDirty(p,reversed,original),false);
  const other=structuredClone(original);other.values['Stage.BossDEF']=0;assert.equal(isProfileDirty(p,other),true);assert.equal(isProfileDirty(p,original,other),true);assert.equal(isProfileDirty(p,original,null),true);assert.equal(isProfileDirty(p,original),true);
  for(const key of ['lowerwearAlternativeEnabled','petSkillAttackEnabled','nephronRaidEnabled','nutProtectionPotionEnabled']){const changed=structuredClone(original);changed[key]=!changed[key];assert.equal(isProfileDirty(p,changed),true);}
});
for(const action of ['createProfile','renameProfile','duplicateProfile','deleteProfile','saveProfile'])test(action+' storage failure preserves previous memory and persisted contents',()=>{
  const {manager,storage,map}=setup();const a=ok(manager.createProfile('A',original));const before=ok(manager.getStore()),raw=map.get(profilesKey);
  storage.setItem=()=>{const error=new Error('Full');error.name='QuotaExceededError';throw error;};
  const args={createProfile:['B',original],renameProfile:[a.id,'B'],duplicateProfile:[a.id],deleteProfile:[a.id],saveProfile:[a.id,original,null]};
  const result=manager[action](...args[action]);assert.equal(result.error.code,'quota-exceeded');assert.deepEqual(ok(manager.getStore()),before);assert.equal(map.get(profilesKey),raw);
});
test('invalid JSON, schema, duplicates and incomplete states are reported without overwriting data',()=>{
  const {manager,map,storage}=setup();const a=ok(manager.createProfile('A',original));const valid=ok(manager.getStore());
  for(const raw of ['{',JSON.stringify({...valid,schemaVersion:2}),JSON.stringify({...valid,profiles:[a,a]}),JSON.stringify({...valid,activeProfileId:'missing'}),JSON.stringify({...valid,profiles:[{...a,loadout:{schemaVersion:3,Job:'TB',values:{}}}]})]){map.set(profilesKey,raw);assert.equal(new LoadoutProfiles(()=>storage).reload().ok,false);assert.equal(map.get(profilesKey),raw);}
  for(const value of [NaN,Infinity,null,{},true]){const state=structuredClone(original);state.values['Stage.BossDEF']=value;assert.equal(manager.createProfile('invalid',state).ok,false);}
});
test('unavailable storage and sample read-only manager return explicit errors',()=>{
  const blocked=new LoadoutProfiles(()=>{throw Error('Blocked');});assert.equal(blocked.reload().error.code,'read-failed');assert.equal(blocked.createProfile('A',original).error.code,'not-loaded');
  const {storage,map}=setup();const sample=new LoadoutProfiles(()=>storage,true);ok(sample.reload());assert.equal(sample.createProfile('sample',original).error.code,'read-only');assert.equal(map.has(profilesKey),false);
});
test('stale tabs and writes interleaving with persistence report conflicts without blind retry',()=>{
  const {manager,storage,map}=setup();const second=new LoadoutProfiles(()=>storage);ok(second.reload());ok(manager.createProfile('A',original));assert.equal(second.createProfile('B',original).error.code,'conflict');assert.equal(ok(second.getStore()).profiles.length,0);
  ok(second.reload());ok(second.createProfile('B',original));assert.equal(manager.renameProfile(ok(manager.getStore()).profiles[0].id,'X').error.code,'conflict');
  ok(manager.reload());const before=ok(manager.getStore());const external=JSON.stringify({...before,activeProfileId:before.profiles[0].id});storage.setItem=()=>map.set(profilesKey,external);assert.equal(manager.createProfile('C',original).error.code,'conflict');assert.deepEqual(ok(manager.getStore()),before);
});
