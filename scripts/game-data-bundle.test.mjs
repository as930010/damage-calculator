import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const { GAME_DATA_FILES, loadGameData } = await import(pathToFileURL(join(root, "dist/frontend/data.js")));
const { projectDamage } = await import(pathToFileURL(join(root, "dist/frontend/projection.js")));
const bundle = await read("dist/data/game-data.json");

async function readPreviousShape() {
  const expected = Object.fromEntries(await Promise.all(Object.entries(GAME_DATA_FILES).map(async ([key, file]) => [
    key,
    await read(`data/${file}`),
  ])));
  const mapping = expected.mapping;
  const catalogFiles = [...new Set([...mapping.selections.map((entry) => entry.catalogFile), mapping.magicStoneSelections.catalogFile])];
  expected.catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async (file) => [file, await read(`data/${file}`)])));
  return expected;
}

test("built game data matches the previous per-file data object exactly", async () => {
  const expected = await readPreviousShape();
  assert.deepEqual(bundle, expected);
});

test("game data loading uses one cache-busted request and returns the full previous shape", async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.document = { querySelector: () => ({ content: "test-revision" }) };
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
    const state = await read("data/examples/live-sheet-2026-09-28.json");
    assert.deepEqual(projectDamage(loaded, state), projectDamage(await readPreviousShape(), state));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});

test("the built revision changes with game data so cached bundles cannot go stale", async () => {
  const dataRevision = createHash("sha256").update(await readFile(join(root, "dist/data/game-data.json"))).digest("hex").slice(0, 16);
  const html = await readFile(join(root, "dist/index.html"), "utf8");
  const revision = html.match(/<meta name="build-revision" content="([^"]+)"/u)?.[1];
  assert.ok(revision?.endsWith(dataRevision));
  assert.ok(html.includes(`styles.css?v=${revision}`));
});
