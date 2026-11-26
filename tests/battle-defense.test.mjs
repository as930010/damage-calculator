import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { combineDefenseRates, combineExternalSources, parseDefensePercentage, isDefensePercentageDraft } from '../dist/calculation/battle-defense.js';
import { calculateFinalDamage } from '../dist/calculation/final-damage.js';
import { finalDamageInputs } from '../dist/calculation/loadout-engine.js';
import { defaultBattleDefense, parseBattleDefense, externalDefenseRate, createBattleDefenseStore, BATTLE_DEFENSE_KEY, teamRevision, teamSnapshotUpdateReason, teamDefenseIgnoreAdditive, replaceTeamDefenseSource, findTeamDefenseSource } from '../dist/frontend/battle-defense-state.js';
import { teamDefenseReferences, loadTeamDefenseDataRevision, loadTeamDefenseReferences } from '../dist/frontend/team-defense-reference.js';
import { parseCoreCatalog } from '../dist/features/buff-simulator/frontend/data-loader.js';
import { parseSavedSimulatorState, resolveSavedMembers, resolveSavedOptions } from '../dist/features/buff-simulator/frontend/saved-state.js';
import { calculateChallenge, calculateTeam } from '../dist/features/buff-simulator/calculation/engine.js';
import { projectBeneficiaryDamage } from '../dist/frontend/beneficiary-defense.js';
import { projectDamage, evaluateLoadout } from '../dist/frontend/projection.js';
import { createBaselineEvaluationCache } from '../dist/frontend/baseline-evaluation.js';
import { readRatingLoadout, readArmorRatingLoadout } from '../dist/features/transformation-score/loadout.js';
import { scoreConfiguration } from '../dist/features/transformation-score/scoring.js';
const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const data = json('../dist/data/game-data.json'), state = json('../data/examples/public-example-2026-09-28.json');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-11 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const catalog = parseCoreCatalog(Object.fromEntries(Object.entries({ classes:'classes', classEffects:'class-effects', effectTypes:'effect-types', loadoutOptions:'loadout-options', calculationParameters:'calculation-parameters' }).map(([key,name])=>[key,json('../features/buff-simulator/data/'+name+'.json')])));
const manualSource = (id, percentage, name = '') => ({ kind:'manual', id, name, percentage });
const legacyEnvironment = (mode, sources, teamSnapshot = null) => ({ schemaVersion:1, mode, manualPercentage:'10', sources, teamSnapshot });
const testSnapshot = (rate, extra = {}) => ({ mode:'single', target:'single', rate, sources:['confirmed'], sourceRevision:'test', dataRevision:'test', importedAt:'2026-11-07', ...extra });
const savedTeam = (mode = 'single') => ({ version:1, mode, membersByTeam:{single:['KE','KE','RM'],first:['KE','RM'],second:['KE','BL']}, optionsByTeam:{single:{},first:{},second:{}}, bossReductions:{single:.7192,challenge:.7192}, optionDisclosureOpen:{} });

test('Exact equipment-sum/external-product examples A/B/C', () => {
  const external = combineExternalSources([.48,.5,.5,.2]); close(external,.896);
  const before = combineDefenseRates((5+1.5+1.2)/100, external), after = combineDefenseRates((5+1.5+1.2+1.5)/100, external);
  close(before,.904008); close(after,.905568);
  const factorBefore=1/(1-.7192*before),factorAfter=1/(1-.7192*after);
  close((factorAfter/factorBefore-1)*100,.32173849972754187);
});
test('Rates reject invalid values without silently clamping equipment totals', () => {
  for (const value of [NaN,Infinity,-.01,1.01]) { assert.throws(()=>combineDefenseRates(value,.5)); assert.throws(()=>combineExternalSources([value])); }
  assert.equal(combineDefenseRates(.077,0),.077); assert.equal(combineDefenseRates(0,1),1); assert.equal(combineExternalSources([]),0);
});

test('Full defense handles 0/100 percent and rejects singular denominators without Infinity', () => {
  const evaluated=evaluateLoadout(data,state,false,true),input=finalDamageInputs(evaluated.comparisonInput,evaluated.damage.result);
  const full=calculateFinalDamage({...input,externalDefenseBreakRate:1});close(full.defenseFactor,1/(1-input.enemyDefensePct/100));
  assert.equal(calculateFinalDamage({...input,enemyDefensePct:0,externalDefenseBreakRate:1}).defenseFactor,1);
  assert.throws(()=>calculateFinalDamage({...input,enemyDefensePct:100,externalDefenseBreakRate:1}),/denominator is zero/);
  assert.throws(()=>calculateFinalDamage({...input,defenseIgnorePct:101}),/裝備無視防禦/);
});
test('Decimal input drafts reject blank, exponent notation and illegal characters', () => {
  for(const raw of['','-1','100.1','NaN','Infinity','1e1','2x','89.6%','1.','0.123456789'])assert.equal(parseDefensePercentage(raw),null,raw);
  for(const [raw,value] of [['0',0],['100',1],['89.6',.896],['.5',.005],['0.12345678',.0012345678]])close(parseDefensePercentage(raw),value);
});
test('Percentage editing accepts decimal drafts and blocks non-numeric, negative and out-of-range edits', () => {
  for(const raw of['','.','0','89.','89.6','.5','100','100.00000000']) assert.equal(isDefensePercentageDraft(raw),true,raw);
  for(const raw of['-1','+1','100.1','101','1e2','NaN','Infinity','中文','abc','48%','4..8',' 48','48\n','0.123456789']) assert.equal(isDefensePercentageDraft(raw),false,raw);
});

test('Direct input and itemized sources are equivalent while inactive drafts never stack', () => {
  const value = { ...defaultBattleDefense(), manualPercentage:'89.6', sources:[48,50,50,20].map((n,i)=>manualSource(String(i),String(n))) };
  for (const mode of ['manual','sources']) close(externalDefenseRate({...value,mode}),.896);
  assert.equal(externalDefenseRate({...value,mode:'manual',manualPercentage:''}),0);
  assert.throws(()=>externalDefenseRate({...value,mode:'manual',manualPercentage:'1e2'}),/十進位/);
});
test('A single team snapshot multiplies with manual rows at full precision and replacement keeps its identity', () => {
  const manual = manualSource('a','20');
  const value = { ...defaultBattleDefense(), mode:'sources', sources:[manual,manualSource('blank','')] };
  const snapshot = testSnapshot(.15, { sources:['職業：VI','配置效果：風球'], sourceIds:['vi','wind'] });
  const active = { ...value, sources:replaceTeamDefenseSource(value,snapshot) };
  close(externalDefenseRate(active),.32);
  const imported = findTeamDefenseSource(active.sources);
  const rate = .15123456789123456;
  const sources = replaceTeamDefenseSource(active,testSnapshot(rate,{mode:'challenge',target:'sharedArena'}));
  assert.equal(sources.length,3); assert.equal(sources[0],manual);
  assert.equal(findTeamDefenseSource(sources).id,imported.id);
  close(externalDefenseRate({...active,sources}),1-.8*(1-rate));
  close(externalDefenseRate({...active,sources:sources.filter(s=>s.kind==='manual')}),.2);
});
test('Blank individual sources contribute zero while nonblank invalid drafts remain invalid', () => {
  const sources = values => values.map((percentage,i)=>manualSource(String(i),percentage,i % 2 ? '鋼鐵城牆' : ''));
  const value = {...defaultBattleDefense(),mode:'sources'};
  for (const [values,expected] of [[[],0],[[''],0],[['','',''],0],[['48','50',''],.74],[['48','50','20',''],.792],[['','50'],.5],[[' ','50'],.5]]) {
    close(externalDefenseRate({...value,sources:sources(values)}),expected);
  }
  for (const percentage of ['-1','101','NaN','Infinity','1e2','abc','4..8','0.123456789','.','48.']) {
    assert.throws(()=>externalDefenseRate({...value,sources:sources(['48',percentage])}),/尚未完成/,percentage);
  }
  const named={...value,sources:[manualSource('a','','鋼鐵城牆')]};assert.equal(externalDefenseRate(named),0);
  const reloaded=parseBattleDefense(JSON.stringify(named));assert.deepEqual(reloaded.sources,named.sources);assert.equal(externalDefenseRate(reloaded),0);
  reloaded.sources[0].percentage='50';close(externalDefenseRate(reloaded),.5);
  reloaded.sources[0].percentage='';assert.equal(externalDefenseRate(reloaded),0);
});

test('Versioned persistence validates snapshots and preserves incomplete source drafts', () => {
  assert.deepEqual(parseBattleDefense(null),defaultBattleDefense());assert.throws(()=>parseBattleDefense('{'));assert.throws(()=>parseBattleDefense('{"schemaVersion":2}'));
  const value={...defaultBattleDefense(),mode:'sources',sources:[manualSource('a','')]};assert.deepEqual(parseBattleDefense(JSON.stringify(value)),value);
  assert.throws(()=>parseBattleDefense(JSON.stringify({...value,sources:[value.sources[0],value.sources[0]]})));
  assert.throws(()=>parseBattleDefense(JSON.stringify({...value,sources:[{kind:'team',id:'team',snapshot:testSnapshot(Infinity)}]})));
  assert.throws(()=>parseBattleDefense(JSON.stringify({...value,sources:[{kind:'team',id:'team',snapshot:testSnapshot(.2)},{kind:'team',id:'other-team',snapshot:testSnapshot(.3)}]})));
});
test('Team names round-trip independently of snapshots and are kept only for the same target', () => {
  const snapshot=testSnapshot(.8634800125,{defenseIgnoreAdditive:.05});
  const team={kind:'team',id:'reference',name:'我的主力隊伍',snapshot};
  const value={...defaultBattleDefense(),mode:'sources',sources:[team,manualSource('manual','20')]};
  const restored=parseBattleDefense(JSON.stringify(value));
  assert.deepEqual(restored,value);
  assert.equal(externalDefenseRate(restored),externalDefenseRate({...value,sources:[{...team,name:'別名'},value.sources[1]]}));
  assert.equal(teamDefenseIgnoreAdditive(restored),.05);
  const refreshed={...snapshot,importedAt:'2026-11-08',rate:.2};
  assert.deepEqual(replaceTeamDefenseSource(restored,refreshed)[0],{...team,snapshot:refreshed});
  const first={...refreshed,mode:'challenge',target:'firstTeam'};
  assert.deepEqual(replaceTeamDefenseSource(restored,first)[0],{kind:'team',id:'reference',snapshot:first});
  const firstNamed={...restored,sources:[{...team,snapshot:first},value.sources[1]]};
  assert.equal(replaceTeamDefenseSource(firstNamed,{...first,target:'secondTeam'})[0].name,undefined);
  assert.throws(()=>parseBattleDefense(JSON.stringify({...value,sources:[{...team,name:8}]})));
  assert.throws(()=>externalDefenseRate({...value,sources:[team,manualSource('broken','abc')]}),/第 1 條/);
});

test('Cosmetic storage changes notify editors but not calculation consumers', () => {
  const dom=new JSDOM('',{url:'https://test.local'}),host=dom.window,store=createBattleDefenseStore(host);
  try {
    let renders=0,calculations=0;store.subscribe(()=>renders++);store.subscribeCalculation(()=>calculations++);
    const team={kind:'team',id:'team',snapshot:testSnapshot(.2,{defenseIgnoreAdditive:.05})};
    store.set({...store.value,mode:'sources',sources:[team]});
    store.set({...store.value,sources:[{...team,name:'本分頁'}]});
    const sync=source=>{host.localStorage.setItem(BATTLE_DEFENSE_KEY,JSON.stringify({...store.value,sources:[source]}));
      host.dispatchEvent(new host.StorageEvent('storage',{key:BATTLE_DEFENSE_KEY}));};
    sync({...team,name:'跨分頁'});
    assert.equal(renders,3);assert.equal(calculations,1);
    assert.equal(store.value.sources[0].name,'跨分頁');assert.equal(store.rate,.2);
    sync({...team,snapshot:{...team.snapshot,defenseIgnoreAdditive:0}});
    assert.equal(calculations,2);assert.equal(store.defenseIgnoreAdditive,0);assert.equal(store.rate,.2);
  } finally {store.dispose();host.close();}
});

test('Same-page notifications, storage sync and loadout isolation', () => {
  const dom=new JSDOM('',{url:'https://test.local'}),host=dom.window;host.localStorage.setItem('dab-loadout-v1','untouched');
  const store=createBattleDefenseStore(host);let notified=0;store.subscribe(()=>notified++);
  store.set({...store.value,manualPercentage:'89.6'});close(store.rate,.896);assert.equal(notified,1);
  host.localStorage.setItem(BATTLE_DEFENSE_KEY,JSON.stringify({...store.value,manualPercentage:'50'}));host.dispatchEvent(new host.StorageEvent('storage',{key:BATTLE_DEFENSE_KEY}));assert.equal(store.rate,.5);assert.equal(notified,2);
  store.set({...store.value,manualPercentage:''});assert.equal(store.rate,0);assert.equal(store.error,'');assert.equal(host.localStorage.getItem('dab-loadout-v1'),'untouched');store.dispose();dom.window.close();
});
test('Team single snapshot equals actual simulator engine with default and selected options', () => {
  const raw=JSON.stringify(savedTeam()),saved=parseSavedSimulatorState(raw,catalog);const refs=teamDefenseReferences(raw,catalog,'fixture');
  const expected=calculateTeam({mode:'single',damageBase:catalog.damageBase,members:resolveSavedMembers(catalog,saved.membersByTeam.single,'single'),options:resolveSavedOptions(catalog,saved.optionsByTeam.single),defense:{bossDamageReduction:.7192},uniqueClassCodes:catalog.classes.filter(c=>c.uniquenessGroup==='green-control').map(c=>c.code),actionSpeedCap:catalog.parameters.actionSpeedCap});
  close(refs.refs[0].rate,expected.defenseBreak);assert.equal(refs.sourceRevision,teamRevision(raw));assert.equal(refs.refs.length,1);
});
test('Challenge exposes explicit route/arena snapshots, preserving source uniqueness', () => {
  const raw=JSON.stringify(savedTeam('challenge')),saved=parseSavedSimulatorState(raw,catalog),refs=teamDefenseReferences(raw,catalog,'fixture');
  const team=key=>({members:resolveSavedMembers(catalog,saved.membersByTeam[key],'challenge'),options:resolveSavedOptions(catalog,saved.optionsByTeam[key])});
  const expected=calculateChallenge({firstTeam:team('first'),secondTeam:team('second'),damageBase:catalog.damageBase,defense:{challengeBreakCoefficient:.7192},uniqueClassCodes:catalog.classes.filter(c=>c.uniquenessGroup==='green-control').map(c=>c.code),actionSpeedCap:catalog.parameters.actionSpeedCap});
  assert.deepEqual(refs.refs.map(r=>r.target),['firstTeam','secondTeam','sharedArena']);for(const ref of refs.refs)close(ref.rate,expected[ref.target].defenseBreak);
  const snapshot=parseBattleDefense(JSON.stringify(legacyEnvironment('team',[],{...refs.refs[2],mode:refs.mode,sourceRevision:refs.sourceRevision,dataRevision:refs.dataRevision,importedAt:'2026-11-06'})));
  const value=externalDefenseRate(snapshot);const changed=savedTeam('challenge');changed.membersByTeam.first=['BL'];assert.notEqual(teamRevision(JSON.stringify(changed)),refs.sourceRevision);assert.equal(externalDefenseRate(parseBattleDefense(JSON.stringify(snapshot))),value);
});
test('Missing/unsupported/invalid/empty team configurations cannot be imported', () => {
  for(const raw of[null,'{}','{"version":2}',JSON.stringify({...savedTeam(),membersByTeam:{single:[]}}),JSON.stringify({...savedTeam(),membersByTeam:{single:['UNKNOWN']}})])assert.throws(()=>teamDefenseReferences(raw,catalog,'fixture'),/有效隊伍/);
});
test('Default external zero preserves exact old homepage values; Baseline uses current environment', () => {
  const original=projectDamage(data,state);assert.deepEqual(projectDamage(data,state,0),original);
  const before=original.result.finalDamage.finalDamage,external=.896,equipment=original.result.attributes.stats.defenseIgnorePct.finalTotal/100,D=Number(state.values['Stage.BossDEF'])/100;
  const next=projectDamage(data,state,external);close(next.result.finalDamage.finalDamage/before,(1-D*equipment)/(1-D*combineDefenseRates(equipment,external)));
  const cache=createBaselineEvaluationCache(),revision={};assert.equal(cache.get(data,state,revision,0).damage.result.finalDamage.finalDamage,before);assert.equal(cache.get(data,state,revision,external).damage.result.finalDamage.finalDamage,next.result.finalDamage.finalDamage);
  assert.equal(evaluateLoadout(data,state,true,false,null).damage,null);
});
test('Blank sources use the same full damage engine and scoring context as the filled sources alone', () => {
  const sources = ['48','50','20',''].map((percentage,i)=>manualSource(String(i),percentage,i===3?'新增來源':''));
  const env={...defaultBattleDefense(),mode:'sources',sources};
  const rate=externalDefenseRate(env);close(rate,.792);
  const withoutBlank=externalDefenseRate({...env,sources:sources.slice(0,3)});close(rate,withoutBlank);
  const context=readRatingLoadout(data,state,rate);
  close(scoreConfiguration(context,context.actual).after,projectDamage(data,state,rate).result.finalDamage.finalDamage);
  assert.deepEqual(parseBattleDefense(JSON.stringify(env)).sources,sources);
});

test('Weapon scoring and every candidate recompute equipment ignore with fixed external environment', () => {
  const original=JSON.stringify(state),context=readRatingLoadout(data,state,.896);
  const lines=[{choice:'無視防禦%',roll:8},{choice:'技能傷害%',roll:10},{choice:'雙攻%',roll:8},{choice:'無關傷害',roll:null}];
  const copy=structuredClone(state);data.transformations.slots.forEach((f,i)=>{delete copy.values[f.choiceField];delete copy.values[f.valueField];if(lines[i].choice==='無關傷害')return;copy.values[f.choiceField]=lines[i].choice;copy.values[f.valueField]=lines[i].roll/100;});
  close(scoreConfiguration(context,lines).after,projectDamage(data,copy,.896).result.finalDamage.finalDamage);assert.equal(JSON.stringify(state),original);
  const zero=readRatingLoadout(data,state,0);assert.notEqual(context.comparisons.find(c=>c.rule.choice==='無視防禦%').gains[0],zero.comparisons.find(c=>c.rule.choice==='無視防禦%').gains[0]);
});
test('Armor with A/B pants preserves the same external environment and other equipment effects', () => {
  for(const target of data.innerwear.slots){const copy=structuredClone(state);copy.lowerwearAlternativeEnabled=true;for(const slot of data.innerwear.slots){copy.values[slot.typeField]='內布隆';copy.values[slot.enhancementField]='Lv.11';copy.values[slot.forgingField]=0;const f=data.nephronArmor.fields.find(f=>f.slotId===slot.id);for(const t of f.transformFields){delete copy.values[t.attributeField];delete copy.values[t.valueField];}}
    const context=readArmorRatingLoadout(data,copy,target.id,.896),fields=data.nephronArmor.fields.find(f=>f.slotId===target.id).transformFields;
    const lines=context.upperSelection;for(const[f,i]of fields.map((f,i)=>[f,i])){copy.values[f.attributeField]=lines[i].choice;copy.values[f.valueField]=lines[i].roll/100;}
    close(context.simulatedDamage(lines),projectDamage(data,copy,.896).result.finalDamage.finalDamage);
  }
});

test('VI snapshot data freshness is independent of source revision and never overwrites the stored rate', async () => {
  const saved={...savedTeam(),membersByTeam:{single:['VI']}};const raw=JSON.stringify(saved),refs=teamDefenseReferences(raw,catalog,'current-data');
  const old={mode:'single',target:'single',rate:.354,sources:['職業：VI'],sourceRevision:teamRevision(raw),dataRevision:'old-data',importedAt:'2026-11-07'};
  const environment=legacyEnvironment('team',[],old);
  assert.equal(teamSnapshotUpdateReason(old,teamRevision(raw),'current-data'),'data');assert.equal(teamSnapshotUpdateReason(old,'changed-source','current-data'),'data');assert.equal(teamSnapshotUpdateReason(old,'changed-source','old-data'),'team');assert.equal(teamSnapshotUpdateReason(old,teamRevision(raw),'old-data'),null);
  close(externalDefenseRate(parseBattleDefense(JSON.stringify(environment))),.354);assert.equal(environment.teamSnapshot.dataRevision,'old-data');
  const D=.7192,options=resolveSavedOptions(catalog,parseSavedSimulatorState(raw,catalog).optionsByTeam.single);
  const expected=1-(1-.1925)*options.reduce((remaining,o)=>remaining*(1-(o.effects.defenseBreak??0)),1);close(refs.refs[0].rate,expected);
  const manifest=json('../site-dist/buff-simulator/asset-manifest.json');const names=['classes','class-effects','effect-types','loadout-options','calculation-parameters'];const paths=names.map(n=>manifest.data['data/'+n+'.json']);
  const fetchBefore=globalThis.fetch,requests=[];globalThis.fetch=async url=>{const path=new URL(url).pathname.split('/buff-simulator/')[1];requests.push(path);return{ok:true,json:async()=>path==='asset-manifest.json'?manifest:json('../site-dist/buff-simulator/'+path)};};
  try {const revision=await loadTeamDefenseDataRevision(new URL('https://test.local/buff-simulator/'));assert.equal(revision,paths.join('|'));assert.deepEqual(requests,['asset-manifest.json']);
    const imported=await loadTeamDefenseReferences(raw,new URL('https://test.local/buff-simulator/'));assert.equal(imported.dataRevision,revision);close(imported.refs[0].rate,expected);assert.equal(requests.length,7);
    globalThis.fetch=async()=>({ok:true,json:async()=>({data:{}})});await assert.rejects(loadTeamDefenseDataRevision(new URL('https://test.local/buff-simulator/')),/有效隊伍/);
  }finally{globalThis.fetch=fetchBefore;}
  const before=projectDamage(data,state,.354),after=projectDamage(data,state,expected);assert.notEqual(before.result.finalDamage.finalDamage,after.result.finalDamage.finalDamage);
  close(scoreConfiguration(readRatingLoadout(data,state,expected),readRatingLoadout(data,state,expected).actual).after,after.result.finalDamage.finalDamage);
  assert.equal(old.rate,.354);assert.ok(D>0);
});

test('LA exact additive group uses E+L before external break; core precision and boundaries', () => {
  const evaluated=evaluateLoadout(data,state,false,true),input=finalDamageInputs(evaluated.comparisonInput,evaluated.damage.result);
  const base={...input,defenseIgnorePct:8.7,externalDefenseBreakRate:.915,enemyDefensePct:96.01};
  const before=calculateFinalDamage(base),after=calculateFinalDamage({...base,defenseIgnoreAdditive:.05});
  close(before.defenseContext.effectiveRate,.922395);close(after.defenseContext.effectiveRate,.926645);
  close(before.defenseFactor,8.740604685783106);close(after.defenseFactor,9.063871110193827);
  close(after.finalDamage/before.finalDamage-1,.03698444627481265);
  assert.equal(after.defenseContext.equipmentRate,.087);close(after.defenseContext.adjustedEquipmentRate,.137);
  assert.equal(calculateFinalDamage({...base,enemyDefensePct:0,defenseIgnoreAdditive:.05}).defenseFactor,1);
  close(combineDefenseRates(0,0,.05),.05);close(combineDefenseRates(.95,0,.05),1);
  for(const v of[-.1,NaN,Infinity,1.1])assert.throws(()=>combineDefenseRates(.087,.915,v));
  assert.throws(()=>calculateFinalDamage({...base,defenseIgnorePct:96,defenseIgnoreAdditive:.05}),/加算/);
  close(calculateFinalDamage({...base,externalDefenseBreakRate:1,defenseIgnoreAdditive:.05}).defenseFactor,calculateFinalDamage({...base,externalDefenseBreakRate:1}).defenseFactor);
});
test('Legacy migration preserves effective rates, parks inactive manual rows and is idempotent', () => {
  const legacySources = [{id:'team-reference',name:'保留的來源',percentage:'20'}];
  const snapshot = testSnapshot(.3,{defenseIgnoreAdditive:.05,defenseIgnoreSources:['職業：LA']});
  assert.equal(teamDefenseIgnoreAdditive(parseBattleDefense(JSON.stringify(legacyEnvironment('team',[],testSnapshot(.3))))),0);
  for (const mode of ['manual','sources','team']) {
    const raw = JSON.stringify(legacyEnvironment(mode,legacySources,snapshot));
    const migrated = parseBattleDefense(raw);
    assert.deepEqual(parseBattleDefense(raw),migrated);
    assert.deepEqual(parseBattleDefense(JSON.stringify(migrated)),migrated);
    assert.equal(migrated.schemaVersion,2);
    close(externalDefenseRate(migrated),{manual:.1,sources:.2,team:.3}[mode]);
    close(teamDefenseIgnoreAdditive(migrated),mode==='team'?.05:0);
    if (mode==='team') {
      assert.equal(migrated.mode,'sources');
      assert.deepEqual(migrated.legacyManualSources,[manualSource('team-reference','20','保留的來源')]);
      assert.notEqual(migrated.sources[0].id,legacySources[0].id);
      assert.deepEqual(findTeamDefenseSource(migrated.sources).snapshot,snapshot);
    } else {
      assert.deepEqual(migrated.sources,[manualSource('team-reference','20','保留的來源')]);
    }
  }
  const emptyTeam = parseBattleDefense(JSON.stringify(legacyEnvironment('team',legacySources)));
  assert.equal(externalDefenseRate(emptyTeam),0); assert.equal(emptyTeam.legacyManualSources.length,1);
});

test('LA is applied once with itemized break, and is removed by replacement, deletion or direct input', () => {
  const value = { ...defaultBattleDefense(), mode:'sources', manualPercentage:'10', sources:[manualSource('one','15')] };
  const snapshot = testSnapshot(.2,{defenseIgnoreAdditive:.05,defenseIgnoreSources:['職業：LA']});
  const dom = new JSDOM('',{url:'https://test.local'}), host = dom.window, store = createBattleDefenseStore(host);
  try {
    store.set({...value,sources:replaceTeamDefenseSource(value,snapshot)});
    close(store.rate,.32); close(store.defenseIgnoreAdditive,.05);
    close(combineDefenseRates(.087,store.rate,store.defenseIgnoreAdditive),.41316);
    const active = store.value;
    store.set({...active,mode:'manual'}); close(store.rate,.1); assert.equal(store.defenseIgnoreAdditive,0);
    assert.deepEqual(store.value.sources,active.sources);
    store.set({...active,sources:replaceTeamDefenseSource(active,testSnapshot(.2))});
    close(store.rate,.32); assert.equal(store.defenseIgnoreAdditive,0);
    host.localStorage.setItem(BATTLE_DEFENSE_KEY,JSON.stringify(active));
    host.dispatchEvent(new host.StorageEvent('storage',{key:BATTLE_DEFENSE_KEY}));
    close(store.rate,.32); close(store.defenseIgnoreAdditive,.05);
    store.set({...store.value,sources:store.value.sources.filter(source=>source.kind==='manual')});
    close(store.rate,.15); assert.equal(store.defenseIgnoreAdditive,0);
    const restored = createBattleDefenseStore(host);
    assert.deepEqual(restored.value.sources,value.sources); assert.equal(restored.defenseIgnoreAdditive,0); restored.dispose();
  } finally { store.dispose(); host.close(); }
});

test('LA references obey single, challenge route and shared-arena source uniqueness', () => {
  for(const mode of['single','challenge']){
    const saved=savedTeam(mode);saved.membersByTeam={single:['LA','LA'],first:['LA','LA'],second:['NP']};
    const refs=teamDefenseReferences(JSON.stringify(saved),catalog,'current');
    for(const ref of refs.refs){const expected=ref.target==='secondTeam'?0:.05;close(ref.defenseIgnoreAdditive??0,expected);if(expected)assert.deepEqual(ref.contributions.filter(item=>item.category==='defense-ignore'),[{id:'class:la',category:'defense-ignore',label:'LA',rate:.05}]);}
    if(mode==='challenge'){saved.membersByTeam.second=['LA'];const both=teamDefenseReferences(JSON.stringify(saved),catalog,'current');for(const ref of both.refs)close(ref.defenseIgnoreAdditive,.05);}
  }
});
test('LA same context reaches Baseline, weapon candidates and every armor A/B target without mutation', () => {
  const original=JSON.stringify(state),B=.915,L=.05,cache=createBaselineEvaluationCache(),revision={};
  const plain=cache.get(data,state,revision,B,0),la=cache.get(data,state,revision,B,L);
  assert.notEqual(la.damage.result.finalDamage.finalDamage,plain.damage.result.finalDamage.finalDamage);
  close(la.damage.result.finalDamage.finalDamage,projectDamage(data,state,B,L).result.finalDamage.finalDamage);
  const context=readRatingLoadout(data,state,B,L);close(scoreConfiguration(context,context.actual).after,la.damage.result.finalDamage.finalDamage);
  const lines=[{choice:'無視防禦%',roll:8},{choice:'技能傷害%',roll:10},{choice:'雙攻%',roll:8},{choice:'無關傷害',roll:null}],copy=structuredClone(state);
  data.transformations.slots.forEach((f,i)=>{delete copy.values[f.choiceField];delete copy.values[f.valueField];if(lines[i].roll===null)return;copy.values[f.choiceField]=lines[i].choice;copy.values[f.valueField]=lines[i].roll/100;});
  close(scoreConfiguration(context,lines).after,projectDamage(data,copy,B,L).result.finalDamage.finalDamage);
  for(const target of data.innerwear.slots){const armor=structuredClone(state);armor.lowerwearAlternativeEnabled=true;
    for(const slot of data.innerwear.slots){armor.values[slot.typeField]='內布隆';armor.values[slot.enhancementField]=slot.id===target.id?'Lv.11':'Lv.12';armor.values[slot.forgingField]=0;}
    const rating=readArmorRatingLoadout(data,armor,target.id,B,L),fields=data.nephronArmor.fields.find(f=>f.slotId===target.id).transformFields;
    for(const[f,i]of fields.map((f,i)=>[f,i])){armor.values[f.attributeField]=rating.upperSelection[i].choice;armor.values[f.valueField]=rating.upperSelection[i].roll/100;}
    close(rating.simulatedDamage(rating.upperSelection),projectDamage(data,armor,B,L).result.finalDamage.finalDamage);
  }
  assert.equal(JSON.stringify(state),original);
});
test('Readonly Buff beneficiary adapter reads saved equipment and defaults missing loadout to zero',async()=>{
  const {readBeneficiaryDefense}=await import('../dist/frontend/beneficiary-defense.js');
  assert.deepEqual(await readBeneficiaryDefense('test:data',null),{rates:[0],source:'empty'});
  const fetchBefore=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return{ok:true,json:async()=>data};};
  try{const raw=JSON.stringify(state),result=await readBeneficiaryDefense('test:data',raw),expected=projectDamage(data,state).result;
    const rates=expected.lowerwearConfigurations?.map(c=>c.result.attributes.stats.defenseIgnorePct.finalTotal/100)??[expected.attributes.stats.defenseIgnorePct.finalTotal/100];
    assert.deepEqual(result,{rates,source:'loadout'});assert.equal(JSON.stringify(state),raw);
    await readBeneficiaryDefense('test:data',raw);assert.equal(calls,1);
    await assert.rejects(readBeneficiaryDefense('test:data','{'));
  }finally{globalThis.fetch=fetchBefore;}
});

test('Explicit reference modes resolve both saved rosters independently of last mode and preserve scope',()=>{
  const scoped=structuredClone(catalog);for(const p of scoped.classEffects)if(p.code==='LA')p.effects.defenseBreak=p.mode==='single'?.1:.4;
  for(const lastMode of['single','challenge']){
    const saved=savedTeam(lastMode);saved.membersByTeam={single:['LA','LA'],first:['LA','LA'],second:['IM']};
    const disabled=Object.fromEntries(scoped.loadoutOptions.filter(o=>o.userInput?.kind!=='percentage').map(o=>[o.id,false]));saved.optionsByTeam={single:disabled,first:disabled,second:disabled};
    const raw=JSON.stringify(saved),parsed=parseSavedSimulatorState(raw,scoped);
    for(const requested of['single','challenge']){
      const refs=teamDefenseReferences(raw,scoped,'data',requested);assert.equal(refs.mode,requested);assert.equal(refs.sourceRevision,teamRevision(raw));
      const resolve=key=>({members:resolveSavedMembers(scoped,parsed.membersByTeam[key],requested),options:resolveSavedOptions(scoped,parsed.optionsByTeam[key])});
      if(requested==='single'){const expected=calculateTeam({mode:requested,...resolve('single'),damageBase:scoped.damageBase,defense:{bossDamageReduction:.7192}});close(refs.refs[0].rate,expected.defenseBreak);close(refs.refs[0].rate,.1);close(refs.refs[0].defenseIgnoreAdditive,.05);}
      else {const expected=calculateChallenge({firstTeam:resolve('first'),secondTeam:resolve('second'),damageBase:scoped.damageBase,defense:{challengeBreakCoefficient:.9601}});assert.deepEqual(refs.refs.map(r=>r.target),['firstTeam','secondTeam','sharedArena']);
        for(const ref of refs.refs){close(ref.rate,expected[ref.target].defenseBreak);close(ref.defenseIgnoreAdditive??0,expected[ref.target].defenseIgnoreAdditive??0);}
        close(refs.refs[0].rate,.4);close(refs.refs[1].rate,0);close(refs.refs[2].rate,.4);close(refs.refs[2].defenseIgnoreAdditive,.05);
      }
    }
    assert.equal(JSON.stringify(saved),raw);assert.equal(parsed.mode,lastMode);
  }
});
test('Missing requested mode never falls back; a valid member with zero break remains importable',()=>{
  const saved=savedTeam('single');saved.membersByTeam={single:['LA'],first:[],second:[]};assert.throws(()=>teamDefenseReferences(JSON.stringify(saved),catalog,'v','challenge'),/目前尚無已保存的挑戰雙隊配置/);
  saved.mode='challenge';saved.membersByTeam={single:[],first:['LA'],second:[]};assert.throws(()=>teamDefenseReferences(JSON.stringify(saved),catalog,'v','single'),/目前尚無已保存的單隊配置/);
  const disabled=Object.fromEntries(catalog.loadoutOptions.filter(o=>o.userInput?.kind!=='percentage').map(o=>[o.id,false]));saved.membersByTeam.single=['IM'];saved.optionsByTeam.single=disabled;
  // No loadout effects in this fixture: a member with no break must still be a valid zero result.
  const zero=teamDefenseReferences(JSON.stringify(saved),{...catalog,loadoutOptions:[]},'v','single');assert.equal(zero.refs[0].rate,0);assert.equal(zero.refs[0].defenseIgnoreAdditive??0,0);
  saved.membersByTeam.first=['UNKNOWN'];assert.doesNotThrow(()=>teamDefenseReferences(JSON.stringify(saved),catalog,'v','single'));assert.throws(()=>teamDefenseReferences(JSON.stringify(saved),catalog,'v','challenge'),/有效隊伍/);
  assert.throws(()=>teamDefenseReferences('{',catalog,'v','single'),/有效隊伍/);
});

test('Support magazine levels survive cross-mode parsing without altering defense references or LA snapshots',()=>{
  const saved=savedTeam('single');saved.membersByTeam={single:['NP','LA'],first:['BL','LA'],second:['NP']};
  const rawBefore=JSON.stringify(saved),singleBefore=teamDefenseReferences(rawBefore,catalog,'data','single'),challengeBefore=teamDefenseReferences(rawBefore,catalog,'data','challenge');
  saved.optionsByTeam.single={'support-magazine-i':true,'support-magazine-i-level':5,'support-magazine-iii':true,'support-magazine-iii-level':2};
  saved.optionsByTeam.first={'support-magazine-ii':true,'support-magazine-ii-level':6};saved.optionsByTeam.second={'support-magazine-iii':false,'support-magazine-iii-level':6};
  const raw=JSON.stringify(saved),restored=parseSavedSimulatorState(raw,catalog);
  assert.equal(restored.optionsByTeam.single['support-magazine-i-level'],5);assert.equal(restored.optionsByTeam.second['support-magazine-iii-level'],6);
  for(const[mode,previous]of[['single',singleBefore],['challenge',challengeBefore]]){const now=teamDefenseReferences(raw,catalog,'data',mode);assert.deepEqual(now.refs,previous.refs);assert.notEqual(now.sourceRevision,previous.sourceRevision);}
  assert.equal(saved.mode,'single');assert.equal(JSON.stringify(saved),raw);
});

test('Imported contribution rates use the engine winners and catalog option order across both routes', () => {
  const scoped = structuredClone(catalog);
  const classRates = new Map([['LA', .1], ['VI', .1925], ['NP', .12], ['BL', .15]]);
  for (const profile of scoped.classEffects) if (classRates.has(profile.code)) profile.effects.defenseBreak = classRates.get(profile.code);
  const options = (...on) => Object.fromEntries(scoped.loadoutOptions.filter(option => !option.userInput).map(option => [option.id, on.includes(option.id)]));
  const saved = savedTeam();
  saved.membersByTeam = { single: ['VI', 'VI', 'LA'], first: ['LA', 'NP', 'LA'], second: ['BL', 'VI', 'LA'] };
  saved.optionsByTeam = { single: options(), first: options('steel-wall-defense-break'), second: options('steel-wall-defense-break', 'wind-ball-defense-break', 'incense-defense-break') };
  const raw = JSON.stringify(saved);
  const only = teamDefenseReferences(raw, scoped, 'test', 'single').refs[0];
  const [first, second, arena] = teamDefenseReferences(raw, scoped, 'test', 'challenge').refs;
  const group = (ref, category) => ref.contributions.filter(source => source.category === category).map(({label,rate}) => [label,rate]);
  assert.deepEqual(group(only, 'class'), [['VI',.1925],['LA',.1]]);
  assert.deepEqual(group(first, 'class'), [['LA',.1],['NP',.12]]);
  assert.deepEqual(group(second, 'class'), [['BL',.15],['VI',.1925],['LA',.1]]);
  assert.deepEqual(group(arena, 'class'), [['LA',.1],['NP',.12],['VI',.1925]]);
  assert.deepEqual(group(arena, 'loadout'), [['鋼鐵城牆',.48],['風球',.5],['支援飾品（香爐、預言書）',.15]]);
  assert.deepEqual(group(arena, 'defense-ignore'), [['LA',.05]]);
  assert.equal(arena.contributions.find(source=>source.label==='支援飾品（香爐、預言書）').id,'loadout:incense-defense-break');
  for (const ref of [only, first, second, arena]) {
    const external = ref.contributions.filter(source => source.category !== 'defense-ignore');
    close(ref.rate, 1 - external.reduce((remaining, source) => remaining * (1 - source.rate), 1));
  }
});

test('Structured snapshots round-trip and reject malformed or duplicate contributions', () => {
  const item = { id:'class:la', category:'class', label:'LA', rate:.1 };
  const additive = { ...item, category:'defense-ignore', rate:.05 };
  const environment = { ...defaultBattleDefense(), mode:'sources', sources:[{ kind:'team', id:'team', snapshot:testSnapshot(.1,{contributions:[item,additive]}) }] };
  delete environment.sources[0].snapshot.sources;
  assert.deepEqual(parseBattleDefense(JSON.stringify(environment)),environment);
  for (const contributions of [null,[item,item],[{...item,category:'invalid'}],[{...item,rate:'0.1'}],[{...item,rate:0}],[{...item,rate:1.1}]]) {
    environment.sources[0].snapshot.contributions = contributions;
    assert.throws(()=>parseBattleDefense(JSON.stringify(environment)),/隊伍破防來源明細/);
  }
});

test('Saved FP/DN variants share the live resolver and leave the active defense snapshot intact', () => {
  const saved = savedTeam();
  saved.membersByTeam = { single: ['', 'FP', 'DN'], first: ['', 'DN'], second: ['', '', 'FP', 'DN'] };
  saved.classSkillVersionsByTeam = {
    single: { 1: { 'FP.FatalShotConverted': true }, 2: { 'DN.FieldPowerConverted': false } },
    second: { 3: { 'DN.FieldPowerConverted': false } }
  };
  const raw = JSON.stringify(saved);
  const active = parseSavedSimulatorState(raw, catalog);
  const resolve = (key, mode) => ({
    members: resolveSavedMembers(catalog, active.membersByTeam[key], mode, active.classSkillVersionsByTeam[key]),
    options: resolveSavedOptions(catalog, active.optionsByTeam[key])
  });
  const defense = { bossDamageReduction: .5, challengeBreakCoefficient: .5 };
  const single = teamDefenseReferences(raw, catalog, 'data-new', 'single');
  const challenge = teamDefenseReferences(raw, catalog, 'data-new', 'challenge');
  const expected = calculateChallenge({ firstTeam: resolve('first', 'challenge'), secondTeam: resolve('second', 'challenge'), damageBase: catalog.damageBase, defense });
  close(single.refs[0].rate, calculateTeam({ mode: 'single', ...resolve('single', 'single'), damageBase: catalog.damageBase, defense }).defenseBreak);
  for (const ref of challenge.refs) {
    close(ref.rate, expected[ref.target].defenseBreak);
    assert.ok(ref.contributions.some(row => row.label === 'DN' && row.rate === .1));
  }
  const snapshot = testSnapshot(challenge.refs.at(-1).rate, { mode: 'challenge', target: 'sharedArena',
    sourceRevision: challenge.sourceRevision, dataRevision: challenge.dataRevision });
  const initial = { ...defaultBattleDefense(), mode: 'sources' };
  const environment = { ...initial, sources: replaceTeamDefenseSource(initial, snapshot) };
  saved.classSkillVersionsByTeam.second[3]['DN.FieldPowerConverted'] = true;
  const changed = teamDefenseReferences(JSON.stringify(saved), catalog, 'data-new', 'challenge');
  assert.equal(teamSnapshotUpdateReason(snapshot, changed.sourceRevision, changed.dataRevision), 'team');
  close(changed.refs.at(-1).rate, snapshot.rate);
  assert.deepEqual(findTeamDefenseSource(environment.sources).snapshot, snapshot);
});

test('DN conversion adds ordinary critical damage once in average, single-pants and transformation scoring', () => {
  const base = { ...state, Job: 'DN', lowerwearAlternativeEnabled: true };
  const skill = 'DN.FieldPowerConverted';
  for (const condition of [undefined, { enabled: true, comparison: 'above', lowerwear: 'lowerwearA' },
    { enabled: true, comparison: 'below', lowerwear: 'lowerwearB' }]) {
    const normal = { ...base, bossHealthCondition: condition };
    const enabled = { ...normal, classSkillVersions: { [skill]: true } };
    const off = projectDamage(data, normal).result, on = projectDamage(data, enabled).result;
    assert.equal(off.classCritDamagePassivePct, 60);
    assert.equal(on.classCritDamagePassivePct, 60);
    close(on.attributes.stats.critDamagePct.finalTotal - off.attributes.stats.critDamagePct.finalTotal, 9.2);
    assert.deepEqual(on.combatRates, off.combatRates);
    assert.deepEqual(on.multiplicativeCritDamage, off.multiplicativeCritDamage);
    assert.deepEqual(on.generalMultiplicativeDamage, off.generalMultiplicativeDamage);
    assert.ok(on.finalDamage.finalDamage > off.finalDamage.finalDamage);
    assert.deepEqual(on.lowerwearConfigurations?.map(x => x.configuration), off.lowerwearConfigurations?.map(x => x.configuration));
    for (const [i, item] of (on.lowerwearConfigurations ?? []).entries()) {
      assert.ok(item.result.finalDamage.finalDamage > off.lowerwearConfigurations[i].result.finalDamage.finalDamage);
    }
    const withoutTransforms = { ...enabled, values: { ...enabled.values } };
    for (const { choiceField, valueField } of data.transformations.slots) {
      delete withoutTransforms.values[choiceField]; delete withoutTransforms.values[valueField];
    }
    const score = readRatingLoadout(data, enabled);
    close(score.baselineDamage, projectDamage(data, withoutTransforms).result.finalDamage.finalDamage);
    assert.ok(score.baselineDamage > readRatingLoadout(data, normal).baselineDamage);
  }
  const sameJob = { ...state, Job: 'FP' };
  assert.deepEqual(projectDamage(data, { ...sameJob, classSkillVersions: { [skill]: true } }), projectDamage(data, sameJob));
});

test('The beneficiary bridge returns just the effective working-draft percentages', () => {
  const copy = structuredClone(data);
  const role = { ...structuredClone(state), Job: 'DN', lowerwearAlternativeEnabled: false,
    classSkillVersions: { 'DN.FieldPowerConverted': true } };
  const original = projectBeneficiaryDamage(copy, JSON.stringify(role));
  assert.deepEqual(original, { critDamagePct: 303, bossDamagePct: 185.5 });
  copy.parameters.characterBase.critDamagePct -= 16.5; // Isolate the requested 286.5% example.
  const controlled = projectBeneficiaryDamage(copy, JSON.stringify(role));
  close(controlled.critDamagePct, 286.5);
  const team = calculateTeam({ mode: 'single', defense: { bossDamageReduction: .5 }, damageBase: controlled,
    members: resolveSavedMembers(catalog, ['', 'DN'], 'single', { 1: role.classSkillVersions }) });
  close(team.damageBuff.base.critDamagePct, 286.5);
  close(team.damageBuff.critPoints, 9.2);
  close(team.buffMultiplier, 1.092 * (286.5 + 9.2) / 286.5);
  role.classSkillVersions['DN.FieldPowerConverted'] = false;
  close(projectBeneficiaryDamage(copy, JSON.stringify(role)).critDamagePct, 277.3);
  role.lowerwearAlternativeEnabled = true;
  role.values['Left.Armor.Bottom.FORGE'] = 0;
  assert.throws(() => projectBeneficiaryDamage(copy, JSON.stringify(role)), /屬性|致命傷害或 Boss/);
  role.bossHealthCondition = { enabled: true, comparison: 'below', lowerwear: 'lowerwearB' };
  assert.ok(projectBeneficiaryDamage(copy, JSON.stringify(role)).critDamagePct > 0);
  assert.throws(() => projectBeneficiaryDamage(copy, JSON.stringify({ schemaVersion: 1 })), /格式無效/);
  assert.throws(() => projectBeneficiaryDamage(copy, 'invalid'), /格式無效/);
});
test('CeL uses the same 25-point Boss passive in the calculator, baseline and rating', () => {
  const loadout = { ...state, Job: 'CEL' };
  const current = projectDamage(data, loadout).result;
  const sources = current.attributes.stats.bossDamagePct.sharedSources.filter(source => source.sourceId === 'class-passive:CEL:boss-damage');
  assert.deepEqual(sources, [{ sourceId: 'class-passive:CEL:boss-damage', valuePct: 25 }]);
  assert.equal(current.classCritDamagePassivePct, 20);
  const former = structuredClone(data);
  former.classDamagePassives.bossDamagePctByClass.CEL = 20;
  const before = projectDamage(former, loadout).result;
  close(current.finalDamage.finalDamage / before.finalDamage.finalDamage,
    (100 + current.attributes.stats.bossDamagePct.finalTotal) / (100 + before.attributes.stats.bossDamagePct.finalTotal));
  close(createBaselineEvaluationCache().get(data, loadout, Symbol()).damage.result.finalDamage.finalDamage, current.finalDamage.finalDamage);
  const rating = readRatingLoadout(data, loadout);
  close(scoreConfiguration(rating, rating.actual).after, current.finalDamage.finalDamage);
});
