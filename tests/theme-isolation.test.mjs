import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [indexHtml, buildScript, sharedStyles, mainSource] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "scripts/build.mjs"), "utf8"),
  readFile(resolve(root, "frontend/styles.css"), "utf8"),
  readFile(resolve(root, "frontend/main.ts"), "utf8"),
]);
const seasonalPath = resolve(root, "frontend/seasonal-effects.css");
let seasonalCss = null;
try {
  await access(seasonalPath);
  seasonalCss = await readFile(seasonalPath, "utf8");
} catch {
  seasonalCss = null;
}

function leafRules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [];
  const rules = [];
  let start = 0;
  let quote = "";
  let escaped = false;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      stack.push({ selector: css.slice(start, index).trim(), contentStart: index + 1 });
      start = index + 1;
    } else if (character === "}") {
      const block = stack.pop();
      if (block) {
        const body = css.slice(block.contentStart, index);
        if (!body.includes("{")) rules.push({ selector: block.selector, body });
      }
      start = index + 1;
    }
  }
  return rules;
}

function splitSelectors(selectorList) {
  const selectors = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors.filter(Boolean);
}

function declarations(body) {
  return body.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const separator = part.indexOf(":");
    return [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
  });
}

const allowedThemeProperties = new Set([
  "accent-color", "background", "background-attachment", "background-clip", "background-color",
  "background-image", "background-position", "background-repeat", "background-size",
  "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-radius", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius",
  "border-bottom-right-radius", "border-style", "box-shadow", "caret-color", "color", "color-scheme",
  "filter", "outline-color", "outline-style", "opacity", "text-shadow",
  "transition", "transition-delay", "transition-duration", "transition-property", "transition-timing-function",
]);

test("activity theme is optional and its complete removal leaves a buildable core", () => {
  const hasThemeLink = /href="\.\/frontend\/seasonal-effects\.css(?:\?[^"]*)?"/.test(indexHtml);
  assert.equal(hasThemeLink, seasonalCss !== null, "theme CSS presence and its explicit stylesheet link must match");
  assert.doesNotMatch(indexHtml, /syncSeasonalAnimation|seasonal-page-hidden/);
  assert.match(buildScript, /sourceIndexHtml\.matchAll/);
  assert.doesNotMatch(buildScript, /seasonal-effects\.css/);
});

test("activity CSS changes only visual properties on non-decorative selectors", () => {
  if (seasonalCss === null) return;
  const violations = [];
  for (const rule of leafRules(seasonalCss)) {
    for (const selector of splitSelectors(rule.selector)) {
      if (selector.includes("::")) continue;
      for (const [property] of declarations(rule.body)) {
        if (property.startsWith("--") && selector === ":root") continue;
        if (property.startsWith("--") || !allowedThemeProperties.has(property)) {
          violations.push(selector + " sets " + property);
        }
      }
    }
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("shared styles and DOM own toolbar grouping and responsive sizing", () => {
  for (const selector of [".toolbar-settings", ".toolbar-actions", ".class-settings", ".skill-damage-share-number-wrap", "@media(max-width:700px)"]) {
    assert.ok(sharedStyles.replace(/\s/g, "").includes(selector.replace(/\s/g, "")), "missing shared layout rule: " + selector);
  }
  assert.match(mainSource, /toolbarSettings\.className\s*=\s*'toolbar-settings'/);
  assert.match(mainSource, /classSettings\.className\s*=\s*'class-settings'/);
  assert.match(mainSource, /historyActions\.className\s*=\s*'history-actions'/);
});