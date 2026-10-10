import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function omitSourceIds(value) {
  if (Array.isArray(value)) return value.map(omitSourceIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, child]) => key !== "sourceId" && !(key === "id" && typeof child === "string" && child.includes(":")))
      .map(([key, child]) => [key, omitSourceIds(child)]));
  }
  return value;
}

test("built game data omits private maintenance references without changing projection results", async () => {
  const privateKeys = new Set([
    "manifest", "notes", "note", "sourceSheet", "sourceSheets", "sourceCell", "sourceCells", "sourceRange", "sourceRanges",
    "sourceFormula", "cells", "workbook", "sheet", "sheets", "calculationSheet", "extractedAt",
    "overallPotentialSourceCells", "yellowRateSourceCell", "sourceSpreadsheet", "sourceSpreadsheetId", "sourceWorkbookTitle",
    "importedAt", "coverage", "workbookDerived", "optionSource", "effectOutputCells", "effectOutputRows",
    "countedInputRange", "countFormulaCell", "pieceCountInput", "elementInput", "colorInput", "inputRules", "selectorRange",
    "calculationRow", "calculationRows", "formula",
  ]);
  const leaked = [];
  const inspect = (value, path = "$") => {
    if (Array.isArray(value)) { value.forEach((child, index) => inspect(child, `${path}[${index}]`)); return; }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (privateKeys.has(key)) leaked.push(`${path}.${key}`);
        inspect(child, `${path}.${key}`);
      }
      return;
    }
    if (typeof value === "string" && /Google Sheets|計算機!|係數區!|裝備模擬區!|sheet:/i.test(value)) leaked.push(`${path}=${value}`);
  };
  inspect(bundle);
  assert.deepEqual(leaked, []);
  assert.equal(await read("dist/data/examples/live-sheet-2026-09-28-expected.json").catch(() => null), null);

  const privateContent = /Google Sheets|Google spreadsheet|docs\.google\.com\/spreadsheets|Excel|計算機!|係數區!|裝備模擬區!|單隊用表!|挑戰\(雙隊\)模式用表!|係數調整!|全角色BUFF參照表!|sheet:|live-sheet|!\$?[A-Z]{1,3}\$?\d+/i;
  const publicFiles = (await listFiles("dist")).filter((file) => /\.(?:json|js|css|html|svg|webmanifest|txt)$/i.test(file));
  assert.ok(!publicFiles.some((file) => /sheet|google|manifest|live-sheet/i.test(file)), "public filenames must not expose maintenance references");
  for (const file of publicFiles) {
    const content = await readFile(join(root, file), "utf8");
    assert.doesNotMatch(content, privateContent, `${file} contains private maintenance references`);
    if (!file.endsWith(".json")) continue;
    const document = JSON.parse(content);
    const metadataPaths = [];
    const inspectDocument = (value, path = "$") => {
      if (Array.isArray(value)) { value.forEach((child, index) => inspectDocument(child, `${path}[${index}]`)); return; }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (privateKeys.has(key)) metadataPaths.push(`${path}.${key}`);
        inspectDocument(child, `${path}.${key}`);
      }
    };
    inspectDocument(document);
    assert.deepEqual(metadataPaths, [], `${file} contains private metadata fields`);
  }

  const source = await readPreviousShape();
  const state = await read("data/examples/public-example-2026-09-28.json");
  assert.deepEqual(omitSourceIds(projectDamage(bundle, state)), omitSourceIds(projectDamage(source, state)));
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
    const state = await read("data/examples/public-example-2026-09-28.json");
    assert.deepEqual(omitSourceIds(projectDamage(loaded, state)), omitSourceIds(projectDamage(await readPreviousShape(), state)));
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
  assert.ok(html.includes(`main.js?v=${revision}`));
});

test("stylesheet cache keys cover exactly the CSS linked by the selected theme", async () => {
  const html = await readFile(join(root, "dist/index.html"), "utf8");
  const references = [...html.matchAll(/href="\.\/frontend\/([^"?]+\.css)\?v=([^"]+)"/g)];
  const files = references.map((match) => match[1]);
  const revisions = new Set(references.map((match) => match[2]));
  assert.ok(files.length > 0, "the built page links at least one stylesheet");
  assert.equal(new Set(files).size, files.length, "stylesheet references are unique");
  assert.equal(revisions.size, 1, "all stylesheet links share one content-derived revision");
  const cssContents = await Promise.all(files.map(async (file) => readFile(join(root, "dist/frontend", file), "utf8")));
  const stylesheetInput = files.map((file, index) => file + "\0" + cssContents[index]).join("\n");
  const expectedRevision = createHash("sha256").update(stylesheetInput).digest("hex").slice(0, 16);
  assert.deepEqual([...revisions], [expectedRevision]);
  const emittedCss = (await readdir(join(root, "dist/frontend"))).filter((file) => file.endsWith(".css")).sort();
  assert.deepEqual(emittedCss, [...files].sort(), "the build emits no unlinked/stale stylesheets");
  assert.doesNotMatch(html, /__STYLESHEET_REVISION__/u);
});
