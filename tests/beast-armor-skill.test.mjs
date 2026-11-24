import test from 'node:test';
import assert from 'node:assert/strict';
import { beastArmorSkillEffects, beastArmorSkillFields, beastArmorSkillSourceId, beastSkillValueChoices } from '../dist/calculation/beast-armor-skill.js';
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

const { effect: effectField, value: valueField } = beastArmorSkillFields;
const index = createCatalogIndex(gameData);
const loadout = (values = {}) => parseState(JSON.stringify({ ...sample, values: { ...sample.values, ...values } }));
const skill = (effect, value) => ({ [effectField]: effect, ...(value === undefined ? {} : { [valueField]: value }) });
const damage = state => projectDamage(gameData, state).result;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' ≈ ' + expected);
const profile = (current, baseline) => ({
  id: 'beast', name: '聖獸技能配置', loadout: current, baseline,
  createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z',
});
const library = entry => ({ schemaVersion: 1, profiles: [entry], activeProfileId: null });

test('armor skill options are ordered and each tier yields exactly its intended stat', () => {
  const expected = [
    ['super-adaptability', '超適應力', 'superAdaptabilityPct'],
    ['all-damage', '所有傷害', 'multiplicativeDamagePct'],
    ['all-skill-damage', '所有技能傷害', 'multiplicativeDamagePct'],
    ['critical-damage', '致命一擊傷害', 'multiplicativeCritDamagePct'],
    ['boss-damage', 'Boss 傷害', 'bossDamagePct'],
    ['defense-ignore', '無視防禦力', 'defenseIgnorePct'],
    ['unrelated', '無關傷害', null],
  ];
  assert.deepEqual(beastArmorSkillEffects.map(({ id, label, statKey }) => [id, label, statKey]), expected);
  assert.deepEqual(index.resolveFieldChoices(effectField, {}), expected.map(([id]) => id));
  assert.deepEqual([codeForFieldId(effectField), codeForFieldId(valueField)], [312, 313]);
  const baseline = resolveMasterBeastEffects(gameData.masterBeast, {});
  for (const [effect, , key] of expected) {
    const choices = key ? [3, 4, 5] : [0];
    assert.deepEqual(beastSkillValueChoices(beastArmorSkillFields, effect), choices);
    assert.deepEqual(index.resolveFieldChoices(valueField, skill(effect)), choices);
    for (const value of choices) {
      const sources = resolveMasterBeastEffects(gameData.masterBeast, { armorSkill: { effect, value } });
      assert.deepEqual(sources.filter(source => source.sourceId !== beastArmorSkillSourceId), baseline);
      assert.deepEqual(sources.filter(source => source.sourceId === beastArmorSkillSourceId),
        key ? [{ sourceId: beastArmorSkillSourceId, stats: { [key]: value } }] : []);
    }
  }
  assert.deepEqual(index.resolveFieldChoices(valueField, {}), []);
});

test('additive skill effects join their existing attributes without changing ordinary adaptability', () => {
  const reference = damage(loadout());
  for (const [choice, key, valuePct] of [
    ['super-adaptability', 'superAdaptabilityPct', 3],
    ['boss-damage', 'bossDamagePct', 4],
    ['defense-ignore', 'defenseIgnorePct', 5],
  ]) {
    const result = damage(loadout(skill(choice, valuePct)));
    const stat = result.attributes.stats[key];
    near(stat.finalTotal - reference.attributes.stats[key].finalTotal, valuePct);
    assert.deepEqual(stat.sharedSources.find(source => source.sourceId === beastArmorSkillSourceId),
      { sourceId: beastArmorSkillSourceId, valuePct });
    assert.deepEqual(result.attributes.stats.adaptabilityPct, reference.attributes.stats.adaptabilityPct);
  }
});

test('skill products stay separate from engravings, spirit stones and other critical damage sources', () => {
  const engraving = {
    'Weapon.Engraving.1.Enabled': 1, 'Weapon.Engraving.1.Effect': 'attack', 'Weapon.Engraving.1.Value': '5',
    'Weapon.Engraving.2.Enabled': 1, 'Weapon.Engraving.2.Effect': 'critical-damage', 'Weapon.Engraving.2.Value': '5',
  };
  const original = damage(loadout());
  const engraved = damage(loadout(engraving));
  for (const effect of ['all-damage', 'all-skill-damage']) {
    const result = damage(loadout({ ...engraving, ...skill(effect, '4') }));
    const product = result.generalMultiplicativeDamage;
    assert.deepEqual(product.factors.filter(source => source.sourceId !== beastArmorSkillSourceId),
      engraved.generalMultiplicativeDamage.factors);
    assert.ok(product.factors.some(source => source.sourceId === gameData.masterBeast.armorSpiritStoneSetEffect.id));
    near(product.productBeforeBaseline / original.generalMultiplicativeDamage.productBeforeBaseline, 1.092);
    assert.deepEqual(result.attributes.stats.allSkillDamagePct, engraved.attributes.stats.allSkillDamagePct);
  }
  const critical = damage(loadout({ ...engraving, ...skill('critical-damage', '4') }));
  assert.deepEqual(critical.multiplicativeCritDamage.factors.filter(source => source.sourceId !== beastArmorSkillSourceId),
    engraved.multiplicativeCritDamage.factors);
  near(critical.multiplicativeCritDamage.productBeforeBaseline / engraved.multiplicativeCritDamage.productBeforeBaseline, 1.04);
  assert.deepEqual(critical.attributes.stats.critDamagePct, engraved.attributes.stats.critDamagePct);
});

test('unselected, unrelated and invalid rolls have no effect and cannot bypass transfer checks', () => {
  const original = loadout();
  for (const selections of [
    skill('unrelated', 0), skill('boss-damage'), skill('all-damage', 0),
    skill('all-damage', 6), skill('all-damage', 3.5), skill('all-damage', '4%'),
    skill('unrelated', 5), skill('missing-id', 4), { [valueField]: 4 },
  ]) {
    assert.deepEqual(damage(loadout(selections)), damage(original));
  }
  for (const selections of [skill('all-damage', 6), skill('unrelated', '4'), skill('bad', '3'), { [valueField]: '5' }]) {
    const corrupt = loadout(selections);
    assert.throws(() => parseLoadoutJson(encodeSingle(corrupt), original, gameData), /聖獸技能含無效欄位/);
    const wire = JSON.parse(serializeLoadout(original, gameData).json);
    for (const [field, value] of Object.entries(selections)) wire.values[codeForFieldId(field)] = value;
    const legacy = parseLoadoutJson(JSON.stringify(wire), original, gameData);
    assert.ok(legacy.clearedFields.includes(valueField));
    assert.equal(legacy.clearedFields.includes(effectField), selections[effectField] === 'bad');
    assert.equal(legacy.state.values[valueField], undefined);
    assert.equal(normalizeOptionalEffectValues(corrupt.values, index), true);
    assert.equal(corrupt.values[valueField], undefined);
  }
});

test('skill choices, blank legacy settings and baselines survive single, legacy and library transfers', () => {
  const original = loadout();
  const current = loadout(skill('all-skill-damage', '4'));
  const baseline = loadout(skill('all-damage', '5'));
  for (const state of [original, current, baseline, loadout(skill('unrelated', 0))]) {
    assert.deepEqual(parseLoadoutJson(exportWorkingLoadout(state), original, gameData).state, state);
    const restored = parseLoadoutJson(serializeLoadout(state, gameData).json, original, gameData);
    assert.equal(restored.state.values[effectField], state.values[effectField]);
    assert.equal(restored.state.values[valueField], state.values[valueField]);
    assert.deepEqual(restored.clearedFields.filter(field => [effectField, valueField].includes(field)), []);
  }
  const saved = profile(current, baseline);
  const map = new Map();
  const profiles = new LoadoutProfiles(() => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }));
  assert.equal(profiles.reload().ok, true);
  const restored = profiles.restoreProfiles(parseProfileBackup(exportProfileBackup(library(saved))), 'replace');
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.value.profiles[0], saved);
  const invalidBaseline = loadout(skill('boss-damage', 17));
  assert.throws(() => parseProfileBackup(encodeLibrary(library(profile(current, invalidBaseline)))), /baseline.*聖獸技能/);
});

test('armor editor updates its own selections through changes, history, profiles, baseline and transfer', async t => {
  const original = loadout();
  const saved = profile(loadout(skill('boss-damage', '4')), loadout(skill('super-adaptability', '3')));
  const page = await uiPage(original, original, { storage: { [profilesKey]: JSON.stringify(library(saved)) } });
  t.after(() => page.close());
  const { document, Event, localStorage } = page.dom.window;
  const selectSlot = id => document.querySelector('[data-beast-slot-id="' + id + '"]').click();
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
  const click = selector => document.querySelector(selector).click();
  const current = () => page.readState().values;

  selectSlot('headwear');
  assert.equal(field(effectField), null);
  selectSlot('armor');
  const completion = document.querySelector('[data-beast-slot-id="armor"]').dataset.configuration;
  const participation = () => field(beastArmorSkillFields.enabled);
  assert.equal(participation().checked, false);
  assert.equal(participation().parentElement.textContent, '該聖獸技能是否參與計算');
  assert.equal(input(valueField).disabled, true);
  assert.deepEqual(choices(effectField).map(item => item.querySelector('span').textContent), beastArmorSkillEffects.map(item => item.label));
  pick(effectField, '所有傷害');
  assert.deepEqual(choices(valueField).map(item => item.querySelector('span').textContent), ['3%', '4%', '5%']);
  pick(valueField, '5%');
  assert.equal(current()[effectField], 'all-damage');
  assert.equal(current()[valueField], '5');
  assert.equal(participation().checked, false);
  assert.deepEqual(damage(page.readState()), damage(original));
  participation().click();
  near(damage(page.readState()).finalDamage.finalDamage / damage(original).finalDamage.finalDamage, 1.05);
  participation().click();
  assert.equal(input(valueField).value, '5%');
  assert.deepEqual(damage(page.readState()), damage(original));
  assert.equal(document.querySelector('[data-beast-slot-id="armor"]').dataset.configuration, completion);
  const exported = await page.exportJson();
  pick(effectField, 'Boss 傷害');
  assert.equal(current()[valueField], undefined);
  assert.deepEqual(damage(page.readState()), damage(original));
  click('#undo');
  assert.equal(input(effectField).value, '所有傷害');
  assert.equal(input(valueField).value, '5%');
  click('#redo');
  assert.equal(input(effectField).value, 'Boss 傷害');
  assert.equal(input(valueField).value, '');
  pick(effectField, '無關傷害');
  assert.equal(input(valueField).value, '0');
  assert.equal(input(valueField).disabled, true);
  assert.equal(field(valueField).querySelector('.picker-clear').hidden, true);
  assert.equal(current()[valueField], 0);
  assert.deepEqual(damage(page.readState()), damage(original));
  assert.equal(parseState(localStorage.getItem('dab-loadout-v1')).values[effectField], 'unrelated');

  click('[data-profile-id="beast"]');
  for (let i = 0; i < 160 && current()[effectField] !== 'boss-damage'; i++) {
    [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '放棄修改並切換')?.click();
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(input(valueField).value, '4%', document.querySelector('#profile-message').textContent);
  assert.equal(participation().checked, true);
  click('#restore-baseline');
  assert.equal(input(effectField).value, '超適應力');
  assert.equal(input(valueField).value, '3%');
  assert.equal(participation().checked, true);
  await page.importJson(JSON.stringify(exported));
  assert.equal(input(effectField).value, '所有傷害');
  assert.equal(input(valueField).value, '5%');
  assert.equal(participation().checked, false);
  assert.deepEqual(damage(page.readState()), damage(original));
});

test('ice search and transformation rating keep the same active skill as the homepage', async () => {
  const state = loadout(skill('all-damage', 4));
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
  near(rating.simulatedDamage(rating.actual), reference);
});
