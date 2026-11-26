import { parseDamageBasis } from '../frontend/damage-basis-state.ts';
import { resolveLoadoutOption } from '../calculation/options.ts';
import { SUPPORT_MAGAZINE_LEVELS, supportMagazineBonus, supportMagazineLevelKey } from '../calculation/support-magazines.ts';
import { parseSavedSimulatorState, resolveSavedMembers, resolveSavedOptions } from '../frontend/saved-state.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCoreCatalog } from '../frontend/data-loader.ts';
import { calculateBeneficiaryDefenseGain } from '../calculation/defense.ts';
import { calculateProductStat } from '../../../calculation/multiplicative.ts';
import { calculateTeam, calculateChallenge } from '../calculation/engine.ts';
import { boot, fixturesUrl, storageKey } from './dom-harness.mjs';
import { capture, edit, scenarios } from './scenarios.mjs';

// Recorded from the unmodified 54f16fb production build before event routing changes.
// Keep the archived numeric outputs, v1 payloads and complete result HTML exact.
// Check the revised skill reference directly against the ordered catalog.
// Damage basis adds calculation detail; the
// original baseline scenarios retain the same numerical results at the original assumptions.
// NP single and DaB corrections change only
// MP metrics/breakdowns; old-data replay and independent field/DOM checks verified both fixtures.
// The UI audit removed redundant result eyebrows; only the corresponding result digests changed.
const fixtures = JSON.parse(await readFile(fixturesUrl, 'utf8'));
const reference = JSON.parse(await readFile(new URL('../data/skill-reference.json', import.meta.url), 'utf8'));
function assertReference(h, selectedCodes = []) {
  const roles = reference.roles.filter(role => !selectedCodes.length || selectedCodes.includes(role.code));
  const articles = [...h.app.querySelectorAll('.skill-result')];
  assert.equal(articles.length, roles.length);
  for (const [index, role] of roles.entries()) {
    const article = articles[index];
    const heading = article.querySelector('.skill-role-heading');
    assert.equal(heading.querySelector('strong').textContent.split(' · ')[0], role.code);
    assert.equal(heading.querySelector('span').textContent, role.skills.length + ' 項技能');
    const entries = [...article.querySelectorAll('.skill-entry')];
    assert.equal(entries.length, role.skills.length, role.code);
    for (const [skillIndex, skill] of role.skills.entries()) {
      const row = entries[skillIndex];
      assert.equal(row.querySelector('strong').textContent, skill.name);
      assert.equal(row.querySelector('header span').textContent, skill.category || '未標示類型', skill.name);
      const description = [...row.querySelector('p').childNodes]
        .map(node => node.nodeName === 'BR' ? '\n' : node.textContent).join('');
      assert.equal(description, skill.description, skill.name);
      if (skill.icon) {
        const image = row.querySelector('img');
        assert.equal(image.src, new URL('data/' + skill.icon, h.window.document.baseURI).href);
        assert.equal(image.getAttribute('loading'), 'lazy');
      } else {
        assert.equal(row.querySelector('.skill-icon-placeholder').getAttribute('aria-hidden'), 'true');
      }
    }
  }
}

async function open(t, options) { const h = await boot(options); t.after(h.close); return h; }
function work(h, expected) {
  for (const [key, value] of Object.entries(expected)) assert.equal(h.calls[key], value, key);
  assert.equal(h.calls.updateResults, h.calls.resultWrites, 'each result update writes the actual DOM once');
  if (h.query('.skill-reference').open) {
    assert.equal(h.calls.updateSkillReference, h.calls.skillWrites, 'each loaded skill update writes the actual DOM once');
  } else {
    assert.equal(h.calls.skillWrites, 0, 'collapsed skill references do not build content');
  }
}

// The archived results retain their original IEEE-754 tails. Compare only engine numbers
// within a few machine epsilons; keep the HTML, storage and result structure exact.
function matchArchivedNumbers(actual, expected) {
  if (typeof actual === 'number' && typeof expected === 'number'
    && Math.abs(actual - expected) <= 16 * Number.EPSILON * Math.max(1, Math.abs(expected))) return expected;
  if (Array.isArray(actual) && Array.isArray(expected)) return actual.map((value, i) => matchArchivedNumbers(value, expected[i]));
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    return Object.fromEntries(Object.entries(actual).map(([key, value]) => [key, matchArchivedNumbers(value, expected[key])]));
  }
  return actual;
}
for (const [name, setup] of Object.entries(scenarios)) {
  test(`baseline numeric results, complete formatted HTML and v1 storage: ${name}`, async t => {
    const h = await open(t); setup(h); await h.openSkills();
    const actual = capture(h);
    actual.results = matchArchivedNumbers(actual.results, fixtures[name].results);
    assert.deepEqual(actual.results, fixtures[name].results);
    assert.equal(actual.resultHtmlHash, fixtures[name].resultHtmlHash);
    assert.deepEqual(actual.saved, fixtures[name].saved);
    const selectedCodes = name === 'configuredSingle' ? ['DaB', 'NP']
      : name === 'configuredChallenge' ? ['DaB', 'NP', 'SU'] : [];
    assertReference(h, selectedCodes);
  });
}


test('Buff mode tabs keep one sequential stop and move focus with the selected panel', async t => {
  const h = await open(t);
  const key = name => h.window.document.activeElement.dispatchEvent(
    new h.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  h.query('[data-mode="single"]').focus();
  key('ArrowRight');
  assert.equal(h.window.document.activeElement, h.query('#buff-mode-challenge'));
  assert.equal(h.query('#buff-mode-single').tabIndex, -1);
  assert.equal(h.query('#buff-mode-challenge').tabIndex, 0);
  assert.equal(h.query('#buff-mode-panel').getAttribute('aria-labelledby'), 'buff-mode-challenge');
  assert.equal(h.app.querySelectorAll('[data-member]').length, 8);
  key('Home');
  assert.equal(h.window.document.activeElement, h.query('#buff-mode-single'));
  assert.equal(h.app.querySelectorAll('[data-member]').length, 6);
});

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

test('skill and result disclosures resume their last state after leaving the page', async t => {
  const h = await open(t);
  await h.openSkills();
  const single = h.query('#results .result-card');
  single.querySelector('.control-times').open = true;
  single.querySelector('.calculation-details').open = true;
  h.clickMode('challenge');
  await h.openSkills();
  const cards = h.app.querySelectorAll('#results .result-card');
  cards[0].querySelector('.control-times').open = true;
  cards[2].querySelector('.calculation-details').open = true;
  h.window.dispatchEvent(new h.window.Event('pagehide'));
  const savedDisclosures = h.savedDisclosures();
  assert.equal(savedDisclosures.skillReferenceOpen, true);

  const restored = await open(t, { saved: h.saved(), savedDisclosures });
  assert.equal(restored.query('.skill-reference').open, true);
  await restored.settleSkills();
  assert.equal(restored.requests.filter(path => path === 'skill-reference.json').length, 1);
  assert.equal(restored.app.querySelectorAll('#results .result-card')[0].querySelector('.control-times').open, true);
  assert.equal(restored.app.querySelectorAll('#results .result-card')[2].querySelector('.calculation-details').open, true);
  restored.clickMode('single');
  assert.equal(restored.query('#results .control-times').open, true);
  assert.equal(restored.query('#results .calculation-details').open, true);
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
  const h = await open(t); await h.openSkills(); h.reset();
  const completeReference = h.query('[data-skill-results]').innerHTML;
  const search = edit(h, '[data-skill-query]', '護盾');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, saveCurrentInputs: 0, memberScans: 0, updateSkillReference: 1 });
  assert.ok(h.query('[data-skill-results]').textContent.includes('護盾'));
  h.reset(); h.event(search, 'change');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, updateSkillReference: 0 });
  edit(h, '[data-skill-query]', '');
  assert.equal(h.query('[data-skill-results]').innerHTML, completeReference);
});

test('skill reference retains selected-class filtering and no-match behavior', async t => {
  const h = await open(t); edit(h, '[data-member]', 'DaB'); await h.openSkills();
  const headings = [...h.app.querySelectorAll('.skill-role-heading')].map(node => node.textContent);
  assert.equal(headings.length, 1); assert.ok(headings[0].includes('DaB'));
  h.reset(); edit(h, '[data-skill-query]', '完全不存在的技能');
  assert.equal(h.query('[data-skill-results]').textContent, '沒有符合的技能。');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, memberScans: 0 });
  edit(h, '[data-skill-query]', '');
  assert.equal(h.app.querySelectorAll('.skill-role-heading').length, 1);
});

test('search composition commits once and ignores intermediate or trailing input/change events', async t => {
  const h = await open(t); await h.openSkills(); const input = h.query('[data-skill-query]'); h.reset();
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
  const h = await open(t); scenarios.configuredChallenge(h); await h.openSkills(); h.reset();
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const skillRequests = h => h.requests.filter(path => path === 'skill-reference.json').length;

test('core initialization requests five JSON files and builds no collapsed skill content', async t => {
  const h = await open(t);
  assert.deepEqual(h.requests, ['classes.json', 'class-effects.json', 'effect-types.json', 'loadout-options.json', 'calculation-parameters.json']);
  assert.equal(h.query('.skill-reference').open, false);
  assert.equal(h.query('[data-skill-results]').querySelectorAll('*').length, 0);
  assert.equal(h.calls.calculateTeam, 1);
  h.reset(); edit(h, '[data-member]', 'DaB'); h.clickMode('challenge');
  assert.equal(skillRequests(h), 0);
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 0);
  assert.equal(h.calls.updateResults, 2);
  assert.equal(h.calls.calculateTeam, 4);
});

test('first expansion loads once, keeps catalog order and icons, and reuses the session cache', async t => {
  const h = await open(t); h.reset(); await h.openSkills();
  assert.equal(skillRequests(h), 1);
  assertReference(h);
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 251);
  const skillList = h.query('[data-skill-results]');
  assert.equal(skillList.querySelectorAll('*').length, 2510); // MI's extra two line breaks were removed.
  assert.doesNotMatch(skillList.textContent, /亂殺快感|解放意志:織語者/);
  assert.match(skillList.textContent, /使用特殊主動技能時恢復5%最大MP/);
  for (const image of h.app.querySelectorAll('.skill-entry img')) {
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.ok(image.src.startsWith('https://test.example/buff-simulator/data/'));
  }
  assert.equal(h.calls.calculateTeam, 0); assert.equal(h.calls.storage, 0);
  h.setSkillsOpen(false);
  assert.equal(h.query('[data-skill-results]').childElementCount, 0);
  await h.openSkills(); h.event(h.query('.skill-reference'), 'toggle');
  assert.equal(skillRequests(h), 1);
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 251);
  h.clickMode('challenge'); await h.openSkills();
  assert.equal(skillRequests(h), 1);
});

test('first expansion creates only the selected class, and open rosters/search remain live', async t => {
  const h = await open(t); edit(h, '[data-member]', 'DaB'); await h.openSkills();
  assert.equal(h.app.querySelectorAll('.skill-result').length, 1);
  edit(h, '[data-member]', 'NP');
  assert.ok(h.query('.skill-role-heading').textContent.includes('NP'));
  h.reset(); edit(h, '[data-skill-query]', '完全不存在的技能');
  assert.equal(h.query('[data-skill-results]').textContent, '沒有符合的技能。');
  edit(h, '[data-skill-query]', '');
  assert.ok(h.query('.skill-role-heading').textContent.includes('NP'));
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, memberScans: 0, updateSkillReference: 2 });
});

test('in-flight expansions share one request and completion uses the latest query and roster', async t => {
  const pending = deferred(); let response;
  const h = await open(t, { fetchSkill: value => { response = value; return pending.promise; } });
  h.setSkillsOpen(true);
  assert.ok(h.query('[data-skill-results]').textContent.includes('正在載入'));
  assert.equal(h.query('[data-skill-results]').getAttribute('aria-busy'), 'true');
  edit(h, '[data-skill-query]', '不存在');
  h.setSkillsOpen(false); h.setSkillsOpen(true); h.event(h.query('.skill-reference'), 'toggle');
  edit(h, '[data-member]', 'DaB'); edit(h, '[data-skill-query]', 'DaB');
  assert.equal(skillRequests(h), 1);
  h.reset(); pending.resolve(response); await h.settleSkills();
  assert.equal(h.app.querySelectorAll('.skill-result').length, 1);
  assert.ok(h.query('.skill-role-heading').textContent.includes('DaB'));
  assert.equal(h.query('[data-skill-results]').hasAttribute('aria-busy'), false);
  assert.equal(h.calls.calculateTeam, 0); assert.equal(h.calls.storage, 0);
});

test('completion while collapsed caches data without creating hidden items', async t => {
  const pending = deferred(); let response;
  const h = await open(t, { fetchSkill: value => { response = value; return pending.promise; } });
  h.setSkillsOpen(true); h.setSkillsOpen(false);
  pending.resolve(response); await h.settleSkills();
  assert.equal(h.query('[data-skill-results]').childElementCount, 0);
  await h.openSkills();
  assert.equal(skillRequests(h), 1);
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 251);
});

test('shell replacement during loading never fills an obsolete or collapsed panel', async t => {
  const pending = deferred(); let response;
  const h = await open(t, { fetchSkill: value => { response = value; return pending.promise; } });
  h.setSkillsOpen(true); const oldResults = h.query('[data-skill-results]');
  h.reset(); h.clickMode('challenge');
  assert.equal(h.calls.calculateTeam, 3); assert.equal(h.calls.updateResults, 1);
  pending.resolve(response); await h.settleSkills();
  assert.equal(oldResults.querySelectorAll('.skill-entry').length, 0);
  assert.equal(h.query('[data-skill-results]').childElementCount, 0);
  edit(h, '[data-member][data-team="second"]', 'NP'); await h.openSkills();
  assert.equal(skillRequests(h), 1);
  assert.equal(h.app.querySelectorAll('.skill-result').length, 1);
  assert.ok(h.query('.skill-role-heading').textContent.includes('NP'));
});

test('reopening a replacement shell during loading shares the request and reads the new team/query', async t => {
  const pending = deferred(); let response;
  const h = await open(t, { fetchSkill: value => { response = value; return pending.promise; } });
  h.setSkillsOpen(true); edit(h, '[data-skill-query]', '不存在');
  h.clickMode('challenge'); h.setSkillsOpen(true);
  edit(h, '[data-member][data-team="second"]', 'NP');
  edit(h, '[data-skill-query]', 'NP');
  assert.equal(skillRequests(h), 1);
  assert.ok(h.query('[data-skill-results]').textContent.includes('正在載入'));
  pending.resolve(response); await h.settleSkills();
  assert.equal(h.app.querySelectorAll('.skill-result').length, 1);
  assert.ok(h.query('.skill-role-heading').textContent.includes('NP'));
});

for (const failure of ['network', 'HTTP', 'JSON']) {
  test(`${failure} skill failure is isolated, permits core edits and retries successfully`, async t => {
    let attempts = 0;
    const h = await open(t, { fetchSkill: response => {
      if (++attempts > 1) return response;
      if (failure === 'network') throw new Error('offline');
      if (failure === 'HTTP') return { ok: false, status: 503 };
      return { ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } };
    } });
    const before = h.query('#results').innerHTML;
    await h.openSkills();
    assert.equal(h.query('#results').innerHTML, before);
    assert.ok(h.query('[role="alert"]').textContent.includes('載入失敗'));
    h.reset(); edit(h, '[data-member]', 'DaB');
    assert.equal(h.calls.calculateTeam, 1); assert.equal(h.calls.storage, 1);
    h.query('[data-skill-retry]').click(); await h.settleSkills();
    assert.equal(skillRequests(h), 2);
    assert.equal(h.app.querySelectorAll('.skill-result').length, 1);
    assert.equal(h.app.querySelector('[data-skill-retry]'), null);
    assert.equal(h.calls.calculateTeam, 1); assert.equal(h.calls.storage, 1);
  });
}

for (const [name, corrupt] of Object.entries({
  object: () => null,
  roles: data => ({ ...data, roles: {} }),
  duplicate: data => ({ ...data, roles: [...data.roles, data.roles[0]] }),
  unknown: data => { data.roles[0].code = 'unknown-class'; return data; },
  skills: data => { data.roles[0].skills = null; return data; },
  incomplete: data => ({ ...data, roles: data.roles.slice(1) }),
})) {
  test(`lazy skill validation retains the existing ${name} rule and permits retry`, async t => {
    let attempts = 0;
    const h = await open(t, { fetchSkill: response => ++attempts === 1
      ? { ok: true, json: async () => corrupt(await response.json()) } : response });
    await h.openSkills();
    assert.ok(h.app.querySelector('[data-skill-retry]'));
    assert.equal(capture(h).resultHtmlHash, fixtures.defaultSingle.resultHtmlHash);
    h.query('[data-skill-retry]').click(); await h.settleSkills();
    assert.equal(h.app.querySelectorAll('.skill-entry').length, 251);
    assert.equal(skillRequests(h), 2);
  });
}

const corePayloads = Object.fromEntries(await Promise.all(Object.entries({classes:'classes',classEffects:'class-effects',effectTypes:'effect-types',loadoutOptions:'loadout-options',calculationParameters:'calculation-parameters'})
  .map(async([key,name])=>[key,JSON.parse(await readFile(new URL('../data/'+name+'.json',import.meta.url),'utf8'))])));
const closeNumber = (a,b) => assert.ok(Math.abs(a-b)<1e-12*Math.max(1,Math.abs(b)), `${a} != ${b}`);

test('All 60 classes preserve default effects outside the documented balance corrections', () => {
  const catalog=parseCoreCatalog(corePayloads);
  assert.equal(corePayloads.classEffects.classes.length,60);assert.equal(catalog.classEffects.length,120);
  for(const role of catalog.classes){const profiles=catalog.classEffects.filter(p=>p.classId===role.id);assert.equal(profiles.length,2);assert.deepEqual(profiles[0].effects,profiles[1].effects);assert.notEqual(profiles[0].effects,profiles[1].effects);assert.equal('estimatedDamageScore' in profiles[0],false);}
  assert.equal(corePayloads.classEffects.classes.filter(p=>p.challengeEffects).length,0);
  const changed={RM:['buff','debuff'],DaB:['mpRecoveryPerSecond'],PR:['buff','legacyCompositeBuff','mpRecoveryPerSecond','debuffCleanse'],BL:['actionSpeedMultiplicative'],NP:['mpRecoveryPerSecond'],LA:['buff','multiplicativeCritDamage','debuff','defenseIgnoreAdditive'],VI:['defenseBreak'],DN:['buff','critDamageAdditive'],LI:['buff','bossDamageAdditive'],AD:['buff','legacyCompositeBuff','bossDamageAdditive'],HE:['buff','legacyCompositeBuff','multiplicativeCritDamage'],CeL:['buff','legacyCompositeBuff']};
  const previousVariantEffects = {
    KE: { defenseBreak: .2, attackReduction: -.12 }, SH: { buff: .06 },
    ES: { shield: .15 }, MP: { defenseBreak: .196 },
  };
  const projection = catalog.classEffects.map(p => {
    const effects = { ...resolveSavedMembers(catalog, [p.code], p.mode)[0]?.effects, ...previousVariantEffects[p.code] };
    if (p.code === 'DN') delete effects.shield;
    if (p.code === 'MP') delete effects.magicalAttackReduction;
    return { code: p.code, mode: p.mode, effects: Object.fromEntries(Object.entries(effects)
      .filter(([key]) => !changed[p.code]?.includes(key)).sort(([a], [b]) => a.localeCompare(b))) };
  }).sort((a, b) => (a.code + ':' + a.mode).localeCompare(b.code + ':' + b.mode));
  assert.equal(createHash('sha256').update(JSON.stringify(projection)).digest('hex'),'5d29732cf1f58189f85c8c154a6809afb2846d407e8fa5b39431e6ef59e3bb4f');
  for(const mode of ['single','challenge']){const fx=code=>catalog.classEffects.find(p=>p.code===code&&p.mode===mode).effects;
    closeNumber(fx('RM').debuff,.12);assert.equal('buff' in fx('RM'),false);assert.equal('mpRecoveryPerSecond' in fx('DaB'),false);closeNumber(fx('PR').mpRecoveryPerSecond,.05);assert.equal(fx('PR').buff,.179675);assert.equal(fx('PR').debuffCleanse,2);closeNumber(fx('BL').actionSpeedMultiplicative,.1);closeNumber(fx('NP').mpRecoveryPerSecond,.2);
    assert.equal(fx('LA').buff,.05);assert.equal(fx('LA').multiplicativeCritDamage,.05);assert.equal(fx('HE').multiplicativeCritDamage,.16);assert.equal(fx('LI').bossDamageAdditive,.08);closeNumber(fx('LA').debuff,.05);closeNumber(fx('LA').defenseIgnoreAdditive,.05);closeNumber(fx('LA').defenseBreak,.1);closeNumber(fx('VI').defenseBreak,.1925);
  }
});

test('Schema 2 rejects incompatible, duplicate, incomplete, unknown and non-finite class data', () => {
  const mutations=[p=>p.classEffects.schemaVersion=1,p=>p.classEffects.classes.push(p.classEffects.classes[0]),p=>p.classEffects.classes.pop(),p=>p.classEffects.classes[0].classId='unknown',p=>p.classEffects.classes[0].code='wrong',p=>p.classEffects.classes[0].effects.unknown=1,p=>p.classEffects.classes[0].effects.buff=NaN,p=>p.classEffects.classes[0].effects.buff=Infinity,p=>p.classEffects.classes[0].effects.defenseBreak=1.01,p=>p.classEffects.classes[0].effects.defenseBreak=-.01,p=>p.classEffects.classes[0].effects.superArmor=.5,p=>p.classEffects.classes[0].challengeEffects=null,p=>p.classEffects.classes[0].challengeEffects={buff:Infinity},p=>p.classes[1].code=p.classes[0].code];
  for(const mutate of mutations){const input=structuredClone(corePayloads);mutate(input);assert.throws(()=>parseCoreCatalog(input));}
  const input=structuredClone(corePayloads);input.classEffects.classes[0].effects.attackReduction=-.12;assert.doesNotThrow(()=>parseCoreCatalog(input),'retain existing negative attack-reduction semantics');
  input.classEffects.classes[0].challengeEffects={};const catalog=parseCoreCatalog(input);assert.deepEqual(catalog.classEffects.find(p=>p.classId===input.classEffects.classes[0].classId&&p.mode==='challenge').effects,{},'empty override replaces the base');
});

test('IM 20% Debuff and VI 19.25% defense use full precision in both modes and format only for display', async t => {
  const catalog=parseCoreCatalog(corePayloads);
  const member=(code,mode)=>{const p=catalog.classEffects.find(p=>p.code===code&&p.mode===mode);return{classId:p.classId,classCode:p.code,effects:p.effects};};
  for(const mode of ['single','challenge']){
    const common={mode,defense:{bossDamageReduction:catalog.parameters.bossDamageReduction,challengeBreakCoefficient:catalog.parameters.challengeBreakCoefficient}};
    const im=calculateTeam({...common,members:[member('IM',mode)]});closeNumber(im.debuffIncrease,.2);
    const vi=calculateTeam({...common,members:[member('VI',mode)]});closeNumber(vi.defenseBreak,1-(1-.15)*(1-.05));closeNumber(vi.defenseBreak,.1925);
    const result=calculateChallenge({firstTeam:{members:[member('VI','challenge')]},secondTeam:{members:[member('IM','challenge')]},defense:common.defense});closeNumber(result.firstTeam.defenseBreak,.1925);closeNumber(result.sharedArena.defenseBreak,.1925);
  }
  const h=await open(t);edit(h,'[data-member]','IM');assert.ok([...h.app.querySelectorAll('.metric')].some(e=>e.textContent.includes('Debuff 增幅')&&e.textContent.includes('20.00%')));
  edit(h,'[data-member]','VI');await h.openSkills();assert.equal(h.app.querySelectorAll('.skill-entry').length,4);assert.doesNotMatch(h.query('[data-skill-results]').textContent,/猛虎4式/);assert.match(h.query('[data-skill-results]').textContent,/制壓:定/);assert.match(h.query('[data-skill-results]').textContent,/槍術的極致/);
  edit(h,'[data-skill-query]','怒濤');assert.equal(h.query('[data-skill-results]').textContent,'沒有符合的技能。');
  h.clickMode('challenge');edit(h,'[data-member][data-team="first"]','VI');const final=capture(h).results.at(-1),values=final.breakdown.find(e=>e.key==='defenseBreak').values;closeNumber(values[0],.1925);closeNumber(final.defenseBreak,1-values.reduce((remaining,value)=>remaining*(1-value),1));
});

test('LA additive ignore is unique per source, independent of Buff/Debuff and dynamically evaluated',async t=>{
  closeNumber(calculateBeneficiaryDefenseGain(.087,.05,.915,.9601),.03698444627481265);
  for(const[e,l,b,d]of[[0,.05,0,0],[.087,.05,1,.9601],[0,0,0,.9601]])closeNumber(calculateBeneficiaryDefenseGain(e,l,b,d),0);
  assert.notEqual(calculateBeneficiaryDefenseGain(.087,.05,.915,.9601),calculateBeneficiaryDefenseGain(.2,.05,.915,.9601));
  for(const[e,l,b,d]of[[.98,.05,.5,.9],[0,.05,1,1],[NaN,.05,0,.9],[-.1,.05,0,.9]])assert.throws(()=>calculateBeneficiaryDefenseGain(e,l,b,d));
  const catalog=parseCoreCatalog(corePayloads),profile=catalog.classEffects.find(p=>p.code==='LA'&&p.mode==='single'),member={classId:profile.classId,classCode:profile.code,effects:profile.effects};
  const one=calculateTeam({mode:'single',members:[member],damageBase:catalog.damageBase,defense:{bossDamageReduction:.9601}}),duplicate=calculateTeam({mode:'single',members:[member,member],damageBase:catalog.damageBase,defense:{bossDamageReduction:.9601}});closeNumber(one.defenseIgnoreAdditive,.05);assert.deepEqual(duplicate.breakdown,one.breakdown);closeNumber(one.defenseBreak,.1);closeNumber(one.totalDamageMultiplier,1.05*(235+7.5)/235*1.05/(1-.9601*.1));
  const challenge=calculateChallenge({firstTeam:{members:[member]},secondTeam:{members:[member]},damageBase:catalog.damageBase,defense:{challengeBreakCoefficient:.9601}});for(const r of Object.values(challenge))closeNumber(r.defenseIgnoreAdditive,.05);
  const h=await open(t);edit(h,'[data-member]','LA');assert.match(h.query('#results').textContent,/裝備無視防禦加算 \+5.00%/);assert.match(h.query('#results').textContent,/0% 試算/);assert.match(h.query('#results').textContent,/此項獨立表示，上方增益未包含此條。/);
});

const magazineCatalog=()=>parseCoreCatalog(corePayloads);
const magazineOptions=(catalog,settings={})=>catalog.loadoutOptions.filter(o=>o.userInput?.kind==='support-magazine').map(def=>resolveLoadoutOption(def,catalog.parameters,settings[def.id]?.enabled??false,settings[def.id]?.level??1));
const magazineMember=(catalog,code,mode='single')=>resolveSavedMembers(catalog,[code],mode)[0];
const magazineTeam=(members,options=[])=>calculateTeam({mode:'single',members,options,damageBase:magazineCatalog().damageBase,defense:{bossDamageReduction:.7192}});

test('Support magazines follow all six tiers and compose only the targeted green-control components',()=>{
  const c=magazineCatalog(),green=c.classes.filter(r=>r.uniquenessGroup==='green-control');assert.equal(green.length,8);
  assert.deepEqual(SUPPORT_MAGAZINE_LEVELS,[1,2,3,4,5,6]);
  for(const[level,bonus]of[[1,.005],[2,.01],[3,.015],[4,.02],[5,.025],[6,.03]])closeNumber(supportMagazineBonus(level),bonus);
  const settings=(i,ii,iii)=>Object.fromEntries([['i',i],['ii',ii],['iii',iii]].filter(([,v])=>v).map(([id,level])=>['support-magazine-'+id,{enabled:true,level}]));
  for(const role of green){const m=magazineMember(c,role.code),before=JSON.stringify(m),base=magazineTeam([m]);
    closeNumber(m.effects.buff,.2544);closeNumber(m.effects.actionSpeedMultiplicative,.1);assert.deepEqual(magazineTeam([m],magazineOptions(c)),base);
    for(const[i,ii,iii,buff,speed]of[[5,0,0,.2824,.1],[0,6,0,.288,.1],[5,6,0,.31675,.1],[0,0,2,.2544,.11],[0,0,6,.2544,.13]]){
      const result=magazineTeam([m],magazineOptions(c,settings(i,ii,iii)));closeNumber(result.buffIncrease,buff);closeNumber(result.actionSpeedMultiplicative,speed);
      for(const key of Object.keys(base).filter(k=>!['buffIncrease','buffMultiplier','actionSpeedMultiplicative','totalDamageMultiplier','breakdown','supportMagazineDetails','damageBuff'].includes(k)))assert.deepEqual(result[key],base[key],role.code+':'+key);
      const { attackFactor, ...otherDamageDetails } = result.damageBuff;
      closeNumber(attackFactor, 1 + buff);
      assert.deepEqual(otherDamageDetails, Object.fromEntries(Object.entries(base.damageBuff).filter(([key]) => key !== 'attackFactor')));
      assert.ok(result.supportMagazineDetails.every(d=>d.classCode===role.code));
    }
    for(const level of SUPPORT_MAGAZINE_LEVELS){closeNumber(magazineTeam([m],magazineOptions(c,settings(level,0,0))).buffIncrease,(1+.12+level*.005)*1.12-1);closeNumber(magazineTeam([m],magazineOptions(c,settings(0,level,0))).buffIncrease,1.12*(1+.12+level*.005)-1);closeNumber(magazineTeam([m],magazineOptions(c,settings(0,0,level))).actionSpeedMultiplicative,.1+level*.005);}
    assert.equal(JSON.stringify(m),before);
  }
  const all=magazineOptions(c,settings(6,6,6)),normal={id:'normal-gear',effects:{buff:.2,actionSpeedMultiplicative:.144}},other=magazineMember(c,'LA');
  assert.deepEqual(magazineTeam([other],[normal,...all]),magazineTeam([other],[normal]));assert.deepEqual(magazineTeam([],all),magazineTeam([]));
  const m=magazineMember(c,'NP'),extra={...m,effects:{...m.effects,buff:1.12*1.12*1.2-1,actionSpeedMultiplicative:1.1*1.05-1}};
  const independent=magazineTeam([extra],all);closeNumber(independent.buffMultiplier,1.15*1.15*1.2);closeNumber(independent.actionSpeedMultiplicative,1.13*1.05-1);
  const mixed=magazineTeam([m],[normal,...all]);closeNumber(mixed.buffMultiplier,1.15*1.15*1.2);closeNumber(mixed.actionSpeedMultiplicative,1.13*1.144-1);
  closeNumber(magazineTeam([m],[{id:'fast-shoes',effects:{actionSpeedMultiplicative:.9}},...all]).actionSpeedMultiplicative,.4);
  assert.deepEqual(magazineTeam([m],[...all,...all]),magazineTeam([m],all));
});
test('Support magazines remain bound to the winning green-control source across challenge routes and arena',()=>{
  const c=magazineCatalog(),m=code=>magazineMember(c,code,'challenge'),opts=(i,ii,iii)=>magazineOptions(c,Object.fromEntries([['i',i],['ii',ii],['iii',iii]].filter(([,n])=>n).map(([id,level])=>['support-magazine-'+id,{enabled:true,level}])));
  const input={firstTeam:{members:[m('NP')],options:opts(5,0,2)},secondTeam:{members:[m('BL')],options:opts(0,6,6)},defense:{challengeBreakCoefficient:.9601}};
  const untouched=JSON.stringify(input),r=calculateChallenge(input);closeNumber(r.firstTeam.buffIncrease,.2824);closeNumber(r.firstTeam.actionSpeedMultiplicative,.11);closeNumber(r.secondTeam.buffIncrease,.288);closeNumber(r.secondTeam.actionSpeedMultiplicative,.13);
  closeNumber(r.sharedArena.buffIncrease,.2824);closeNumber(r.sharedArena.actionSpeedMultiplicative,.11);assert.deepEqual(r.sharedArena.ignoredClassIds,[m('BL').classId]);assert.ok(r.sharedArena.supportMagazineDetails.every(d=>d.classCode==='NP'));
  const other=calculateChallenge({...input,firstTeam:{members:[m('IM')],options:opts(6,0,6)}});closeNumber(other.sharedArena.buffIncrease,.288);closeNumber(other.sharedArena.actionSpeedMultiplicative,.13);assert.ok(other.sharedArena.supportMagazineDetails.every(d=>d.classCode==='BL'));
  const firstWins=calculateChallenge({...input,firstTeam:{members:[m('NP')],options:opts(0,0,0)},secondTeam:{members:[m('NP')],options:opts(6,6,6)}});closeNumber(firstWins.sharedArena.buffIncrease,.2544);assert.equal(firstWins.sharedArena.supportMagazineDetails,undefined);
  assert.equal(JSON.stringify(input),untouched);
});
test('Support magazine saves normalize invalid levels to Lv.1 and keep untouched legacy payloads free of new keys',()=>{
  const c=magazineCatalog(),id='support-magazine-i',key=supportMagazineLevelKey(id),base={version:1,mode:'single',membersByTeam:{single:['NP']},optionsByTeam:{single:{}}};
  const old=parseSavedSimulatorState(JSON.stringify(base),c);assert.equal(Object.hasOwn(old.optionsByTeam.single,id),false);assert.equal(Object.hasOwn(old.optionsByTeam.single,key),false);
  for(const invalid of[undefined,null,-1,0,7,2.5,NaN,Infinity,'6']){
    const raw={...base,optionsByTeam:{single:{[id]:true,[key]:invalid}}},state=parseSavedSimulatorState(JSON.stringify(raw),c);
    assert.equal(state.optionsByTeam.single[id],true);assert.equal(state.optionsByTeam.single[key],1);
    closeNumber(magazineTeam(resolveSavedMembers(c,['NP'],'single'),resolveSavedOptions(c,state.optionsByTeam.single)).supportMagazineDetails[0].effectiveValue,.125);
  }
  const disabled=parseSavedSimulatorState(JSON.stringify({...base,optionsByTeam:{single:{[id]:false,[key]:6}}}),c);assert.equal(disabled.optionsByTeam.single[key],6);assert.equal(resolveSavedOptions(c,disabled.optionsByTeam.single).find(o=>o.id===id).supportMagazine.enabled,false);
  for(const mutate of[p=>p.loadoutOptions.at(-1).userInput.target='unknown',p=>p.loadoutOptions.at(-1).effects={buff:{kind:'fixed',value:.03}},p=>p.loadoutOptions.at(-1).userInput.target=p.loadoutOptions.at(-2).userInput.target]){const payload=structuredClone(corePayloads);mutate(payload);assert.throws(()=>parseCoreCatalog(payload));}
});
test('Magazine Checkbox and Select update once, preserve focus and disabled drafts, and restore after reload',async t=>{
  const h=await open(t);edit(h,'[data-member]','NP');const id='support-magazine-i',box=h.query('[data-option="'+id+'"]'),level=h.query('[data-magazine-level="'+id+'"]');
  const info=h.query('[data-support-magazine="'+id+'"] [data-magazine-info]');
  assert.equal(box.checked,false);assert.equal(level.disabled,true);assert.equal(level.value,'1');
  assert.equal(info.textContent,'攻擊力 Buff +0.5%');
  h.reset();edit(h,'[data-option="'+id+'"]',true);h.event(box,'change');work(h,{calculateTeam:1,updateResults:1,storage:1,shell:0});assert.equal(level.disabled,false);
  level.focus();h.reset();edit(h,'[data-magazine-level="'+id+'"]',5);h.event(level,'change');work(h,{calculateTeam:1,updateResults:1,storage:1,shell:0});assert.equal(h.window.document.activeElement,level);assert.equal(h.query('[data-magazine-level="'+id+'"]'),level);
  closeNumber(capture(h).results.at(-1).breakdown.find(e=>e.key==='buff').values[0],.2824);assert.match(h.query('.calculation-details').textContent,/支援彈匣I Lv.5 · NP/);assert.match(h.query('.calculation-details').textContent,/攻擊力 Buff 12.00% → 14.50%/);
  edit(h,'[data-option="'+id+'"]',false);assert.equal(level.disabled,true);assert.equal(level.value,'5');assert.equal(h.saved().optionsByTeam.single[id+'-level'],5);closeNumber(capture(h).results.at(-1).breakdown.find(e=>e.key==='buff').values[0],.2544);
  edit(h,'[data-option="'+id+'"]',true);closeNumber(capture(h).results.at(-1).breakdown.find(e=>e.key==='buff').values[0],.2824);
  const restored=await open(t,{saved:h.saved()});assert.equal(restored.query('[data-magazine-level="'+id+'"]').value,'5');assert.equal(restored.query('[data-option="'+id+'"]').checked,true);assert.deepEqual(capture(restored).results.at(-1),capture(h).results.at(-1));
  edit(h,'[data-member]','LA');assert.equal(capture(h).results.at(-1).supportMagazineDetails,undefined);assert.equal(info.textContent,'攻擊力 Buff +2.5%');closeNumber(capture(h).results.at(-1).defenseIgnoreAdditive,.05);
  await h.openSkills();h.reset();edit(h,'[data-skill-query]','本源');work(h,{calculateTeam:0,updateResults:0,storage:0});
});
test('Challenge magazine controls keep three independent team drafts and round-trip their levels',async t=>{
  const h=await open(t),set=(team,roman,level)=>{const id='support-magazine-'+roman;edit(h,'[data-option="'+id+'"][data-team="'+team+'"]',true);edit(h,'[data-magazine-level="'+id+'"][data-team="'+team+'"]',level);};
  edit(h,'[data-member]','NP');set('single','i',3);h.clickMode('challenge');edit(h,'[data-member][data-team="first"]','NP');edit(h,'[data-member][data-team="second"]','BL');set('first','i',5);set('first','iii',2);set('second','ii',6);set('second','iii',6);
  const saved=h.saved(),latest=capture(h).results.slice(-3);closeNumber(latest[0].supportMagazineDetails.find(d=>d.target==='attackBuff').effectiveValue,.145);closeNumber(latest[1].supportMagazineDetails.find(d=>d.target==='allSkillDamageBuff').effectiveValue,.15);closeNumber(latest[2].supportMagazineDetails.find(d=>d.target==='allSpeedBuff').effectiveValue,.11);
  h.clickMode('single');assert.equal(h.query('[data-magazine-level="support-magazine-i"]').value,'3');h.clickMode('challenge');assert.equal(h.query('[data-magazine-level="support-magazine-i"][data-team="first"]').value,'5');assert.equal(h.query('[data-magazine-level="support-magazine-ii"][data-team="second"]').value,'6');
  const restored=await open(t,{saved});assert.deepEqual(capture(restored).results,capture(h).results.slice(-3));assert.equal(restored.query('[data-magazine-level="support-magazine-iii"][data-team="first"]').value,'2');
});
test('DN field power references keep the verified values, icons and line breaks',async t=>{
  const skills=JSON.parse(await readFile(new URL('../data/skill-reference.json',import.meta.url),'utf8')).roles.find(r=>r.code==='DN').skills;
  assert.deepEqual(skills.filter(s=>s.name.replace(/^\[轉換\]/, '').startsWith('原野力量')).map(s=>({name:s.name,description:s.description,icon:s.icon})),[
    {name:'原野力量',description:'我方\n攻擊力 +11.5%\n所受傷害 -13.8%',icon:'skill-icons/DN-03.png'},
    {name:'[轉換]原野力量',description:'我方\n攻擊力 +9.2%、致命傷害 +11.5%\n覺醒回復速度 +34.5%',icon:'skill-icons/DN-04.png'}]);
  const h=await open(t);edit(h,'[data-member]','DN');await h.openSkills();h.reset();edit(h,'[data-skill-query]','原野力量');assert.equal(h.app.querySelectorAll('.skill-entry').length,2);assert.doesNotMatch(h.query('[data-skill-results]').textContent,/物理攻擊/);assert.match(h.query('[data-skill-results]').innerHTML,/我方<br>攻擊力/);work(h,{calculateTeam:0,updateResults:0,storage:0});
});

test('Support accessory and both resistance sources default on and preserve independent saved opt-outs', async t => {
  const accessory = 'incense-defense-break', badge = 'dark-ghost-badge-resistance', crystal = 'ice-crystal-resistance';
  const ids = [accessory, badge, crystal];
  const legacy = { version:1, mode:'single', membersByTeam:{single:['IM']}, optionsByTeam:{single:{}} };
  const h = await open(t,{saved:legacy});
  const field = (id,team='single') => '[data-option="'+id+'"][data-team="'+team+'"]';
  for (const id of ids) assert.equal(h.query(field(id)).checked,true);
  assert.equal(h.query(field(accessory)).parentElement.textContent,'支援飾品（香爐、預言書）');
  const result = () => capture(h).results.at(-1);
  const initial = result();
  edit(h,field(accessory),false);
  closeNumber(result().defenseBreak,1-(1-initial.defenseBreak)/.85);
  edit(h,field(badge),false);assert.equal(result().resistanceReduction,initial.resistanceReduction-100);
  edit(h,field(crystal),false);assert.equal(result().resistanceReduction,initial.resistanceReduction-250);
  const saved = h.saved();for (const id of ids) assert.equal(saved.optionsByTeam.single[id],false);
  const restored = await open(t,{saved});
  for (const id of ids) assert.equal(restored.query(field(id)).checked,false);
  for (const id of ids) edit(h,field(id),true);
  assert.deepEqual(result(),initial);
  h.clickMode('challenge');
  const both = () => capture(h).results.slice(-3);
  const [beforeFirst,beforeSecond,beforeArena] = both();
  edit(h,field(accessory,'first'),false);edit(h,field(badge,'first'),false);edit(h,field(crystal,'second'),false);
  const [first,second,arena] = both();
  closeNumber(first.defenseBreak,1-(1-beforeFirst.defenseBreak)/.85);
  assert.equal(first.resistanceReduction,beforeFirst.resistanceReduction-100);
  assert.equal(second.resistanceReduction,beforeSecond.resistanceReduction-150);
  assert.equal(arena.defenseBreak,beforeArena.defenseBreak);assert.equal(arena.resistanceReduction,beforeArena.resistanceReduction);
  const separate = await open(t,{saved:h.saved()});
  for (const [team,option,checked] of [['first',accessory,false],['second',accessory,true],['first',badge,false],['second',badge,true],['first',crystal,true],['second',crystal,false]]) {
    assert.equal(separate.query(field(option,team)).checked,checked);
  }
});

test('FP and DN team skill variants share existing effect channels and mode-specific base effects', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const fp = 'FP.FatalShotConverted', dn = 'DN.FieldPowerConverted';
  for (const mode of ['single', 'challenge']) {
    const resolve = (code, selection) => resolveSavedMembers(catalog, [code], mode, { 0: selection })[0];
    assert.deepEqual(resolve('FP').effects, { buff: .2, actionSpeedMultiplicative: .18 });
    assert.deepEqual(resolve('FP', { [fp]: true }).effects, { buff: .2 });
    assert.deepEqual(resolve('DN', { [dn]: false }).effects, { buff: .115, shield: .138, debuff: .0507, defenseBreak: .1 });
    assert.deepEqual(resolve('DN').effects, resolve('DN', { [dn]: false }).effects);
    const converted = resolve('DN', { [dn]: true }).effects;
    assert.equal(converted.buff, .092);
    assert.equal(converted.critDamageAdditive, .115);
    assert.equal(converted.debuff, .0507);
    assert.equal(converted.defenseBreak, .1);
    assert.equal(converted.shield, undefined);
    const { shield, ignoredClassIds } = calculateTeam({
      mode, members: [resolve('DN', { [dn]: false }), resolve('DN'), resolve('KE')],
      defense: { bossDamageReduction: .5, challengeBreakCoefficient: .5 }
    });
    closeNumber(shield, 1 - (1 - .138) * (1 - .2));
    assert.deepEqual(ignoredClassIds, ['dn']);
  }
  const custom = structuredClone(corePayloads);
  custom.calculationParameters.criticalDamage.defaultPercent = 300;
  custom.classEffects.classes.find(role => role.code === 'DN').challengeEffects = { defenseBreak: .25, buff: .03 };
  custom.classes.find(role => role.code === 'DN').name = '丹尼安';
  const alternate = parseCoreCatalog(custom);
  const [{ effects }] = resolveSavedMembers(alternate, ['丹尼安'], 'challenge', { 0: { [dn]: true } });
  closeNumber(effects.buff, 1.03 * 1.092 - 1);
  assert.equal(effects.critDamageAdditive, .115);
  assert.equal(effects.defenseBreak, .25);
});

test('Skill variant data rejects unknown and cross-class options or malformed effects', () => {
  for (const mutate of [
    row => { row.skillVersions['FP.FatalShotConverted'] = row.skillVersions['DN.FieldPowerConverted']; },
    row => { row.skillVersions['DN.FieldPowerConverted'].converted.effects.critDamageAdditive = -1; },
    row => { row.skillVersions['DN.FieldPowerConverted'].normal.effects.shield = 1.1; },
    row => { delete row.skillVersions['DN.FieldPowerConverted'].normal; },
  ]) {
    const input = structuredClone(corePayloads);
    mutate(input.classEffects.classes.find(role => role.code === 'DN'));
    assert.throws(() => parseCoreCatalog(input));
  }
});

test('Roster skill selections use raw slot positions, validate matching IDs and retain explicit false', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const dn = 'DN.FieldPowerConverted', fp = 'FP.FatalShotConverted';
  const saved = parseSavedSimulatorState(JSON.stringify({
    version: 1, mode: 'challenge',
    membersByTeam: { single: ['', 'DN', 'fp'], first: ['', '', 'FP'], second: ['DN', 'KE'] },
    classSkillVersionsByTeam: { single: { 0: { [dn]: false }, 1: { [dn]: false, [fp]: true }, 2: { [fp]: 'true' } },
      first: { 2: { [fp]: true }, 4: { [fp]: true } }, second: { 0: { [dn]: true }, 1: { [dn]: true } } }
  }), catalog);
  assert.deepEqual(saved.classSkillVersionsByTeam, {
    single: { 1: { [dn]: false } }, first: { 2: { [fp]: true } }, second: { 0: { [dn]: true } }
  });
  assert.deepEqual(resolveSavedMembers(catalog, saved.membersByTeam.single, 'single', saved.classSkillVersionsByTeam.single).map(m => m.effects.buff), [.115, .2]);
  assert.equal(resolveSavedMembers(catalog, saved.membersByTeam.first, 'challenge', saved.classSkillVersionsByTeam.first)[0].effects.actionSpeedMultiplicative, undefined);
});

test('Roster checkbox updates preserve focus, mode-specific selections and reload', async t => {
  const h = await open(t);
  const member = (team, index) => '[data-member][data-team="' + team + '"][data-member-index="' + index + '"]';
  const inSlot = (team, index) => h.query(member(team, index)).closest('.member-slot').querySelector('[data-member-skill-version]');
  const setMember = (team, index, value) => edit(h, member(team, index), value);
  assert.equal(h.app.querySelectorAll('[data-member]').length, 6);
  assert.equal(inSlot('single', 0), null);
  const dn = setMember('single', 2, 'dn');
  const skill = inSlot('single', 2);
  assert.equal(skill.checked, false);
  assert.equal(h.saved().classSkillVersionPreferences, undefined);
  assert.equal(skill.closest('label').textContent, '原野力量是否轉換');
  assert.equal(skill.closest('label').contains(dn), false);
  skill.focus(); h.reset(); skill.click();
  assert.equal(h.window.document.activeElement, skill);
  assert.equal(inSlot('single', 2), skill);
  assert.equal(h.query(member('single', 2)), dn);
  assert.equal(h.calls.shell, 0);
  assert.equal(h.calls.calculateTeam, 1);
  assert.equal(h.calls.storage, 1);
  dn.focus();
  setMember('single', 2, ' DN ');
  assert.equal(h.window.document.activeElement, dn);
  assert.equal(inSlot('single', 2), skill);
  assert.equal(skill.checked, true);
  setMember('single', 3, 'DN');
  assert.equal(inSlot('single', 3).checked, true);
  inSlot('single', 3).click();
  assert.equal(skill.checked, true);
  closeNumber(h.teamResults.at(-1).shield, 0);
  h.clickMode('challenge');
  assert.equal(h.app.querySelectorAll('[data-member]').length, 8);
  setMember('first', 2, 'FP');
  setMember('second', 2, 'FP');
  assert.equal(inSlot('first', 2).closest('label').textContent, '致命神槍是否轉換');
  inSlot('first', 2).click();
  assert.equal(inSlot('second', 2).checked, false);
  h.clickMode('single');
  assert.equal(inSlot('single', 2).checked, true);
  const saved = h.saved();
  assert.deepEqual(saved.classSkillVersionPreferences, { 'DN.FieldPowerConverted': false, 'FP.FatalShotConverted': true });
  assert.deepEqual(saved.classSkillVersionsByTeam, { single: { 2: { 'DN.FieldPowerConverted': true }, 3: { 'DN.FieldPowerConverted': false } },
    first: { 2: { 'FP.FatalShotConverted': true } } });
  const restored = await open(t, { saved });
  assert.equal(restored.query(member('single', 2)).closest('.member-slot').querySelector('input[type="checkbox"]').checked, true);
  restored.clickMode('challenge');
  assert.equal(restored.query(member('first', 2)).closest('.member-slot').querySelector('input[type="checkbox"]').checked, true);
  setMember('single', 2, 'D');
  assert.equal(inSlot('single', 2), null);
  setMember('single', 2, 'DN');
  assert.equal(inSlot('single', 2).checked, true);
  setMember('single', 2, 'FP');
  assert.equal(inSlot('single', 2).checked, true);
  setMember('single', 2, 'DN');
  assert.equal(inSlot('single', 2).checked, false);
  setMember('single', 2, '');
  assert.equal(inSlot('single', 2), null);
  assert.equal(h.saved().classSkillVersionsByTeam.single[2], undefined);
  assert.equal(h.saved().classSkillVersionPreferences['DN.FieldPowerConverted'], false);
});

test('Ordinary crit points and Boss bonuses use their respective denominators in each arena', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const defense = { bossDamageReduction: .6, challengeBreakCoefficient: .95 };
  const red = resolveSavedOptions(catalog, Object.fromEntries(catalog.loadoutOptions.map(option =>
    [option.id, option.id === 'hundred-billion-red-top-critical-damage'])))
    .find(option => option.id === 'hundred-billion-red-top-critical-damage');
  assert.deepEqual(red.effects, { multiplicativeCritDamage: .1 });
  const dnSelections = { 0: { 'DN.FieldPowerConverted': true } };
  const result = (codes, base = catalog.damageBase, options = []) => calculateTeam({
    mode: 'single', defense, damageBase: base, options, members: resolveSavedMembers(catalog, codes, 'single', dnSelections)
  });
  closeNumber(result(['DN']).buffIncrease, 1.092 * 246.5 / 235 - 1);
  closeNumber(result(['DN'], { critDamagePct: 300, bossDamagePct: 175 }).buffIncrease, 1.092 * 311.5 / 300 - 1);
  const stacked = result(['DN', 'LI'], catalog.damageBase, [red]);
  closeNumber(stacked.buffMultiplier, 1.092 * (235 + 11.5 + 15) / 235 * (275 + 8) / 275);
  closeNumber(stacked.damageBuff.critPoints, 11.5);
  closeNumber(stacked.damageBuff.critProductPoints, 15);
  assert.equal(stacked.damageBuff.bossPoints, 8);
  closeNumber(result(['LI'], { critDamagePct: 235, bossDamagePct: 0 }).buffMultiplier, 1.08);
  const five = { id: 'test-boss-five', effects: { bossDamageAdditive: .05 } };
  closeNumber(result([], catalog.damageBase, [five]).buffMultiplier, 280 / 275);
  closeNumber(result([], { critDamagePct: 235, bossDamagePct: 0 }, [five]).buffMultiplier, 1.05);
  closeNumber(result(['FP'], { critDamagePct: 300, bossDamagePct: 0 }).buffMultiplier, 1.2);
  closeNumber(result(['LA']).buffMultiplier, 1.05 * (235 + 7.5) / 235);
  closeNumber(result(['LA'], { critDamagePct: 300, bossDamagePct: 0 }, [red]).buffMultiplier, 1.05 * (300 + 23.25) / 300);
  for (const code of ['PR','CeL']) {
    const fixed = result([code]).buffMultiplier;
    closeNumber(result([code], { critDamagePct: 300, bossDamagePct: 0 }).buffMultiplier, fixed);
  }
  const challenge = calculateChallenge({ defense, damageBase: catalog.damageBase,
    firstTeam: { members: resolveSavedMembers(catalog, ['DN'], 'challenge', dnSelections), options: [red] },
    secondTeam: { members: resolveSavedMembers(catalog, ['DN','LI'], 'challenge', dnSelections), options: [red, five] } });
  closeNumber(challenge.firstTeam.buffMultiplier, 1.092 * 261.5 / 235);
  closeNumber(challenge.sharedArena.buffMultiplier, 1.092 * 261.5 / 235 * 288 / 275);
  assert.equal(challenge.sharedArena.damageBuff.productSources.filter(source => source.id === 'loadout:' + red.id).length, 1);
  assert.deepEqual(challenge.sharedArena.ignoredClassIds, ['dn']);
});

test('The entered damage basis is used unchanged in every scope as members and variants change', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const damageBase = { critDamagePct: 286.5, bossDamagePct: 175 };
  const defense = { challengeBreakCoefficient: .96 };
  const resolve = (names, converted) => resolveSavedMembers(catalog, names, 'challenge', { 0: { 'DN.FieldPowerConverted': converted } });
  for (const [names, converted, points] of [[['DN'], true, 11.5], [['DN'], false, 0], [[], true, 0]]) {
    const result = calculateChallenge({ defense, damageBase, firstTeam: { members: resolve(['DN'], true) },
      secondTeam: { members: resolve(names, converted) } });
    for (const scope of Object.values(result)) assert.deepEqual(scope.damageBuff.base, damageBase);
    closeNumber(result.secondTeam.damageBuff.critPoints, points);
    closeNumber(result.sharedArena.damageBuff.critPoints, 11.5);
    closeNumber(result.sharedArena.buffMultiplier, 1.092 * (286.5 + 11.5) / 286.5);
  }
});

test('The manual basis keeps valid decimals, rejects incomplete values, and follows both team modes', async t => {
  const h = await open(t);
  const crit = '[data-damage-attribute="critDamagePct"]', boss = '[data-damage-attribute="bossDamagePct"]';
  assert.equal(h.query(crit).value, '235');
  assert.equal(h.query(boss).value, '175');
  assert.equal(h.saved(), null);
  edit(h, crit, '300.25'); edit(h, boss, '0');
  for (const input of ['零', 'abc', '100元', '+8', '-5', '1e3', 'Infinity', '12..5', '15%']) {
    edit(h, crit, input);
    assert.equal(h.query(crit).value, '300.25');
    assert.equal(h.saved().damageBasis.critDamagePct, 300.25);
  }
  for (const input of ['0', '300.', '.', '']) {
    edit(h, crit, input);
    assert.equal(h.query(crit).getAttribute('aria-invalid'), 'true');
    assert.equal(h.saved().damageBasis.critDamagePct, 300.25);
    h.query(crit).dispatchEvent(new h.window.Event('blur'));
    assert.equal(h.query(crit).value, '300.25');
  }
  edit(h, crit, '２８６．５１２３４５６');
  edit(h, boss, '.1234');
  assert.equal(h.query(crit).value, '286.512');
  assert.equal(h.query(boss).value, '.123');
  assert.deepEqual(h.saved().damageBasis, { critDamagePct: 286.512, bossDamagePct: .123 });
  const composing = h.query(crit);
  composing.value = '中文';
  h.event(composing, 'input', { isComposing: true });
  assert.equal(h.saved().damageBasis.critDamagePct, 286.512);
  h.event(composing, 'compositionend');
  assert.equal(composing.value, '286.512');
  edit(h, boss, '0');
  edit(h, crit, '300');
  assert.equal(h.query(crit).hasAttribute('aria-invalid'), false);
  h.clickMode('challenge');
  assert.equal(h.query(crit).value, '300');
  assert.equal(h.query(boss).value, '0');
  assert.deepEqual(JSON.parse(JSON.stringify(h.teamResults.at(-1).damageBuff.base)), { critDamagePct: 300, bossDamagePct: 0 });
  const reloaded = await open(t, { saved: h.saved() });
  assert.equal(reloaded.query(crit).value, '300');
  assert.equal(reloaded.query(boss).value, '0');
});

test('Legacy damage settings keep the original reference pair, valid manual pair, or defaults', async t => {
  const defaults = { critDamagePct: 235, bossDamagePct: 175 };
  const manual = { critDamagePct: 300, bossDamagePct: 0 };
  const base = { critDamagePct: 286.5, bossDamagePct: 185.5 };
  const reference = { version: 1, base, deductions: [{ value: .092 }] };
  assert.equal(parseDamageBasis(undefined, defaults), undefined);
  assert.deepEqual(parseDamageBasis({ mode: 'manual', manual, reference }, defaults), manual);
  assert.deepEqual(parseDamageBasis({ critDamagePct: 286.51284, bossDamagePct: 185.50000000003 }, defaults),
    { critDamagePct: 286.513, bossDamagePct: 185.5 });
  assert.deepEqual(parseDamageBasis({ critDamagePct: .0001, bossDamagePct: 200 }, defaults), defaults);
  assert.deepEqual(parseDamageBasis({ mode: 'reference', manual, reference }, defaults), base);
  assert.deepEqual(parseDamageBasis({ mode: 'reference', manual, reference: { version: 2, base } }, defaults), manual);
  assert.deepEqual(parseDamageBasis({ mode: 'reference', reference: { version: 1, base: { critDamagePct: 0 } } }, defaults), defaults);
  const h = await open(t, { saved: {
    version: 1, mode: 'single', membersByTeam: { single: ['DN','DN'] },
    classSkillVersionsByTeam: { single: { 0: { 'DN.FieldPowerConverted': false } } },
    damageBasis: { mode: 'reference', manual, reference },
  } });
  assert.equal(h.query('[data-damage-attribute="critDamagePct"]').value, '286.5');
  assert.equal(h.query('[data-damage-attribute="bossDamagePct"]').value, '185.5');
  assert.equal(h.query('[data-member-skill-version]').checked, false);
  h.clickMode('challenge');
  assert.deepEqual(h.saved().damageBasis, base);
  assert.deepEqual(h.saved().membersByTeam.single.slice(0, 2), ['DN', 'DN']);
  assert.equal(h.saved().classSkillVersionsByTeam.single[0]['DN.FieldPowerConverted'], false);
});

test('The standalone damage panel precedes the roster and details use the same order in both modes', async t => {
  const h = await open(t);
  const check = () => {
    const panel = h.query('[data-damage-basis]');
    const roster = h.query('#buff-configuration');
    assert.equal(panel.nextElementSibling, roster);
    assert.equal(h.app.querySelectorAll('[data-damage-basis]').length, 1);
    assert.equal(panel.querySelectorAll('input:not(:disabled)').length, 2);
    assert.equal(panel.querySelector('#damage-basis-help').textContent, 'Boss傷害請填面板%數。如果職業有影響致命傷害、Boss傷害的Buff時請自行扣除，避免重複計算。');
    assert.ok(h.app.querySelectorAll('.calculation-details').length > 0);
    for (const details of h.app.querySelectorAll('.calculation-details')) {
      const rows = [...details.querySelectorAll('.detail-row > span')].map(row => row.textContent);
      assert.deepEqual(rows.slice(0, 4), ['Buff增幅', '致命傷害加算', 'Boss 傷害加算', 'Debuff增幅']);
    }
  };
  check();
  h.clickMode('challenge');
  check();
});

test('LA, HE, AD, CeL and PR use the confirmed channels in both routes and the shared arena', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const defense = { bossDamageReduction: .6, challengeBreakCoefficient: .95 };
  for (const mode of ['single', 'challenge']) {
    const team = (codes, critDamagePct, bossDamagePct) => calculateTeam({
      mode, members: resolveSavedMembers(catalog, codes, mode), defense, damageBase: { critDamagePct, bossDamagePct },
    });
    for (const [crit, boss] of [[235, 175], [300, 0]]) {
      closeNumber(team(['LA'], crit, boss).buffMultiplier, 1.05 * (crit + 7.5) / crit);
      closeNumber(team(['HE'], crit, boss).buffMultiplier, (crit + 24) / crit);
      const both = team(['LA', 'HE', 'LA'], crit, boss);
      closeNumber(both.buffMultiplier, 1.05 * (crit + 32.7) / crit);
      assert.deepEqual(both.damageBuff.productSources, [{ id: 'class:la', label: 'LA', value: .05 }, { id: 'class:he', label: 'HE', value: .16 }]);
      assert.equal(both.damageBuff.critPoints, 0);
      assert.deepEqual(both.ignoredClassIds, ['la']);
      const ad = team(['AD'], crit, boss);
      closeNumber(ad.damageBuff.attackFactor, 1.05);
      assert.equal(ad.damageBuff.bossPoints, 3);
      closeNumber(ad.damageBuff.bossFactor, (103 + boss) / (100 + boss));
      closeNumber(ad.buffMultiplier, 1.05 * (103 + boss) / (100 + boss));
      closeNumber(team(['AD','LI'], crit, boss).damageBuff.bossFactor, (111 + boss) / (100 + boss));
      closeNumber(ad.actionSpeedMultiplicative, .1);
      closeNumber(ad.shield, .2);
      closeNumber(ad.defenseBreak, .2);
      closeNumber(ad.debuffIncrease, .07);
      closeNumber(team(['CeL'], crit, boss).buffMultiplier, 1.1 * 1.06);
      closeNumber(team(['PR'], crit, boss).buffMultiplier, 1.05 * 1.05 * 1.07);
    }
  }
  const challenge = calculateChallenge({ defense, damageBase: catalog.damageBase,
    firstTeam: { members: resolveSavedMembers(catalog, ['LA','AD','CeL'], 'challenge') },
    secondTeam: { members: resolveSavedMembers(catalog, ['HE','LA','PR'], 'challenge') } });
  closeNumber(challenge.firstTeam.damageBuff.critProductPoints, 7.5);
  closeNumber(challenge.secondTeam.damageBuff.critProductPoints, 32.7);
  closeNumber(challenge.sharedArena.damageBuff.critProductPoints, 32.7);
  assert.deepEqual(challenge.sharedArena.ignoredClassIds, ['la']);
  assert.ok(Object.values(challenge).every(scope => scope.damageBuff.legacySources.length === 0));
});


test('Multiplicative crit combines raw sources once and shares the calculator product at any panel value', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const redId = 'hundred-billion-red-top-critical-damage';
  const definition = catalog.loadoutOptions.find(option => option.id === redId);
  assert.equal(definition.label, '百億紅套上衣／暴上');
  assert.equal(definition.defaultSelected, true);
  assert.equal(definition.scope, 'per-team');
  assert.deepEqual(definition.effects, { multiplicativeCritDamage: { kind: 'fixed', value: .1 } });
  const red = resolveLoadoutOption(definition, catalog.parameters, true);
  const redOff = resolveLoadoutOption(definition, catalog.parameters, false);
  const defense = { bossDamageReduction: .6, challengeBreakCoefficient: .95 };
  const cases = [
    [[], false, 1, 0], [['LA'], false, 1.05, 7.5], [['HE'], false, 1.16, 24],
    [[], true, 1.1, 15], [['LA', 'HE'], false, 1.218, 32.7], [['LA'], true, 1.155, 23.25],
    [['HE'], true, 1.276, 41.4], [['LA', 'HE'], true, 1.3398, 50.97],
  ];
  for (const mode of ['single', 'challenge']) {
    const resolve = codes => resolveSavedMembers(catalog, codes, mode, { 2: { 'DN.FieldPowerConverted': true } });
    for (const panel of [235, 300]) {
      const damageBase = { critDamagePct: panel, bossDamagePct: 175 };
      const team = (codes, selected) => calculateTeam({
        mode, members: resolve(codes), options: [selected ? red : redOff], defense, damageBase,
      });
      for (const [codes, selected, product, points] of cases) {
        const result = team(codes, selected);
        const details = result.damageBuff;
        closeNumber(details.critProduct, product);
        closeNumber(details.critProductPoints, points);
        closeNumber(details.critFactor, (panel + points) / panel);
        closeNumber(result.buffMultiplier, (codes.includes('LA') ? 1.05 : 1) * (panel + points) / panel);
        assert.equal(details.critPoints, 0);
        assert.equal(details.productSources.length, codes.length + Number(selected));
        assert.deepEqual(details.base, damageBase);
        const ordinary = calculateProductStat([
          { sourceId: 'character-base', valuePct: 50 },
          ...details.productSources.map(source => ({ sourceId: source.id, valuePct: source.value * 100 })),
        ], 150);
        closeNumber(details.critProductPoints, ordinary.value * 100);
      }
      const mixed = team(['LA', 'HE', 'DN'], true);
      closeNumber(mixed.damageBuff.critPoints, 11.5);
      closeNumber(mixed.damageBuff.critFactor, (panel + 11.5 + 50.97) / panel);
      closeNumber(mixed.buffMultiplier, 1.05 * 1.092 * (panel + 11.5 + 50.97) / panel);
    }
  }
  const challenge = calculateChallenge({ defense, damageBase: catalog.damageBase,
    firstTeam: { members: resolveSavedMembers(catalog, ['LA'], 'challenge'), options: [red] },
    secondTeam: { members: resolveSavedMembers(catalog, ['HE', 'LA'], 'challenge'), options: [red] },
  });
  closeNumber(challenge.firstTeam.damageBuff.critProductPoints, 23.25);
  closeNumber(challenge.secondTeam.damageBuff.critProductPoints, 50.97);
  closeNumber(challenge.sharedArena.damageBuff.critProductPoints, 50.97);
  assert.deepEqual(challenge.sharedArena.ignoredClassIds, ['la']);
  assert.equal(challenge.sharedArena.damageBuff.productSources.filter(source => source.id === 'loadout:' + redId).length, 1);
});

test('The red top keeps its saved toggle and shows the raw bonus separately from ordinary crit', async t => {
  const redId = 'hundred-billion-red-top-critical-damage';
  const selector = '[data-option="' + redId + '"]';
  const h = await open(t);
  assert.equal(h.query(selector).checked, true);
  assert.match(h.query(selector).closest('label').textContent, /百億紅套上衣／暴上/);
  edit(h, '[data-member][data-team="single"]', 'LA');
  edit(h, '[data-member][data-team="single"][data-member-index="1"]', 'HE');
  const rows = () => [...h.app.querySelectorAll('.calculation-details .detail-row')];
  const row = label => rows().find(entry => entry.firstElementChild.textContent === label)?.textContent;
  assert.ok(row('基礎乘算暴傷').includes('LA +5% × HE +16% × 百億紅套上衣／暴上 +10%'));
  assert.ok(row('基礎乘算暴傷').includes('1.3398'));
  assert.ok(row('基礎乘算暴傷').includes('50.97'));
  assert.ok(!row('致命傷害加算').includes('暴上'));
  edit(h, selector, false);
  assert.ok(row('基礎乘算暴傷').includes('32.7'));
  assert.ok(!row('基礎乘算暴傷').includes('暴上'));
  const restored = await open(t, { saved: h.saved() });
  assert.equal(restored.query(selector).checked, false);
});
test('KE, CeT, SH and MP variants preserve common effects in each arena', () => {
  const catalog = parseCoreCatalog(corePayloads);
  const defense = { bossDamageReduction: .6, challengeBreakCoefficient: .95 };
  const keys = {
    ke: 'KE.ArmorBreakConverted', cet: 'CeT.TacticalFieldConverted', sh: 'SH.NecromancyConverted',
    mp: 'MP.MindBreakConverted',
  };
  for (const mode of ['single', 'challenge']) {
    const members = (codes, saved) => resolveSavedMembers(catalog, codes, mode, saved);
    const one = (code, selected) => members([code], { 0: selected })[0].effects;
    assert.deepEqual(one('KE'), { defenseBreak: .12, debuff: .12, shield: .2, superArmor: 1 });
    assert.deepEqual(one('KE', { [keys.ke]: true }),
      { defenseBreak: .2, attackReduction: -.12, debuff: .12, shield: .2, superArmor: 1 });
    const field = one('CeT', { [keys.cet]: true });
    assert.equal(field.shield, .4);
    assert.equal(field.bossDamageAdditive, .12);
    const initialField = one('CeT');
    assert.equal(initialField.shield, .2);
    for (const key of ['mpRecoveryPerSecond', 'superArmor', 'debuff', 'defenseBreak']) {
      assert.equal(field[key], initialField[key]);
    }
    assert.deepEqual(one('SH'), { buff: .05, debuff: .07, defenseBreak: .1925 });
    assert.deepEqual(one('SH', { [keys.sh]: true }), { buff: .06, debuff: .07, defenseBreak: .1925 });

    assert.deepEqual(one('MP'), { debuff: .12, magicalAttackReduction: .28 });
    assert.deepEqual(one('MP', { [keys.mp]: true }), { debuff: .12, defenseBreak: .196 });
    const normal = calculateTeam({ mode, members: members(['MP']), defense });
    assert.equal(normal.attackReduction, 0);
    closeNumber(normal.breakdown.find(row => row.key === 'magicalAttackReduction').result, .28);
    const result = calculateTeam({ mode, damageBase: catalog.damageBase, defense,
      members: members(['KE', 'CeT', 'MP', 'KE'], { 1: { [keys.cet]: true }, 2: { [keys.mp]: true }, 3: { [keys.ke]: true } }) });
    closeNumber(result.defenseBreak, 1 - .88 * .8 * .804);
    closeNumber(result.damageBuff.bossFactor, 287 / 275);
    assert.deepEqual(result.ignoredClassIds, ['ke']);
  }
});

test('New skill toggles are independent, and saved preferences seed new slots without changing existing slots', async t => {
  const h = await open(t);
  const input = (team, index) => '[data-member][data-team="' + team + '"][data-member-index="' + index + '"]';
  const controls = (target, team, index) => [...target.query(input(team, index)).closest('.member-slot').querySelectorAll('[data-member-skill-version]')];
  function assign(target, team, index, code) {
    edit(target, input(team,index), code);
    return controls(target, team, index);
  }
  for (const [index, code] of ['FP', 'DN', 'KE', 'CeT', 'SH', 'MP'].entries()) {
    const field = assign(h, 'single', index, code);
    assert.equal(field.length, 1, code);
    assert.equal(field[0].checked, false, code);
  }
  assert.equal(h.saved().classSkillVersionPreferences, undefined);
  assert.equal(h.saved().classSkillVersionsByTeam, undefined);
  const choices = assign(h, 'single', 0, 'ES');
  assert.equal(choices.length, 1);
  assert.equal(choices[0].closest('label').textContent, '戰鬥序曲是否轉換');
  assert.equal(choices[0].checked, false);
  choices[0].click();
  h.clickMode('challenge');
  const [otherPrelude] = assign(h, 'first', 1, 'ES');
  assert.equal(otherPrelude.checked, true);
  otherPrelude.click();
  assert.deepEqual(assign(h, 'second', 1, 'ES').map(field => field.checked), [false]);
  h.clickMode('single');
  assert.deepEqual(controls(h, 'single', 0).map(field => field.checked), [true]);
  const saved = h.saved();
  const restored = await open(t, { saved });
  assert.deepEqual(controls(restored, 'single', 0).map(field => field.checked), [true]);
  assign(restored, 'single', 0, '');
  assert.equal(controls(restored, 'single', 0).length, 0);
  assert.deepEqual(assign(restored, 'single', 0, 'ES').map(field => field.checked), [false]);

  const legacy = structuredClone(saved);
  delete legacy.classSkillVersionsByTeam.single;
  legacy.classSkillVersionPreferences['FP.FatalShotConverted'] = 'true';
  legacy.classSkillVersionPreferences.unknown = true;
  const replay = await open(t, { saved: legacy });
  assert.deepEqual(controls(replay, 'single', 0).map(field => field.checked), [false]);
  assert.equal(controls(replay, 'single', 1)[0].checked, false);
  assert.deepEqual(assign(replay, 'single', 5, 'ES').map(field => field.checked), [false]);
  assert.equal(replay.saved().classSkillVersionPreferences['FP.FatalShotConverted'],undefined);
  assert.equal(replay.saved().classSkillVersionPreferences.unknown,undefined);
});

test('ES keeps Provoke once in all arenas for both War Prelude choices, including legacy saves', async t => {
  const catalog = parseCoreCatalog(corePayloads);
  const removed = 'ES.ProvokeConverted', war = 'ES.WarPreludeConverted', fp = 'FP.FatalShotConverted';
  const validSlots = { single: { 0: { [war]: true } }, first: { 0: { [war]: false } },
    second: { 0: { [war]: true }, 1: { [fp]: false } } };
  const validPreferences = { [war]: false, [fp]: true };
  const legacy = { version: 1, mode: 'single',
    membersByTeam: { single: ['ES'], first: ['ES'], second: ['ES', 'FP'] },
    classSkillVersionsByTeam: {
      single: { 0: { [war]: true, [removed]: true } },
      first: { 0: { [war]: false } },
      second: { 0: { [war]: true, [removed]: false }, 1: { [fp]: false } },
    },
    classSkillVersionPreferences: { ...validPreferences, [removed]: true },
  };
  for (const value of [true, false, undefined]) {
    const raw = structuredClone(legacy);
    raw.classSkillVersionPreferences[removed] = value;
    for (const slots of Object.values(raw.classSkillVersionsByTeam)) slots[0][removed] = value;
    const parsed = parseSavedSimulatorState(JSON.stringify(raw), catalog);
    assert.deepEqual(parsed.classSkillVersionsByTeam, validSlots);
    assert.deepEqual(parsed.classSkillVersionPreferences, validPreferences);
    const members = (team, mode) => resolveSavedMembers(catalog, parsed.membersByTeam[team], mode, parsed.classSkillVersionsByTeam[team]);
    const defense = { bossDamageReduction: .6, challengeBreakCoefficient: .95 };
    const single = calculateTeam({ mode: 'single', defense, members: members('single', 'single') });
    const first = members('first', 'challenge');
    const second = members('second', 'challenge');
    const common = { buff: .1, debuff: .08, defenseBreak: .2, attackReduction: -.1, resistanceReduction: 100, actionSpeedDiminishing: .03 };
    assert.deepEqual(first[0].effects, { ...common, debuffCleanse: 3 });
    assert.deepEqual(second[0].effects, { ...common, shield: .15 });
    const challenge = calculateChallenge({ defense, firstTeam: { members: first }, secondTeam: { members: second } });
    for (const result of [single, ...Object.values(challenge)]) {
      closeNumber(result.debuffIncrease, .08);
      closeNumber(result.attackReduction, -.1);
    }
    closeNumber(single.shield, .15);
    closeNumber(challenge.firstTeam.shield, 0);
    closeNumber(challenge.secondTeam.shield, .15);
    closeNumber(challenge.sharedArena.shield, 0);
  }

  const h = await open(t, { saved: legacy });
  const controls = (page, team) => [...page.app.querySelectorAll('.member-slot')].find(slot =>
    slot.querySelector('[data-member]').dataset.team === team).querySelectorAll('[data-member-skill-version]');
  const assertPrelude = (page, team, checked) => {
    const fields = controls(page, team);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].closest('label').textContent, '戰鬥序曲是否轉換');
    assert.equal(fields[0].checked, checked);
  };
  assertPrelude(h, 'single', true);
  h.clickMode('challenge');
  assertPrelude(h, 'first', false);
  assertPrelude(h, 'second', true);
  assert.deepEqual(h.saved().classSkillVersionsByTeam, validSlots);
  assert.deepEqual(h.saved().classSkillVersionPreferences, validPreferences);
  const reloaded = await open(t, { saved: h.saved() });
  assertPrelude(reloaded, 'first', false);
  assertPrelude(reloaded, 'second', true);
  reloaded.clickMode('single');
  assertPrelude(reloaded, 'single', true);
});

test('Confirmed converted-only reference skills are marked once and have no toggle', () => {
  const catalog = parseCoreCatalog(corePayloads);
  // The user confirmed that only these converted forms provide team effects.
  const names = [
    ['RM', '月神之刃'], ['IM', '無限追逐者'], ['PR', '滂沱之箭'], ['RH', '核子爆破'],
    ['CC', '炸裂狼嚎'], ['SU', '制壓:搗'], ['SU', '隱形'], ['DB', 'EMP衝擊'],
    ['MN', '練擊'], ['PO', 'G-1日冕'], ['BL', '狂越連爆'],
  ];
  assert.ok(reference.roles.every(role => role.skills.every(skill => !skill.name.endsWith('(轉換)'))));
  const markedName = /^\[轉換\]/;
  for (const [code, name] of names) {
    const matches = reference.roles.find(role => role.code === code).skills.filter(skill => skill.name.replace(markedName, '') === name);
    assert.equal(matches.length, 1, code + ' ' + name);
    assert.equal(matches[0].name, '[轉換]' + name);
    assert.equal(catalog.classSkillVersions.has(code), false);
    for (const mode of ['single', 'challenge']) {
      const [member] = resolveSavedMembers(catalog, [code], mode);
      assert.deepEqual(member.effects, catalog.classEffects.find(profile => profile.code === code && profile.mode === mode).effects);
    }
  }
});

test('Reference normalization keeps icons, classifications and searchable passives', async t => {
  const h=await open(t);
  await h.openSkills();
  edit(h,'[data-skill-query]','被動');
  const rows=[...h.app.querySelectorAll('.skill-entry')];
  assert.equal(rows.length,36);
  for(const row of rows){
    assert.doesNotMatch(row.querySelector('strong').textContent,/\(被動\)/);
    assert.match(row.querySelector('header span').textContent,/被動$/);
  }
  const find=(name)=>rows.find(row=>row.querySelector('strong').textContent===name);
  assert.equal(find('戰略密碼:軸碎').querySelector('header span').textContent,'Buff、被動');
  assert.match(find('戰略密碼:軸碎').querySelector('img').src,/CE-02\.png$/);
  assert.equal(find('解放意志:Code:Failess').querySelector('header span').textContent,'DeBuff、被動');
  assert.equal(find('死亡本能').querySelector('header span').textContent,'被動');
  for(const [code,name] of [['RM','火鳳昇華'],...['AN','DaB','TW','PR'].map(code=>[code,'風暴之箭'])]){
    assert.equal(reference.roles.find(role=>role.code===code).skills.filter(row=>row.name===name+'(原版)').length,1);
    assert.equal(parseCoreCatalog(corePayloads).classSkillVersions.has(code),false);
  }
  assert.equal(reference.roles.find(role=>role.code==='MI').skills.find(row=>row.name==='扯鈴').description,
    '敵方10秒內抗性 -100+[骰子]\n※100+(骰子2+骰子5) =125');
});
