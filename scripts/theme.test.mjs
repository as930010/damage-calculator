import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { initializeThemeToggle } = await import(pathToFileURL(join(root, "dist/frontend/theme.js")));

function fixture(saved = null, failStorage = false) {
  let listener;
  const stored = saved;
  const writes = [];
  const storage = {
    getItem() { if (failStorage) throw new Error("storage unavailable"); return stored; },
    setItem(key, value) { if (failStorage) throw new Error("storage unavailable"); writes.push([key, value]); },
  };
  const button = {
    attributes: {}, textContent: "", title: "",
    addEventListener(_type, callback) { listener = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const rootElement = { dataset: {} };
  initializeThemeToggle(button, rootElement, storage);
  return { button, rootElement, writes, click: () => listener() };
}

test("theme starts dark by default, toggles to light, and persists the selection", () => {
  const { button, rootElement, writes, click } = fixture();
  assert.equal(rootElement.dataset.theme, "dark");
  assert.equal(button.textContent, "明亮模式");
  assert.equal(button.attributes["aria-pressed"], "false");
  click();
  assert.equal(rootElement.dataset.theme, "light");
  assert.equal(button.textContent, "暗色模式");
  assert.equal(button.attributes["aria-pressed"], "true");
  assert.deepEqual(writes, [["damage-calculator-theme", "light"]]);
});

test("a saved light preference is restored and the user can return to dark mode", () => {
  const { button, rootElement, writes, click } = fixture("light");
  assert.equal(rootElement.dataset.theme, "light");
  assert.equal(button.textContent, "暗色模式");
  click();
  assert.equal(rootElement.dataset.theme, "dark");
  assert.equal(button.attributes["aria-pressed"], "false");
  assert.deepEqual(writes, [["damage-calculator-theme", "dark"]]);
});

test("theme remains usable when browser storage is unavailable", () => {
  const { button, rootElement, writes, click } = fixture(null, true);
  assert.equal(rootElement.dataset.theme, "dark");
  click();
  assert.equal(rootElement.dataset.theme, "light");
  assert.deepEqual(writes, []);
});

test("light palette defines readable light surfaces while preserving the dark default tokens", async () => {
  const css = await readFile(join(root, "frontend/styles.css"), "utf8");
  assert.match(css, /:root\{\s*color-scheme:dark;\s*--page-bg:#15171c;\s*--text-main:#e5e8ee/u);
  assert.match(css, /:root\[data-theme="light"\]\{\s*color-scheme:light;\s*--page-bg:#f4f6fa/u);
  assert.match(css, /--panel:#fff;\s*--panel-alt:#f8f9fa/u);
  assert.match(css, /--text-heading:#26364c/u);
  assert.match(css, /\.theme-toggle\{/u);
});
