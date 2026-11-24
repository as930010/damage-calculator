import test from 'node:test';
import assert from 'node:assert/strict';
import { beastArmorSkillEffects, beastArmorSkillFields, beastArmorSkillSourceId, beastRingSkills, beastSkillValueChoices } from '../dist/calculation/beast-armor-skill.js';
import { resolveMasterBeastEffects } from '../dist/calculation/equipment-effects.js';
import { searchIce } from '../dist/features/ice-optimizer/frontend/search.js';
import { readRatingLoadout } from '../dist/features/transformation-score/loadout.js';
import { createCatalogIndex } from '../dist/frontend/catalog-index.js';
import { codeForFieldId } from '../dist/frontend/field-ids.js';
import { encodeLibrary, encodeSingle } from '../dist/frontend/loadout-archive.js';
import { exportProfileBackup, LoadoutProfiles, parseProfileBackup, profilesKey } from '../dist/frontend/loadout-profiles.js';
import { exportWorkingLoadout, parseLoadoutJson, serializeLoadout } from '../dist/frontend/loadout-transfer.js';
import { projectDamage } from '../dist/frontend/projection.js';
import { normalizeOptionalEffectValues, parseState } from '../dist/frontend/state.js';
import { gameData, sample } from './loadout-evaluation-harness.mjs';
import { uiPage } from './ui-update-harness.mjs';

const armor = beastArmorSkillFields;
const [first, second] = beastRingSkills;
const boost = 'armor-skill-boost';
const rolls = Array.from({ length: 20 }, (_, index) => index + 1);
const index = createCatalogIndex(gameData);
const loadout = (values = {}) => parseState(JSON.stringify({ ...sample, values: { ...sample.values, ...values } }));
const fields = (slot, effect, value) => ({ [slot.effect]: effect, ...(value === undefined ? {} : { [slot.value]: value }) });
const ring = (slot, value) => fields(slot, boost, value);
const damage = state => projectDamage(gameData, state).result;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' ≈ ' + expected);
const applyBeast = (armorSkill, ringSkills) => resolveMasterBeastEffects(gameData.masterBeast, { armorSkill, ringSkills });
const getArmorSource = sources => sources.find(source => source.sourceId === beastArmorSkillSourceId);
const profile = (current, baseline) => ({
  id: 'beast-rings', name: '聖獸指環配置', loadout: current, baseline,
  createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z',
});
const library = entry => ({ schemaVersion: 1, profiles: [entry], activeProfileId: null });

test('ring selectors keep independent slots, permanent codes and all twenty integer rolls', () => {
  for (const [slot, effectCode, valueCode] of [[first, 314, 315], [second, 316, 317]]) {
    assert.deepEqual(slot.effects.map(({ id, label }) => [id, label]),
      [[boost, '增加聖獸盔甲效果'], ['unrelated', '無關傷害']]);
    assert.deepEqual([codeForFieldId(slot.effect), codeForFieldId(slot.value)], [effectCode, valueCode]);
    assert.deepEqual(beastSkillValueChoices(slot, boost), rolls);
    assert.deepEqual(index.resolveFieldChoices(slot.value, ring(slot)), rolls);
    assert.deepEqual(index.resolveFieldChoices(slot.value, fields(slot, 'unrelated')), [0]);
    assert.deepEqual(index.resolveFieldChoices(slot.value, {}), []);
  }
  assert.deepEqual(index.resolveFieldChoices(first.effect, ring(second, 20)), [boost, 'unrelated']);
  assert.deepEqual(index.resolveFieldChoices(second.effect, ring(first, 20)), [boost, 'unrelated']);
  assert.deepEqual(index.resolveFieldChoices(second.effect, fields(first, 'unrelated', 0)), [boost, 'unrelated']);
});

test('verified in-game: 5% super adaptability with 16% and 17% ring boosts yields 6.65%', () => {
  const state = loadout({ ...fields(armor, 'super-adaptability', '5'), ...ring(first, '16'), ...ring(second, 17) });
  const base = damage(loadout());
  const result = damage(state);
  const stat = result.attributes.stats.superAdaptabilityPct;
  assert.deepEqual(stat.sharedSources.find(source => source.sourceId === beastArmorSkillSourceId),
    { sourceId: beastArmorSkillSourceId, valuePct: 6.65 });
  near(stat.finalTotal - base.attributes.stats.superAdaptabilityPct.finalTotal, 6.65);
  assert.deepEqual(result.attributes.stats.adaptabilityPct, base.attributes.stats.adaptabilityPct);
  assert.equal(state.values[armor.value], '5');
});

test('ring addition scales all six armor skill keys exactly once without rounding', () => {
  const boostBy = value => ({ effect: boost, value });
  const oldSources = applyBeast();
  for (const { id, statKey } of beastArmorSkillEffects.filter(effect => effect.statKey)) {
    for (const [base, ringSkills, expected] of [
      [5, [{}, { effect: 'unrelated', value: 0 }], 5],
      [5, [boostBy(20)], 6],
      [5, [{}, boostBy('20')], 6],
      [5, [boostBy(10), boostBy(20)], 6.5],
      [5, [boostBy(20), boostBy(20)], 7],
      [3, [boostBy(1)], 3.03],
    ]) {
      const sources = applyBeast({ effect: id, value: base }, ringSkills);
      assert.deepEqual(getArmorSource(sources), { sourceId: beastArmorSkillSourceId, stats: { [statKey]: expected } });
      assert.deepEqual(sources.filter(source => source.sourceId !== beastArmorSkillSourceId), oldSources);
    }
  }

  for (const selection of [undefined, {}, { effect: 'unrelated', value: 0 }, { effect: 'boss-damage' }, { effect: 'boss-damage', value: 7 }]) {
    assert.deepEqual(applyBeast(selection, [boostBy(20), boostBy(20)]), oldSources);
  }
  for (const bad of [-1, 0, 1.5, 21, '20%', '1e1', '任意字串', undefined]) {
    assert.deepEqual(getArmorSource(applyBeast({ effect: 'boss-damage', value: 5 }, [boostBy(bad), boostBy(20)])),
      { sourceId: beastArmorSkillSourceId, stats: { bossDamagePct: 6 } });
  }
});

test('amplified armor stays one factor beside independent engravings and critical damage sources', () => {
  const engravings = {
    'Weapon.Engraving.1.Enabled': 1, 'Weapon.Engraving.1.Effect': 'attack', 'Weapon.Engraving.1.Value': '5',
    'Weapon.Engraving.2.Enabled': 1, 'Weapon.Engraving.2.Effect': 'critical-damage', 'Weapon.Engraving.2.Value': '5',
  };
  const bonuses = { ...ring(first, 20), ...ring(second, 20) };
  const base = damage(loadout());
  const engraved = damage(loadout(engravings));
  assert.deepEqual(damage(loadout(bonuses)), base);
  for (const id of ['all-damage', 'all-skill-damage']) {
    const result = damage(loadout({ ...engravings, ...bonuses, ...fields(armor, id, 5) }));
    const factors = result.generalMultiplicativeDamage;
    assert.deepEqual(factors.factors.filter(entry => entry.sourceId !== beastArmorSkillSourceId), engraved.generalMultiplicativeDamage.factors);
    assert.deepEqual(factors.factors.filter(entry => entry.sourceId === beastArmorSkillSourceId).map(entry => entry.valuePct), [7]);
    near(factors.productBeforeBaseline / base.generalMultiplicativeDamage.productBeforeBaseline, 1.1235);
  }
  const critical = damage(loadout({ ...engravings, ...bonuses, ...fields(armor, 'critical-damage', 5) }));
  assert.deepEqual(critical.multiplicativeCritDamage.factors.filter(entry => entry.sourceId !== beastArmorSkillSourceId),
    engraved.multiplicativeCritDamage.factors);
  near(critical.multiplicativeCritDamage.productBeforeBaseline / engraved.multiplicativeCritDamage.productBeforeBaseline, 1.07);
  assert.deepEqual(critical.attributes.stats.critDamagePct, engraved.attributes.stats.critDamagePct);
  assert.deepEqual(critical.generalMultiplicativeDamage, engraved.generalMultiplicativeDamage);
});

test('archives retain raw rolls and apply the established strict and legacy validation policies', () => {
  const original = loadout();
  const active = loadout({ ...fields(armor, 'super-adaptability', '5'), ...ring(first, 16), ...ring(second, '17') });
  const baseline = loadout({ ...fields(armor, 'super-adaptability', 5), ...fields(first, 'unrelated', 0), ...ring(second, 20) });
  for (const state of [original, active, baseline]) {
    const strict = parseLoadoutJson(exportWorkingLoadout(state), original, gameData);
    assert.deepEqual(strict.state, state);
    const legacy = parseLoadoutJson(serializeLoadout(state, gameData).json, original, gameData);
    for (const slot of [armor, first, second]) for (const field of [slot.effect, slot.value]) {
      assert.equal(legacy.state.values[field], state.values[field]);
      assert.ok(!legacy.clearedFields.includes(field));
    }
  }
  const saved = profile(active, baseline);
  const map = new Map();
  const profiles = new LoadoutProfiles(() => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }));
  assert.equal(profiles.reload().ok, true);
  const restored = profiles.restoreProfiles(parseProfileBackup(exportProfileBackup(library(saved))), 'replace');
  assert.equal(restored.ok, true);
  const copy = profiles.duplicateProfile(saved.id);
  assert.equal(copy.ok, true);
  assert.deepEqual(copy.value.loadout, active);
  assert.deepEqual(copy.value.baseline, baseline);

  for (const values of [ring(first, 21), ring(first, -2), ring(first, 1.1), ring(first, 'junk'), fields(first, 'unrelated', 16), fields(first, 'bad', 16)]) {
    const corrupt = loadout({ ...fields(armor, 'super-adaptability', 5), ...ring(second, 20), ...values });
    assert.throws(() => parseLoadoutJson(encodeSingle(corrupt), original, gameData), /聖獸技能含無效欄位/);
    assert.throws(() => parseProfileBackup(encodeLibrary(library(profile(active, corrupt)))), /baseline.*聖獸技能/);
    const wire = JSON.parse(serializeLoadout(corrupt, gameData).json);
    for (const [field, value] of Object.entries(values)) wire.values[codeForFieldId(field)] = value;
    const legacy = parseLoadoutJson(JSON.stringify(wire), original, gameData);
    assert.ok(legacy.clearedFields.includes(first.value));
    assert.equal(legacy.state.values[first.value], undefined);
    assert.equal(legacy.state.values[second.value], 20);
    assert.equal(normalizeOptionalEffectValues(corrupt.values, index), true);
    assert.equal(corrupt.values[first.value], undefined);
  }
});

test('both ring editors preserve section order, history and saved rolls independently', async t => {
  const base = loadout(fields(armor, 'super-adaptability', '5'));
  const saved = profile(loadout({ ...base.values, ...ring(first, '16'), ...ring(second, '17') }),
    loadout({ ...base.values, ...ring(second, '20') }));
  const page = await uiPage(base, base, { storage: { [profilesKey]: JSON.stringify(library(saved)) } });
  t.after(() => page.close());
  const { document, Event } = page.dom.window;
  const click = selector => document.querySelector(selector).click();
  const selectSlot = id => click('[data-beast-slot-id="' + id + '"]');
  const field = id => document.querySelector('[data-field-id="' + id + '"]');
  const input = id => field(id).querySelector('input');
  const choices = id => {
    const control = input(id);
    control.dispatchEvent(new Event('focus'));
    return [...document.getElementById(control.getAttribute('aria-controls')).querySelectorAll('[role="option"]')];
  };
  const pick = (id, label) => {
    const option = choices(id).find(item => item.querySelector('span')?.textContent === label);
    assert.ok(option, label);
    option.click();
  };
  const current = () => page.readState().values;
  const checkEffect = expected => {
    const contribution = damage(page.readState()).attributes.stats.superAdaptabilityPct.sharedSources
      .find(source => source.sourceId === beastArmorSkillSourceId);
    assert.equal(contribution.valuePct, expected);
    assert.equal(current()[armor.value], '5');
  };

  for (const id of ['headwear', 'armor', 'necklace', first.slotId, second.slotId]) {
    selectSlot(id);
    const skills = [armor.slotId, first.slotId, second.slotId].includes(id) ? ['聖獸技能'] : [];
    assert.deepEqual([...document.querySelectorAll('#inspector > details > summary')].map(node => node.textContent),
      ['固定效果', '精靈石', '迷鏡變換', ...skills]);
    assert.equal(document.querySelector('#inspector .beast-mirror-section').dataset.disclosureKey, 'inspector:' + id + ':迷鏡效果');
  }
  assert.match(document.querySelector('#results').textContent, /聖獸迷鏡變換/);
  const firstButton = document.querySelector('[data-beast-slot-id="ring-one"]');
  const completion = firstButton.dataset.configuration;
  for (const [slot, value] of [[first, '16%'], [second, '17%']]) {
    selectSlot(slot.slotId);
    assert.equal(input(slot.value).disabled, true);
    pick(slot.effect, '增加聖獸盔甲效果');
    assert.deepEqual(choices(slot.value).map(item => item.querySelector('span').textContent), rolls.map(roll => roll + '%'));
    const participation = () => field(slot.enabled);
    assert.equal(participation().checked, false);
    pick(slot.value, value);
    assert.equal(participation().checked, false);
    assert.equal(participation().parentElement.textContent, '該聖獸技能是否參與計算');
    checkEffect(slot === first ? 5 : 5.8);
    participation().click();
  }
  assert.equal(firstButton.dataset.configuration, completion);
  checkEffect(6.65);
  field(second.enabled).click();
  assert.equal(input(second.value).value, '17%');
  checkEffect(5.8);
  click('#undo');
  assert.equal(field(second.enabled).checked, true);
  checkEffect(6.65);
  click('#redo');
  assert.equal(field(second.enabled).checked, false);
  checkEffect(5.8);
  field(second.enabled).click();
  const exported = await page.exportJson();
  pick(second.effect, '無關傷害');
  assert.equal(input(second.value).value, '0');
  assert.equal(input(second.value).disabled, true);
  checkEffect(5.8);
  click('#undo');
  assert.equal(input(second.value).value, '17%');
  checkEffect(6.65);
  click('#redo');
  checkEffect(5.8);
  pick(second.effect, '增加聖獸盔甲效果');
  assert.equal(input(second.value).value, '');
  checkEffect(5.8);
  selectSlot(first.slotId);
  field(first.effect).querySelector('.picker-clear').click();
  checkEffect(5);
  await page.importJson(JSON.stringify(exported));
  checkEffect(6.65);
  assert.equal(input(first.value).value, '16%');

  click('[data-profile-id="beast-rings"]');
  for (let i = 0; i < 160 && document.querySelector('[data-profile-id="beast-rings"]').getAttribute('aria-pressed') !== 'true'; i++) {
    [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '放棄修改並切換')?.click();
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(document.querySelector('[data-profile-id="beast-rings"]').getAttribute('aria-pressed'), 'true');
  click('#restore-baseline');
  checkEffect(6);
  assert.equal(input(first.value).value, '');
  selectSlot(second.slotId);
  assert.equal(input(second.value).value, '20%');
});

test('skill switches persist without altering stored rolls, and malformed switches do not activate skills', () => {
  const original = loadout();
  const base = { ...fields(armor, 'super-adaptability', 5), ...ring(first, 16), ...ring(second, 17) };
  const contribution = state => damage(state).attributes.stats.superAdaptabilityPct.sharedSources
    .find(source => source.sourceId === beastArmorSkillSourceId)?.valuePct;
  assert.deepEqual([armor, first, second].map(slot => codeForFieldId(slot.enabled)), [318, 319, 320]);
  assert.equal(contribution(loadout(base)), 6.65);
  assert.equal(contribution(loadout({ ...base, [armor.enabled]: 0 })), undefined);
  assert.equal(contribution(loadout({ ...base, [first.enabled]: 0 })), 5.85);
  assert.equal(contribution(loadout({ ...base, [second.enabled]: '0' })), 5.8);
  const disabled = loadout({ ...base, [first.enabled]: 0, [second.enabled]: 1 });
  assert.deepEqual(parseLoadoutJson(exportWorkingLoadout(disabled), original, gameData).state, disabled);
  const legacy = JSON.parse(serializeLoadout(disabled, gameData).json);
  assert.equal(contribution(parseLoadoutJson(JSON.stringify(legacy), original, gameData).state), 5.85);
  const corrupt = loadout({ ...base, [first.enabled]: 'invalid' });
  assert.equal(contribution(corrupt), 5.85);
  assert.throws(() => parseLoadoutJson(encodeSingle(corrupt), original, gameData), /聖獸技能含無效欄位/);
  legacy.values[codeForFieldId(first.enabled)] = 'invalid';
  const corrected = parseLoadoutJson(JSON.stringify(legacy), original, gameData);
  assert.ok(corrected.clearedFields.includes(first.enabled));
  assert.equal(corrected.state.values[first.enabled], 0);
  assert.equal(corrected.state.values[first.value], 16);
  assert.equal(contribution(corrected.state), 5.85);
  assert.equal(normalizeOptionalEffectValues(corrupt.values, index), true);
  assert.equal(corrupt.values[first.enabled], 0);
});

test('ice search and transformation rating reuse the same boosted armor skill as homepage damage', async () => {
  const state = loadout({ ...fields(armor, 'all-damage', 5), ...ring(first, 20), ...ring(second, 20) });
  const reference = damage(state).finalDamage.finalDamage;
  const search = await searchIce(gameData, state, () => {}, { allowedSeries: ['幻影面紗', '真理假面', '紫霄花郎'] });
  assert.equal(search.baselineDamage, reference);
  const rating = readRatingLoadout(gameData, state);
  const withoutTransforms = { ...state, values: { ...state.values } };
  for (const { choiceField, valueField } of gameData.transformations.slots) {
    delete withoutTransforms.values[choiceField];
    delete withoutTransforms.values[valueField];
  }
  assert.equal(rating.baselineDamage, damage(withoutTransforms).finalDamage.finalDamage);
  near(rating.simulatedDamage(rating.actual) / reference, 1);
});
