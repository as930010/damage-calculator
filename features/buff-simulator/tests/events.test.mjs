import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { boot, fixturesUrl, storageKey } from './dom-harness.mjs';
import { capture, edit, scenarios } from './scenarios.mjs';

// Recorded from the unmodified 54f16fb production build before event routing changes.
// Full numeric outputs and v1 payloads are checked alongside complete result/skill HTML hashes.
const fixtures = JSON.parse(await readFile(fixturesUrl, 'utf8'));
async function open(t, options) { const h = await boot(options); t.after(h.close); return h; }
function work(h, expected) {
  for (const [key, value] of Object.entries(expected)) assert.equal(h.calls[key], value, key);
  assert.equal(h.calls.updateResults, h.calls.resultWrites, 'each result update writes the actual DOM once');
  assert.equal(h.calls.updateSkillReference, h.calls.skillWrites, 'each skill update writes the actual DOM once');
}

for (const [name, setup] of Object.entries(scenarios)) {
  test(`baseline numeric results, complete formatted HTML and v1 storage: ${name}`, async t => {
    const h = await open(t); setup(h); assert.deepEqual(capture(h), fixtures[name]);
  });
}

test('single/challenge round-trip restores separate rosters, percentages, toggles and Boss values', async t => {
  const h = await open(t); scenarios.configuredSingle(h);
  const single = capture(h);
  scenarios.configuredChallenge(h);
  const challenge = capture(h);
  h.clickMode('single');
  assert.equal(h.query('[data-member]').value, 'DaB');
  assert.equal(h.query('[data-option-value="skill-damage-gloves"]').value, '25');
  assert.equal(h.query('[data-option="green-beast"]').checked, false);
  assert.equal(h.query('#boss-reduction').value, '80.00');
  assert.equal(capture(h).resultHtmlHash, single.resultHtmlHash);
  h.clickMode('challenge');
  assert.equal(h.query('[data-member][data-team="first"]').value, 'DaB');
  assert.equal(h.query('[data-member][data-team="second"]').value, 'NP');
  assert.equal(h.query('#boss-reduction').value, '95.50');
  assert.equal(capture(h).resultHtmlHash, challenge.resultHtmlHash);
});

test('stored settings reload with the same numeric results and formatted result DOM', async t => {
  const h = await open(t); scenarios.configuredSingle(h); scenarios.configuredChallenge(h);
  const saved = h.saved();
  assert.deepEqual(Object.keys(saved), ['version', 'mode', 'membersByTeam', 'optionsByTeam', 'bossReductions', 'optionDisclosureOpen']);
  assert.equal(saved.version, 1);
  const before = capture(h);
  const restored = await open(t, { saved });
  assert.deepEqual(capture(restored).results, before.results);
  assert.equal(capture(restored).resultHtmlHash, before.resultHtmlHash);
  assert.equal(restored.query('[data-member][data-team="second"]').value, 'NP');
  restored.reset();
  restored.query('.option-disclosure').open = true;
  restored.event(restored.query('.option-disclosure'), 'toggle');
  assert.equal(restored.saved().optionDisclosureOpen.first, true);
  work(restored, { calculateTeam: 0, updateResults: 0, updateSkillReference: 0, storage: 1 });
});

test('invalid storage and disabled storage leave the calculator usable', async t => {
  for (const saved of ['{', { version: 999 }, { version: 1, mode: 'bad', membersByTeam: { single: [null] }, bossReductions: { single: 1 } }]) {
    const h = await open(t, { saved });
    assert.equal(createHash('sha256').update(h.query('#results').innerHTML).digest('hex'), fixtures.defaultSingle.resultHtmlHash);
  }
  const h = await open(t, { storageThrows: true }); h.reset();
  edit(h, '[data-member]', 'DaB');
  work(h, { calculateTeam: 1, updateResults: 1, storage: 1 });
  assert.ok(h.query('#results').textContent.includes('Buff 增幅'));
});

test('class codes with case and surrounding whitespace resolve to identical calculations', async t => {
  const h = await open(t);
  edit(h, '[data-member]', 'dab');
  const result = capture(h).results.at(-1);
  edit(h, '[data-member]', ' DaB ');
  assert.deepEqual(capture(h).results.at(-1), result);
  assert.ok(!h.query('#results').textContent.includes('尚未辨識'));
});

test('unknown classes remain visible as escaped validation messages and can be corrected', async t => {
  const h = await open(t);
  edit(h, '[data-member]', '<不存在&>');
  assert.ok(h.query('#results').textContent.includes('<不存在&>'));
  assert.equal(h.app.querySelector('#results script'), null);
  assert.equal(h.saved().membersByTeam.single[0], '<不存在&>');
  edit(h, '[data-member]', 'DaB');
  assert.ok(!h.query('#results').textContent.includes('尚未辨識'));
});

test('illegal Boss values show the existing warning, preserve the last valid save and accept corrections', async t => {
  const h = await open(t); edit(h, '#boss-reduction', 80);
  for (const value of [100, -1, 101]) {
    h.reset(); edit(h, '#boss-reduction', value);
    assert.ok(h.query('#results').textContent.includes('0%（含）至 100%（不含）'));
    assert.equal(h.saved().bossReductions.single, 0.8);
    work(h, { calculateTeam: 0, updateResults: 1, storage: 0, updateSkillReference: 0 });
  }
  h.reset(); edit(h, '#boss-reduction', 80);
  work(h, { calculateTeam: 1, updateResults: 1, storage: 0 });
  assert.ok(!h.query('#results').textContent.includes('validation-note'));
});

test('blank, malformed and negative percentages preserve the existing number conversion and remain correctable', async t => {
  const h = await open(t);
  const input = edit(h, '[data-option-value="movement-speed-shoes"]', 'invalid');
  assert.equal(input.value, '');
  assert.equal(h.saved().optionsByTeam.single['movement-speed-shoes'], 0);
  edit(h, '[data-option-value="movement-speed-shoes"]', -5);
  assert.equal(h.saved().optionsByTeam.single['movement-speed-shoes'], -5);
  edit(h, '[data-option-value="movement-speed-shoes"]', 14.4);
  assert.equal(h.saved().optionsByTeam.single['movement-speed-shoes'], 14.4);
  assert.ok(h.query('#results').textContent.includes('乘算動速'));
});

test('Chinese skill search and clear update only skill references, without roster scans', async t => {
  const h = await open(t); h.reset();
  const search = edit(h, '[data-skill-query]', '護盾');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, saveCurrentInputs: 0, memberScans: 0, updateSkillReference: 1 });
  assert.ok(h.query('[data-skill-results]').textContent.includes('護盾'));
  h.reset(); h.event(search, 'change');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, updateSkillReference: 0 });
  edit(h, '[data-skill-query]', '');
  assert.equal(capture(h).skillHtmlHash, fixtures.defaultSingle.skillHtmlHash);
});

test('skill reference retains selected-class filtering and no-match behavior', async t => {
  const h = await open(t); edit(h, '[data-member]', 'DaB');
  const headings = [...h.app.querySelectorAll('.skill-role-heading')].map(node => node.textContent);
  assert.equal(headings.length, 1); assert.ok(headings[0].includes('DaB'));
  h.reset(); edit(h, '[data-skill-query]', '完全不存在的技能');
  assert.equal(h.query('[data-skill-results]').textContent, '沒有符合的技能。');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, memberScans: 0 });
  edit(h, '[data-skill-query]', '');
  assert.equal(h.app.querySelectorAll('.skill-role-heading').length, 1);
});

test('search composition commits once and ignores intermediate or trailing input/change events', async t => {
  const h = await open(t); const input = h.query('[data-skill-query]'); h.reset();
  h.event(input, 'compositionstart'); input.value = '護'; h.event(input, 'input', { isComposing: true });
  h.event(input, 'change'); input.value = '護盾'; h.event(input, 'input', { isComposing: true });
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, updateSkillReference: 0 });
  h.event(input, 'compositionend', { data: '護盾' }); h.event(input); h.event(input, 'change');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, memberScans: 0, updateSkillReference: 1 });
});

test('member composition commits Chinese text once without saving partial composition and permits correction', async t => {
  const h = await open(t); const input = h.query('[data-member]');
  h.reset();
  h.event(input, 'compositionstart'); input.value = '未'; h.event(input, 'input', { isComposing: true });
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0 });
  input.value = '未知職業'; h.event(input, 'compositionend'); h.event(input); h.event(input, 'change');
  work(h, { calculateTeam: 1, updateResults: 1, storage: 1, updateSkillReference: 1 });
  assert.equal(h.saved().membersByTeam.single[0], '未知職業');
  assert.ok(h.query('#results').textContent.includes('尚未辨識'));
  edit(h, '[data-member]', 'DaB');
  assert.ok(!h.query('#results').textContent.includes('尚未辨識'));
});

for (const mode of ['single', 'challenge']) {
  test(`${mode}: input/change duplicate member selection runs only one necessary calculation round`, async t => {
    const h = await open(t); if (mode === 'challenge') h.clickMode(mode);
    const input = h.query('[data-member]'); h.reset(); input.value = 'DaB'; h.event(input); h.event(input, 'change');
    work(h, { calculateTeam: mode === 'single' ? 1 : 3, calculateChallenge: mode === 'single' ? 0 : 1,
      updateResults: 1, storage: 1, updateSkillReference: 1, saveCurrentInputs: 1 });
  });
}

for (const [selector, value] of [['[data-option="green-beast"]', false], ['[data-option-value="skill-damage-gloves"]', 25], ['#boss-reduction', 80]]) {
  test(`${selector}: duplicate events update only changed calculation state`, async t => {
    const h = await open(t); h.reset(); const input = edit(h, selector, value); h.event(input, 'change');
    work(h, { calculateTeam: 1, updateResults: 1, storage: 1, saveCurrentInputs: 1, updateSkillReference: 0 });
  });
}

test('same numeric values and repeated untouched fields skip work; rapid real changes are not lost', async t => {
  const h = await open(t); const input = edit(h, '[data-option-value="skill-damage-gloves"]', '25'); h.reset();
  input.value = '25.00'; h.event(input); h.event(input, 'change');
  const boss = h.query('#boss-reduction'); h.event(boss); h.event(boss, 'change');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, saveCurrentInputs: 0, updateSkillReference: 0 });
  for (const value of ['26', '27', '26', '']) { input.value = value; h.event(input); h.event(input, 'change'); }
  work(h, { calculateTeam: 4, updateResults: 4, storage: 4 });
  assert.equal(h.saved().optionsByTeam.single['skill-damage-gloves'], 0);
});

test('one mode switch owns one shell and one result round; clicking the active mode is a no-op', async t => {
  const h = await open(t); h.reset(); h.clickMode('challenge');
  work(h, { shell: 1, calculateTeam: 3, calculateChallenge: 1, updateResults: 1, updateSkillReference: 1, storage: 1 });
  h.reset(); h.clickMode('challenge');
  work(h, { shell: 0, calculateTeam: 0, updateResults: 0, updateSkillReference: 0, storage: 0, saveCurrentInputs: 0 });
  h.clickMode('single');
  work(h, { shell: 1, calculateTeam: 1, updateResults: 1, updateSkillReference: 1, storage: 1 });
});

test('mode switching preserves a composing member instead of discarding its visible edit', async t => {
  const h = await open(t); const input = h.query('[data-member]');
  h.event(input, 'compositionstart'); input.value = 'DaB'; h.event(input, 'input', { isComposing: true });
  h.clickMode('challenge'); h.clickMode('single');
  assert.equal(h.query('[data-member]').value, 'DaB');
  assert.equal(h.saved().membersByTeam.single[0], 'DaB');
});

test('unknown event sources do not save or update; disclosure toggles preserve v1 state without calculation', async t => {
  const h = await open(t); h.reset(); h.event(h.query('#results'));
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, updateSkillReference: 0 });
  const disclosure = h.query('.option-disclosure'); disclosure.open = true; h.event(disclosure, 'toggle'); h.event(disclosure, 'toggle');
  assert.equal(h.saved().optionDisclosureOpen.single, true);
  work(h, { calculateTeam: 0, updateResults: 0, storage: 1, updateSkillReference: 0 });
  assert.equal(storageKey, 'buff-team-simulator.state.v1');
});

test('challenge search skips all three team calculations, persistence and roster scans', async t => {
  const h = await open(t); scenarios.configuredChallenge(h); h.reset();
  edit(h, '[data-skill-query]', '護盾');
  work(h, { calculateTeam: 0, calculateChallenge: 0, updateResults: 0, storage: 0,
    saveCurrentInputs: 0, memberScans: 0, updateSkillReference: 1 });
});

test('an untouched numeric default does not create a saved state', async t => {
  const h = await open(t); h.reset();
  edit(h, '[data-option-value="skill-damage-gloves"]', '18.00');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, saveCurrentInputs: 0 });
  assert.equal(h.saved(), null);
});

test('repeated shell rebuilds retain exactly one composition handler and one update round', async t => {
  const h = await open(t);
  for (const mode of ['challenge', 'single', 'challenge', 'single', 'challenge', 'single']) {
    h.reset(); h.clickMode(mode);
    work(h, { shell: 1, calculateTeam: mode === 'single' ? 1 : 3, updateResults: 1, updateSkillReference: 1 });
  }
  const input = h.query('[data-member]'); h.reset();
  h.event(input, 'compositionstart'); input.value = 'DaB'; h.event(input, 'input', { isComposing: true });
  h.event(input, 'compositionend'); h.event(input); h.event(input, 'change');
  work(h, { calculateTeam: 1, updateResults: 1, storage: 1, updateSkillReference: 1 });
});
