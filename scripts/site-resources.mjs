import { seasonalStylesheetPattern, themeBootstrap, themeController } from './theme-resources.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contentHash, minifyCss } from './production-assets.mjs';

// Only the integrated deployment shares URLs. The standalone Buff output is untouched.
export function shareSimulatorCss(optimized) {
  const prefix = 'buff-simulator/';
  const manifestPath = prefix + 'asset-manifest.json';
  const manifest = JSON.parse(optimized.files.get(manifestPath));
  let html = optimized.files.get(prefix + 'index.html').toString();
  for (const source of ['site-shell.css', 'seasonal-effects.css']) {
    const shared = optimized.manifest.css.find(item => item.source === source);
    const local = manifest.css.find(item => item.source === source);
    if (!shared && !local) continue;
    if (!shared || !local) throw new Error(`Inconsistent shared stylesheet: ${source}`);
    const bytes = optimized.files.get(prefix + local.path);
    if (!bytes || !Buffer.from(bytes).equals(Buffer.from(optimized.files.get(shared.path)))) {
      throw new Error(`Shared stylesheet content differs: ${source}`);
    }
    const reference = `href="./${local.path}"`;
    if (html.split(reference).length !== 2) throw new Error(`Unexpected Buff stylesheet reference: ${source}`);
    html = html.replace(reference, `href="../${shared.path}"`);
    optimized.files.delete(prefix + local.path);
    delete manifest.files[local.path];
    local.path = '../' + shared.path;
  }
  const bytes = Buffer.from(html);
  optimized.files.set(prefix + 'index.html', bytes);
  manifest.files['index.html'] = { bytes: bytes.length, hash: contentHash(bytes) };
  optimized.files.set(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
}

// The common selector is always present; the seasonal stylesheet is optional.
export async function integrateThemes(root, optimized) {
  const seasonalCssPath = optimized.manifest.css.find(item => item.source === 'seasonal-effects.css')?.path;
  let themeCss = await readFile(join(root, 'theme-preview', 'themes.css'), 'utf8');
  for (const name of ['original', 'seasonal', 'harbor', 'forest', 'ember']) {
    const bytes = await readFile(join(root, 'theme-preview', 'cards', `__theme-card-${name}.svg`));
    const path = `assets/theme-card-${name}-${contentHash(bytes)}.svg`;
    optimized.files.set(path, bytes);
    optimized.manifest.files[path] = { bytes: bytes.length, hash: contentHash(bytes) };
    themeCss = themeCss.replace(`./__theme-card-${name}.svg`, `./${path.slice('assets/'.length)}`);
  }
  const themeCssBytes = Buffer.from(minifyCss(themeCss));
  const themeCssPath = `assets/themes-${contentHash(themeCssBytes)}.css`;
  const themeJsBytes = Buffer.from(themeController(await readFile(join(root, 'theme-preview', 'themes.js'), 'utf8')));
  const themeJsPath = `assets/themes-${contentHash(themeJsBytes)}.js`;
  for (const [path, bytes] of [[themeCssPath, themeCssBytes], [themeJsPath, themeJsBytes]]) {
    optimized.files.set(path, bytes);
    optimized.manifest.files[path] = { bytes: bytes.length, hash: contentHash(bytes) };
  }
  for (const [page, prefix] of [['index.html', './'], ['ice-optimizer/index.html', '../'], ['buff-simulator/index.html', '../'], ['transformation-score/index.html', '../']]) {
    let html = optimized.files.get(page).toString();
    const seasonalLinks = [...html.matchAll(seasonalStylesheetPattern)];
    if (seasonalLinks.length !== (seasonalCssPath ? 1 : 0)) throw new Error(`Unexpected seasonal stylesheet count in ${page}`);
    if (seasonalLinks.some(([link]) => !/\smedia=["']not all["']/.test(link) || !/\sdata-theme-seasonal(?:\s|\/?>)/.test(link))) {
      throw new Error(`Seasonal stylesheet must be inactive and marked in ${page}`);
    }
    html = seasonalCssPath
      ? html.replace(seasonalStylesheetPattern, link => link + themeBootstrap)
      : html.replace('</head>', themeBootstrap + '\n</head>');
    html = html.replace('</head>', `<!-- theme-control:start --><link rel="stylesheet" href="${prefix}${themeCssPath}"><script defer src="${prefix}${themeJsPath}"></script><!-- theme-control:end -->\n</head>`);
    const bytes = Buffer.from(html);
    optimized.files.set(page, bytes);
    if (page === 'buff-simulator/index.html') {
      const manifestPath = 'buff-simulator/asset-manifest.json';
      const manifest = JSON.parse(optimized.files.get(manifestPath));
      manifest.files['index.html'] = { bytes: bytes.length, hash: contentHash(bytes) };
      optimized.files.set(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    } else {
      optimized.manifest.files[page] = { bytes: bytes.length, hash: contentHash(bytes) };
    }
  }
}
