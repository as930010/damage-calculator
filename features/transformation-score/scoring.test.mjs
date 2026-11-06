import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareRolls, gradeGain, scoreConfiguration } from '../../dist/features/transformation-score/scoring.js';
import { readRatingLoadout, readArmorRatingLoadout } from '../../dist/features/transformation-score/loadout.js';
import { projectDamage } from '../../dist/frontend/projection.js';
import { parseState } from '../../dist/frontend/state.js';
import { validTransformationValue, normalizeTransformationValues, normalizeTransformationSelections } from '../../dist/calculation/transformation-selections.js';
import { serializeLoadout, parseLoadoutJson } from '../../dist/frontend/loadout-transfer.js';
import { codeForFieldId } from '../../dist/frontend/field-ids.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const data = json('../../dist/data/game-data.json');
const saved = json('../../data/examples/public-example-2026-09-28.json');
const original = JSON.stringify(saved);
const blank = { choice: '', roll: null };
const four = (...lines) => [...lines, ...Array(4 - lines.length).fill(blank)];
const line = (choice, roll) => ({ choice, roll });
const close = (a, b) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b)), `${a} != ${b}`);

// Independent oracle: edit a copy of the actual homepage fields, then run its entire projection.
function home(state, lines, game = data) {
  const copy = structuredClone(state);
  game.transformations.slots.forEach(({choiceField, valueField}, i) => {
    delete copy.values[choiceField];
    delete copy.values[valueField];
    const selection = lines[i];
    if (!selection?.choice) return;
    copy.values[choiceField] = selection.choice;
    copy.values[valueField] = selection.roll / (selection.choice.includes('等級') ? 1 : 100);
  });
  return projectDamage(game, copy).result;
}
const expected = [
  ['雙攻% × 強化','攻擊力% × 強化',.8,.1], ['攻擊力等級 × 強化','攻擊力等級 × 強化',.8,.1],
  ['技能傷害% × 強化','所有技能傷害 × 強化',.8,.1], ['致命傷害% × 強化','致命一擊傷害 × 強化',.8,.1],
  ['雙攻%','攻擊力%',6,1], ['攻擊力等級','攻擊力等級',6,1], ['技能傷害%','所有技能傷害',6,1],
  ['致命傷害%','致命一擊傷害',6,1], ['兩極化%','兩極化',5,1], ['流血%','流血',5,1],
  ['強烈技傷%','強烈技能傷害',6,1], ['超越技傷%','超越技能傷害',6,1],
  ['Boss傷害%','Boss 傷害增加',8,1], ['無視防禦%','無視防禦',4.5,.5],
];
const context = readRatingLoadout(data, saved);
test('All stored tiers preserve fractions, numeric strings and floating-point representations', () => {
  for (const rule of context.rules) for (const tier of rule.rolls) {
    const value = tier / rule.valueMultiplier;
    for (const raw of [value, String(value), value.toExponential(), value + 1e-13]) assert.equal(validTransformationValue(rule, raw), true, rule.label);
    for (const raw of [NaN, Infinity, 'bad', null, true, {}, '6.5%', (rule.minRoll - rule.step) / rule.valueMultiplier,
      (rule.maxRoll + rule.step) / rule.valueMultiplier, (tier + rule.step / 3) / rule.valueMultiplier]) assert.equal(validTransformationValue(rule, raw), false, rule.label + ': ' + raw);
  }
});
test('Cleanup only removes illegal values and describes each original slot and value', () => {
  const values = { ...saved.values, 'Weapon.Transform.1.Stat':'流血%', 'Weapon.Transform.1.Value':.055,
    'Weapon.Transform.2.Stat':'無視防禦%', 'Weapon.Transform.2.Value':.065,
    'Weapon.Transform.3.Stat':'攻擊力等級', 'Weapon.Transform.3.Value':6.5 };
  const copy = {...values};
  const result = normalizeTransformationValues(data.transformations, values);
  assert.deepEqual(result.fields,['Weapon.Transform.1.Value','Weapon.Transform.3.Value']);
  assert.match(result.messages[0],/第 1 條「流血」.*5.5%.*步進 1.*已清空/);
  assert.match(result.messages[1],/第 3 條「攻擊力等級」.*6.5 級.*已清空/);
  for (const [key,value] of Object.entries(copy)) if (!result.fields.includes(key)) assert.equal(values[key],value);
  assert.deepEqual(normalizeTransformationValues(data.transformations,values).messages,[]);
});
test('Compact JSON retains legal old tiers and reports only illegal transformation values', () => {
  const input = structuredClone(saved);
  const examples = [['流血%',.08],['兩極化%',.12],['攻擊力等級',9],['無視防禦%',.065]];
  data.transformations.slots.forEach((slot,i)=>{input.values[slot.choiceField]=examples[i][0];input.values[slot.valueField]=examples[i][1]});
  const json = serializeLoadout(input,data).json;
  const imported = parseLoadoutJson(json,input,data);
  assert.equal(imported.transformationWarnings,undefined);
  data.transformations.slots.forEach(slot=>{assert.equal(imported.state.values[slot.choiceField],input.values[slot.choiceField]);assert.equal(imported.state.values[slot.valueField],input.values[slot.valueField])});
  const roundTrip = JSON.parse(serializeLoadout(imported.state,data).json).values;
  for (const slot of data.transformations.slots) {
    assert.equal(roundTrip[String(codeForFieldId(slot.choiceField))],input.values[slot.choiceField]);
    assert.equal(roundTrip[String(codeForFieldId(slot.valueField))],input.values[slot.valueField]);
  }
  for (const bad of [.04,.055,.13,'not numeric',null]) {
    const raw = JSON.parse(json);raw.values[String(codeForFieldId('Weapon.Transform.1.Value'))]=bad;
    const changed = parseLoadoutJson(JSON.stringify(raw),input,data);
    assert.equal(changed.state.values['Weapon.Transform.1.Value'],undefined);
    assert.equal(changed.state.values['Weapon.Transform.1.Stat'],'流血%');
    assert.equal(changed.transformationWarnings.length,1);
    assert.match(changed.transformationWarnings[0],/第 1 條.*流血.*已清空/);
    for(const slot of data.transformations.slots.slice(1)) assert.equal(changed.state.values[slot.valueField],input.values[slot.valueField]);
  }
});
test('Repeated effective choices keep the first; unrelated slots remain explicit with no stale roll', () => {
  const source=[line('技能傷害%',6),line('技能傷害%',13),line('技能傷害% × 強化',1.5),line('無關傷害',12)];
  assert.deepEqual(normalizeTransformationSelections(source),[source[0],blank,source[2],line('無關傷害',null)]);
  const score=scoreConfiguration(context,source);
  close(score.after,home(saved,[source[0],blank,source[2]]).finalDamage.finalDamage);
});
for(const count of [1,2,3,4]) test(count+' unrelated choices are repeatable zero effects with unchanged bounds',()=>{
  const selections=[...Array(count).fill(line('無關傷害',13)),...Array(4-count).fill(blank)];
  const score=scoreConfiguration(context,selections);
  assert.equal(score.gain,0);assert.equal(score.pr,0);assert.equal(score.before,score.after);
  const mixed=selections.slice();if(count<4)mixed[count]=line('技能傷害%',13);
  close(scoreConfiguration(context,mixed).after,home(saved,count<4?[line('技能傷害%',13)]:[]).finalDamage.finalDamage);
  assert.equal(context.comparisons.length,14);
  assert.equal(context.upperSelection.some(line=>line.choice==='無關傷害'),false);
  assert.throws(()=>scoreConfiguration({...context,upper:0},selections),/評分基準/);
});
assert.deepEqual(context.rules.map(rule => rule.choice), expected.map(row => row[0]));
for (const [i, [choice,label,min,step]] of expected.entries()) {
  test(label + ' — order, unit and all eight rolls match the homepage', () => {
    const { rule, gains } = context.comparisons[i];
    assert.equal(rule.label, label);
    assert.equal(rule.valueMultiplier, choice.includes('等級') ? 1 : 100);
    assert.equal(rule.minRoll, min);
    assert.equal(rule.step, step);
    const tiers = Array.from({length:8}, (_, index) => (10 * min + index * (10 * step)) / 10);
    assert.deepEqual(rule.rolls, tiers);
    assert.equal(rule.maxRoll, tiers.at(-1));
    for (const [j,roll] of tiers.entries()) {
      const lines = four(line(choice,roll));
      const damage = home(saved,lines).finalDamage.finalDamage;
      close(gains[j], damage / context.baselineDamage - 1);
      close(scoreConfiguration(context,lines).after, damage);
    }
  });
}

test('Low and high references combine four distinct categories in the engine', () => {
  for (const tier of [0,7]) {
    const ranked = expected.map(([choice,,min,step]) => {
      const selection = line(choice,(min*10+tier*(step*10))/10);
      return {selection,damage:home(saved,[selection]).finalDamage.finalDamage};
    }).sort((a,b) => tier ? b.damage-a.damage : a.damage-b.damage);
    const selected = ranked.slice(0,4).map(entry => entry.selection);
    close(tier ? context.upper : context.lower,home(saved,selected).finalDamage.finalDamage / context.baselineDamage - 1);
  }
  const current = scoreConfiguration(context,context.actual);
  close(current.after,projectDamage(data,saved).result.finalDamage.finalDamage);
  close(current.pr,current.gain/context.upper*100);
  assert.equal(scoreConfiguration(context,four()).gain,0);
  assert.equal(JSON.stringify(saved), original);
});

test('Bottom chooses ascending finite gains, includes zero and uses definition order for ties', () => {
  const rules = context.rules;
  const gain = new Map(rules.map((rule,i)=>[rule.choice,i<5?0:i/100]));
  const calls=[];
  const evaluator = lines => {
    calls.push(lines.map(line=>line.choice));
    if(lines.length===1){const value=gain.get(lines[0].choice);return value===null?null:100*(1+value)}
    return 123;
  };
  let result=compareRolls(100,rules,evaluator);
  assert.deepEqual(result.lowerSelection.map(line=>line.choice),rules.slice(0,4).map(rule=>rule.choice));
  close(result.lower,.23);
  gain.set(rules[0].choice,NaN);gain.set(rules[1].choice,Infinity);gain.set(rules[2].choice,null);gain.set(rules[3].choice,-.5);
  result=compareRolls(100,rules,evaluator);
  assert.deepEqual(result.lowerSelection.map(line=>line.choice),rules.slice(4,8).map(rule=>rule.choice));
});
test('Weapon +12 compares 0.8% enhanced attack with 6% ordinary attack without changing either effect',()=>{
  const state={...saved,values:{...saved.values,'Weapon.ENHC':'Lv.12'}};
  const ctx=readRatingLoadout(data,state);
  const enhanced=ctx.comparisons.find(entry=>entry.rule.choice==='雙攻% × 強化').gains[0];
  const plain=ctx.comparisons.find(entry=>entry.rule.choice==='雙攻%').gains[0];
  const base=home(state,[]).attributes.stats.doubleAttackPct.finalTotal;
  close(home(state,[line('雙攻% × 強化',.8)]).attributes.stats.doubleAttackPct.finalTotal-base,9.6);
  close(home(state,[line('雙攻%',6)]).attributes.stats.doubleAttackPct.finalTotal-base,6);
  assert.ok(enhanced>plain);
  for(const selection of ctx.lowerSelection){
    const gain=ctx.comparisons.find(entry=>entry.rule.choice===selection.choice).gains[0];
    assert.ok(gain<=plain);
  }
  assert.ok(!ctx.lowerSelection.some(line=>line.choice==='雙攻% × 強化'));
});
test('Zero defense, skill-share endpoints and capped polarization remain real bottom candidates',()=>{
  for(const share of [0,100]){
    const game=structuredClone(data);
    game.parameters.fixedEffects.push({sourceId:'polarization-at-cap',stats:{polarizationPct:60}});
    const state={...saved,transcendenceSkillDamageSharePct:share,values:{...saved.values,'Stage.BossDEF':0}};
    const ctx=readRatingLoadout(game,state);
    const chosen=ctx.lowerSelection.map(line=>line.choice);
    for(const choice of ['無視防禦%','兩極化%',share===0?'超越技傷%':'強烈技傷%']) assert.ok(chosen.includes(choice));
    const oldLow=ctx.comparisons.map(({rule,gains})=>({choice:rule.choice,roll:rule.rolls[0],gain:gains[0]})).filter(x=>x.gain!==null).sort((a,b)=>b.gain-a.gain).slice(0,4);
    close(ctx.gradingLower,ctx.simulatedDamage(oldLow)/ctx.baselineDamage-1);
    const score=scoreConfiguration(ctx,ctx.actual);
    close(score.pr,score.gain/ctx.upper*100);
    assert.equal(score.grade,gradeGain(score.gain,ctx.gradingLower,ctx.upper));
  }
});

for (const strong of [0,25,50,75,100]) {
  test('Saved skill share and mixed strong/transcendence rolls at ' + strong + '% strong', () => {
    const state = parseState(JSON.stringify({...saved,transcendenceSkillDamageSharePct:100-strong}));
    const ctx = readRatingLoadout(data,state);
    const base = home(state,[]);
    const { combinedFactor } = base.finalDamage.skillDamageWeighting;
    for (const [a,b] of [[13,0],[0,13],[13,6]]) {
      const rows = four(...[a && line('強烈技傷%',a), b && line('超越技傷%',b)].filter(Boolean));
      const estimate = (a*strong + b*(100-strong)) / 10000 / combinedFactor;
      const score = scoreConfiguration(ctx,rows);
      close(score.gain,estimate);
      close(score.after,home(state,rows).finalDamage.finalDamage);
      close(score.pr,estimate/ctx.upper*100);
      assert.equal(score.grade,gradeGain(estimate,ctx.gradingLower,ctx.upper));
    }
  });
}

for (const boss of [0,10,71.92,99]) {
  test('Repeated ignore rolls keep the first and combine with existing sources at Boss defense ' + boss, () => {
    const state = {...saved,values:{...saved.values,'Stage.BossDEF':boss}};
    const base = home(state,[]);
    const defense = base.attributes.stats.defenseIgnorePct;
    assert.ok(defense.sharedSources.length > 1);
    const ctx = readRatingLoadout(data,state);
    for (const roll of [4.5,8]) {
      const rows = Array(4).fill(line('無視防禦%',roll));
      const score = scoreConfiguration(ctx,rows);
      const beforeDenominator = 1 - boss*defense.finalTotal/10000;
      const afterDenominator = 1 - boss*(defense.finalTotal+roll)/10000;
      close(score.gain,beforeDenominator/afterDenominator-1);
      close(score.after,home(state,[rows[0]]).finalDamage.finalDamage);
    }
  });
}
test('Zero existing ignore, near singular, singular and out-of-domain candidates', () => {
  const game = structuredClone(data);
  const state = {...saved,values:{...saved.values,'Stage.BossDEF':100}};
  delete state.values['Accessory.FaceMiddle.Appraisal.2'];
  game.spiritRecord.defaultMaxedStats.defenseIgnorePct = 0;
  const fixed = game.parameters.fixedEffects.find(effect => effect.sourceId === 'fixed-effect:title-defense-ignore');
  for (const ignore of [0,91.9,92,93]) {
    fixed.stats.defenseIgnorePct = ignore;
    close(home(state,[],game).attributes.stats.defenseIgnorePct.finalTotal,ignore);
    const ctx = readRatingLoadout(game,state);
    const rows = four(line('無視防禦%',8));
    if (ignore < 92) close(scoreConfiguration(ctx,rows).gain,(100-ignore)/(92-ignore)-1);
    else {
      assert.equal(ctx.comparisons.at(-1).gains.at(-1),null);
      assert.throws(() => scoreConfiguration(ctx,rows),/有效傷害/);
      assert.ok(Number.isFinite(ctx.upper));
    }
  }
});
test('A high-defense loadout can put ignore in the top-four PR denominator', () => {
  const game = structuredClone(data);
  game.parameters.fixedEffects.push({sourceId:'existing-defense-effect',stats:{defenseIgnorePct:75}});
  const state = {...saved,values:{...saved.values,'Stage.BossDEF':100}};
  const ctx = readRatingLoadout(game,state);
  const top = expected.map(([choice,,min,step]) => {
    const selection = line(choice,(10*min+70*step)/10);
    return {selection,damage:home(state,[selection],game).finalDamage.finalDamage};
  }).sort((a,b) => b.damage-a.damage).slice(0,4).map(row => row.selection);
  assert.equal(top[0].choice,'無視防禦%');
  close(scoreConfiguration(ctx,top).pr,100);
  close(ctx.upper,home(state,top,game).finalDamage.finalDamage/ctx.baselineDamage-1);
});
test('A capped polarization baseline gains nothing from another roll', () => {
  const game = structuredClone(data);
  game.parameters.fixedEffects.push({sourceId:'existing-polarization',stats:{polarizationPct:60}});
  const ctx = readRatingLoadout(game,saved);
  const detail = home(saved,[],game).attributes.stats.polarizationPct;
  assert.equal(detail.finalTotal,detail.cap);
  close(scoreConfiguration(ctx,four(line('兩極化%',12))).gain,0);
});
test('Legacy choice values survive reload, distinct enhanced/flat rolls combine, input stays read-only', () => {
  for (const [Job,enhancement] of [['KE',10],['DaB',13]]) {
    const state = structuredClone(saved);
    state.Job = Job;
    state.values['Weapon.ENHC'] = 'Lv.'+enhancement;
    state.values['Weapon.Transform.1.Stat'] = '技能傷害%';
    state.values['Weapon.Transform.2.Stat'] = '技能傷害% × 強化';
    state.values['Weapon.Transform.2.Value'] = .014;
    const raw = JSON.stringify(state);
    const ctx = readRatingLoadout(data,parseState(raw));
    close(scoreConfiguration(ctx,ctx.actual).after,projectDamage(data,state).result.finalDamage.finalDamage);
    assert.equal(ctx.actual[1].roll,1.4);
    assert.equal(scoreConfiguration(ctx,four(line('技能傷害%',6),line('技能傷害%',13))).after,
      scoreConfiguration(ctx,four(line('技能傷害%',6))).after);
    assert.throws(() => scoreConfiguration(ctx,four(line('雙攻%',3))),/檔位/);
    assert.equal(JSON.stringify(state),raw);
  }
  assert.throws(() => readRatingLoadout(data,{...saved,values:{'Weapon.ENHC':'Lv.9'}}),/\+10 至 \+13/);
});
test('Inclusive rating thresholds and bottom-roll threshold', () => {
  const words = ['陽壽','大畢業','小畢業','優質','堪用','我不是'];
  for (const [i,gain] of [.97,.9,.8,.65,.5,.49999].entries()) {
    assert.ok(gradeGain(gain,.5,1).startsWith(words[i]));
    if (i < 5) assert.ok(gradeGain(gain-1e-8,.5,1).startsWith(words[i+1]));
  }
});

function armorState() {
  const state = structuredClone(saved);
  for (const slot of data.innerwear.slots) {
    state.values[slot.typeField] = '內布隆';
    state.values[slot.enhancementField] = 'Lv.11';
    state.values[slot.forgingField] = '0';
    const field = data.nephronArmor.fields.find(item => item.slotId === slot.id);
    for (const entry of field.transformFields) { delete state.values[entry.attributeField]; delete state.values[entry.valueField]; }
    delete state.values[field.magazineField]; delete state.values[field.magazineLevelField];
  }
  state.lowerwearAlternativeEnabled = true;
  return state;
}
function armorHome(state, slotId, lines) {
  const copy = structuredClone(state);
  const fields = data.nephronArmor.fields.find(item => item.slotId === slotId).transformFields;
  fields.forEach((field, i) => {
    delete copy.values[field.attributeField]; delete copy.values[field.valueField];
    if (!lines[i]?.choice) return;
    copy.values[field.attributeField] = lines[i].choice;
    if (lines[i].roll !== null) copy.values[field.valueField] = lines[i].roll / 100;
  });
  return projectDamage(data, copy).result.finalDamage.finalDamage;
}
for (const slot of data.innerwear.slots) test('Armor full-engine equivalence and references: ' + slot.id, () => {
  const state = armorState();
  const original = JSON.stringify(state);
  const context = readArmorRatingLoadout(data, state, slot.id);
  assert.equal(context.actual.length, 3);
  assert.equal(context.rules.length, 15);
  close(context.baselineDamage, armorHome(state, slot.id, []));
  for (const rule of context.rules) for (const roll of rule.rolls) {
    close(context.simulatedDamage([line(rule.choice, roll)]), armorHome(state, slot.id, [line(rule.choice, roll)]));
  }
  const lines = context.rules.slice(0, 3).map(rule => line(rule.choice, rule.rolls.at(-1)));
  close(scoreConfiguration(context, lines).after, armorHome(state, slot.id, lines));
  assert.equal(context.lowerSelection.length, 3); assert.equal(context.upperSelection.length, 3);
  const sorted = context.comparisons.map(({rule,gains}, order) => ({choice:rule.choice,gain:gains[0],order}))
    .filter(item => Number.isFinite(item.gain) && item.gain >= 0).sort((a,b)=>a.gain-b.gain || a.order-b.order).slice(0,3);
  assert.deepEqual(context.lowerSelection.map(item=>item.choice), sorted.map(item=>item.choice));
  close(context.simulatedDamage(context.lowerSelection), armorHome(state, slot.id, context.lowerSelection));
  close(context.simulatedDamage(context.upperSelection), armorHome(state, slot.id, context.upperSelection));
  const zero = scoreConfiguration(context, Array(3).fill(line('無關傷害', null)));
  assert.equal(zero.gain, 0); assert.equal(zero.pr, 0);
  assert.equal(JSON.stringify(state), original);
});
test('Armor lowerwear respects both condition paths and inactive slots', () => {
  for (const lowerwear of ['lowerwearA','lowerwearB']) for (const comparison of ['above','below']) {
    const state = armorState();
    state.bossHealthCondition = { enabled:true, lowerwear, comparison };
    const id = lowerwear === 'lowerwearA' ? 'lowerwear' : 'lowerwearAlternative';
    const context = readArmorRatingLoadout(data,state,id);
    const lines = context.upperSelection;
    close(context.simulatedDamage(lines),armorHome(state,id,lines));
    assert.throws(()=>readArmorRatingLoadout(data,state,id === 'lowerwear' ? 'lowerwearAlternative':'lowerwear'), /未參與/);
  }
  const state = armorState(); state.lowerwearAlternativeEnabled = false;
  assert.throws(()=>readArmorRatingLoadout(data,state,'lowerwearAlternative'), /未參與/);
});
test('Armor enhancement, existing transformations, magazines and zero benefits remain independent', () => {
  const state = armorState();
  const field = data.nephronArmor.fields[0];
  state.values[field.magazineField] = data.nephronArmor.magazines[0].name;
  state.values[field.magazineLevelField] = 'Lv.3';
  state.values[field.transformFields[0].attributeField] = '所有技能傷害%';
  state.values[field.transformFields[0].valueField] = .01;
  for (const level of [10,11,12,13]) {
    state.values[data.innerwear.slots[0].enhancementField] = 'Lv.' + level;
    state.transcendenceSkillDamageSharePct = level === 10 ? 0 : level === 11 ? 100 : 50;
    state.values['Stage.BossDEF'] = level === 10 ? 0 : 83.94;
    const context = readArmorRatingLoadout(data,state,'upper');
    assert.equal(context.enhancement,level);
    for (const selections of [context.actual, context.upperSelection, context.lowerSelection]) {
      close(context.simulatedDamage(selections),armorHome(state,'upper',selections));
    }
  }
  state.values[data.innerwear.slots[0].typeField] = '百億';
  assert.throws(()=>readArmorRatingLoadout(data,state,'upper'), /不是內布隆/);
});
