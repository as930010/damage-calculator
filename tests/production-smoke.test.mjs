import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createRuntime, root, gameData, resultHtml, sample } from './loadout-evaluation-harness.mjs';
import { uiPage, stageFields, stateB, enter, workloadActions } from './ui-update-harness.mjs';
import { boot as buffPage } from '../features/buff-simulator/tests/dom-harness.mjs';
import { scenarios, capture } from '../features/buff-simulator/tests/scenarios.mjs';

const waitFor = async (check, message) => {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail(message);
};

async function productionPage({ reader, search = '' } = {}) {
  const manifest = JSON.parse(await readFile(join(root, 'site-dist/asset-manifest.json'), 'utf8'));
  const html = await readFile(join(root, 'site-dist/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://production.test/damage-calculator/' + search, pretendToBeVisual: true });
  dom.window.localStorage.setItem('dab-loadout-v1', JSON.stringify(sample));
  dom.window.localStorage.setItem('dab-baseline-v1', JSON.stringify(sample));
  const blobs = [], requests = [];
  class ExportURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return 'https://production.test/#export'; }
    static revokeObjectURL() {}
  }
  const runtime = await createRuntime({ dom, instrument: false, sourceReader: reader,
    globals: { URL: ExportURL, fetch: async (url, options) => {
      const parsed = new URL(String(url), dom.window.location.href);
      assert.ok(parsed.pathname.startsWith('/damage-calculator/'));
      const path = decodeURIComponent(parsed.pathname.slice('/damage-calculator/'.length));
      requests.push({ path, cache: options.cache });
      const bytes = await readFile(join(root, 'site-dist', path));
      return { ok: true, json: async () => JSON.parse(bytes) };
    } },
  });
  const anchorClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function() { if (!this.download) anchorClick.call(this); };
  await runtime.load('site-dist/' + manifest.entry);
  await waitFor(() => dom.window.document.querySelector('#damage-result')?.textContent.trim(), 'production main initializes');
  assert.equal(dom.window.document.querySelector('.error-card'), null);
  const page = { dom, runtime, requests, manifest, blobs, close: () => dom.window.close(),
    readState: () => JSON.parse(dom.window.localStorage.getItem('dab-loadout-v1')) };
  page.exportJson = async (doubleClick = false) => {
    const before = blobs.length;
    await waitFor(() => !dom.window.document.querySelector('#export-loadout').disabled, 'export button ready');
    dom.window.document.querySelector('#export-loadout').click();
    if (doubleClick) dom.window.document.querySelector('#export-loadout').click();
    await waitFor(() => blobs.length === before + 1, 'one export completes');
    const reader = new dom.window.FileReader();
    const json = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(JSON.parse(reader.result)); reader.onerror = reject; reader.readAsText(blobs.at(-1));
    });
    assert.equal(blobs.length, before + 1); return json;
  };
  page.importJson = async json => {
    const input = dom.window.document.querySelector('#loadout-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => json }] });
    input.dispatchEvent(new dom.window.Event('change'));
    await waitFor(() => /已匯入/.test(dom.window.document.querySelector('#transfer-status').textContent), 'import completes');
  };
  return page;
}

test('production main matches source results and preserves lazy transfer, stage, history, baseline and picker controls', async () => {
  const source = await uiPage(sample, sample), page = await productionPage();
  const sourceTransfer = await source.runtime.load('frontend/loadout-transfer.ts');
  try {
    assert.deepEqual(resultHtml(page.dom.window.document), resultHtml(source.dom.window.document));
    assert.equal(page.requests.length, 1); assert.equal(page.requests[0].cache, 'force-cache');
    assert.match(page.requests[0].path, /^data\/game-data\.[a-f0-9]+\.json$/);
    assert.ok(!page.runtime.loadedFiles().some(name => name.includes('loadout-transfer-')));
    assert.deepEqual(await page.exportJson(true), await source.exportJson());
    assert.equal(page.runtime.loadedFiles().filter(name => name.includes('loadout-transfer-')).length, 1);
    await page.importJson(sourceTransfer.serializeLoadout(stateB, gameData).json);
    await source.importState(stateB);
    assert.deepEqual(resultHtml(page.dom.window.document), resultHtml(source.dom.window.document));
    for (const [key, label] of stageFields) {
      assert.equal(page.readState().values[key], stateB.values[key]);
      assert.equal(page.dom.window.document.querySelector(`input[aria-label="${label}"]`).value, stateB.values[key]);
    }
    for (const id of ['undo', 'redo', 'restore-baseline']) page.dom.window.document.querySelector('#' + id).click();
    for (const [key, label] of stageFields) assert.equal(page.dom.window.document.querySelector(`input[aria-label="${label}"]`).value, String(sample.values[key] ?? ''));
    await workloadActions.equipment(page);
    assert.equal(page.readState().values['Weapon.ENHC'], 'Lv.13');
    enter(page, '職業', 'KE'); assert.equal(page.readState().Job, 'KE');
    page.dom.window.document.querySelector('#baseline').click();
    enter(page, 'Boss防禦', '50');
    page.dom.window.document.querySelector('#restore-baseline').click();
    assert.equal(page.dom.window.document.querySelector('input[aria-label="Boss防禦"]').value, String(sample.values['Stage.BossDEF']));
    const exported = await page.exportJson();
    assert.equal(exported['Stage.BossDEF'], page.readState().values['Stage.BossDEF']);
  } finally { source.close(); page.close(); }
});

test('optional loader shares requests and retries failures; export failure remains recoverable', async () => {
  const runtime = await createRuntime();
  const { createTransferLoader } = await runtime.load('frontend/loadout-transfer-loader.ts');
  let calls = 0;
  const module = { test: true };
  const load = createTransferLoader(async () => { calls++; if (calls === 1) throw new Error('offline'); return module; });
  const first = load(); assert.equal(load(), first);
  await assert.rejects(first, /offline/);
  assert.equal(await load(), module); assert.equal(await load(), module); assert.equal(calls, 2);
  const attempts = [];
  const page = await productionPage({ reader: async path => {
    if (path.includes('/loadout-transfer-')) {
      attempts.push(path);
      if (!path.includes('?retry=')) throw new Error('cached failure for original URL');
    }
    return readFile(resolve(root, path.split('?')[0]), 'utf8');
  } });
  try {
    page.dom.window.document.querySelector('#export-loadout').click();
    await waitFor(() => /匯出失敗/.test(page.dom.window.document.querySelector('#transfer-status').textContent), 'failure is handled');
    assert.equal(page.blobs.length, 0);
    assert.ok(page.dom.window.document.querySelector('#damage-result').textContent.trim());
    await page.exportJson();
    assert.equal(attempts.length, 2);
    assert.ok(attempts[1].endsWith('?retry=1'));
    await page.exportJson(); assert.equal(attempts.length, 2, 'successful retry module is reused');
  } finally { page.close(); }
});

test('transfer retries are bounded and request page reload after four failed attempts', async () => {
  const runtime = await createRuntime();
  const { createTransferLoader } = await runtime.load('frontend/loadout-transfer-loader.ts');
  let attempts = 0;
  const load = createTransferLoader(async () => { attempts++; throw new Error('offline'); });
  for (let i = 0; i < 4; i++) await assert.rejects(load(), /offline/);
  await assert.rejects(load(), /重新整理/); await assert.rejects(load(), /重新整理/);
  assert.equal(attempts, 4);
});

test('production sample uses its versioned JSON without overwriting saved state', async () => {
  const page = await productionPage({ search: '?sample=public-example-2026-09-28' });
  try {
    assert.equal(page.requests.length, 2);
    assert.match(page.requests[1].path, /^data\/examples\/public-example-2026-09-28\.[a-f0-9]+\.json$/);
    assert.deepEqual(page.readState(), sample);
  } finally { page.close(); }
});

test('delayed transfer preserves export intent and newer imports win while core inputs remain usable', async () => {
  let release, requested = false;
  const gate = new Promise(resolve => { release = resolve; });
  const page = await productionPage({ reader: async path => {
    if (path.includes('/loadout-transfer-')) { requested = true; await gate; }
    return readFile(resolve(root, path), 'utf8');
  } });
  try {
    const exported = page.exportJson();
    await waitFor(() => requested, 'optional chunk requested');
    enter(page, 'Boss防禦', '50');
    release();
    assert.equal((await exported)['Stage.BossDEF'], sample.values['Stage.BossDEF']);
    assert.equal(page.readState().values['Stage.BossDEF'], '50');
    const transfer = await page.runtime.load('dist/frontend/loadout-transfer.js');
    const input = page.dom.window.document.querySelector('#loadout-file');
    let oldFile;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: () => new Promise(resolve => { oldFile = resolve; }) }] });
    input.dispatchEvent(new page.dom.window.Event('change'));
    await page.importJson(transfer.serializeLoadout(stateB, gameData).json);
    oldFile(transfer.serializeLoadout(sample, gameData).json);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(page.readState().values['Stage.Adapt'], stateB.values['Stage.Adapt']);
    assert.equal(page.dom.window.document.querySelector('input[aria-label="關卡適應力"]').value, stateB.values['Stage.Adapt']);
  } finally { release(); page.close(); }
});

test('Buff production matches source single/challenge HTML and keeps skills lazy, cached and isolated from calculation', async () => {
  const source = await buffPage(), page = await buffPage({ production: true });
  try {
    assert.equal(page.requests.length, 5); assert.ok(!page.requests.some(path => path.startsWith('skill-reference')));
    assert.equal(page.query('[data-skill-results]').childElementCount, 0);
    for (const name of ['configuredSingle', 'configuredChallenge']) {
      scenarios[name](source); scenarios[name](page);
      assert.equal(capture(page).resultHtmlHash, capture(source).resultHtmlHash);
      assert.deepEqual(page.saved(), source.saved());
    }
    const before = page.query('#results').innerHTML, saved = page.saved();
    await source.openSkills(); await page.openSkills();
    assert.equal(capture(page).skillHtmlHash, capture(source).skillHtmlHash);
    assert.equal(page.requests.length, 6);
    page.setSkillsOpen(false); await page.openSkills(); assert.equal(page.requests.length, 6);
    const search = page.query('[data-skill-query]'); search.value = '傷害'; page.event(search);
    assert.equal(page.query('#results').innerHTML, before); assert.deepEqual(page.saved(), saved);
  } finally { source.close(); page.close(); }
});

test('Buff production skill failure is retryable and does not disable core calculation', async () => {
  let failed = false;
  const page = await buffPage({ production: true, fetchSkill: response => {
    if (!failed) { failed = true; return { ok: false, status: 503 }; } return response;
  } });
  try {
    await page.openSkills(); assert.match(page.query('[data-skill-results]').textContent, /載入失敗/);
    const before = page.query('#results').innerHTML;
    page.clickMode('challenge'); assert.notEqual(page.query('#results').innerHTML, before);
    await page.openSkills(); assert.ok(!page.app.querySelector('[data-skill-retry]'));
    assert.equal(page.requests.filter(path => path.startsWith('skill-reference')).length, 2);
  } finally { page.close(); }
});
