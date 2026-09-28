import test from 'node:test';
import assert from 'node:assert/strict';
import { capOverflowPercentage } from '../dist/frontend/cap-warnings.js';

test('上限提示只顯示超出的百分點，不改變上限內或等於上限的結果', () => {
  assert.equal(capOverflowPercentage(60, 60), null);
  assert.equal(capOverflowPercentage(59.9, 60), null);
  assert.ok(Math.abs(capOverflowPercentage(62.5, 60) - 2.5) < 1e-12);
  assert.equal(capOverflowPercentage(100, 100), null);
  assert.ok(Math.abs(capOverflowPercentage(104.25, 100) - 4.25) < 1e-12);
});
