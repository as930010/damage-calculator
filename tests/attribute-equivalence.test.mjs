import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, gameData, sample } from './loadout-evaluation-harness.mjs';
import { uiPage, enter, stateA } from './ui-update-harness.mjs';

test('temporary bonuses agree with the complete loadout engine for every comparable attribute', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { prepareLoadoutAttributes, evaluatePreparedLoadout } = await runtime.load('calculation/loadout-engine.ts');
  const { comparableAttributes, createAttributeEquivalenceCalculator } = await runtime.load('calculation/attribute-equivalence.ts');
  const evaluated = evaluateLoadout(gameData, structuredClone(sample), false, true);
  assert.ok(evaluated.damage);
  const attributes = comparableAttributes(gameData.attributes.attributes);
  assert.ok(attributes.length >= 15);
  assert.ok(!attributes.some(({ key }) => key === 'critRatePct' || key === 'extremizationPct'));
  const input = evaluated.comparisonInput;
  const calculator = createAttributeEquivalenceCalculator(input, evaluated.damage.result, attributes);
  for (const { key } of attributes) {
    const withBonus = { ...input, sources: { ...input.sources, shared: [
      ...input.sources.shared, { sourceId: 'attribute-equivalence:test', stats: { [key]: 10 } },
    ] } };
    const complete = evaluatePreparedLoadout(withBonus, prepareLoadoutAttributes(withBonus));
    assert.ok(complete.result, key);
    const temporary = calculator.damageWith(key, 10);
    assert.ok(Math.abs(temporary - complete.result.finalDamage.finalDamage)
      <= Math.max(1e-6, Math.abs(temporary) * 1e-12), key);
  }
  assert.deepEqual(evaluated.damage.result.attributes, evaluated.attributes);
});

test('inverse values match a selected benefit; capped and inactive sources report honestly', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { comparableAttributes, createAttributeEquivalenceCalculator } = await runtime.load('calculation/attribute-equivalence.ts');
  const attributes = comparableAttributes(gameData.attributes.attributes);
  const evaluated = evaluateLoadout(gameData, structuredClone(sample), false, true);
  const calculator = createAttributeEquivalenceCalculator(evaluated.comparisonInput, evaluated.damage.result, attributes);
  for (const source of ['bossDamagePct', 'bleedDamagePct']) {
    const comparison = calculator.compare(source, 10);
    assert.ok(comparison.targetGainPct > 0, source);
    assert.equal(comparison.rows.find(row => row.key === source).delta, 10);
    for (const row of comparison.rows.filter(row => row.status === 'ok')) {
      const actual = (calculator.damageWith(row.key, row.delta) / evaluated.damage.result.finalDamage.finalDamage - 1) * 100;
      const tolerance = ['doubleAttackPct', 'skillTypeAttackPct'].includes(row.key) ? 0.001 : 1e-6;
      assert.ok(Math.abs(actual - comparison.targetGainPct) <= tolerance, `${source} vs ${row.key}: ${actual} vs ${comparison.targetGainPct}`);
    }
  }
  const inactive = calculator.compare('strongSkillDamagePct', 10);
  assert.equal(inactive.targetGainPct, null, 'strong-skill share is zero in the sample');
  const atCap = structuredClone(evaluated.damage.result);
  atCap.attributes.stats.polarizationPct.totalBeforeCap = 60;
  atCap.attributes.stats.polarizationPct.finalTotal = 60;
  const capped = createAttributeEquivalenceCalculator(evaluated.comparisonInput, atCap, attributes);
  assert.equal(capped.compare('bossDamagePct', 10).rows.find(row => row.key === 'polarizationPct').status, 'unreachable');
});

test('table switches the last edited source, treats blank as zero, and follows loadout changes without saving drafts', async () => {
  const page = await uiPage();
  try {
    const { document, Event } = page.dom.window;
    const panel = document.querySelector('.attribute-equivalence-panel');
    assert.ok(panel); assert.equal(panel.open, false);
    for (const [selector, title] of [
      ['.results-panel', '目前填寫的屬性'],
      ['.attribute-equivalence-panel', '傷害屬性等效比較'],
    ]) {
      const summary = document.querySelector(`${selector} > summary`);
      assert.equal(summary.textContent, title);
      assert.equal(summary.className, document.querySelector('.weapon-magic-stone-panel > summary').className);
      assert.equal(summary.children.length, 0, 'the native disclosure marker and title stay unobstructed');
    }
    assert.ok(document.querySelector('.results-panel > .panel-note #comparison-label'));
    assert.equal(panel.querySelector('tr[data-equivalence-key="critRatePct"]'), null);
    assert.equal(panel.querySelector('tr[data-equivalence-key="extremizationPct"]'), null);
    const saved = JSON.stringify(page.readState());
    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    const input = key => panel.querySelector(`tr[data-equivalence-key="${key}"] input`);
    const gain = key => panel.querySelector(`tr[data-equivalence-key="${key}"] td:last-child`).textContent;
    input('bossDamagePct').value = '10';
    input('bossDamagePct').dispatchEvent(new Event('input', { bubbles: true }));
    const firstEquivalent = input('defenseIgnorePct').value;
    assert.ok(Number(firstEquivalent) >= 0);
    assert.ok(Number(input('allSkillDamagePct').value) > 0);
    assert.ok(parseFloat(gain('allSkillDamagePct')) >= parseFloat(gain('bossDamagePct')) - 0.000001,
      'the equivalent rounded up to three places still reaches the selected gain');
    assert.match(input('allSkillDamagePct').value, /^(?:\d+)(?:\.\d{1,3})?$/);
    assert.match(gain('bleedDamagePct'), /%|無法達成|不適用/);
    input('bleedDamagePct').value = '10';
    input('bleedDamagePct').dispatchEvent(new Event('input', { bubbles: true }));
    assert.ok(input('bleedDamagePct').closest('tr').classList.contains('attribute-equivalence-active'));
    assert.equal(input('bleedDamagePct').value, '10');
    input('bleedDamagePct').value = '';
    input('bleedDamagePct').dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(gain('bossDamagePct'), '0%');
    assert.equal(input('bossDamagePct').value, '0');
    assert.equal(JSON.stringify(page.readState()), saved, 'comparison inputs never persist to the loadout');
    input('bossDamagePct').value = '12.34567';
    input('bossDamagePct').dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(input('bossDamagePct').value, '12.345');
    input('bossDamagePct').value = '10';
    input('bossDamagePct').dispatchEvent(new Event('input', { bubbles: true }));
    await enter(page, 'Boss防禦', '50');
    assert.notEqual(input('defenseIgnorePct').value, firstEquivalent);
    assert.equal(input('bossDamagePct').value, '10');
  } finally { page.close(); }
});

test('main-page disclosure choices survive reload and result rebuilding', async () => {
  const first = await uiPage();
  let stored;
  try {
    const { document, Event, localStorage } = first.dom.window;
    const change = (selector, open) => {
      const detail = document.querySelector(selector);
      assert.ok(detail, selector);
      detail.open = open;
      detail.dispatchEvent(new Event('toggle'));
    };
    change('.results-panel', false);
    change('.attribute-equivalence-panel', true);
    change('.weapon-magic-stone-panel', true);
    change('#results details[data-disclosure-key="stat:bossDamagePct"]', true);
    change('#inspector details.editor-section', true);
    change('.site-credits-notes', true);
    document.querySelector('.global-source-panel:not(.weapon-magic-stone-panel)').open = true;
    first.dom.window.dispatchEvent(new Event('pagehide'));
    stored = localStorage.getItem('damage-calculator.disclosures.v1');
    assert.ok(stored);
  } finally { first.close(); }

  const next = await uiPage(stateA, stateA, { storage: { 'damage-calculator.disclosures.v1': stored } });
  try {
    const { document } = next.dom.window;
    assert.equal(document.querySelector('.results-panel').open, false);
    assert.equal(document.querySelector('.attribute-equivalence-panel').open, true);
    assert.equal(document.querySelector('.weapon-magic-stone-panel').open, true);
    assert.equal(document.querySelector('.global-source-panel:not(.weapon-magic-stone-panel)').open, true);
    assert.equal(document.querySelector('#results details[data-disclosure-key="stat:bossDamagePct"]').open, true);
    assert.equal(document.querySelector('#inspector details.editor-section').open, true);
    assert.equal(document.querySelector('.site-credits-notes').open, true);
    await enter(next, 'Boss防禦', '50');
    assert.equal(document.querySelector('#results details[data-disclosure-key="stat:bossDamagePct"]').open, true);
    assert.equal(document.querySelector('.results-panel').open, false);
  } finally { next.close(); }
});
