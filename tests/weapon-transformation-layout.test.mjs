import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveWeaponTransformationsFromFields } from '../dist/calculation/weapon-transformations.js';
import { projectDamage } from '../dist/frontend/projection.js';
import { parseState } from '../dist/frontend/state.js';
import { parseLoadoutJson, serializeLoadout } from '../dist/frontend/loadout-transfer.js';
import { gameData, sample } from './loadout-evaluation-harness.mjs';
import { uiPage } from './ui-update-harness.mjs';

const main = readFileSync(new URL('../frontend/main.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/styles.css', import.meta.url), 'utf8');

test('武器變換屬性和數值共用雙欄網格', () => {
  assert.ok(main.includes("attributeValueGrid(transform, 'weapon-transformation-grid')"));
  assert.ok(main.includes('field(transformationGrid,'));
  assert.ok(main.includes('transformationGrid.append(picker)'));
  assert.ok(main.includes('transformationRolls(rule).map'));
  assert.match(styles, /\.attribute-value-grid\{display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});


test('weapon transformations accept repeated unrelated effects and retain visible and accessible labels', async t => {
  const original = parseState(JSON.stringify(sample));
  const slots = gameData.transformations.slots;
  const page = await uiPage(original, null);
  t.after(() => page.dom.window.close());
  const { document, Event } = page.dom.window;
  const picker = id => document.querySelector(`.weapon-transformation-grid [data-field-id="${id}"]`);
  function choices(field) {
    const input = picker(field).querySelector('input');
    input.dispatchEvent(new Event('focus'));
    return [...document.getElementById(input.getAttribute('aria-controls')).querySelectorAll('[role="option"]')];
  }
  function choose(field, text) {
    const item = choices(field).find(option => option.textContent === text);
    assert(item, text);
    item.click();
  }
  const read = () => page.readState().values;
  const finalDamage = current => projectDamage(gameData, current).result.finalDamage.finalDamage;
  const withoutTransforms = structuredClone(original);
  for (const [i, slot] of slots.entries()) {
    delete withoutTransforms.values[slot.choiceField];
    delete withoutTransforms.values[slot.valueField];
    assert.equal(picker(slot.choiceField).querySelector('label').textContent, `變換 ${i + 1}`);
    const value = picker(slot.valueField);
    assert.equal(value.querySelector('label').textContent, '數值');
    const input = value.querySelector('input');
    assert.equal(value.querySelector('label').htmlFor, input.id);
    assert.equal(input.getAttribute('aria-label'), `變換 ${i + 1} 數值`);
  }
  for (const slot of slots) {
    choose(slot.choiceField, '無關傷害');
    const field = picker(slot.valueField).querySelector('input');
    assert.equal(field.disabled, true);
    assert.equal(field.value, '0');
    assert.equal(picker(slot.valueField).querySelector('.picker-clear').hidden, true);
    assert.equal(read()[slot.valueField], 0);
  }
  assert.deepEqual(resolveWeaponTransformationsFromFields(gameData.transformations, read()), []);
  assert.equal(finalDamage(page.readState()), finalDamage(withoutTransforms));
  const last = slots.at(-1);
  document.querySelector('#undo').click();
  assert.equal(read()[last.choiceField], original.values[last.choiceField]);
  assert.equal(read()[last.valueField], original.values[last.valueField]);
  document.querySelector('#redo').click();
  assert.equal(read()[last.valueField], 0);
  const exact = await page.exportJson();
  const legacy = parseLoadoutJson(serializeLoadout(page.readState(), gameData).json, original, gameData);
  assert.equal(legacy.transformationWarnings, undefined);
  for (const slot of slots) {
    assert(!legacy.clearedFields.includes(slot.choiceField));
    assert.equal(legacy.state.values[slot.choiceField], '無關傷害');
    assert.equal(legacy.state.values[slot.valueField], 0);
  }
  document.querySelector('#baseline').click();
  choose(slots[0].choiceField, 'Boss 傷害增加');
  assert.equal(read()[slots[0].valueField], undefined);
  assert(!choices(slots[1].choiceField).some(option => option.textContent === 'Boss 傷害增加'));
  choose(slots[0].valueField, '8%');
  assert.equal(read()[slots[0].valueField], 0.08);
  document.querySelector('#restore-baseline').click();
  assert.equal(read()[slots[0].choiceField], '無關傷害');
  assert.equal(read()[slots[0].valueField], 0);
  await page.importJson(JSON.stringify(exact));
  for (const slot of slots) assert.equal(read()[slot.valueField], 0);
});

test('an unselected historical weapon transformation remains blank', async t => {
  const original = parseState(JSON.stringify(sample));
  const slot = gameData.transformations.slots[0];
  delete original.values[slot.choiceField];
  delete original.values[slot.valueField];
  const page = await uiPage(original, null);
  t.after(() => page.dom.window.close());
  assert.equal(page.readState().values[slot.choiceField], undefined);
  assert.equal(page.dom.window.document.querySelector(`[data-field-id="${slot.choiceField}"] input`).value, '');
});
