import { resolveLoadoutOption } from '../calculation/options.ts';
import { SUPPORT_MAGAZINE_LEVELS, supportMagazineBonus, supportMagazineLevelKey } from '../calculation/support-magazines.ts';
import { parseSavedSimulatorState, resolveSavedMembers, resolveSavedOptions } from '../frontend/saved-state.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseCoreCatalog } from '../frontend/data-loader.ts';
import { calculateBeneficiaryDefenseGain } from '../calculation/defense.ts';
import { calculateTeam, calculateChallenge } from '../calculation/engine.ts';
import { boot, fixturesUrl, storageKey } from './dom-harness.mjs';
import { capture, edit, scenarios } from './scenarios.mjs';

// Recorded from the unmodified 54f16fb production build before event routing changes.
// Full numeric outputs and v1 payloads are checked alongside complete result/skill HTML hashes.
// VI/DN reference edits change only full-roster skill digests. NP single and DaB corrections change only
// MP metrics/breakdowns; old-data replay and independent field/DOM checks verified both fixtures.
const fixtures = JSON.parse(await readFile(fixturesUrl, 'utf8'));
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

for (const [name, setup] of Object.entries(scenarios)) {
  test(`baseline numeric results, complete formatted HTML and v1 storage: ${name}`, async t => {
    const h = await open(t); setup(h); await h.openSkills(); assert.deepEqual(capture(h), fixtures[name]);
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
  const search = edit(h, '[data-skill-query]', '護盾');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, saveCurrentInputs: 0, memberScans: 0, updateSkillReference: 1 });
  assert.ok(h.query('[data-skill-results]').textContent.includes('護盾'));
  h.reset(); h.event(search, 'change');
  work(h, { calculateTeam: 0, updateResults: 0, storage: 0, updateSkillReference: 0 });
  edit(h, '[data-skill-query]', '');
  assert.equal(capture(h).skillHtmlHash, fixtures.defaultSingle.skillHtmlHash);
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

test('first expansion loads once, keeps original ordered HTML/icons, and reuses the session cache', async t => {
  const h = await open(t); h.reset(); await h.openSkills();
  assert.equal(skillRequests(h), 1);
  assert.equal(capture(h).skillHtmlHash, fixtures.defaultSingle.skillHtmlHash);
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 253);
  assert.equal(h.query('[data-skill-results]').querySelectorAll('*').length, 2528);
  for (const image of h.app.querySelectorAll('.skill-entry img')) {
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.ok(image.src.startsWith('https://test.example/buff-simulator/data/'));
  }
  assert.equal(h.calls.calculateTeam, 0); assert.equal(h.calls.storage, 0);
  h.setSkillsOpen(false);
  assert.equal(h.query('[data-skill-results]').childElementCount, 0);
  await h.openSkills(); h.event(h.query('.skill-reference'), 'toggle');
  assert.equal(skillRequests(h), 1);
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 253);
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
  assert.equal(h.app.querySelectorAll('.skill-entry').length, 253);
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
    assert.equal(h.app.querySelectorAll('.skill-entry').length, 253);
    assert.equal(skillRequests(h), 2);
  });
}

const corePayloads = Object.fromEntries(await Promise.all(Object.entries({classes:'classes',classEffects:'class-effects',effectTypes:'effect-types',loadoutOptions:'loadout-options',calculationParameters:'calculation-parameters'})
  .map(async([key,name])=>[key,JSON.parse(await readFile(new URL('../data/'+name+'.json',import.meta.url),'utf8'))])));
const closeNumber = (a,b) => assert.ok(Math.abs(a-b)<1e-12*Math.max(1,Math.abs(b)), `${a} != ${b}`);

test('all 60 classes share effects and preserve every field outside the seven authorized corrections', () => {
  const catalog=parseCoreCatalog(corePayloads);
  assert.equal(corePayloads.classEffects.classes.length,60);assert.equal(catalog.classEffects.length,120);
  for(const role of catalog.classes){const profiles=catalog.classEffects.filter(p=>p.classId===role.id);assert.equal(profiles.length,2);assert.deepEqual(profiles[0].effects,profiles[1].effects);assert.notEqual(profiles[0].effects,profiles[1].effects);assert.equal('estimatedDamageScore' in profiles[0],false);}
  assert.equal(corePayloads.classEffects.classes.filter(p=>p.challengeEffects).length,0);
  const changed={RM:['buff','debuff'],DaB:['mpRecoveryPerSecond'],PR:['debuffCleanse'],BL:['actionSpeedMultiplicative'],NP:['mpRecoveryPerSecond'],LA:['buff','debuff','defenseIgnoreAdditive'],VI:['defenseBreak']};
  const projection=catalog.classEffects.map(p=>({code:p.code,mode:p.mode,effects:Object.fromEntries(Object.entries(p.effects).filter(([key])=>!changed[p.code]?.includes(key)).sort(([a],[b])=>a.localeCompare(b)))})).sort((a,b)=>(a.code+':'+a.mode).localeCompare(b.code+':'+b.mode));
  assert.equal(createHash('sha256').update(JSON.stringify(projection)).digest('hex'),'60301ed93cd9f44e1ebabd88c21190e6d2d54aa9dfcfcea2dcba80629097ebcf');
  for(const mode of ['single','challenge']){const fx=code=>catalog.classEffects.find(p=>p.code===code&&p.mode===mode).effects;
    closeNumber(fx('RM').debuff,.12);assert.equal('buff' in fx('RM'),false);closeNumber(fx('DaB').mpRecoveryPerSecond,.01875);assert.equal(fx('PR').debuffCleanse,2);closeNumber(fx('BL').actionSpeedMultiplicative,.1);closeNumber(fx('NP').mpRecoveryPerSecond,.2);
    closeNumber(fx('LA').buff,1.05*(2.35+.0825)/2.35-1);closeNumber((1+fx('LA').buff)*1.0382-1,.12837981914893626);closeNumber((1+fx('LA').buff)*1.0382*1.05-1,.1847988101063831);closeNumber(fx('LA').debuff,.05);closeNumber(fx('LA').defenseIgnoreAdditive,.05);closeNumber(fx('LA').defenseBreak,.1);closeNumber(fx('VI').defenseBreak,.1925);
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
  const one=calculateTeam({mode:'single',members:[member],defense:{bossDamageReduction:.9601}}),duplicate=calculateTeam({mode:'single',members:[member,member],defense:{bossDamageReduction:.9601}});closeNumber(one.defenseIgnoreAdditive,.05);assert.deepEqual(duplicate.breakdown,one.breakdown);closeNumber(one.defenseBreak,.1);closeNumber(one.totalDamageMultiplier,(1+profile.effects.buff)*1.05/(1-.9601*.1));
  const challenge=calculateChallenge({firstTeam:{members:[member]},secondTeam:{members:[member]},defense:{challengeBreakCoefficient:.9601}});for(const r of Object.values(challenge))closeNumber(r.defenseIgnoreAdditive,.05);
  const h=await open(t);edit(h,'[data-member]','LA');assert.match(h.query('#results').textContent,/裝備無視防禦加算 \+5.00%/);assert.match(h.query('#results').textContent,/0% 試算/);assert.match(h.query('#results').textContent,/此項獨立表示，上方增益未包含此條。/);
});

const magazineCatalog=()=>parseCoreCatalog(corePayloads);
const magazineOptions=(catalog,settings={})=>catalog.loadoutOptions.filter(o=>o.userInput?.kind==='support-magazine').map(def=>resolveLoadoutOption(def,catalog.parameters,settings[def.id]?.enabled??false,settings[def.id]?.level??1));
const magazineMember=(catalog,code,mode='single')=>resolveSavedMembers(catalog,[code],mode)[0];
const magazineTeam=(members,options=[])=>calculateTeam({mode:'single',members,options,defense:{bossDamageReduction:.7192}});

test('Support magazines follow all six tiers and compose only the targeted green-control components',()=>{
  const c=magazineCatalog(),green=c.classes.filter(r=>r.uniquenessGroup==='green-control');assert.equal(green.length,8);
  assert.deepEqual(SUPPORT_MAGAZINE_LEVELS,[1,2,3,4,5,6]);
  for(const[level,bonus]of[[1,.005],[2,.01],[3,.015],[4,.02],[5,.025],[6,.03]])closeNumber(supportMagazineBonus(level),bonus);
  const settings=(i,ii,iii)=>Object.fromEntries([['i',i],['ii',ii],['iii',iii]].filter(([,v])=>v).map(([id,level])=>['support-magazine-'+id,{enabled:true,level}]));
  for(const role of green){const m=magazineMember(c,role.code),before=JSON.stringify(m),base=magazineTeam([m]);
    closeNumber(m.effects.buff,.2544);closeNumber(m.effects.actionSpeedMultiplicative,.1);assert.deepEqual(magazineTeam([m],magazineOptions(c)),base);
    for(const[i,ii,iii,buff,speed]of[[5,0,0,.2824,.1],[0,6,0,.288,.1],[5,6,0,.31675,.1],[0,0,2,.2544,.11],[0,0,6,.2544,.13]]){
      const result=magazineTeam([m],magazineOptions(c,settings(i,ii,iii)));closeNumber(result.buffIncrease,buff);closeNumber(result.actionSpeedMultiplicative,speed);
      for(const key of Object.keys(base).filter(k=>!['buffIncrease','buffMultiplier','actionSpeedMultiplicative','totalDamageMultiplier','breakdown','supportMagazineDetails'].includes(k)))assert.deepEqual(result[key],base[key],role.code+':'+key);
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
  assert.equal(box.checked,false);assert.equal(level.disabled,true);assert.equal(level.value,'1');
  h.reset();edit(h,'[data-option="'+id+'"]',true);h.event(box,'change');work(h,{calculateTeam:1,updateResults:1,storage:1,shell:0});assert.equal(level.disabled,false);
  level.focus();h.reset();edit(h,'[data-magazine-level="'+id+'"]',5);h.event(level,'change');work(h,{calculateTeam:1,updateResults:1,storage:1,shell:0});assert.equal(h.window.document.activeElement,level);assert.equal(h.query('[data-magazine-level="'+id+'"]'),level);
  closeNumber(capture(h).results.at(-1).breakdown.find(e=>e.key==='buff').values[0],.2824);assert.match(h.query('.calculation-details').textContent,/支援彈匣I Lv.5 · NP/);assert.match(h.query('.calculation-details').textContent,/攻擊力 Buff 12.00% → 14.50%/);
  edit(h,'[data-option="'+id+'"]',false);assert.equal(level.disabled,true);assert.equal(level.value,'5');assert.equal(h.saved().optionsByTeam.single[id+'-level'],5);closeNumber(capture(h).results.at(-1).breakdown.find(e=>e.key==='buff').values[0],.2544);
  edit(h,'[data-option="'+id+'"]',true);closeNumber(capture(h).results.at(-1).breakdown.find(e=>e.key==='buff').values[0],.2824);
  const restored=await open(t,{saved:h.saved()});assert.equal(restored.query('[data-magazine-level="'+id+'"]').value,'5');assert.equal(restored.query('[data-option="'+id+'"]').checked,true);assert.deepEqual(capture(restored).results.at(-1),capture(h).results.at(-1));
  edit(h,'[data-member]','LA');assert.equal(capture(h).results.at(-1).supportMagazineDetails,undefined);assert.match(h.query('[data-support-magazine="'+id+'"]').textContent,/目前無可強化的綠控來源/);closeNumber(capture(h).results.at(-1).defenseIgnoreAdditive,.05);
  await h.openSkills();h.reset();edit(h,'[data-skill-query]','本源');work(h,{calculateTeam:0,updateResults:0,storage:0});
});
test('Challenge magazine controls keep three independent team drafts and round-trip their levels',async t=>{
  const h=await open(t),set=(team,roman,level)=>{const id='support-magazine-'+roman;edit(h,'[data-option="'+id+'"][data-team="'+team+'"]',true);edit(h,'[data-magazine-level="'+id+'"][data-team="'+team+'"]',level);};
  edit(h,'[data-member]','NP');set('single','i',3);h.clickMode('challenge');edit(h,'[data-member][data-team="first"]','NP');edit(h,'[data-member][data-team="second"]','BL');set('first','i',5);set('first','iii',2);set('second','ii',6);set('second','iii',6);
  const saved=h.saved(),latest=capture(h).results.slice(-3);closeNumber(latest[0].supportMagazineDetails.find(d=>d.target==='attackBuff').effectiveValue,.145);closeNumber(latest[1].supportMagazineDetails.find(d=>d.target==='allSkillDamageBuff').effectiveValue,.15);closeNumber(latest[2].supportMagazineDetails.find(d=>d.target==='allSpeedBuff').effectiveValue,.11);
  h.clickMode('single');assert.equal(h.query('[data-magazine-level="support-magazine-i"]').value,'3');h.clickMode('challenge');assert.equal(h.query('[data-magazine-level="support-magazine-i"][data-team="first"]').value,'5');assert.equal(h.query('[data-magazine-level="support-magazine-ii"][data-team="second"]').value,'6');
  const restored=await open(t,{saved});assert.deepEqual(capture(restored).results,capture(h).results.slice(-3));assert.equal(restored.query('[data-magazine-level="support-magazine-iii"][data-team="first"]').value,'2');
});
test('DN field power descriptions remove only the physical restriction and retain icons, values and line breaks',async t=>{
  const skills=JSON.parse(await readFile(new URL('../data/skill-reference.json',import.meta.url),'utf8')).roles.find(r=>r.code==='DN').skills;
  assert.deepEqual(skills.filter(s=>s.name.startsWith('原野力量')).map(s=>({name:s.name,description:s.description,icon:s.icon})),[
    {name:'原野力量',description:'我方\n攻擊力 +11.5%\n所受傷害 -13.8%',icon:'skill-icons/DN-03.png'},
    {name:'原野力量(轉換)',description:'我方\n攻擊力、致命傷害 +9.2%\n覺醒回復速度 +34.5%',icon:'skill-icons/DN-04.png'}]);
  const h=await open(t);edit(h,'[data-member]','DN');await h.openSkills();h.reset();edit(h,'[data-skill-query]','原野力量');assert.equal(h.app.querySelectorAll('.skill-entry').length,2);assert.doesNotMatch(h.query('[data-skill-results]').textContent,/物理攻擊/);assert.match(h.query('[data-skill-results]').innerHTML,/我方<br>攻擊力/);work(h,{calculateTeam:0,updateResults:0,storage:0});
});
