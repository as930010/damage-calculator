import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPublishableDataFile, publicGameData } from './public-game-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const { GAME_DATA_FILES, loadGameData } = await import(pathToFileURL(join(root, "dist/frontend/data.js")));
const { projectDamage } = await import(pathToFileURL(join(root, "dist/frontend/projection.js")));
const bundle = await read("dist/data/game-data.json");

async function listFiles(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

async function readSourceData() {
  const expected = Object.fromEntries(await Promise.all(Object.entries(GAME_DATA_FILES).map(async ([key, file]) => [
    key,
    await read(`data/${file}`),
  ])));
  const mapping = expected.mapping;
  const catalogFiles = [...new Set([...mapping.selections.map((entry) => entry.catalogFile), mapping.magicStoneSelections.catalogFile])];
  expected.catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async (file) => [file, await read(`data/${file}`)])));
  return expected;
}

test('public data preserves gameplay fields while excluding internal annotations', () => {
  for (const path of ['data/manifest.json', 'data/examples/calculation-expected.json']) assert.equal(isPublishableDataFile(path), false);
  for (const path of ['data/classes.json', 'data/skill-reference.json', 'data/skill-icons/AC-01.png']) assert.equal(isPublishableDataFile(path), true);
  const source = {
    sourceId: 'fixed-effect:master-beast', sourceName: '聖獸', stats: { doubleAttackPct: 3 },
    options: [{ value: 0 }, { value: null }], source: 'internal origin', sourceContext: 'internal origin',
    metadata: { author: 'private' }, provenance: { origin: 'private' }, developerNote: 'private',
    nested: { note: 'private', internal: { location: 'private' } },
    sources: [{ sourceId: 'effect:example', valueSource: { inputFieldId: 'Weapon.ENHC' } }],
  };
  const before = structuredClone(source);
  assert.deepEqual(publicGameData(source), {
    sourceId: 'fixed-effect:master-beast', sourceName: '聖獸', stats: { doubleAttackPct: 3 },
    options: [{ value: 0 }, { value: null }], nested: {},
    sources: [{ sourceId: 'effect:example', valueSource: { inputFieldId: 'Weapon.ENHC' } }],
  });
  assert.deepEqual(source, before);
});

test('public data rejects nested credentials, malformed source IDs and non-finite values', () => {
  for (const key of ['apiKey', 'access_token', 'client-secret', 'password', 'privateKey', 'authorization']) {
    assert.throws(() => publicGameData({ options: [{ [key]: 'sensitive' }] }), /Sensitive field/);
  }
  for (const sourceId of ['invalid reference', 'effect:invalid!reference', '', 123]) {
    assert.throws(() => publicGameData({ sourceId }), /Invalid public source identifier/);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => publicGameData({ stats: { value } }), /Non-finite number/);
  }
});

test("built public data excludes internal files and annotations without changing projection results", async () => {
  const privateKeys = new Set([
    "metadata", "provenance", "internal", "note", "notes", "developerNote", "formula",
    "dataUpdatedAt", "source", "apiKey", "password", "credentials",
  ]);
  const publicFiles = (await listFiles("dist")).filter(file => file.endsWith(".json"));
  assert.ok(publicFiles.length > 1);
  for (const file of publicFiles) {
    assert.ok(!/(?:^|\/)manifest\.json$|-expected\.json$/.test(file), file + " is maintenance-only");
    const document = await read(file);
    const inspect = (value, path = "$") => {
      if (Array.isArray(value)) return value.forEach((child, index) => inspect(child, path + "[" + index + "]"));
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!privateKeys.has(key), file + ":" + path + "." + key + " is private");
        inspect(child, path + "." + key);
      }
    };
    inspect(document);
  }

  const source = await readSourceData();
  const state = await read("data/examples/public-example-2026-09-28.json");
  assert.deepEqual(projectDamage(bundle, state), projectDamage(source, state));
});

test("game data loading uses one cache-busted request and returns the full data catalog", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.document = { querySelector: selector => selector.includes('build-revision') ? ({ content: 'test-revision' }) : null };
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, json: async () => bundle };
  };
  try {
    const loaded = await loadGameData();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "./data/game-data.json?v=test-revision");
    assert.equal(requests[0].options.cache, "force-cache");
    assert.deepEqual(loaded, bundle);
    const state = await read("data/examples/public-example-2026-09-28.json");
    assert.deepEqual(projectDamage(loaded, state), projectDamage(await readSourceData(), state));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("the built revision changes with game data so cached bundles cannot go stale", async () => {
  const dataRevision = createHash("sha256").update(await readFile(join(root, "dist/data/game-data.json"))).digest("hex").slice(0, 16);
  const html = await readFile(join(root, "site-dist/index.html"), "utf8");
  const manifest = JSON.parse(await readFile(join(root, "site-dist/asset-manifest.json"), "utf8"));
  assert.equal(html.match(/<meta name="build-revision" content="([^"]+)"/u)?.[1], dataRevision);
  assert.ok(html.includes(manifest.data['data/game-data.json']));
  assert.ok(html.includes(manifest.entry));
  assert.deepEqual(await readFile(join(root, 'site-dist', manifest.data['data/game-data.json'])), await readFile(join(root, 'dist/data/game-data.json')));
});

test("stylesheet cache keys cover exactly the CSS linked by the selected theme", async () => {
  const pages = ["index.html", "buff-simulator/index.html", "ice-optimizer/index.html"];
  const linkedCss = [];
  for (const page of pages) {
    const html = await readFile(join(root, "site-dist", page), "utf8");
    const files = [...html.matchAll(/href="([^"?]+\.css)"/g)].map(match => join(dirname(page), match[1]));
    assert.ok(files.length > 0); assert.equal(new Set(files).size, files.length);
    linkedCss.push(...files);
    assert.doesNotMatch(html, /__STYLESHEET_REVISION__/u);
  }
  const files = [...new Set(linkedCss)];
  for (const file of files) {
    const content = await readFile(join(root, 'site-dist', file));
    const revision = createHash('sha256').update(content).digest('hex').slice(0, 16);
    assert.ok(file.endsWith('-' + revision + '.css'), 'each stylesheet URL covers its own content');
  }
  const emittedCss = [
    ...(await readdir(join(root, 'site-dist/assets'))).filter(file => file.endsWith('.css')).map(file => join('assets', file)),
    ...(await readdir(join(root, 'site-dist/buff-simulator/assets'))).filter(file => file.endsWith('.css')).map(file => join('buff-simulator', 'assets', file)),
  ].sort();
  assert.deepEqual(emittedCss, [...files].sort(), 'no unlinked or stale stylesheets');
});
