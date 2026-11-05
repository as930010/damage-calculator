import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerPage } from './picker-harness.mjs';

for (const action of ['Enter', 'mouse outside', 'touch outside', 'focus leaving']) {
  test('direct entry commits once on ' + action + ' and leaves no dirty draft', async () => {
    const page = await pickerPage(false, true);
    try {
      page.input.focus();
      page.type('v7');
      assert.deepEqual(page.commits, [], 'typing alone does not commit');
      if (action === 'Enter') page.key('Enter');
      else if (action === 'focus leaving') {
        const outside = page.dom.window.document.createElement('button');
        page.dom.window.document.body.append(outside);
        outside.focus();
      } else {
        const pointer = new page.dom.window.Event('pointerdown', { bubbles: true });
        Object.defineProperty(pointer, 'pointerType', { value: action.startsWith('touch') ? 'touch' : 'mouse' });
        page.dom.window.document.body.dispatchEvent(pointer);
      }
      assert.deepEqual(page.commits, ['V7']);
      assert.deepEqual(page.invalid, []);
      assert.equal(page.input.value, '候選 7');
      assert.equal(page.list.hidden, true);
      assert.equal(page.input.getAttribute('aria-expanded'), 'false');
      if (action === 'Enter') assert.equal(page.dom.window.document.activeElement, page.input);
      page.input.blur();
      page.dom.window.document.body.dispatchEvent(new page.dom.window.Event('pointerdown', { bubbles: true }));
      page.key('Enter');
      assert.deepEqual(page.commits, ['V7'], 'later blur, outside pointer and Enter do not resubmit');
    } finally { page.close(); }
  });
}
