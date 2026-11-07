import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { combineDefenseRates, combineExternalSources, parseDefensePercentage, isDefensePercentageDraft } from '../dist/calculation/battle-defense.js';
import { calculateFinalDamage } from '../dist/calculation/final-damage.js';
import { finalDamageInputs } from '../dist/calculation/loadout-engine.js';
import { defaultBattleDefense, parseBattleDefense, externalDefenseRate, createBattleDefenseStore, BATTLE_DEFENSE_KEY, teamRevision } from '../dist/frontend/battle-defense-state.js';
import { teamDefenseReferences } from '../dist/frontend/team-defense-reference.js';
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
