import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderEquipmentDamageSummary } from '../frontend/damage-summary-view.ts';

const numberFormatter = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const percentFormatter = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const cases = [
  ['fractional digits', 68159617.09, 59599089.578, '.09', '.578', '14.36%', ['59,599,089.578', '68,159,617.09']],
  ['integer and zero gain', 1234567, 1234567, null, null, '0.00%', ['1,234,567', '1,234,567']],
  ['missing baseline', 100, undefined, null, null, '—', ['—', '100']],
  ['missing current damage', undefined, 100, null, null, '—', ['100', '—']],
  ['zero damage and negative gain', 0, 100, null, null, '-100.00%', ['100', '0']],
];

for (const [name, current, baseline, currentFraction, baselineFraction, gain, previousText] of cases) {
  test('equipment damage summary preserves visible text for ' + name, () => {
    const html = renderEquipmentDamageSummary(current, baseline, numberFormatter, percentFormatter);
    const [before, after, change] = JSDOM.fragment(html).querySelectorAll('strong');
    assert.doesNotMatch(html, /\bstyle\s*=/i);
    assert.deepEqual([before.textContent, after.textContent], previousText);

    for (const [element, value, fraction] of [[before, baseline, baselineFraction], [after, current, currentFraction]]) {
      assert.equal(element.textContent, value === undefined ? '—' : numberFormatter.format(value));
      assert.equal(element.querySelector('.damage-decimal')?.textContent ?? null, fraction);
      if (value === undefined) {
        assert.equal(element.childElementCount, 0);
      } else {
        const integer = numberFormatter.formatToParts(value)
          .filter(part => part.type !== 'decimal' && part.type !== 'fraction')
          .map(part => part.value).join('');
        assert.equal(element.querySelector('.damage-integer')?.textContent, integer);
      }
    }

    assert.equal(change.textContent, gain);
    assert.equal(change.childElementCount, 0);
  });
}
