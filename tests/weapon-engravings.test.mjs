import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableWeaponEngravingEffects, clearInvalidWeaponEngravingFields, resolveWeaponEngravingSources,
  weaponEngravingEffects, weaponEngravingSlots,
} from '../dist/calculation/weapon-engravings.js';
import { projectDamage } from '../dist/frontend/projection.js';
import { parseState } from '../dist/frontend/state.js';
import { codeForFieldId } from '../dist/frontend/field-ids.js';
import { encodeLibrary, encodeSingle } from '../dist/frontend/loadout-archive.js';
import { exportWorkingLoadout, parseLoadoutJson, serializeLoadout } from '../dist/frontend/loadout-transfer.js';
import { exportProfileBackup, LoadoutProfiles, parseProfileBackup, profilesKey } from '../dist/frontend/loadout-profiles.js';
import { gameData, sample } from './loadout-evaluation-harness.mjs';
import { uiPage } from './ui-update-harness.mjs';

const original = parseState(JSON.stringify(sample));
const [first, second, third] = weaponEngravingSlots;
const engraving = (slot, effect, value = '', enabled = 1) => ({
  [slot.enabledField]: enabled, [slot.effectField]: effect, [slot.valueField]: value,
});
const state = (fields = {}) => ({ ...original, values: { ...original.values, ...fields } });
const factors = gameData.attack.weaponEnhancementFactors;
const sources = values => resolveWeaponEngravingSources(values, factors);
const damage = loadout => projectDamage(gameData, loadout).result;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);

test('only the six confirmed engraving IDs and Brilliant rolls are offered', () => {
  assert.deepEqual(weaponEngravingEffects.map(({ id, label, statKey, values }) => [id, label, statKey, [...values]]), [
    ['attack', '攻擊力%', 'multiplicativeDamagePct', ['4', '5', 'enhancement']],
    ['critical-damage', '致命一擊傷害%', 'multiplicativeCritDamagePct', ['4', '5', 'enhancement']],
    ['defense-ignore', '無視防禦力%', 'defenseIgnorePct', ['4', '5']],
    ['boss-damage', 'Boss 傷害增加%', 'bossDamagePct', ['4', '5']],
    ['all-skill-damage', '所有技能傷害%', 'multiplicativeDamagePct', ['4', '5', 'enhancement']],
    ['unrelated', '無關傷害', null, []],
  ]);
});

test('effects reserve their ID even while disabled and unrelated effects never reserve an ID', () => {
  const fields = engraving(first, 'attack', '4', 0);
  const available = slot => availableWeaponEngravingEffects(fields, slot.effectField).map(effect => effect.id);
  assert(available(first).includes('attack'));
  assert(!available(second).includes('attack'));
  assert(!available(third).includes('attack'));
  assert(available(second).includes('all-skill-damage'));
  fields[first.effectField] = 'boss-damage';
  assert(available(second).includes('attack'));
  const unrelated = Object.assign({}, ...weaponEngravingSlots.map(slot => engraving(slot, 'unrelated')));
  assert.deepEqual(sources(unrelated), []);
  assert.deepEqual(clearInvalidWeaponEngravingFields(unrelated), []);
  assert.equal(damage(state(unrelated)).finalDamage.finalDamage, damage(original).finalDamage.finalDamage);
});

test('independent attack and skill damage multiply and critical damage joins the existing critical product', () => {
  const reference = damage(original);
  for (const roll of ['4', '5']) {
    const result = damage(state({
      ...engraving(first, 'attack', '5'), ...engraving(second, 'all-skill-damage', roll),
      ...engraving(third, 'critical-damage', '5'),
    }));
    assert.deepEqual(result.generalMultiplicativeDamage.factors.filter(x => x.sourceId.startsWith('weapon-engraving:')).map(x => [x.sourceId, x.valuePct]),
      [[first.sourceId, 5], [second.sourceId, Number(roll)]]);
    near(result.generalMultiplicativeDamage.productBeforeBaseline / reference.generalMultiplicativeDamage.productBeforeBaseline,
      roll === '4' ? 1.092 : 1.1025);
    assert(reference.multiplicativeCritDamage.factors.length > 0);
    assert.deepEqual(result.multiplicativeCritDamage.factors.filter(x => x.sourceId !== third.sourceId), reference.multiplicativeCritDamage.factors);
    near(result.multiplicativeCritDamage.productBeforeBaseline / reference.multiplicativeCritDamage.productBeforeBaseline, 1.05);
    assert.deepEqual(result.attributes.stats.critDamagePct, reference.attributes.stats.critDamagePct);
  }
  const result = damage(state({ ...engraving(first, 'defense-ignore', '4'), ...engraving(second, 'boss-damage', '5') }));
  for (const [key, slot, valuePct] of [['defenseIgnorePct', first, 4], ['bossDamagePct', second, 5]]) {
    assert.deepEqual(result.attributes.stats[key].sharedSources.find(x => x.sourceId === slot.sourceId), {
      sourceId: slot.sourceId, valuePct,
    });
  }
});

test('dynamic rolls use the valid weapon level each time and disabling removes the source', () => {
  for (const kind of ['attack', 'all-skill-damage', 'critical-damage']) {
    const fields = engraving(first, kind, 'enhancement');
    const statKey = weaponEngravingEffects.find(effect => effect.id === kind).statKey;
    for (const [level, points] of [[10, 5], [11, 5.5], [12, 6], [13, 6.5]]) {
      assert.deepEqual(sources({ ...fields, 'Weapon.ENHC': `Lv.${level}` }),
        [{ sourceId: first.sourceId, stats: { [statKey]: points } }]);
    }
    for (const read of ['', 'Lv.21', 'invalid11']) assert.deepEqual(sources({ ...fields, 'Weapon.ENHC': read }), []);
    assert.deepEqual(sources({ ...fields, 'Weapon.ENHC': 'Lv.12', [first.enabledField]: 0 }), []);
    assert.equal(fields[first.valueField], 'enhancement');
  }
});

test('strict imports reject repeated effects and legacy imports report cleared fields', () => {
  for (const effect of ['attack', 'critical-damage']) {
    const invalid = state({
      ...engraving(first, effect, '4', 0), ...engraving(second, effect, '5'),
      ...engraving(third, 'boss-damage', '5'),
    });
    assert.throws(() => sources(invalid.values), /刻印石含無效或重複欄位/);
    assert.throws(() => parseLoadoutJson(encodeSingle(invalid), original, gameData), /刻印石含無效或重複欄位/);
    const legacy = JSON.parse(serializeLoadout(invalid, gameData).json);
    for (const [key, value] of Object.entries(engraving(second, effect, '5'))) legacy.values[codeForFieldId(key)] = value;
    const imported = parseLoadoutJson(JSON.stringify(legacy), original, gameData);
    assert(imported.clearedFields.includes(second.effectField));
    assert(imported.clearedFields.includes(second.valueField));
    assert.equal(imported.state.values[first.effectField], effect);
    assert.equal(imported.state.values[third.effectField], 'boss-damage');
    assert(!sources(imported.state.values).some(entry => entry.sourceId === second.sourceId));
  }
  for (const fields of [engraving(first, 'defense-ignore', 'enhancement'), engraving(first, 'boss-damage', '6'), engraving(first, 'crit-rate', '5')]) {
    assert.throws(() => parseLoadoutJson(encodeSingle(state(fields)), original, gameData), /刻印石含無效或重複欄位/);
  }
});

test('the single loadout and profile backup preserve all engraving settings and baseline', () => {
  const fields = {
    ...engraving(first, 'attack', 'enhancement'), ...engraving(second, 'all-skill-damage', '5', 0),
    ...engraving(third, 'unrelated'),
  };
  const loadout = state(fields);
  const baseline = state({ ...fields, 'Weapon.ENHC': 'Lv.11' });
  assert.deepEqual(parseLoadoutJson(exportWorkingLoadout(loadout), original, gameData).state, loadout);
  const profile = { id: 'test', name: '測試刻印', loadout, baseline, createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z' };
  const library = { schemaVersion: 1, profiles: [profile], activeProfileId: null };
  const map = new Map();
  const profiles = new LoadoutProfiles(() => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }));
  assert(profiles.reload().ok);
  const restored = profiles.restoreProfiles(parseProfileBackup(exportProfileBackup(library)), 'replace');
  assert(restored.ok);
  assert.deepEqual(restored.value.profiles[0], profile);
  const copied = profiles.duplicateProfile('test');
  assert(copied.ok);
  assert.deepEqual(copied.value.loadout, loadout);
  assert.deepEqual(copied.value.baseline, baseline);
  const invalidBaseline = state({ ...engraving(first, 'attack', '4'), ...engraving(second, 'attack', '5') });
  assert.throws(() => parseProfileBackup(encodeLibrary({ ...library, profiles: [{ ...profile, baseline: invalidBaseline }] })), /baseline.*刻印石/);
});

test('weapon UI keeps selections across checkbox, enhancement, history, baseline, import and profile switch', async t => {
  const saved = state({ ...engraving(first, 'attack', 'enhancement', 0), 'Weapon.ENHC': 'Lv.11' });
  const profile = { id: 'engraved', name: '刻印配置', loadout: saved, baseline: saved, createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z' };
  const page = await uiPage(original, null, { storage: { [profilesKey]: JSON.stringify({ schemaVersion: 1, profiles: [profile], activeProfileId: null }) } });
  const { document, Event } = page.dom.window;
  t.after(() => page.dom.window.close());
  const field = key => document.querySelector(`[data-field-id="${key}"]`);
  const picker = key => field(key).querySelector('input');
  const choices = key => {
    const input = picker(key);
    input.dispatchEvent(new Event('focus'));
    return [...document.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]')];
  };
  const pick = (key, label) => {
    const option = choices(key).find(node => node.querySelector('span')?.textContent === label);
    assert.ok(option, label);
    option.click();
  };
  const current = () => page.readState().values;
  const currentSource = () => sources(current()).find(entry => entry.sourceId === first.sourceId);
  for (const slot of weaponEngravingSlots) assert.equal(field(slot.enabledField).checked, false);
  document.querySelector('[data-profile-id="engraved"]').click();
  for (let i = 0; i < 160 && current()[first.effectField] !== 'attack'; i++) {
    const discard = [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent === '放棄修改並切換');
    discard?.click();
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(current()[first.valueField], 'enhancement', document.querySelector('#profile-message').textContent);
  assert.equal(picker(first.valueField).value, '強化×0.5%');
  assert(!choices(second.effectField).some(node => node.textContent === '攻擊力%'));
  field(first.enabledField).click();
  near(currentSource().stats.multiplicativeDamagePct, 5.5);
  pick('Weapon.ENHC', 'Lv.12');
  near(currentSource().stats.multiplicativeDamagePct, 6);
  document.querySelector('#undo').click();
  near(currentSource().stats.multiplicativeDamagePct, 5.5);
  document.querySelector('#redo').click();
  near(currentSource().stats.multiplicativeDamagePct, 6);
  field(first.enabledField).click();
  assert.equal(current()[first.valueField], 'enhancement');
  assert.equal(currentSource(), undefined);
  const exported = await page.exportJson();
  pick(first.effectField, 'Boss 傷害增加%');
  assert(choices(second.effectField).some(node => node.textContent === '攻擊力%'));
  assert(!choices(first.valueField).some(node => node.textContent.includes('強化×')));
  document.querySelector('#restore-baseline').click();
  assert.equal(current()['Weapon.ENHC'], 'Lv.11');
  assert.equal(current()[first.valueField], 'enhancement');
  await page.importJson(JSON.stringify(exported));
  assert.equal(current()['Weapon.ENHC'], 'Lv.12');
  assert.equal(current()[first.valueField], 'enhancement');
  assert.equal(field(first.enabledField).checked, false);
  pick(third.effectField, '無關傷害');
  assert.equal(picker(third.valueField).value, '0');
  assert.equal(picker(third.valueField).disabled, true);
  assert.equal(field(third.valueField).querySelector('.picker-clear').hidden, true);
  const before = damage(page.readState()).finalDamage.finalDamage;
  field(third.enabledField).click();
  assert.equal(damage(page.readState()).finalDamage.finalDamage, before);
  assert.equal(current()[third.valueField], undefined);
  assert.equal(current()[third.enabledField], 1);
});

test('corrupted local engraving values are normalized with a visible field-specific notice', async t => {
  const loadout = state({
    ...engraving(first, 'attack', '5'), ...engraving(second, 'attack', '4'), ...engraving(third, 'boss-damage', '5'),
  });
  const page = await uiPage(loadout, loadout);
  t.after(() => page.dom.window.close());
  const status = page.dom.window.document.querySelector('#transfer-status').textContent;
  assert(status.includes(second.effectField));
  assert(status.includes('比較基準'));
  assert.equal(page.readState().values[second.effectField], undefined);
  assert.equal(page.readState().values[third.effectField], 'boss-damage');
});
