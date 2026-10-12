import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { productionAssets, validateAssets, contentHash } from '../scripts/production-assets.mjs';

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
  assert.equal(Object.keys(first.manifest.js).length, 3);
  const initial = first.manifest.js[first.manifest.entry].imports;
  assert.equal(initial.filter(item => item.kind === 'dynamic-import').length, 1);
  const transfer = initial.find(item => item.kind === 'dynamic-import').path;
  assert.match(transfer, /loadout-transfer-/);
  assert.ok(first.files.get(transfer).length > 0);
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
  assert.equal(without.manifest.css.length, 2);
  assert.ok(![...without.files.keys()].some(name => name.includes('seasonal')));
});

test('changing a lazy dependency versions the chunk and referencing entry without changing CSS', async () => {
  const first = await baseline();
  const second = await productionAssets({ ...options, plugin: { name: 'version-test', setup(builder) {
    builder.onLoad({ filter: /loadout-transfer\.js$/ }, async args => ({
      contents: await readFile(args.path, 'utf8') + '\nconsole.info("new-transfer-version");', loader: 'js',
    }));
  } } });
  const lazy = value => value.manifest.js[value.manifest.entry].imports.find(item => item.kind === 'dynamic-import').path;
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
