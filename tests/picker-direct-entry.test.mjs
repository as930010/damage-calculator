import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../frontend/picker.ts', import.meta.url), 'utf8');

test('direct-entry pickers commit edits on Enter, outside pointer/touch, and focus leaving the picker', () => {
  assert.match(source, /document\.addEventListener\("pointerdown"[\s\S]*?entry\.commitOrClose\(\)/);
  assert.match(source, /root\.addEventListener\('focusout',[\s\S]*?directEntryDirty\) commitDirectEntry\(\)/);
  assert.match(source, /event\.key === 'Enter' && directEntry[\s\S]*?commitDirectEntry\(\)/);
  assert.match(source, /if \(!directEntryDirty\) \{ close\(\); return; \}/);
});
