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
    assert.ok([...panel.querySelectorAll('tr[data-equivalence-key] input')].every(input => input.value === '' && input.placeholder === '0'));
    input('bossDamagePct').dispatchEvent(new Event('blur'));
    assert.equal(input('bossDamagePct').value, ''); assert.equal(gain('bossDamagePct'), '0%');
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
    assert.equal(input('bossDamagePct').value, '');
    input('bleedDamagePct').dispatchEvent(new Event('blur'));
    assert.equal(input('bleedDamagePct').value, '');
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

test('combined signed changes use one complete engine evaluation, caps and merged defense ignore without mutating the input', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { calculateLoadout } = await runtime.load('calculation/loadout-engine.ts');
  const { calculateCombinedAttributeChange } = await runtime.load('calculation/attribute-equivalence.ts');
  const evaluation = evaluateLoadout(gameData, structuredClone(sample), false, true);
  const input = evaluation.comparisonInput, baseline = evaluation.damage.result;
  const saved = JSON.stringify({ input, baseline });
  const deltas = { doubleAttackPct: 10, bleedDamagePct: -20, transcendenceSkillDamagePct: 7,
    bossDamagePct: 10, critDamagePct: -5, superAdaptabilityPct: 2.5, defenseIgnorePct: 1.25,
    multiplicativeDamagePct: 2, multiplicativeCritDamagePct: -1, adaptabilityPct: 100, polarizationPct: 100 };
  const expected = calculateLoadout({ ...input, sources: { ...input.sources, shared: [
    ...input.sources.shared, ...Object.entries(deltas).map(([key, value]) => ({ sourceId: 'test:' + key, stats: { [key]: value } })),
  ] } });
  runtime.resetCounts();
  const actual = calculateCombinedAttributeChange(input, baseline, deltas);
  assert.equal(actual.simulatedDamage, expected.finalDamage.finalDamage);
  assert.equal(actual.gainPct, (expected.finalDamage.finalDamage / baseline.finalDamage.finalDamage - 1) * 100);
  assert.equal(expected.attributes.stats.defenseIgnorePct.totalBeforeCap, baseline.attributes.stats.defenseIgnorePct.totalBeforeCap + 1.25);
  assert.equal(expected.attributes.stats.adaptabilityPct.finalTotal, 60);
  assert.equal(expected.attributes.stats.polarizationPct.finalTotal, 60);
  assert.equal(runtime.counts.calculateLoadout, 1); assert.equal(runtime.counts.aggregateCharacterAttributes, 2);
  assert.equal(JSON.stringify({ input, baseline }), saved);
  const both = calculateCombinedAttributeChange(input, baseline, { bossDamagePct: 10, bleedDamagePct: 10 });
  const separateGains = calculateCombinedAttributeChange(input, baseline, { bossDamagePct: 10 }).gainPct
    + calculateCombinedAttributeChange(input, baseline, { bleedDamagePct: 10 }).gainPct;
  assert.ok(Math.abs(both.gainPct - separateGains) > 0.001, 'compound gains must not be added together');
  runtime.resetCounts();
  for (const deltas of [{}, { bleedDamagePct: 0, bossDamagePct: -0 }]) {
    const zero = calculateCombinedAttributeChange(input, baseline, deltas);
    assert.equal(zero.simulatedDamage, baseline.finalDamage.finalDamage); assert.equal(zero.gainPct, 0);
  }
  assert.equal(runtime.counts.calculateLoadout ?? 0, 0);
  for (const invalid of [NaN, Infinity, -Infinity, 1_000_001])
    assert.equal(calculateCombinedAttributeChange(input, baseline, { bossDamagePct: invalid }), null);
  assert.equal(calculateCombinedAttributeChange(input, baseline, { nonexistentStat: 1 }), null);
});

test('combined changes preserve class effects, lowerwear bonus averaging and Boss HP conditions', async () => {
  const runtime = await createRuntime();
  const { evaluateLoadout } = await runtime.load('frontend/projection.ts');
  const { calculateLoadout } = await runtime.load('calculation/loadout-engine.ts');
  const { calculateCombinedAttributeChange } = await runtime.load('calculation/attribute-equivalence.ts');
  const evaluation = evaluateLoadout(gameData, { ...structuredClone(sample), Job: 'FP' }, false, true);
  const deltas = { strongerPct: -2, heatPct: 5, multiplicativeDamagePct: 1.5, multiplicativeCritDamagePct: -0.5, defenseIgnorePct: -2 };
  for (const condition of [undefined, 'above', 'below']) {
    const input = { ...evaluation.comparisonInput, bossHealthCondition: condition,
      lowerwearBonusSources: {
        lowerwearA: [{ sourceId: 'test:medal-a', stats: { multiplicativeDamagePct: 1, multiplicativeCritDamagePct: 0.5 } }],
        lowerwearB: [{ sourceId: 'test:medal-b', stats: { multiplicativeDamagePct: 1.5, multiplicativeCritDamagePct: 1 } }],
      } };
    const baseline = calculateLoadout(input);
    const expected = calculateLoadout({ ...input, sources: { ...input.sources,
      shared: [...input.sources.shared, { sourceId: 'test:combined', stats: deltas }] } });
    assert.equal(calculateCombinedAttributeChange(input, baseline, deltas).simulatedDamage, expected.finalDamage.finalDamage);
    assert.equal(expected.lowerwearConfigurations.length, 2);
  }
  const singularInput = { ...evaluation.comparisonInput, enemyDefensePct: 100 };
  const singularBaseline = calculateLoadout(singularInput);
  const pole = 100 - singularBaseline.attributes.stats.defenseIgnorePct.totalBeforeCap;
  assert.equal(calculateCombinedAttributeChange(singularInput, singularBaseline, { defenseIgnorePct: pole }), null);
});

test('combined UI preserves independent drafts, accepts signed decimals and follows loadout changes without saving simulations', async () => {
  const page = await uiPage();
  try {
    const { document, Event } = page.dom.window;
    const panel = document.querySelector('.attribute-equivalence-panel');
    const original = document.querySelector('#attribute-equivalence-single');
    const combined = document.querySelector('#attribute-equivalence-combined');
    const mode = text => [...panel.querySelectorAll('.attribute-equivalence-modes button')].find(button => button.textContent === text);
    const input = key => combined.querySelector(`input[data-combined-key="${key}"]`);
    const result = key => combined.querySelector(`[data-combined-result="${key}"]`).textContent;
    const set = (key, value) => { input(key).value = value; input(key).dispatchEvent(new Event('input', { bubbles: true })); };
    assert.equal(original.hidden, false); assert.equal(combined.hidden, true);
    assert.equal(mode('等效換算/單項增幅').getAttribute('aria-pressed'), 'true');
    panel.open = true; panel.dispatchEvent(new Event('toggle'));
    const singleInput = original.querySelector('tr[data-equivalence-key="bossDamagePct"] input');
    singleInput.value = '10'; singleInput.dispatchEvent(new Event('input', { bubbles: true }));
    const saved = page.readState(), baselineJson = page.dom.window.localStorage.getItem('dab-baseline-v1');
    const damageHtml = document.querySelector('#damage-result').innerHTML;
    mode('綜合計算').click();
    assert.equal(original.hidden, true); assert.equal(combined.hidden, false); assert.equal(result('gain'), '0%');
    assert.deepEqual([...combined.querySelectorAll('input')].map(input => input.dataset.combinedKey),
      [...original.querySelectorAll('tr[data-equivalence-key]')].map(row => row.dataset.equivalenceKey));
    for (const draft of ['-', '-.', '-0.']) {
      set('bleedDamagePct', draft); assert.equal(input('bleedDamagePct').value, draft);
      assert.doesNotMatch(combined.textContent, /NaN|Infinity/);
    }
    set('bleedDamagePct', '-20.12345'); assert.equal(input('bleedDamagePct').value, '-20.123');
    set('doubleAttackPct', '10'); set('superAdaptabilityPct', '2.5');
    page.runtime.resetCounts(); set('bossDamagePct', '10');
    assert.equal(page.runtime.counts.calculateLoadout, 1);
    assert.equal(page.runtime.counts.evaluateLoadout ?? 0, 0);
    assert.equal(page.runtime.counts.aggregateCharacterAttributes, 2);
    assert.deepEqual(page.readState(), saved); assert.equal(document.querySelector('#undo').disabled, true);
    assert.equal(page.dom.window.localStorage.getItem('dab-baseline-v1'), baselineJson);
    assert.equal(document.querySelector('#damage-result').innerHTML, damageHtml);
    const deltas = { bleedDamagePct: -20.123, doubleAttackPct: 10, superAdaptabilityPct: 2.5, bossDamagePct: 10 };
    const { calculateCombinedAttributeChange } = await page.runtime.load('calculation/attribute-equivalence.ts');
    const { evaluateLoadout } = await page.runtime.load('frontend/projection.ts');
    const expected = state => {
      const evaluation = evaluateLoadout(gameData, state, false, true);
      return calculateCombinedAttributeChange(evaluation.comparisonInput, evaluation.damage.result, deltas);
    };
    const format = number => number.toLocaleString('zh-TW', { maximumFractionDigits: 3 });
    assert.equal(result('simulated'), format(expected(saved).simulatedDamage));
    const priorDamage = result('base'); await enter(page, 'Boss防禦', '50');
    assert.notEqual(result('base'), priorDamage);
    assert.equal(result('simulated'), format(expected(page.readState()).simulatedDamage));
    assert.equal(input('bleedDamagePct').value, '-20.123');
    document.querySelector('#undo').click(); assert.equal(result('base'), priorDamage);
    const lastDamage = result('simulated');
    set('bossDamagePct', 'abc'); assert.equal(input('bossDamagePct').value, '10'); assert.equal(result('simulated'), lastDamage);
    set('bossDamagePct', '1000001'); assert.equal(result('gain'), '—');
    for (const key of Object.keys(deltas)) set(key, '');
    assert.equal(result('gain'), '0%'); assert.equal(result('simulated'), result('base'));
    mode('等效換算/單項增幅').click(); assert.equal(singleInput.value, '10');
    assert.equal(singleInput, original.querySelector('tr[data-equivalence-key="bossDamagePct"] input'));
    mode('綜合計算').click(); assert.equal(input('bleedDamagePct').value, '');
  } finally { page.close(); }
});

test('comparison inputs block letters, symbols, invalid pastes and IME commits while retaining combined negative drafts', async () => {
  const page = await uiPage();
  try {
    const { document, Event, KeyboardEvent, InputEvent } = page.dom.window;
    const panel = document.querySelector('.attribute-equivalence-panel');
    panel.open = true; panel.dispatchEvent(new Event('toggle'));
    const saved = JSON.stringify(page.readState());
    const single = document.querySelector('tr[data-equivalence-key="bossDamagePct"] input');
    const combined = document.querySelector('input[data-combined-key="bossDamagePct"]');
    const set = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
    for (const input of [single, combined]) {
      if (input === combined) [...panel.querySelectorAll('.attribute-equivalence-modes button')].find(button => button.textContent === '綜合計算').click();
      input.dispatchEvent(new Event('focus')); set(input, '12.3'); input.setSelectionRange(4, 4);
      for (const character of ['e', 'E', 'a', '中', '+', '-', '%', ' ', '.']) {
        const keyboard = new KeyboardEvent('keydown', { key: character, cancelable: true });
        input.dispatchEvent(keyboard); assert.equal(keyboard.defaultPrevented, true, 'keydown ' + character);
        const edit = new InputEvent('beforeinput', { inputType: 'insertText', data: character, cancelable: true });
        input.dispatchEvent(edit); assert.equal(edit.defaultPrevented, true, 'beforeinput ' + character);
      }
      for (const text of ['abc', '中文', '1e3', '+2', '12%', '1.2.3']) {
        const paste = new Event('paste', { cancelable: true });
        Object.defineProperty(paste, 'clipboardData', { value: { getData: () => text } });
        input.dispatchEvent(paste); assert.equal(paste.defaultPrevented, true, 'paste ' + text);
        set(input, text); assert.equal(input.value, '12.3', 'input fallback ' + text);
      }
      input.dispatchEvent(new Event('compositionstart'));
      input.value = '中文'; input.dispatchEvent(new InputEvent('input', { isComposing: true }));
      input.dispatchEvent(new Event('compositionend')); assert.equal(input.value, '12.3');
      const selectAll = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
      input.dispatchEvent(selectAll); assert.equal(selectAll.defaultPrevented, false);
      set(input, '12.34567'); assert.equal(input.value, '12.345');
      set(input, ''); assert.equal(input.value, '');
      set(input, '.'); assert.equal(input.value, '.');
      set(input, '.5'); assert.equal(input.value, '.5');
      set(input, '-2.5'); assert.equal(input.value, input === combined ? '-2.5' : '.5');
    }
    for (const draft of ['-', '-.', '-0.', '-2.5']) { set(combined, draft); assert.equal(combined.value, draft); }
    assert.deepEqual(page.readState(), JSON.parse(saved));
    assert.doesNotMatch(document.querySelector('#attribute-equivalence-combined').textContent, /NaN|Infinity/);
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
