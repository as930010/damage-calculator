import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClassCode, sanitizeClassCode } from '../frontend/class-code.ts';

const codes = ['DaB', 'BMa', 'MN'];

test('職業代碼忽略大小寫並回傳資料中的標準代碼', () => {
  assert.equal(resolveClassCode('DAB', codes), 'DaB');
  assert.equal(resolveClassCode('dab', codes), 'DaB');
  assert.equal(resolveClassCode('bma', codes), 'BMa');
  assert.equal(resolveClassCode('mn', codes), 'MN');
});

test('職業欄位只保留英文字母，未知代碼不會被套用', () => {
  assert.equal(sanitizeClassCode('DaB123中'), 'DaB');
  assert.equal(resolveClassCode('Unknown', codes), null);
  assert.equal(resolveClassCode('DaB1', codes), null);
  assert.equal(resolveClassCode('', codes), null);
});
