import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUnsignedInteger, sanitizeUnsignedInteger } from '../frontend/direct-input.ts';

test('關卡自訂值只接受非負整數字串', () => {
  assert.equal(resolveUnsignedInteger('95'), '95');
  assert.equal(resolveUnsignedInteger('0'), '0');
  assert.equal(resolveUnsignedInteger('71'), '71');
  assert.equal(resolveUnsignedInteger('71.5'), null);
  assert.equal(resolveUnsignedInteger('-1'), null);
  assert.equal(resolveUnsignedInteger(''), null);
  assert.equal(sanitizeUnsignedInteger('9a5'), '95');
});
