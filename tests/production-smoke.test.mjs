import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createRuntime, root, gameData, resultHtml, sample } from './loadout-evaluation-harness.mjs';
import { uiPage, stageFields, stateB, enter, workloadActions } from './ui-update-harness.mjs';
import { boot as buffPage } from '../features/buff-simulator/tests/dom-harness.mjs';
import { scenarios, capture } from '../features/buff-simulator/tests/scenarios.mjs';

test('source and production expose a keyboard shortcut to the main workspace on all four pages', async () => {
  for (const route of ['', 'ice-optimizer/', 'transformation-score/', 'buff-simulator/']) {
    for (const pagePath of [route ? 'features/' + route : '', 'site-dist/' + route]) {
      const html = await readFile(join(root, pagePath, 'index.html'), 'utf8');
      const { window } = new JSDOM(html);
      try {
        const link = window.document.querySelector('a[href], button, input, select, [tabindex="0"]');
        assert.equal(link?.className, 'skip-to-workspace', pagePath);
        assert.match(link.textContent, /跳到主要內容/);
        const target = window.document.querySelector(link.getAttribute('href'));
        assert.equal(target?.localName, 'main', pagePath);
        assert.equal(target.tabIndex, -1, pagePath);
      } finally { window.close(); }
    }
  }
});

const waitFor = async (check, message) => {
  for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
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
    await waitFor(() => {
      [...dom.window.document.querySelectorAll('dialog button')].find(button => button.textContent === '套用至畫布')?.click();
      return /已匯入/.test(dom.window.document.querySelector('#transfer-status').textContent);
    }, 'import completes');
  };
  return page;
}

test('production result shortcuts address unique focusable destinations', async () => {
  const page = await productionPage();
  const cases = [
    [page.dom.window, '#damage-detail-heading', '查看傷害明細'],
    [page.dom.window, '#equipment-config-heading', '返回裝備配置'],
  ];
  const staticWindows = [];
  try {
    for (const [route, target, label] of [
      ['ice-optimizer', '#optimizer-result-region', '查看搜尋結果'],
      ['transformation-score', '#configuration-rating', '查看評分'],
    ]) {
      const html = await readFile(join(root, 'site-dist', route, 'index.html'), 'utf8');
      const { window } = new JSDOM(html);
      staticWindows.push(window);
      cases.push([window, target, label]);
    }
    for (const [{ document }, target, label] of cases) {
      const link = document.querySelector(`a.site-inpage-link[href="${target}"]`);
      assert.equal(link?.textContent.trim(), label);
      assert.equal(document.querySelectorAll(target).length, 1, target);
      assert.equal(document.querySelector(target).getAttribute('tabindex'), '-1', target);
    }
  } finally {
    for (const window of staticWindows) window.close();
    page.close();
  }
});

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
    assert.equal(exported.values['3'], page.readState().values['Stage.BossDEF']);
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
    assert.equal((await exported).values['3'], sample.values['Stage.BossDEF']);
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

test('production transformation score follows the active loadout and keeps simulations read-only', async () => {
  const dir = join(root, 'site-dist');
  const html = await readFile(join(dir, 'transformation-score/index.html'), 'utf8');
  const base = 'https://production.test/damage-calculator/';
  const dom = new JSDOM(html, { url: base + 'transformation-score/' });
  const { document, localStorage, StorageEvent, Event } = dom.window;
  const workspace = document.querySelector('#score-workspace');
  const savedKey = 'dab-loadout-v1';
  const active = JSON.stringify(sample);
  try {
    localStorage.setItem('dab-baseline-v1', active);
    const runtime = await createRuntime({ dom, instrument: false, globals: {
      Option: dom.window.Option,
      fetch: async url => {
        const asset = new URL(url, document.baseURI);
        assert.ok(asset.href.startsWith(base + 'data/game-data.'));
        return { ok: true, json: async () => JSON.parse(await readFile(join(dir, asset.href.slice(base.length)), 'utf8')) };
      },
    } });
    const entry = document.querySelector('script[type="module"]').src.slice(base.length);
    await runtime.load('site-dist/' + entry);
    await waitFor(() => workspace.hidden, 'a saved comparison baseline alone cannot be scored');
    localStorage.setItem(savedKey, active);
    document.querySelector('#reload-loadout').click();
    await waitFor(() => !workspace.hidden, 'load the saved active equipment');
    const current = () => document.querySelector('.score-verdict strong').textContent;
    assert.match(document.querySelector('#score-output').textContent, /變換分數/);
    assert.ok(document.querySelector('.score-grade').textContent.trim());
    assert.match(document.querySelector('#score-bounds').textContent, /最低收益參考（四條）/);
    assert.match(document.querySelector('#score-bounds').textContent, /頂變換參考/);
    assert.doesNotMatch(document.querySelector('#loadout-status').textContent, /物理職業|魔法職業/);
    assert.match(document.querySelector('#loadout-status').textContent, /不含武器變換攻擊力等級/);
    assert.equal(document.querySelector('a[href="../"]:not(.site-tabs a)'), null);
    const choices = [...document.querySelector('[data-choice]').options].slice(1);
    const tables = [...document.querySelectorAll('#roll-comparisons table')];
    assert.equal(tables.length, 14);
    assert.deepEqual(tables.map(table => table.caption.textContent), gameData.transformations.rules.map(rule => rule.label));
    for (const table of tables) {
      assert.equal(table.querySelectorAll('th[scope="col"]').length, 2);
      assert.equal(table.tBodies[0].rows.length, 8);
      for (const row of table.tBodies[0].rows) assert.match(row.cells[1].textContent, /^-?\d+\.\d{2}%$/);
    }
    assert.equal(tables[5].tBodies[0].rows[0].cells[0].textContent, '13');
    assert.equal(tables[13].tBodies[0].rows[0].cells[0].textContent, '8.0%');
    assert.equal(choices.find(option => option.value === '技能傷害%').text, '所有技能傷害');
    const initial = current();
    const filter = document.querySelector('#roll-filter');
    const boxes = [...filter.querySelectorAll('input')];
    assert.equal(boxes.length, 14);
    assert.ok(boxes.every(box => box.checked));
    boxes.slice(0, -1).forEach(box => { box.checked = false; });
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    assert.match(document.querySelector('#roll-filter-status').textContent, /1／14/);
    assert.deepEqual([...document.querySelectorAll('#roll-comparisons .roll-card:not([hidden]) table')], [tables.at(-1)]);
    assert.equal(current(), initial);
    assert.equal(localStorage.getItem(savedKey), active);
    boxes.forEach(box => { box.checked = true; });
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(document.querySelectorAll('#roll-comparisons .roll-card:not([hidden])').length, 14);
    const disclosure = document.querySelector('#roll-disclosure');
    disclosure.open = false;
    for (let i = 0; i < 4; i++) {
      const choice = document.querySelector(`[data-choice="${i}"]`);
      choice.value = '無關傷害';
      choice.dispatchEvent(new Event('change', { bubbles: true }));
      assert.ok(document.querySelector(`[data-roll="${i}"]`).disabled);
      assert.equal(document.querySelector(`[data-roll="${i}"]`).options.length, 1);
    }
    assert.equal(current(), '0.00');
    assert.match(document.querySelector('#score-output').textContent, /目前提升幅度0.00%/);
    assert.doesNotMatch(document.querySelector('#configuration-rating').textContent, /無變換基準傷害|模擬後傷害/);
    const first = document.querySelector('[data-choice="0"]');
    first.value = '技能傷害%'; first.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(document.querySelector('.score-grade'), null);
    assert.equal(document.querySelector('[data-roll="0"]').value, '');
    assert.equal([...document.querySelector('[data-choice="1"]').options].find(option => option.value === '技能傷害%'), undefined);
    document.querySelector('[data-roll="0"]').value = '13';
    document.querySelector('[data-roll="0"]').dispatchEvent(new Event('change', { bubbles: true }));
    const duplicate = document.querySelector('[data-choice="1"]');
    duplicate.add(new dom.window.Option('所有技能傷害', '技能傷害%')); duplicate.value = '技能傷害%'; duplicate.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(duplicate.value, '');
    assert.equal(document.querySelector('[data-roll="1"]').value, '');
    document.querySelector('#reload-loadout').click();
    assert.equal(disclosure.open, false);
    assert.equal(current(), initial);
    assert.equal(localStorage.getItem(savedKey), active);
    const roll = document.querySelector('[data-roll="0"]');
    roll.value = '8';
    roll.dispatchEvent(new Event('change', { bubbles: true }));
    assert.notEqual(current(), initial);
    assert.equal(localStorage.getItem(savedKey), active);
    const changed = { ...sample, Job: 'KE', values: { ...sample.values, 'Weapon.ENHC': 'Lv.13' } };
    localStorage.setItem(savedKey, JSON.stringify(changed));
    dom.window.dispatchEvent(new StorageEvent('storage', { key: savedKey }));
    assert.match(document.querySelector('#loadout-status').textContent, /KE.*\+13.*不含武器變換攻擊力等級/);
    assert.notEqual(current(), initial);
    assert.equal(document.querySelector('[data-roll="0"]').value, '13');
    const highest = index => document.querySelectorAll('#roll-comparisons table')[index].tBodies[0].rows[0].cells[1].textContent;
    changed.transcendenceSkillDamageSharePct = 0;
    changed.values['Stage.BossDEF'] = 0;
    localStorage.setItem(savedKey, JSON.stringify(changed));
    document.querySelector('#reload-loadout').click();
    assert.equal(highest(11), '0.00%');
    assert.equal(highest(13), '0.00%');
    assert.ok(parseFloat(highest(10)) > 0);
    changed.transcendenceSkillDamageSharePct = 100;
    changed.values['Stage.BossDEF'] = 80;
    localStorage.setItem(savedKey, JSON.stringify(changed));
    dom.window.dispatchEvent(new StorageEvent('storage', { key: savedKey }));
    assert.equal(highest(10), '0.00%');
    assert.ok(parseFloat(highest(11)) > 0);
    assert.ok(parseFloat(highest(13)) > 0);
    localStorage.removeItem(savedKey);
    dom.window.dispatchEvent(new StorageEvent('storage', { key: savedKey }));
    assert.ok(workspace.hidden);
    assert.match(document.querySelector('#loadout-status').textContent, /尚未取得/);
    assert.equal(localStorage.getItem('dab-baseline-v1'), active);
  } finally { dom.window.close(); }
});

test('four source and production pages retain unique metadata and current footer version', async () => {
  const pages = [
    ['index.html', 'index.html', '', '配裝模擬器', /艾爾之光.*配裝/],
    ['features/transformation-score/index.html', 'transformation-score/index.html', 'transformation-score/', '屬性變換評分', /武器變換.*PR/],
    ['features/ice-optimizer/index.html', 'ice-optimizer/index.html', 'ice-optimizer/', '冰裝最佳化試算', /冰裝.*理論傷害/],
    ['features/buff-simulator/index.html', 'buff-simulator/index.html', 'buff-simulator/', '隊伍增益模擬', /Buff／DeBuff/],
  ];
  for (const production of [false, true]) {
    const descriptions = [];
    for (const [source, output, path, title, purpose] of pages) {
      const dom = new JSDOM(await readFile(join(root, production ? 'site-dist/' + output : source), 'utf8'));
      try {
        const doc = dom.window.document;
        assert.equal(doc.title, title);
        const description = doc.querySelectorAll('head meta[name="description"]');
        assert.equal(description.length, 1);
        assert.match(description[0].content, purpose);
        descriptions.push(description[0].content);
        const canonical = doc.querySelectorAll('head link[rel="canonical"]');
        assert.equal(canonical.length, 1);
        assert.equal(canonical[0].href, 'https://as930010.github.io/damage-calculator/' + path);
        assert.equal(doc.querySelector('.footer-version bdi').textContent, 'v5.01.13');
        assert.equal(doc.querySelector('.footer-updated time').dateTime, '2026-11-26');
      } finally { dom.window.close(); }
    }
    assert.equal(new Set(descriptions).size, 4);
  }
});

test('release history preserves published entries and prepends new versions without replacing history', async () => {
  const { createHash } = await import('node:crypto');
  for (const path of ['index.html', 'site-dist/index.html']) {
    const dom = new JSDOM(await readFile(join(root, path), 'utf8'));
    try {
      const list = dom.window.document.querySelector('ol.site-release-list');
      assert.ok(list);
      const entries = [...list.children].map(li => [
        li.querySelector('strong').textContent, li.querySelector('time').dateTime, li.querySelector('p').textContent,
      ]);
      const versions = entries.map(entry => entry[0]);
      assert.equal(new Set(versions).size, versions.length, 'versions are unique within release history');
      assert.deepEqual(entries[0], ['v5.01.13', '2026-11-26', '新增職業技能轉換設定、重構隊伍增益計算並新增基礎傷害屬性設定、修正職業技能效果']);
      assert.deepEqual(entries[1], ['v4.12.07', '2026-11-25', '全面重構裝備畫布與設定介面、統一選擇器及版面樣式、優化操作效能']);
      assert.deepEqual(entries[2], ['v4.11.05', '2026-11-24', '新增迷鏡聖獸技能']);
      assert.deepEqual(entries[3], ['v4.10.06', '2026-11-24', '新增深淵暗鬼武器及相關套裝效果、移除傷害計算機的動作速度統計']);
      assert.deepEqual(entries[4], ['v4.09.12', '2026-11-24', '新增武器刻印石功能、優化介面中分隔線忽高忽低的問題']);
      assert.deepEqual(entries[5], ['v4.08.11', '2026-11-22', '全面優化UI、統計數據新增「重置冷卻%」']);
      assert.deepEqual(entries[6], ['v4.07.04', '2026-11-20', '團隊增益效果與PR被動技能效果更新至11/19平衡版本']);
      assert.deepEqual(entries[7], ["v4.07.03","2026-11-19","優化UI、優化詞條顯示邏輯、更新天線耳機與百億藍套裝效果"]);
      assert.deepEqual(entries[8], ['v4.06.06', '2026-11-19', '新增儲存角色與配置快捷切換功能，優化UI與主題配色']);
      assert.deepEqual(entries[9], ['v4.05.03', '2026-11-17', '優化引用破防區塊操作、隊伍增益模擬自由度']);
      assert.deepEqual(entries[10], ['v4.03.03', '2026-11-10', '修正TB、DN、TW未被賦靈錄加成正確識別到分支的問題']);
      assert.deepEqual(entries[11], ['v4.03.02', '2026-11-09', '大規模優化隊伍Buff模擬內容，增加支援彈匣']);
      assert.deepEqual(entries[12], ['v4.02.02', '2026-11-07', '優化裝備配置部分設定與完成設定的提醒方式']);
      assert.deepEqual(entries[13], ['v4.01.07', '2026-11-06', '新增細算無視防禦以及彈匣選項，用於支援格雷特勳章的效果計算']);
      assert.deepEqual(entries[14], ['v4.01.03', '2026-11-06', '新增屬性變換試算評分功能']);
      assert.deepEqual(entries[15], ['v3.04.23', '2026-11-05', '優化冰裝與內裝魔法石來源顯示方式、獵人的本能新增公會技能標籤']);
      const current = versions.indexOf('v3.04.19'), previous = versions.indexOf('v3.04.18');
      assert.ok(current >= 0 && previous > current);
      assert.deepEqual(entries[previous], ['v3.04.18', '2026-10-30', '新增切換佈景主題功能、按鈕反應與視覺效果優化']);
      assert.deepEqual(entries[current], ['v3.04.19', '2026-11-04', '修正幻影面紗左五數值錯誤的問題']);
      for (let i = 1; i < entries.length; i++) {
        assert.ok(entries[i - 1][1] >= entries[i][1], 'dates descend');
        const newer = versions[i - 1].slice(1).split('.').map(Number);
        const older = versions[i].slice(1).split('.').map(Number);
        const part = newer.findIndex((value, j) => value !== older[j]);
        assert.ok(part >= 0 && newer[part] > older[part], 'versions descend');
      }
      // Frozen published history from v3.03.01 down; new releases may be prepended.
      const historical = entries.slice(versions.indexOf('v3.03.01'));
      assert.equal(historical.length, 38);
      assert.equal(createHash('sha256').update(JSON.stringify(historical)).digest('hex'), 'f83af82e996813c1d7da64004c06d98d91fea9e4fc0c8bf03b5d37fa278ba206');
    } finally { dom.window.close(); }
  }
});
