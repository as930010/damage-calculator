import { seasonalStylesheetLink } from '../scripts/theme-resources.mjs';
import { JSDOM } from 'jsdom';
import { shareSimulatorCss, integrateThemes } from '../scripts/site-resources.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rmdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { productionAssets, validateAssets, contentHash, writeProduction, cleanOutput } from '../scripts/production-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = { root, compiled: resolve(root, 'dist') };
let built;
const baseline = () => built ??= productionAssets(options);

test('repeat builds are byte-identical; linked CSS, JS and JSON have content versions', async () => {
  const first = await baseline(), second = await productionAssets(options);
  assert.deepEqual(first.files, second.files);
  validateAssets(first.files, first.manifest);
  for (const { path } of first.manifest.css) assert.ok(path.includes(contentHash(first.files.get(path))));
  for (const path of Object.values(first.manifest.data)) if (path.endsWith('.json')) assert.ok(path.includes(contentHash(first.files.get(path))));
  const initial = first.manifest.js[first.manifest.entry].imports;
  const lazy = initial.filter(item => item.kind === 'dynamic-import');
  assert.equal(lazy.length, 2, 'transfer and team reference are separate on-demand features');
  const transfer = lazy.find(item => /\/loadout-transfer-/.test(item.path)).path;
  const teamReference = lazy.find(item => /\/team-defense-reference-/.test(item.path)).path;
  const eagerlyLoaded = new Set();
  const visit = path => {
    if (eagerlyLoaded.has(path)) return;
    eagerlyLoaded.add(path);
    for (const dependency of first.manifest.js[path].imports) if (dependency.kind !== 'dynamic-import') visit(dependency.path);
  };
  visit(first.manifest.entry);
  assert.ok(!eagerlyLoaded.has(transfer));
  assert.ok(!eagerlyLoaded.has(teamReference));
  assert.ok(first.files.get(teamReference).length > 0);
  assert.equal(first.manifest.transfer, transfer);
  assert.ok(first.files.get('index.html').toString().includes(`name="loadout-transfer-url" content="./${transfer}"`));
  assert.match(transfer, /loadout-transfer-/);
  assert.ok(first.files.get(transfer).length > 0);
});

test('failed asset writes cannot publish a ready manifest and a subsequent publish removes partial output', async () => {
  const temporary = await mkdtemp(join(root, '.build-verification-'));
  assert.equal(dirname(temporary), resolve(root), 'cleanup stays in the project workspace');
  const fixture = broken => {
    const files = new Map(broken ? [['assets', Buffer.from('force a file/directory collision')]] : []);
    files.set('index.html', Buffer.from('<script src="./assets/main.js"></script>'));
    files.set('assets/main.js', Buffer.from('export const value = 1;'));
    const manifest = { format: 1, entry: 'assets/main.js', js: { 'assets/main.js': { imports: [] } }, css: [], data: {},
      files: Object.fromEntries([...files].map(([name, bytes]) => [name, { bytes: bytes.length, hash: contentHash(bytes) }])) };
    files.set('asset-manifest.json', Buffer.from(JSON.stringify(manifest)));
    return { files, manifest };
  };
  try {
    await assert.rejects(writeProduction(temporary, fixture(true).files));
    await assert.rejects(readFile(join(temporary, 'site-dist/asset-manifest.json')), { code: 'ENOENT' });
    const good = fixture(false);
    await writeProduction(temporary, good.files);
    assert.deepEqual(JSON.parse(await readFile(join(temporary, 'site-dist/asset-manifest.json'))), good.manifest);
    assert.equal((await readFile(join(temporary, 'site-dist/assets/main.js'))).toString(), 'export const value = 1;');
  } finally {
    await cleanOutput(temporary, 'site-dist');
    await rmdir(temporary);
  }
});

test('a seasonal CSS edit changes only its URL; removing its HTML link omits its output', async () => {
  const first = await baseline();
  const css = await readFile(join(root, 'frontend/seasonal-effects.css'), 'utf8');
  const changed = await productionAssets({ ...options, cssOverrides: { 'seasonal-effects.css': css + '\n/* version test */' } });
  assert.equal(first.manifest.entry, changed.manifest.entry);
  for (let i = 0; i < first.manifest.css.length; i++) {
    const a = first.manifest.css[i], b = changed.manifest.css[i];
    if (a.source === 'seasonal-effects.css') assert.notEqual(a.path, b.path);
    else assert.equal(a.path, b.path);
  }
  const html = (await readFile(join(root, 'index.html'), 'utf8')).replace(/\s*<link[^>]+seasonal-effects\.css[^>]+>/, '');
  const without = await productionAssets({ ...options, html });
  assert.deepEqual(without.manifest.css.map(item => item.source), ['styles.css', 'polish.css', 'site-shell.css', 'equipment-workspace.css']);
  assert.ok(![...without.files.keys()].some(name => name.includes('seasonal')));
});

test('changing a lazy dependency versions the chunk and referencing entry without changing CSS', async () => {
  const first = await baseline();
  const second = await productionAssets({ ...options, plugin: { name: 'version-test', setup(builder) {
    builder.onLoad({ filter: /loadout-transfer\.js$/ }, async args => ({
      contents: await readFile(args.path, 'utf8') + '\nconsole.info("new-transfer-version");', loader: 'js',
    }));
  } } });
  const lazy = value => value.manifest.js[value.manifest.entry].imports.find(item => item.kind === 'dynamic-import' && /\/loadout-transfer-/.test(item.path)).path;
  assert.notEqual(lazy(first), lazy(second)); assert.notEqual(first.manifest.entry, second.manifest.entry);
  assert.deepEqual(first.manifest.css, second.manifest.css);
  validateAssets(second.files, second.manifest);
  const missing = new Map(second.files); missing.delete(lazy(second));
  assert.throws(() => validateAssets(missing, second.manifest), /Invalid asset|Unresolved/);
  const stale = new Map(second.files); stale.set(lazy(second), first.files.get(lazy(first)));
  assert.throws(() => validateAssets(stale, second.manifest), /Invalid asset/);
});

test('data changes version its URL and entry while other resources remain reusable', async () => {
  const first = await baseline();
  const bytes = Buffer.concat([await readFile(join(root, 'dist/data/game-data.json')), Buffer.from(' ')]);
  const second = await productionAssets({ ...options, dataOverrides: { 'data/game-data.json': bytes } });
  assert.notEqual(first.manifest.data['data/game-data.json'], second.manifest.data['data/game-data.json']);
  assert.notEqual(first.manifest.entry, second.manifest.entry);
  assert.deepEqual(first.manifest.css, second.manifest.css);
  assert.deepEqual(JSON.parse(second.files.get(second.manifest.data['data/game-data.json'])), JSON.parse(first.files.get(first.manifest.data['data/game-data.json'])));
  validateAssets(second.files, second.manifest);
});

test('tree shaking removes unused emitted declarations under otherwise identical bundle settings', async () => {
  const first = await baseline(), unshaken = await productionAssets({ ...options, treeShaking: false });
  const total = value => Object.keys(value.manifest.js).reduce((sum, name) => sum + value.files.get(name).length, 0);
  assert.ok(total(first) < total(unshaken), 'actual project emits fewer JS bytes with tree shaking');
});

test('production minification preserves complete raw calculation outputs for fixed configurations', async () => {
  const entry = new URL('../dist/frontend/projection.js', import.meta.url);
  const original = await import(entry.href);
  const result = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, minify: true,
    treeShaking: true, format: 'esm', target: 'es2022', charset: 'utf8', write: false });
  const optimized = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
  const data = JSON.parse(await readFile(join(root, 'dist/data/game-data.json'), 'utf8'));
  const state = JSON.parse(await readFile(join(root, 'data/examples/public-example-2026-09-28.json'), 'utf8'));
  const changed = structuredClone(state);
  Object.assign(changed.values, { 'Stage.Adapt': '80', 'Stage.CritRatePenalty': '10', 'Stage.BossDEF': '83.94' });
  for (const input of [state, changed]) assert.deepEqual(optimized.projectDamage(data, input), original.projectDamage(data, input));
});

test('production manifest covers exact emitted files, both pages, and GitHub Pages subpath imports', async () => {
  const deployment = resolve(root, 'site-dist');
  const all = new Map();
  async function walk(dir, prefix = '') {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) await walk(join(dir, item.name), prefix + item.name + '/');
      else all.set(prefix + item.name, await readFile(join(dir, item.name)));
    }
  }
  await walk(deployment);
  const main = JSON.parse(all.get('asset-manifest.json'));
  const buff = JSON.parse(all.get('buff-simulator/asset-manifest.json'));
  assert.deepEqual(main.pages, ['buff-simulator/asset-manifest.json']);
  for (const [prefix, manifest] of [['', main], ['buff-simulator/', buff]]) {
    validateAssets(all, manifest, prefix);
    for (const [path, info] of Object.entries(manifest.js)) {
      const text = all.get(prefix + path).toString();
      for (const dep of info.imports) {
        const relativeImport = text.matchAll(/(?:from\s*|import\s*\(|import\s*)["']([^"']+\.js)["']/g);
        const urls = [...relativeImport].map(match => new URL(match[1], `https://example.test/damage-calculator/${prefix}${path}`).pathname);
        assert.ok(urls.includes(`/damage-calculator/${prefix}${dep.path}`), `${path} resolves ${dep.path} in subpath`);
      }
    }
  }
  const expected = [...Object.keys(main.files), 'asset-manifest.json', ...Object.keys(buff.files).map(name => 'buff-simulator/' + name), 'buff-simulator/asset-manifest.json'].sort();
  assert.deepEqual([...all.keys()].sort(), expected, 'no unreferenced legacy modules or stale versions');
  const workflow = await readFile(join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /path: site-dist/); assert.match(workflow, /pnpm run test:production/);
  const preview = await readFile(join(root, 'scripts/preview.mjs'), 'utf8');
  assert.match(preview, /\.\.\/site-dist/);
  const { loadGameData } = await import('../dist/frontend/data.js');
  assert.equal(typeof loadGameData, 'function', 'Node test ESM contract remains available');
});

async function integratedFixture(seasonal) {
  const omitSeasonal = html => html.replace(/\s*<link[^>]+seasonal-effects\.css[^>]+>/, '');
  const mainHtml = await readFile(join(root, 'index.html'), 'utf8');
  const main = await productionAssets({ ...options, html: seasonal ? mainHtml : omitSeasonal(mainHtml) });
  const buffRoot = join(root, 'features/buff-simulator');
  const buffHtml = await readFile(join(buffRoot, 'index.html'), 'utf8');
  const cssOverrides = Object.fromEntries(await Promise.all(['site-shell.css', 'seasonal-effects.css'].map(async name =>
    [name, await readFile(join(root, 'frontend', name), 'utf8')])));
  const buff = await productionAssets({ root: buffRoot, compiled: join(buffRoot, 'dist'), buff: true,
    html: seasonal ? buffHtml : omitSeasonal(buffHtml), cssOverrides });
  for (const [name, bytes] of buff.files) main.files.set('buff-simulator/' + name, bytes);
  const cssLinks = main.manifest.css.filter(item => ['site-shell.css', 'seasonal-effects.css'].includes(item.source))
    .map(item => item.source === 'seasonal-effects.css'
      ? seasonalStylesheetLink('../' + item.path).replace('<link rel="stylesheet"', '<link data-build-test="preserved" rel="stylesheet"')
      : `<link rel="stylesheet" href="../${item.path}" />`).join('');
  const ice = Buffer.from(`<head>${cssLinks}</head><body><header class="site-header"></header></body>`);
  main.files.set('transformation-score/index.html', ice);
  main.files.set('ice-optimizer/index.html', ice);
  main.manifest.files['ice-optimizer/index.html'] = { bytes: ice.length, hash: contentHash(ice) };
  return main;
}

test('integrated themes survive optional seasonal resources and preserve shared URLs', async t => {
  for (const seasonal of [true, false]) await t.test(seasonal ? 'five themes' : 'four themes without seasonal CSS', async () => {
    const integrated = await integratedFixture(seasonal);
    shareSimulatorCss(integrated);
    await integrateThemes(root, integrated);
    const buff = JSON.parse(integrated.files.get('buff-simulator/asset-manifest.json'));
    validateAssets(integrated.files, integrated.manifest);
    validateAssets(integrated.files, buff, 'buff-simulator/');
    for (const source of ['site-shell.css', ...(seasonal ? ['seasonal-effects.css'] : [])]) {
      const path = integrated.manifest.css.find(item => item.source === source).path;
      assert.equal(buff.css.find(item => item.source === source).path, '../' + path);
      assert.ok(!integrated.files.has('buff-simulator/' + path));
      const missing = new Map(integrated.files); missing.delete(path);
      assert.throws(() => validateAssets(missing, buff, 'buff-simulator/'), /Unresolved/);
    }
    assert.equal([...integrated.files.keys()].filter(name => /theme-card-.*\.svg$/.test(name)).length, 5);
    const themeScript = integrated.files.get([...integrated.files.keys()].find(name => /assets\/themes-.*\.js$/.test(name))).toString();
    for (const page of ['index.html', 'ice-optimizer/index.html', 'buff-simulator/index.html', 'transformation-score/index.html']) {
      const html = integrated.files.get(page).toString();
      assert.equal((html.match(/data-theme-seasonal/g) ?? []).length, seasonal ? 2 : 1, 'one link when available plus bootstrap lookup');
      assert.equal((html.match(/theme-control:start/g) ?? []).length, 1);
      const dom = new JSDOM(html, { url: 'https://example.test/damage-calculator/' + page, runScripts: 'outside-only' });
      try {
        dom.window.sessionStorage.setItem('damage-calculator-preview-theme', 'seasonal');
        const bootstrap = html.match(/<!-- theme-bootstrap:start --><script>([\s\S]*?)<\/script>/)[1];
        dom.window.eval(bootstrap);
        dom.window.eval(themeScript);
        const { document } = dom.window;
        assert.equal(document.querySelectorAll('.theme-trigger').length, 1);
        assert.equal(document.querySelectorAll('.theme-card').length, seasonal ? 5 : 4);
        assert.equal(document.querySelector('.theme-trigger').dataset.theme, seasonal ? 'seasonal' : 'original');
        for (const id of ['harbor', 'forest', 'ember', 'original', ...(seasonal ? ['seasonal'] : [])]) {
          document.querySelector(`.theme-card[data-theme="${id}"]`).click();
          assert.equal(dom.window.localStorage.getItem('damage-calculator-preview-theme'), id);
          assert.equal(document.documentElement.dataset.previewTheme, ['original', 'seasonal'].includes(id) ? undefined : id);
          if (seasonal) assert.equal(document.querySelector('link[data-theme-seasonal]').media, id === 'seasonal' ? 'all' : 'not all');
        }
        if (!seasonal) assert.ok(!/seasonal-effects/.test(html));
      } finally { dom.window.close(); }
    }
  });
});

test('production pages retain original with no scripts, controller failure, and unavailable session storage', async () => {
  for (const page of ['index.html', 'ice-optimizer/index.html', 'transformation-score/index.html', 'buff-simulator/index.html']) {
    const html = await readFile(join(root, 'site-dist', page), 'utf8');
    const dom = new JSDOM(html, { url: 'https://example.test/damage-calculator/' + page, runScripts: 'outside-only' });
    try {
      const { document } = dom.window;
      const seasonal = document.querySelectorAll('link[data-theme-seasonal]');
      assert.equal(seasonal.length, 1, page);
      assert.equal(seasonal[0].media, 'not all', page + ' uses the base CSS without running any script');
      assert.equal(document.documentElement.dataset.previewTheme, undefined);
      assert.equal(document.querySelector('.theme-trigger'), null);
      Object.defineProperty(dom.window, 'sessionStorage', { get() { throw new Error('Storage unavailable'); } });
      dom.window.eval(html.match(/<!-- theme-bootstrap:start --><script>([\s\S]*?)<\/script>/)[1]);
      assert.equal(seasonal[0].media, 'not all', 'controller absent and storage unavailable keep the native default');
      assert.equal(document.documentElement.dataset.previewTheme, undefined);
    } finally { dom.window.close(); }
  }
});

test('all pages resolve URL, session preference and native default consistently before and after the controller', async () => {
  const integrated = await integratedFixture(true);
  shareSimulatorCss(integrated);
  await integrateThemes(root, integrated);
  const themeScript = integrated.files.get([...integrated.files.keys()].find(name => /assets\/themes-.*\.js$/.test(name))).toString();
  const cases = [
    [null, null, 'original'], ['invalid', null, 'original'],
    ...['original', 'seasonal', 'harbor', 'forest', 'ember'].map(value => [value, null, value]),
    ...['original', 'seasonal', 'harbor', 'forest', 'ember'].map(value => ['forest', value, value]),
    ['harbor', 'invalid', 'harbor'], [null, 'invalid', 'original'], ['invalid', 'invalid', 'original'],
  ];
  for (const page of ['index.html', 'ice-optimizer/index.html', 'buff-simulator/index.html', 'transformation-score/index.html']) {
    const html = integrated.files.get(page).toString();
    const bootstrap = html.match(/<!-- theme-bootstrap:start --><script>([\s\S]*?)<\/script>/)[1];
    for (const [stored, requested, expected] of cases) {
      const url = new URL('https://example.test/damage-calculator/' + page);
      if (requested !== null) url.searchParams.set('preview-theme', requested);
      const dom = new JSDOM(html, { url: url.href, runScripts: 'outside-only' });
      const label = page + ' stored=' + stored + ' requested=' + requested;
      try {
        const { document } = dom.window;
        if (stored !== null) dom.window.sessionStorage.setItem('damage-calculator-preview-theme', stored);
        const verify = () => {
          assert.equal(document.querySelector('link[data-theme-seasonal]').media, expected === 'seasonal' ? 'all' : 'not all', label);
          assert.equal(document.documentElement.dataset.previewTheme, ['original', 'seasonal'].includes(expected) ? undefined : expected, label);
          assert.equal(document.querySelectorAll('link[data-theme-seasonal]').length, 1, label);
        };
        dom.window.eval(bootstrap);
        verify();
        assert.equal(document.querySelector('link[data-theme-seasonal]').getAttribute('blocking'), expected === 'seasonal' ? 'render' : null, label + ' render blocking only for restored seasonal preference');
        assert.equal(dom.window.sessionStorage.getItem('damage-calculator-preview-theme'), stored, 'migration preserves legacy drafts');
        assert.equal(dom.window.localStorage.getItem('damage-calculator-preview-theme'), expected);
        dom.window.eval(themeScript);
        verify();
        assert.equal(document.querySelector('.theme-trigger').dataset.theme, expected, label);
        assert.equal(dom.window.localStorage.getItem('damage-calculator-preview-theme'), expected, label);
      } finally { dom.window.close(); }
    }
  }
});

test('theme integration recognizes reordered attributes and rejects active seasonal defaults', async () => {
  const integrated = await integratedFixture(true);
  shareSimulatorCss(integrated);
  const page = 'ice-optimizer/index.html';
  const original = integrated.files.get(page).toString();
  const reordered = original.replace(/<link data-build-test="preserved" rel="stylesheet" href="([^"]*seasonal-effects-[^"]+\.css)" media="not all" data-theme-seasonal \/>/,
    '<link data-theme-seasonal media="not all" data-build-test="preserved" href="$1" rel="stylesheet" />');
  assert.notEqual(reordered, original);
  integrated.files.set(page, Buffer.from(reordered));
  await integrateThemes(root, integrated);
  assert.match(integrated.files.get(page).toString(), /data-build-test="preserved"/);
  const active = await integratedFixture(true);
  shareSimulatorCss(active);
  active.files.set(page, Buffer.from(active.files.get(page).toString().replace('media="not all"', 'media="all"')));
  await assert.rejects(integrateThemes(root, active), /must be inactive and marked/);
});

test('shared CSS integration rejects differing content rather than silently changing visuals', async () => {
  const integrated = await integratedFixture(true);
  const manifest = JSON.parse(integrated.files.get('buff-simulator/asset-manifest.json'));
  const path = manifest.css.find(item => item.source === 'site-shell.css').path;
  integrated.files.set('buff-simulator/' + path, Buffer.from('different CSS'));
  assert.throws(() => shareSimulatorCss(integrated), /content differs/);
});


test('persistent theme precedence and legacy migration agree in bootstrap and controller on all four pages', async () => {
  const integrated = await integratedFixture(true);
  shareSimulatorCss(integrated);
  await integrateThemes(root, integrated);
  const controller = integrated.files.get([...integrated.files.keys()].find(name => /assets\/themes-.*\.js$/.test(name))).toString();
  const key = 'damage-calculator-preview-theme';
  const cases = [
    [null, null, null, 'original'],
    ...['original','seasonal','harbor','forest','ember'].map(value => [value, 'ember', null, value]),
    [null,'forest',null,'forest'], ['forest','ember',null,'forest'],
    ['invalid','harbor',null,'harbor'], ['invalid','invalid',null,'original'],
    ['ember','forest','harbor','harbor'], ['forest','ember','invalid','forest'],
  ];
  for (const page of ['index.html','ice-optimizer/index.html','transformation-score/index.html','buff-simulator/index.html']) {
    const html = integrated.files.get(page).toString();
    const bootstrap = html.match(/<!-- theme-bootstrap:start --><script>([\s\S]*?)<\/script>/)[1];
    for (const [local, session, requested, expected] of cases) {
      const dom = new JSDOM(html, {url:'https://example.test/damage-calculator/' + page + (requested ? '?preview-theme=' + requested : ''), runScripts:'outside-only'});
      try {
        const {window} = dom;
        window.localStorage.setItem('unrelated-loadout', 'preserve');
        if (local !== null) window.localStorage.setItem(key,local);
        if (session !== null) window.sessionStorage.setItem(key,session);
        window.eval(bootstrap);
        assert.equal(window.localStorage.getItem(key),expected);
        assert.equal(window.document.querySelector('link[data-theme-seasonal]').media,expected === 'seasonal' ? 'all' : 'not all');
        assert.equal(window.document.documentElement.dataset.previewTheme,['original','seasonal'].includes(expected) ? undefined : expected);
        window.eval(controller);
        assert.equal(window.document.querySelector('.theme-trigger').dataset.theme,expected);
        assert.equal(window.localStorage.getItem(key),expected);
        assert.equal(window.localStorage.getItem('unrelated-loadout'),'preserve');
        assert.equal(window.sessionStorage.getItem(key),session);
      } finally { dom.window.close(); }
    }
  }
});

test('theme storage failures degrade safely and cross-tab updates preserve focus without write loops', async () => {
  const integrated = await integratedFixture(true);
  shareSimulatorCss(integrated);
  await integrateThemes(root,integrated);
  const html = integrated.files.get('index.html').toString();
  const bootstrap = html.match(/<!-- theme-bootstrap:start --><script>([\s\S]*?)<\/script>/)[1];
  const controller = integrated.files.get([...integrated.files.keys()].find(name => /assets\/themes-.*\.js$/.test(name))).toString();
  const key = 'damage-calculator-preview-theme';
  for (const failure of ['local','both','write']) {
    const dom = new JSDOM(html,{url:'https://example.test/damage-calculator/',runScripts:'outside-only'});
    try {
      const {window} = dom;
      if (failure === 'write') Object.defineProperty(window,'localStorage',{value:{getItem(){return null;},setItem(){throw Error('Read only');}}});
      else Object.defineProperty(window,'localStorage',{get(){throw Error('Blocked');}});
      if (failure === 'both') Object.defineProperty(window,'sessionStorage',{get(){throw Error('Blocked');}});
      else window.sessionStorage.setItem(key,'forest');
      assert.doesNotThrow(() => {window.eval(bootstrap);window.eval(controller);});
      window.document.querySelector('.theme-card[data-theme="harbor"]').click();
      const trigger = window.document.querySelector('.theme-trigger');
      assert.equal(trigger.dataset.theme,'harbor');
      assert.equal(trigger.dataset.preferenceStorage,failure === 'both' ? 'page' : 'session');
      if (failure !== 'both') assert.equal(window.sessionStorage.getItem(key),'harbor');
    } finally {dom.window.close();}
  }
  for (const requested of ['', '?preview-theme=forest']) {
    const dom = new JSDOM(html,{url:'https://example.test/damage-calculator/' + requested,runScripts:'outside-only'});
    try {
      const {window} = dom;
      window.eval(bootstrap);window.eval(controller);
      const trigger = window.document.querySelector('.theme-trigger');
      const main = window.document.querySelector('main');
      trigger.focus();
      let writes = 0;
      window.Storage.prototype.setItem = () => { writes++; };
      window.dispatchEvent(new window.StorageEvent('storage',{key,newValue:'ember',storageArea:window.localStorage}));
      assert.equal(trigger.dataset.theme,requested ? 'forest' : 'ember');
      assert.equal(window.document.activeElement,trigger);
      assert.equal(window.document.querySelector('main'),main);
      assert.equal(writes,0);
      window.dispatchEvent(new window.StorageEvent('storage',{key,newValue:'invalid',storageArea:window.localStorage}));
      assert.equal(trigger.dataset.theme,requested ? 'forest' : 'ember');
    } finally {dom.window.close();}
  }
});
