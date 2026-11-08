import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { combineDefenseRates, combineExternalSources, parseDefensePercentage, isDefensePercentageDraft } from '../dist/calculation/battle-defense.js';
import { calculateFinalDamage } from '../dist/calculation/final-damage.js';
import { finalDamageInputs } from '../dist/calculation/loadout-engine.js';
import { defaultBattleDefense, parseBattleDefense, externalDefenseRate, createBattleDefenseStore, BATTLE_DEFENSE_KEY, teamRevision, teamSnapshotUpdateReason, teamDefenseIgnoreAdditive } from '../dist/frontend/battle-defense-state.js';
import { teamDefenseReferences, loadTeamDefenseDataRevision, loadTeamDefenseReferences } from '../dist/frontend/team-defense-reference.js';
import { parseCoreCatalog } from '../dist/features/buff-simulator/frontend/data-loader.js';
import { parseSavedSimulatorState, resolveSavedMembers, resolveSavedOptions } from '../dist/features/buff-simulator/frontend/saved-state.js';
import { calculateChallenge, calculateTeam } from '../dist/features/buff-simulator/calculation/engine.js';
import { projectDamage, evaluateLoadout } from '../dist/frontend/projection.js';
import { createBaselineEvaluationCache } from '../dist/frontend/baseline-evaluation.js';
import { readRatingLoadout, readArmorRatingLoadout } from '../dist/features/transformation-score/loadout.js';
import { scoreConfiguration } from '../dist/features/transformation-score/scoring.js';
const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const data = json('../dist/data/game-data.json'), state = json('../data/examples/public-example-2026-09-28.json');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-11 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const catalog = parseCoreCatalog(Object.fromEntries(Object.entries({ classes:'classes', classEffects:'class-effects', effectTypes:'effect-types', loadoutOptions:'loadout-options', calculationParameters:'calculation-parameters' }).map(([key,name])=>[key,json('../features/buff-simulator/data/'+name+'.json')])));
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

test('Three active modes are equivalent; inactive drafts never stack', () => {
  const value=defaultBattleDefense();value.manualPercentage='89.6';value.sources=[48,50,50,20].map((n,i)=>({id:String(i),name:'',percentage:String(n)}));
  value.teamSnapshot={mode:'single',target:'single',rate:.896,sources:['confirmed'],sourceRevision:'test',dataRevision:'test',importedAt:new Date(0).toISOString()};
  for(const mode of['manual','sources','team'])close(externalDefenseRate({...value,mode}),.896);
  assert.equal(externalDefenseRate({...value,mode:'sources',sources:[{id:'x',name:'',percentage:''}]}),0);
  assert.equal(externalDefenseRate({...value,mode:'team',teamSnapshot:null}),0);
  assert.equal(externalDefenseRate({...value,mode:'manual',manualPercentage:''}),0);
  assert.throws(()=>externalDefenseRate({...value,mode:'manual',manualPercentage:'1e2'}),/十進位/);
});
test('Blank individual sources contribute zero while nonblank invalid drafts remain invalid', () => {
  const sources = values => values.map((percentage,i)=>({id:String(i),name:i % 2 ? '鋼鐵城牆' : '',percentage}));
  const value = {...defaultBattleDefense(),mode:'sources'};
  for (const [values,expected] of [[[],0],[[''],0],[['','',''],0],[['48','50',''],.74],[['48','50','20',''],.792],[['','50'],.5],[[' ','50'],.5]]) {
    close(externalDefenseRate({...value,sources:sources(values)}),expected);
  }
  for (const percentage of ['-1','101','NaN','Infinity','1e2','abc','4..8','0.123456789','.','48.']) {
    assert.throws(()=>externalDefenseRate({...value,sources:sources(['48',percentage])}),/尚未完成/,percentage);
  }
  const named={...value,sources:[{id:'a',name:'鋼鐵城牆',percentage:''}]};assert.equal(externalDefenseRate(named),0);
  const reloaded=parseBattleDefense(JSON.stringify(named));assert.deepEqual(reloaded.sources,named.sources);assert.equal(externalDefenseRate(reloaded),0);
  reloaded.sources[0].percentage='50';close(externalDefenseRate(reloaded),.5);
  reloaded.sources[0].percentage='';assert.equal(externalDefenseRate(reloaded),0);
  const snapshot={mode:'single',target:'single',rate:.3,sources:[],sourceRevision:'x',dataRevision:'x',importedAt:'2026-11-07'};
  assert.equal(externalDefenseRate({...reloaded,mode:'manual',manualPercentage:'10',teamSnapshot:snapshot}),.1);
  assert.equal(externalDefenseRate({...reloaded,mode:'team',manualPercentage:'10',teamSnapshot:snapshot}),.3);
});

test('Versioned persistence validates snapshots and preserves incomplete source drafts', () => {
  assert.deepEqual(parseBattleDefense(null),defaultBattleDefense());assert.throws(()=>parseBattleDefense('{'));assert.throws(()=>parseBattleDefense('{"schemaVersion":2}'));
  const value={...defaultBattleDefense(),mode:'sources',sources:[{id:'a',name:'',percentage:''}]};assert.deepEqual(parseBattleDefense(JSON.stringify(value)),value);
  assert.throws(()=>parseBattleDefense(JSON.stringify({...value,sources:[value.sources[0],value.sources[0]]})));
  assert.throws(()=>parseBattleDefense(JSON.stringify({...value,teamSnapshot:{rate:Infinity}})));
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
  const expected=calculateTeam({mode:'single',members:resolveSavedMembers(catalog,saved.membersByTeam.single,'single'),options:resolveSavedOptions(catalog,saved.optionsByTeam.single),defense:{bossDamageReduction:.7192},uniqueClassCodes:catalog.classes.filter(c=>c.uniquenessGroup==='green-control').map(c=>c.code),actionSpeedCap:catalog.parameters.actionSpeedCap});
  close(refs.refs[0].rate,expected.defenseBreak);assert.equal(refs.sourceRevision,teamRevision(raw));assert.equal(refs.refs.length,1);
});
test('Challenge exposes explicit route/arena snapshots, preserving source uniqueness', () => {
  const raw=JSON.stringify(savedTeam('challenge')),saved=parseSavedSimulatorState(raw,catalog),refs=teamDefenseReferences(raw,catalog,'fixture');
  const team=key=>({members:resolveSavedMembers(catalog,saved.membersByTeam[key],'challenge'),options:resolveSavedOptions(catalog,saved.optionsByTeam[key])});
  const expected=calculateChallenge({firstTeam:team('first'),secondTeam:team('second'),defense:{challengeBreakCoefficient:.7192},uniqueClassCodes:catalog.classes.filter(c=>c.uniquenessGroup==='green-control').map(c=>c.code),actionSpeedCap:catalog.parameters.actionSpeedCap});
  assert.deepEqual(refs.refs.map(r=>r.target),['firstTeam','secondTeam','sharedArena']);for(const ref of refs.refs)close(ref.rate,expected[ref.target].defenseBreak);
  const snapshot={...defaultBattleDefense(),mode:'team',teamSnapshot:{...refs.refs[2],mode:refs.mode,sourceRevision:refs.sourceRevision,dataRevision:refs.dataRevision,importedAt:'2026-11-06'}};
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
  const sources = ['48','50','20',''].map((percentage,i)=>({id:String(i),name:i===3?'新增來源':'',percentage}));
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
  const environment={...defaultBattleDefense(),mode:'team',teamSnapshot:old};
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
test('LA snapshots preserve independent additive data, mode isolation and old snapshot defaults', () => {
  const value={...defaultBattleDefense(),mode:'team',manualPercentage:'10',sources:[{id:'one',name:'',percentage:'20'}],
    teamSnapshot:{mode:'single',target:'single',rate:.3,sources:['break'],sourceRevision:'old',dataRevision:'old',importedAt:'2026-11-08'}};
  assert.equal(teamDefenseIgnoreAdditive(parseBattleDefense(JSON.stringify(value))),0);
  value.teamSnapshot.defenseIgnoreAdditive=.05;value.teamSnapshot.defenseIgnoreSources=['職業：LA'];
  const restored=parseBattleDefense(JSON.stringify(value));assert.deepEqual(restored,value);close(teamDefenseIgnoreAdditive(restored),.05);
  for(const [mode,rate]of[['manual',.1],['sources',.2]]){const off={...restored,mode};close(externalDefenseRate(off),rate);assert.equal(teamDefenseIgnoreAdditive(off),0);assert.deepEqual(off.teamSnapshot,value.teamSnapshot);}
  assert.equal(teamSnapshotUpdateReason(restored.teamSnapshot,'old','new'),'data');close(restored.teamSnapshot.defenseIgnoreAdditive,.05);
  const dom=new JSDOM('',{url:'https://test.local'}),store=createBattleDefenseStore(dom.window);store.set(restored);close(store.defenseIgnoreAdditive,.05);
  const next={...restored,mode:'manual'};dom.window.localStorage.setItem(BATTLE_DEFENSE_KEY,JSON.stringify(next));dom.window.dispatchEvent(new dom.window.StorageEvent('storage',{key:BATTLE_DEFENSE_KEY}));assert.equal(store.defenseIgnoreAdditive,0);store.dispose();dom.window.close();
});
test('LA references obey single, challenge route and shared-arena source uniqueness', () => {
  for(const mode of['single','challenge']){
    const saved=savedTeam(mode);saved.membersByTeam={single:['LA','LA'],first:['LA','LA'],second:['NP']};
    const refs=teamDefenseReferences(JSON.stringify(saved),catalog,'current');
    for(const ref of refs.refs){const expected=ref.target==='secondTeam'?0:.05;close(ref.defenseIgnoreAdditive??0,expected);if(expected)assert.deepEqual(ref.defenseIgnoreSources,['職業：LA']);}
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
      if(requested==='single'){const expected=calculateTeam({mode:requested,...resolve('single'),defense:{bossDamageReduction:.7192}});close(refs.refs[0].rate,expected.defenseBreak);close(refs.refs[0].rate,1-(1-.1)*(1-.15));close(refs.refs[0].defenseIgnoreAdditive,.05);}
      else {const expected=calculateChallenge({firstTeam:resolve('first'),secondTeam:resolve('second'),defense:{challengeBreakCoefficient:.9601}});assert.deepEqual(refs.refs.map(r=>r.target),['firstTeam','secondTeam','sharedArena']);
        for(const ref of refs.refs){close(ref.rate,expected[ref.target].defenseBreak);close(ref.defenseIgnoreAdditive??0,expected[ref.target].defenseIgnoreAdditive??0);}
        close(refs.refs[0].rate,1-(1-.4)*(1-.15));close(refs.refs[1].rate,.15);close(refs.refs[2].rate,1-(1-.4)*(1-.15));close(refs.refs[2].defenseIgnoreAdditive,.05);
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
