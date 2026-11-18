import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";

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
      const selector = css.slice(start, index).trim();
      const insideKeyframes = stack.some(parent => /^@(?:-webkit-)?keyframes\b/i.test(parent.selector));
      stack.push({ selector, contentStart: index + 1, insideKeyframes });
      start = index + 1;
    } else if (character === "}") {
      const block = stack.pop();
      if (block) {
        const body = css.slice(block.contentStart, index);
        if (!body.includes("{")) rules.push({ selector: block.selector, body, insideKeyframes: block.insideKeyframes });
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
  "backdrop-filter", "filter", "outline-color", "opacity", "text-shadow",
]);

test("activity theme is optional and its complete removal leaves a buildable core", () => {
  const hasThemeLink = /href="\.\/frontend\/seasonal-effects\.css(?:\?[^"]*)?"/.test(indexHtml);
  assert.equal(hasThemeLink, seasonalCss !== null, "theme CSS presence and its explicit stylesheet link must match");
  assert.doesNotMatch(indexHtml, /syncSeasonalAnimation|seasonal-page-hidden/);
  assert.match(buildScript, /sourceIndexHtml\.matchAll/);
  assert.match(buildScript, /seasonalCssPath\s*\?/);
});

test("source HTML defaults to original when scripts never execute", async () => {
  for (const file of ['index.html', 'features/buff-simulator/index.html',
    'features/ice-optimizer/index.html', 'features/transformation-score/index.html']) {
    const dom = new JSDOM(await readFile(resolve(root, file), "utf8"));
    try {
      const { document } = dom.window;
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
      const seasonal = links.filter(link => /seasonal-effects|__OPTIMIZER_SEASONAL_CSS_URL__|__SCORE_SEASONAL__/.test(link.getAttribute("href")));
      assert.equal(seasonal.length, seasonalCss === null ? 0 : 1, file);
      if (seasonal.length) {
        assert.equal(seasonal[0].media, "not all", file + " must not apply activity tokens without JavaScript");
        assert.ok(seasonal[0].hasAttribute("data-theme-seasonal"), file);
      }
      assert.ok(links.some(link => /(?:^|\/)styles\.css(?:\?|$)/.test(link.getAttribute("href"))), file + " retains core CSS");
      assert.equal(document.documentElement.dataset.previewTheme, undefined, file);
      assert.equal(document.querySelector(".theme-trigger"), null, file);
    } finally { dom.window.close(); }
  }
});

const sharedThemeColors = ["--site-border", "--site-surface", "--site-text", "--site-muted",
  "--site-action-surface", "--site-action-edge", "--site-control-surface", "--site-field-surface",
  "--site-control-hover", "--site-control-edge", "--site-control-hover-edge",
  "--site-control-disabled", "--site-control-disabled-text", "--site-focus-ring",
  "--site-danger", "--site-warning", "--site-success"];

test("activity CSS changes only visual properties on non-decorative selectors", () => {
  if (seasonalCss === null) return;
  const violations = [];
  for (const rule of leafRules(seasonalCss)) {
    for (const selector of splitSelectors(rule.selector)) {
      // Decorative generated shapes may have dimensions. Placeholder/backdrop
      // selectors remain subject to the same core-layout boundary as controls.
      if (/::(?:before|after)$/.test(selector)) continue;
      for (const [property, value] of declarations(rule.body)) {
        if (rule.insideKeyframes) {
          if (!["transform", "opacity"].includes(property)) violations.push(selector + " sets " + property + " in keyframes");
          continue;
        }
        if (selector.includes(":focus") && ["outline", "outline-style"].includes(property) && /^(?:0(?:\s|$)|none\b)/i.test(value)) {
          violations.push(selector + " hides its focus indicator");
        }
        if (property.startsWith("--") && selector === ":root") continue;
        if (selector === "body.site-page" && sharedThemeColors.includes(property)
          && /^(?:var\(--[\w-]+\)|color-mix\(in srgb, var\(--[\w-]+\), var\(--[\w-]+\) \d+%\))$/.test(value)) continue;
        // Equipment progress endpoints are colors only; progress percentages and layout stay in core CSS.
        if ([".beast-accessory-slot", ":is(.gear-slot,.beast-accessory-slot)"].includes(selector) && /^--slot-(?:normal-[ab]|hover-[ab]|edge)$/.test(property)
          && /^(?:#[\da-f]{3,8}|rgb\([^;]+\)|color-mix\([^;]+\))$/i.test(value)) continue;
        // These component-scoped tokens only supply the existing clear-button text colors.
        if (selector === ".picker-control" && /^--picker-clear(?:-hover)?-color$/.test(property)
          && /^#[\da-f]{3,8}$/i.test(value)) continue;
        if (selector === "body.site-page-buff"
          && /^--(?:bg|panel|panel-strong|line|text|muted|accent|accent-soft|gold)$/.test(property)) continue;
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

// Evaluate the actual styles on representative DOM. jsdom does not evaluate
// viewport media queries, so flatten the active rules for each tested width.
// Real-browser geometry and interactive states are checked in Production Preview.
function cssAtWidth(sources, width) {
  const parser = new JSDOM("<!doctype html>");
  const active = [];
  function visit(rules) {
    for (const rule of rules) {
      if (rule.type === 1) active.push(rule.cssText);
      else if (rule.type === 4) {
        const condition = rule.conditionText;
        if (condition.includes("prefers-reduced-motion")) continue;
        const minimums = [...condition.matchAll(/min-width\s*:\s*(\d+)px/g)];
        const maximums = [...condition.matchAll(/max-width\s*:\s*(\d+)px/g)];
        if (minimums.every(match => width >= Number(match[1])) && maximums.every(match => width <= Number(match[1]))) visit(rule.cssRules);
      }
    }
  }
  for (const source of sources) {
    const element = parser.window.document.createElement("style");
    element.textContent = source;
    parser.window.document.head.append(element);
    assert.ok(element.sheet, "stylesheet must parse");
    visit(element.sheet.cssRules);
  }
  parser.window.close();
  return active.join("\n");
}

const componentMarkup = `<div class="app-shell"><main class="workbench"><div class="canvas-title-input"><div class="field">
  <label>稱號</label><div class="picker-control"><input></div>
</div></div><section class="results-panel"><section class="damage-panel"><div class="damage-summary">
  <div>最小</div><div>最大</div><div class="final-damage">最終</div>
</div></section></section></main></div>`;
const widths = [1280, 701, 700, 601, 600, 441, 440, 390, 375];

test("core CSS owns damage-summary and title layout without activity CSS", async () => {
  const polish = await readFile(resolve(root, "frontend/polish.css"), "utf8");
  for (const width of widths) {
    const dom = new JSDOM(`<!doctype html><style>${cssAtWidth([sharedStyles, polish], width)}</style>${componentMarkup}`);
    try {
      const style = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
      assert.equal(style(".damage-summary").gridTemplateColumns, "repeat(3,minmax(0,1fr))", `damage columns at ${width}`);
      assert.equal(style(".damage-summary").gap, width <= 700 ? "8px" : "12px");
      assert.equal(style(".damage-summary").padding, width <= 700 ? "12px" : "16px 22px 22px");
      assert.equal(style(".damage-summary>div").minHeight, width <= 700 ? "76px" : "88px");
      assert.equal(style(".canvas-title-input").width, width <= 700 ? "190px" : "min(32%, 210px)");
      assert.equal(style(".canvas-title-input").left, width <= 700 ? "110px" : "max(82px, 19% - 62.5px)");
      assert.equal(style(".canvas-title-input .field").display, "grid");
      assert.equal(style(".canvas-title-input .field").gap, "8px");
    } finally { dom.window.close(); }
  }
});

test("Buff uses the current shared header and mobile navigation without activity CSS", async () => {
  const [buff, shell, html] = await Promise.all([
    readFile(resolve(root, "features/buff-simulator/frontend/styles.css"), "utf8"),
    readFile(resolve(root, "frontend/site-shell.css"), "utf8"),
    readFile(resolve(root, "features/buff-simulator/index.html"), "utf8"),
  ]);
  for (const width of widths) {
    const dom = new JSDOM(html);
    try {
      const element = dom.window.document.createElement("style");
      element.textContent = cssAtWidth([buff, shell], width);
      dom.window.document.head.append(element);
      const style = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
      assert.equal(style(".site-header").minHeight, "72px");
      assert.equal(style(".site-header").display, "grid");
      assert.equal(style(".site-header").gridTemplateColumns, width <= 700 ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, max-content)");
      assert.equal(style(".site-header").gap, width <= 700 ? "8px" : "14px");
      assert.equal(style(".site-tabs").gridTemplateColumns, "minmax(0, 5fr) minmax(0, 7fr) minmax(0, 6fr) minmax(0, 6fr)");
      assert.equal(dom.window.document.querySelectorAll(".site-tabs a").length, 4);
      assert.equal(style(".site-tabs a").minHeight, "44px");
      assert.equal(style(".site-developer > .developer-mobile").display, width <= 700 ? "flex" : "none");
    } finally { dom.window.close(); }
  }
});

test("shared control geometry and state rules apply in every theme while the original palette stays isolated", async () => {
  const shell = await readFile(resolve(root, "frontend/site-shell.css"), "utf8");
  const dom = new JSDOM('<!doctype html><link rel="stylesheet" data-theme-seasonal media="not all"><body class="site-page"></body>');
  try {
    const {document} = dom.window;
    const style = document.createElement("style");
    style.textContent = shell;
    document.head.append(style);
    const token = name => dom.window.getComputedStyle(document.body).getPropertyValue(name).trim();
    const rules = [...style.sheet.cssRules];
    const shared = rules.find(rule => rule.style?.getPropertyValue("--site-control-height"));
    assert.ok(shared, "shared controls must be in a CSS rule that the browser can parse");
    assert.ok(token("--site-control-height"));
    assert.ok(token("--site-control-compact"));
    assert.ok(token("--site-focus-ring"));
    assert.notEqual(token("--site-control-disabled"), token("--site-field-surface"));

    const shape = ["--site-control-height", "--site-control-compact", "--site-control-radius",
      "--site-control-label", "--site-control-gap"];
    const geometry = shape.map(token);
    const controlRules = [...shared.cssRules];
    const disabled = controlRules.find(rule => rule.selectorText?.includes(":is(button, input, select, textarea):disabled"));
    assert.equal(disabled.style.getPropertyValue("background"), "var(--site-control-disabled)");
    assert.equal(disabled.style.getPropertyValue("opacity"), "1");
    const focus = controlRules.find(rule => rule.style?.getPropertyValue("outline").includes("var(--site-focus-ring)"));
    assert.match(focus.selectorText, /:focus-visible/);
    assert.match(focus.selectorText, /:has\(> input:focus-visible\)/);
    assert.equal(focus.style.getPropertyValue("box-shadow"), "none");
    const selected = controlRules.find(rule => rule.selectorText?.includes('[aria-selected="true"]') && rule.style.getPropertyValue("background"));
    assert.equal(selected.style.getPropertyValue("background"), "var(--site-action-surface)");

    for (const palette of ["harbor", "forest", "ember"]) {
      document.documentElement.dataset.previewTheme = palette;
      assert.deepEqual(shape.map(token), geometry, palette);
      assert.equal(token("--site-focus-ring"), "", "original focus must not leak into " + palette);
    }
    delete document.documentElement.dataset.previewTheme;
    document.querySelector("link[data-theme-seasonal]").media = "all";
    assert.deepEqual(shape.map(token), geometry, "seasonal");
    assert.equal(token("--site-focus-ring"), "", "original focus must not leak into seasonal");
    document.querySelector("link[data-theme-seasonal]").media = "not all";
    assert.ok(token("--site-focus-ring"));
  } finally { dom.window.close(); }
});

test("the palette and seasonal sheets supply the same control color roles", async () => {
  const palette = await readFile(resolve(root, "theme-preview/themes.css"), "utf8");
  const shell = await readFile(resolve(root, "frontend/site-shell.css"), "utf8");
  assert.ok(seasonalCss?.length || !indexHtml.includes("data-theme-seasonal"), "enabled seasonal sheet must be readable");
  for (const source of [palette, seasonalCss].filter(Boolean)) {
    const dom = new JSDOM("<!doctype html>");
    try {
      const style = dom.window.document.createElement("style");
      style.textContent = source;
      dom.window.document.head.append(style);
      const mapping = [...style.sheet.cssRules].find(rule => rule.style?.getPropertyValue("--site-focus-ring"));
      assert.ok(mapping, "theme needs a color mapping for shared controls");
      for (const role of sharedThemeColors) assert.match(mapping.style.getPropertyValue(role), /var\(--/, role);
      assert.equal(mapping.style.getPropertyValue("--site-control-height"), "", "geometry belongs in Site Shell");
    } finally { dom.window.close(); }
  }
  const primary = shell.match(/& :where\(#optimizer-start, \.optimizer-apply\) \{[\s\S]*?\}/)?.[0];
  assert.match(primary, /var\(--site-action-surface\)/);
  assert.doesNotMatch(shell, /:where\([^\n]*(?:#profile-save|#baseline)/,
    "home save and baseline must use ordinary action rules");
  if (seasonalCss) assert.doesNotMatch(seasonalCss, /^#baseline\b/m, "seasonal baseline must not have a separate highlight");
});
