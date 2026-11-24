import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeaponBaseAttack } from '../dist/calculation/attack.js';
import { resolveRaidSetEffects, resolveWeaponGrowth } from '../dist/calculation/equipment-effects.js';
import { abyssWeapon, defaultWeapon, selectedWeapon, weaponTypeField } from '../dist/calculation/weapon-types.js';
import { evaluateLoadout, projectDamage, resolveLoadoutSources } from '../dist/frontend/projection.js';
import { finalDamageInputs } from '../dist/calculation/loadout-engine.js';
import { profilesKey } from '../dist/frontend/loadout-profiles.js';
import { parseLoadoutJson, serializeLoadout } from '../dist/frontend/loadout-transfer.js';
import { parseState } from '../dist/frontend/state.js';
import { gameData, sample } from './loadout-evaluation-harness.mjs';
import { uiPage } from './ui-update-harness.mjs';
import { scenarios } from './loadout-evaluation-scenarios.mjs';

const abyssGrowth = gameData.growth.abyss;
const state = (values = {}) => parseState(JSON.stringify({ ...sample, values: { ...sample.values, ...values } }));
const abyssState = (values = {}) => state({ [weaponTypeField]: abyssWeapon, ...values });

test('abyss weapon uses offset 35 and rounds before applying the shared enhancement multiplier', () => {
  const reference = { physicalClassCoefficient: 590, magicalClassCoefficient: 590,
    weaponAttackLevelOffset: abyssGrowth.attackLevelOffset, attackLevel: 0, weaponEnhancementFactor: 1 };
  assert.equal(calculateWeaponBaseAttack(reference).physicalAttack, 10844);
  assert.equal(calculateWeaponBaseAttack({ ...reference, physicalClassCoefficient: 580 }).physicalAttack, 10634);
  assert.equal(calculateWeaponBaseAttack({ ...reference, physicalClassCoefficient: 400 }).physicalAttack, 6863);
  const enhanced = { ...reference, weaponEnhancementFactor: gameData.attack.weaponEnhancementFactors['12'] };
  assert.equal(calculateWeaponBaseAttack({ ...enhanced, attackLevel: 12 }).physicalAttack, 34804.1);
  const fullyGrown = calculateWeaponBaseAttack({ ...enhanced, attackLevel: 12 + 20 }).physicalAttack;
  assert.equal(fullyGrown, 13388 * enhanced.weaponEnhancementFactor);
  assert.equal(Math.floor(fullyGrown), 39494);
});

test('abyss +13 at growth Lv.5 reaches 44,849 when weapon attack is truncated', async t => {
  const minimal = scenarios.find(entry => entry.id === 'minimal-complete').state;
  const loadout = { ...minimal, Job: 'IM', values: { ...minimal.values,
    [weaponTypeField]: abyssWeapon, 'Weapon.ENHC': 'Lv.13', [abyssGrowth.settingKey]: 'Lv.5',
  } };
  assert.equal(gameData.attack.classes[loadout.Job].physical, 590);

  const { result } = projectDamage(gameData, loadout);
  const attackLevel = result.attributes.stats.attackLevel;
  assert.equal(attackLevel.finalTotal, 32);
  assert.deepEqual(Object.fromEntries(attackLevel.sharedSources.map(({ sourceId, valuePct }) => [sourceId, valuePct])), {
    'abyss-weapon-enhancement:12': 12,
    'weapon-growth': 20,
  });
  assert.equal(result.attack.weaponPhysicalAttack, 44849.8);
  assert.equal(Math.floor(result.attack.weaponPhysicalAttack), 44849);

  const page = await uiPage(loadout, null);
  t.after(() => page.close());
  const rows = page.dom.window.document.querySelectorAll('[data-disclosure-key="stat:attackPower"] .stat-source-row');
  const weapon = [...rows].find(row => row.querySelector('span').textContent === '武器基礎攻擊力');
  assert.equal(weapon?.querySelector('strong').textContent, '44,849.8');
});

test('abyss growth and enhancement thresholds retain all bonuses reached so far', () => {
  const levels = [{}, { allSkillDamagePct: 10 }, { allSkillDamagePct: 10, attackLevel: 10 },
    { allSkillDamagePct: 15, attackLevel: 10 }, { allSkillDamagePct: 15, attackLevel: 15 },
    { allSkillDamagePct: 20, attackLevel: 20 }];
  assert.deepEqual(abyssGrowth.levels.map(entry => entry.name), ['Lv.0', 'Lv.1', 'Lv.2', 'Lv.3', 'Lv.4', 'Lv.5']);
  for (const [level, stats] of levels.entries()) assert.deepEqual(resolveWeaponGrowth(abyssGrowth, 'Lv.' + level).stats, stats);
  const expected = [{ doubleAttackPct: 12 }, { polarizationPct: 10 }, { attackLevel: 12 }, { critDamagePct: 10 }];
  for (const level of [8, 9, 10, 11, 12, 13]) {
    const input = resolveLoadoutSources(gameData, abyssState({ 'Weapon.ENHC': 'Lv.' + level }));
    const milestones = input.sources.shared.filter(source => source.sourceId.startsWith('abyss-weapon-enhancement:'));
    assert.deepEqual(milestones.map(source => source.stats), expected.slice(0, Math.max(0, level - 9)));
    assert.equal(input.sources.shared.some(source => source.sourceId.startsWith('weapon-transform:')), false);
  }
});

test('raid sets count the actual weapon and preserve diminishing critical-rate points', () => {
  const gears = ['夢緣香爐', '暗鬼的徽章', '夢繞氣息', 'Type-Q女王的勳章', '命運的預言書', '靈魂的枷鎖'];
  const total = (names, weapon) => Object.fromEntries(resolveRaidSetEffects(gameData.raidSets, names, weapon)
    .map(({ sourceId, stats }) => [sourceId, stats]));
  assert.deepEqual(total([gears[0]], abyssWeapon), { 'raid-set-18:2set': { bossDamagePct: 5 } });
  assert.deepEqual(total([gears[0], gears[0]], abyssWeapon), total([gears[0]], abyssWeapon));
  assert.deepEqual(total([gears[0], gears[1]], abyssWeapon), {
    'raid-set-18:2set': { bossDamagePct: 5 }, 'raid-set-18:3set': { polarizationPct: 3, bleedDamagePct: 3 },
  });
  assert.deepEqual(total([gears[3]], abyssWeapon), {});
  assert.deepEqual(total([gears[3]], defaultWeapon), { 'raid-set-21:2set': { critRatePct: 5, bossDamagePct: 7 } });
  assert.deepEqual(total([gears[3], gears[4]], defaultWeapon), {
    'raid-set-21:2set': { critRatePct: 5, bossDamagePct: 7 }, 'raid-set-21:3set': { polarizationPct: 5, bleedDamagePct: 5 },
  });
  assert.deepEqual(total([gears[0], gears[1], gears[2]], defaultWeapon), total([gears[0], gears[1]], abyssWeapon));
});

test('the selected weapon and its growth round-trip while old loadouts default to the original weapon', () => {
  const original = state();
  for (const { choiceField, valueField } of gameData.transformations.slots) {
    delete original.values[choiceField];
    delete original.values[valueField];
  }
  const current = abyssState({ 'Weapon.AbyssGrowth': 'Lv.5', 'Accessory.Bottom': '夢繞氣息' });
  const oldSave = parseLoadoutJson(serializeLoadout(original, gameData).json, current, gameData).state;
  assert.equal(oldSave.values[weaponTypeField], undefined);
  assert.equal(selectedWeapon(oldSave.values), defaultWeapon);
  const saved = parseLoadoutJson(serializeLoadout(current, gameData).json, original, gameData).state;
  for (const field of [weaponTypeField, abyssGrowth.settingKey, 'Accessory.Bottom'])
    assert.equal(saved.values[field], current.values[field], field);

  const result = projectDamage(gameData, saved).result;
  const level = result.attributes.stats.attackLevel.finalTotal;
  const expected = calculateWeaponBaseAttack({
    attackLevel: level,
    physicalClassCoefficient: gameData.attack.classes[saved.Job].physical,
    magicalClassCoefficient: gameData.attack.classes[saved.Job].magical,
    weaponEnhancementFactor: gameData.attack.weaponEnhancementFactors['12'],
    weaponAttackLevelOffset: abyssGrowth.attackLevelOffset,
  });
  assert.equal(result.attack.weaponMagicalAttack, expected.magicalAttack);
  const shared = result.attributes.stats.magicalAttack.sharedSources;
  assert.equal(shared.find(entry => entry.sourceId === 'weapon-base-attack').valuePct, expected.magicalAttack);
});

test('weapon picker switches growth fields and restores previous transformation controls on undo', async t => {
  const page = await uiPage(state({ 'Weapon.AbyssGrowth': 'Lv.5' }), null);
  t.after(() => page.dom.window.close());
  const doc = page.dom.window.document;
  const choices = [...doc.querySelectorAll('[data-weapon-type]')];
  assert.deepEqual(choices.map(button => button.textContent), [abyssWeapon, defaultWeapon]);
  assert.equal(choices[1].getAttribute('aria-pressed'), 'true');
  assert(doc.querySelector('.weapon-transformation-grid'));
  choices[0].click();
  assert.equal(page.readState().values[weaponTypeField], abyssWeapon);
  const active = doc.querySelector('[data-weapon-type][aria-pressed="true"]');
  assert.equal(active.textContent, abyssWeapon);
  assert.equal(doc.querySelector('.weapon-transformation-grid'), null);
  assert.equal(doc.querySelector('[data-field-id="Weapon.AbyssGrowth"] input').value, 'Lv.5');
  doc.querySelector('#undo').click();
  assert(doc.querySelector('.weapon-transformation-grid'));
  assert.equal(doc.querySelector('[data-weapon-type][aria-pressed="true"]').textContent, defaultWeapon);
  doc.querySelector('#redo').click();
  assert.equal(doc.querySelector('[data-weapon-type][aria-pressed="true"]').textContent, abyssWeapon);
  assert.equal(doc.querySelector('.weapon-transformation-grid'), null);
});

test('accessory order and the description-only effect are available through the real catalog', () => {
  const items = gameData.catalogs['equipment/accessories.json'].items;
  for (const [slot, name] of [['faceTop', '被侵蝕的荊棘角'], ['earring', '格雷特的勳章']])
    assert.equal(items.find(item => item.slotId === slot && item.active).name, name);
  const dream = items.filter(item => item.slotId === 'bottom' && item.active).at(-1);
  assert.equal(dream.name, '夢繞氣息');
  assert.equal(dream.pickerDescription, '動作速度 7%');
  assert.deepEqual(dream.stats, {});
});


test('bottom accessories show the appraisal notice, with action speed shown only in the dream option', async t => {
  const page = await uiPage(state(), null);
  t.after(() => page.close());
  const { document, Event } = page.dom.window;
  document.querySelector('[data-slot-id="Accessory.Bottom"]').click();
  const panel = document.querySelector('#inspector');
  const selected = panel.querySelector('[data-field-id="Accessory.Bottom"] input');
  assert.equal(selected.value, '靈魂的枷鎖');
  assert.match(panel.textContent, /此飾品不可鑑定/);

  function select(name) {
    const input = panel.querySelector('[data-field-id="Accessory.Bottom"] input');
    input.dispatchEvent(new Event('focus'));
    const options = document.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]');
    const option = [...options].find(row => row.querySelector('span').textContent === name);
    assert(option, name);
    if (name === '夢繞氣息') assert.equal(option.querySelector('small').textContent, '動作速度 7%');
    option.click();
    assert.equal(page.readState().values['Accessory.Bottom'], name);
    assert.match(panel.textContent, /此飾品不可鑑定/);
    assert.doesNotMatch(panel.querySelector('.accessory-item-description')?.textContent ?? '', /動作速度/);
  }
  select('發光之花');
  select('夢繞氣息');
});

test('isolated coefficient 590 loadouts verify every selectable enhancement and growth combination', () => {
  const minimal = scenarios.find(entry => entry.id === 'minimal-complete').state;
  const growthLevels = [0, 0, 10, 10, 15, 20];
  const growthSkill = [0, 10, 10, 15, 15, 20];
  const enhancements = { 8: 1.6, 9: 1.75, 10: 2.15, 11: 2.55, 12: 2.95, 13: 3.35 };
  assert.deepEqual(gameData.attack.weaponEnhancementFactors, enhancements);
  assert.equal(gameData.attack.classes.IM.physical, 590);

  for (const [enhancement, factor] of Object.entries(enhancements)) {
    for (const [growth, growthBonus] of growthLevels.entries()) {
      const loadout = { ...minimal, Job: 'IM', values: { ...minimal.values,
        [weaponTypeField]: abyssWeapon, 'Weapon.ENHC': 'Lv.' + enhancement, [abyssGrowth.settingKey]: 'Lv.' + growth,
      } };
      const level = Number(enhancement);
      const result = projectDamage(gameData, loadout).result;
      const attackLevel = growthBonus + (level >= 12 ? 12 : 0);
      assert.equal(result.attributes.stats.attackLevel.finalTotal, attackLevel);
      const sources = resolveLoadoutSources(gameData, loadout).sources.shared;
      assert.equal(sources.find(entry => entry.sourceId === 'weapon-growth')?.stats.allSkillDamagePct ?? 0, growthSkill[growth]);
      assert.equal(result.attack.weaponPhysicalAttack, Math.floor(10844 + 79.5 * attackLevel) * factor);
    }
  }
  const original = { ...minimal, Job: 'IM', values: { ...minimal.values, 'Weapon.ENHC': 'Lv.12', 'Weapon.Growth': 'Lv.0' } };
  const before = projectDamage(gameData, original).result;
  assert.equal(before.attack.weaponPhysicalAttack, Math.floor(10844 + 79.5 * 15) * 2.95);
});

test('real accessory slots count each equipped raid piece when the selected weapon changes', () => {
  const minimal = scenarios.find(entry => entry.id === 'minimal-complete').state;
  const setSources = (weapon, slots) => {
    const loadout = { ...minimal, values: { ...minimal.values, [weaponTypeField]: weapon, ...slots } };
    return resolveLoadoutSources(gameData, loadout).sources.shared.filter(source => source.sourceId.startsWith('raid-set-'));
  };
  const abyssPieces = { 'Accessory.Support': '夢緣香爐', 'Accessory.WeaponAccessory': '暗鬼的徽章' };
  const dragonPieces = { 'Accessory.Support': '命運的預言書', 'Accessory.WeaponAccessory': 'Type-Q女王的勳章' };
  const abyssTiers = [{ sourceId: 'raid-set-18:2set', stats: { bossDamagePct: 5 } },
    { sourceId: 'raid-set-18:3set', stats: { polarizationPct: 3, bleedDamagePct: 3 } }];
  const dragonTiers = [{ sourceId: 'raid-set-21:2set', stats: { critRatePct: 5, bossDamagePct: 7 } },
    { sourceId: 'raid-set-21:3set', stats: { polarizationPct: 5, bleedDamagePct: 5 } }];

  assert.deepEqual(setSources(abyssWeapon, {}), []);
  assert.deepEqual(setSources(defaultWeapon, {}), []);
  assert.deepEqual(setSources(abyssWeapon, { 'Accessory.Support': '命運的預言書' }), []);
  assert.deepEqual(setSources(defaultWeapon, { 'Accessory.Support': '夢緣香爐' }), []);
  assert.deepEqual(setSources(abyssWeapon, { 'Accessory.Support': '夢緣香爐' }), abyssTiers.slice(0, 1));
  assert.deepEqual(setSources(abyssWeapon, abyssPieces), abyssTiers);
  assert.deepEqual(setSources(defaultWeapon, abyssPieces), abyssTiers.slice(0, 1));
  assert.deepEqual(setSources(defaultWeapon, { 'Accessory.Support': '命運的預言書' }), dragonTiers.slice(0, 1));
  assert.deepEqual(setSources(defaultWeapon, dragonPieces), dragonTiers);
  assert.deepEqual(setSources(abyssWeapon, dragonPieces), dragonTiers.slice(0, 1));
  assert.deepEqual(setSources(abyssWeapon, { ...abyssPieces, 'Accessory.Bottom': '夢繞氣息' }), abyssTiers);
  assert.deepEqual(setSources(defaultWeapon, { ...dragonPieces, 'Accessory.Bottom': '靈魂的枷鎖' }), dragonTiers);
  const mixed = { 'Accessory.Support': '命運的預言書', 'Accessory.WeaponAccessory': '暗鬼的徽章' };
  assert.deepEqual(setSources(abyssWeapon, mixed), abyssTiers.slice(0, 1));
  assert.deepEqual(setSources(defaultWeapon, mixed), dragonTiers.slice(0, 1));
});

test('switching, baseline restore, and production transfers preserve separate weapon settings and engravings', async t => {
  const original = state();
  const engravedValues = {
    'Weapon.Engraving.1.Enabled': 1, 'Weapon.Engraving.1.Effect': 'attack', 'Weapon.Engraving.1.Value': '4',
    'Weapon.Engraving.2.Enabled': 1, 'Weapon.Engraving.2.Effect': 'all-skill-damage', 'Weapon.Engraving.2.Value': '5',
    'Weapon.Engraving.3.Enabled': 1, 'Weapon.Engraving.3.Effect': 'critical-damage', 'Weapon.Engraving.3.Value': '5',
  };
  const abyss = abyssState({ ...engravedValues, [abyssGrowth.settingKey]: 'Lv.5' });
  const baseline = abyssState({ ...engravedValues, [abyssGrowth.settingKey]: 'Lv.3' });
  const profiles = [original, abyss].map((loadout, index) => ({
    id: index ? 'abyss' : 'dragon', name: index ? '深淵配置' : '死龍配置', loadout, baseline: index ? baseline : original,
    createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z',
  }));
  const page = await uiPage(original, original, { storage: { [profilesKey]: JSON.stringify({
    schemaVersion: 1, profiles, activeProfileId: 'dragon',
  }) } });
  t.after(() => page.close());
  const { document } = page.dom.window;
  const openProfile = async (id, weapon) => {
    document.querySelector('[data-profile-id="' + id + '"]').click();
    for (let attempt = 0; attempt < 160 && selectedWeapon(page.readState().values) !== weapon; attempt++) {
      [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '放棄修改並切換')?.click();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(selectedWeapon(page.readState().values), weapon, document.querySelector('#profile-message').textContent);
  };
  const verifyAbyss = (growth) => {
    const snapshot = page.readState();
    assert.equal(selectedWeapon(snapshot.values), abyssWeapon);
    assert.equal(snapshot.values[abyssGrowth.settingKey], growth);
    const sources = resolveLoadoutSources(gameData, snapshot).sources.shared;
    assert(!sources.some(entry => entry.sourceId.startsWith('weapon-transform:')));
    assert.deepEqual(sources.filter(entry => entry.sourceId.startsWith('weapon-engraving:')).map(entry => entry.stats), [
      { multiplicativeDamagePct: 4 }, { multiplicativeDamagePct: 5 }, { multiplicativeCritDamagePct: 5 },
    ]);
  };
  await openProfile('abyss', abyssWeapon);
  verifyAbyss('Lv.5');
  const exported = await page.exportJson();
  document.querySelector('[data-weapon-type="死龍遺言"]').click();
  const transform = gameData.transformations.slots[0];
  assert.equal(page.readState().values[transform.valueField], original.values[transform.valueField]);
  assert(resolveLoadoutSources(gameData, page.readState()).sources.shared.some(entry => entry.sourceId.startsWith('weapon-transform:')));
  assert(!resolveLoadoutSources(gameData, page.readState()).sources.shared.some(entry => entry.sourceId.startsWith('abyss-weapon-enhancement:')));
  document.querySelector('#restore-baseline').click();
  verifyAbyss('Lv.3');
  await openProfile('dragon', defaultWeapon);
  await page.importJson(JSON.stringify(exported));
  verifyAbyss('Lv.5');
  assert.equal(page.readState().values[transform.valueField], original.values[transform.valueField]);
});

test('restoring only legacy action-speed aggregation has no effect on the damage formula', () => {
  const legacy = structuredClone(gameData);
  legacy.attributes.attributes.push({ key: 'actionSpeedPct', name: '動作速度%', unit: 'percent',
    calculationScope: 'characterTotal', aggregation: 'sum', active: true });
  const horn = legacy.catalogs['equipment/accessories.json'].items.find(entry => entry.name === '被侵蝕的荊棘角');
  horn.stats.actionSpeedPct = 3;
  const cases = [
    [state(), 0],
    [state({ 'Accessory.FaceTop': horn.name }), 3],
    [abyssState({ [abyssGrowth.settingKey]: 'Lv.5', 'Accessory.Bottom': '夢繞氣息' }), 0],
    [abyssState({ [abyssGrowth.settingKey]: 'Lv.5', 'Accessory.Bottom': '夢繞氣息', 'Accessory.FaceTop': horn.name }), 3],
  ];
  for (const [loadout, speed] of cases) {
    const before = evaluateLoadout(legacy, loadout, false, true);
    const after = evaluateLoadout(gameData, loadout, false, true);
    assert.ok(before.damage?.result);
    assert.ok(after.damage?.result);
    assert.equal(before.attributes.stats.actionSpeedPct.finalTotal, speed);
    assert.ok(!Object.hasOwn(after.attributes.stats, 'actionSpeedPct'));
    for (const key of ['physicalAttack', 'magicalAttack'])
      assert.equal(after.attributes.stats[key].finalTotal, before.attributes.stats[key].finalTotal);
    assert.deepEqual(after.damage.result.attack, before.damage.result.attack);
    assert.deepEqual(finalDamageInputs(after.comparisonInput, after.damage.result),
      finalDamageInputs(before.comparisonInput, before.damage.result));
    assert.deepEqual(after.damage.result.finalDamage, before.damage.result.finalDamage);
  }
});
