import test from 'node:test';
import assert from 'node:assert/strict';
import { preventScientificNotation } from '../frontend/numeric-input.ts';

function fakeInput(value = '') {
  const listeners = new Map();
  return {
    value,
    inputMode: '',
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    emit(type, event = {}) {
      event.preventDefault ??= () => { event.defaultPrevented = true; };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
  };
}

test('數值欄位拒絕鍵入、貼上或輸入科學記號 E，並保留合法小數', () => {
  const input = fakeInput('12.5');
  preventScientificNotation(input);
  assert.equal(input.inputMode, 'decimal');

  assert.equal(input.emit('keydown', { key: 'e' }).defaultPrevented, true);
  assert.equal(input.emit('keydown', { key: 'E' }).defaultPrevented, true);
  assert.equal(input.emit('keydown', { key: '5' }).defaultPrevented, undefined);
  assert.equal(input.emit('beforeinput', { data: 'e' }).defaultPrevented, true);
  assert.equal(input.emit('paste', { clipboardData: { getData: () => '1e3' } }).defaultPrevented, true);

  input.value = '1e3';
  input.emit('input');
  assert.equal(input.value, '12.5');
  input.value = '13.75';
  input.emit('input');
  assert.equal(input.value, '13.75');
});
