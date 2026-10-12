import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';

export const contentHash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const slash = path => path.replaceAll('\\', '/');

// Match the existing CSS whitespace-only compaction; preserve comments, strings and escapes.
export function minifyCss(source) {
  let output = '', quote = '', comment = false, space = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) {
      output += c;
      if (c === '*' && next === '/') { output += next; i++; comment = false; }
      continue;
    }
    if (quote) {
      output += c;
      if (c === '\\' && next) { output += next; i++; }
      else if (c === quote) quote = '';
      continue;
    }
    if (/\s/.test(c)) { space = true; continue; }
    if (space && output && !/[{};]/.test(output.at(-1)) && !/[{};]/.test(c)) output += ' ';
    space = false;
    if (c === '/' && next === '*') { output += '/*'; i++; comment = true; }
    else if (c === '\\' && next) { output += c + next; i++; }
    else { if (c === '"' || c === "'") quote = c; output += c; }
  }
  return output.trim();
}

async function dataFiles(directory, prefix = 'data') {
  const files = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const pair of await dataFiles(path, name)) files.set(...pair);
    else if (entry.isFile()) files.set(name, await readFile(path));
    else throw new Error(`Unsupported build data entry: ${path}`);
  }
  return files;
}

/** Bundle already compiled ESM once. Returns files in memory for version/update tests. */
export async function productionAssets({ root, compiled, buff = false, html, cssOverrides = {}, dataOverrides = {}, treeShaking = true, plugin }) {
  html ??= await readFile(join(root, 'index.html'), 'utf8');
  const files = new Map(), data = {}, css = [];
  for (const [path, original] of await dataFiles(join(compiled, 'data'))) {
    const bytes = dataOverrides[path] ?? original;
    const name = path.replace(/\.json$/, `.${contentHash(bytes)}.json`);
    files.set(name, bytes);
    data[path] = name;
  }
  const defines = { [buff ? '__BUFF_ASSET_PATHS__' : '__GAME_ASSET_PATHS__']: JSON.stringify(Object.fromEntries(
    Object.entries(data).filter(([name]) => name.endsWith('.json')).map(([name, hashed]) => [name.slice(5), hashed.slice(5)]))) };
  const outdir = resolve(root, 'site-dist/assets');
  const result = await build({ absWorkingDir: root, entryPoints: [join(compiled, 'frontend/main.js')],
    outdir, bundle: true, minify: true, treeShaking, splitting: true, format: 'esm', target: 'es2022',
    charset: 'utf8', entryNames: '[name]-[hash]', chunkNames: 'chunks/[name]-[hash]',
    define: defines, metafile: true, write: false, plugins: plugin ? [plugin] : [] });
  const js = {};
  let entry;
  for (const output of result.outputFiles) {
    const name = `assets/${slash(relative(outdir, output.path))}`;
    files.set(name, output.contents);
    const meta = result.metafile.outputs[slash(relative(root, output.path))];
    js[name] = { imports: meta.imports.filter(item => !item.external).map(item => ({
      path: slash(relative(resolve(root, 'site-dist'), resolve(root, item.path))), kind: item.kind,
    })) };
    if (meta.entryPoint === slash(relative(root, join(compiled, 'frontend/main.js')))) entry = name;
  }
  if (!entry) throw new Error('Missing production entry');
  html = html.replace(/href="\.\/frontend\/([^"?]+\.css)(?:\?[^"]*)?"/g, (_match, name) => {
    if (name.includes('/') || name.includes('\\') || css.some(item => item.source === name)) throw new Error('Invalid stylesheet reference');
    css.push({ source: name });
    return `href="__CSS_${css.length - 1}__"`;
  });
  for (const [i, item] of css.entries()) {
    const bytes = Buffer.from(minifyCss(cssOverrides[item.source] ?? await readFile(join(root, 'frontend', item.source), 'utf8')));
    item.path = `assets/${item.source.replace(/\.css$/, `-${contentHash(bytes)}.css`)}`;
    files.set(item.path, bytes);
    html = html.replace(`__CSS_${i}__`, `./${item.path}`);
  }
  if (!css.length) throw new Error('Missing production CSS');
  html = html.replace(/src="\.\/frontend\/main\.js(?:\?[^"]*)?"/, `src="./${entry}"`);
  if (!buff) html = html.replace('content="__BUILD_REVISION__"', `content="${contentHash(files.get(data['data/game-data.json']))}"`)
    .replace('</head>', `<meta name="game-data-url" content="./${data['data/game-data.json']}">\n</head>`);
  files.set('index.html', Buffer.from(html));
  files.set('.nojekyll', Buffer.alloc(0));
  const manifest = { format: 1, entry, js, css, data, files: Object.fromEntries(
    [...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => [name, { bytes: bytes.length, hash: contentHash(bytes) }])) };
  validateAssets(files, manifest);
  files.set('asset-manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { files, manifest, metafile: result.metafile };
}

export function validateAssets(files, manifest, prefix = '') {
  for (const [name, info] of Object.entries(manifest.files)) {
    const bytes = files.get(prefix + name);
    if (!bytes || bytes.length !== info.bytes || contentHash(bytes) !== info.hash) throw new Error(`Invalid asset: ${prefix}${name}`);
  }
  const html = files.get(prefix + 'index.html').toString();
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+\.(?:js|css))"/g)) {
    if (!files.has(prefix + match[1])) throw new Error(`Unresolved HTML asset: ${match[1]}`);
  }
  for (const item of Object.values(manifest.js)) for (const dependency of item.imports) {
    if (!files.has(prefix + dependency.path)) throw new Error(`Unresolved JS dependency: ${dependency.path}`);
  }
  for (const name of Object.values(manifest.data)) if (!files.has(prefix + name)) throw new Error(`Unresolved data: ${name}`);
  if (!html.includes(`src="./${manifest.entry}"`) || /__(?:BUILD|STYLESHEET)_REVISION__/.test(html)) throw new Error('Invalid production HTML');
}

export async function cleanOutput(root, name) {
  if (!['dist', 'site-dist'].includes(name)) throw new Error('Unexpected build directory');
  const path = resolve(root, name);
  if (dirname(path) !== resolve(root)) throw new Error('Build path escaped its root');
  const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error(`Refusing to clean non-directory or junction: ${path}`);
  // Check descendants before recursive removal; never follow user-created junctions.
  async function check(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error(`Refusing to clean build symlink: ${join(dir, item.name)}`);
      if (item.isDirectory()) await check(join(dir, item.name));
    }
  }
  if (info) await check(path);
  await rm(path, { recursive: true, force: true });
}

/** A manifest is published last; preview/CI require it before accepting the output. */
export async function writeProduction(root, files) {
  const manifest = JSON.parse(files.get('asset-manifest.json'));
  validateAssets(files, manifest);
  for (const page of manifest.pages ?? []) {
    validateAssets(files, JSON.parse(files.get(page)), page.slice(0, -'asset-manifest.json'.length));
  }
  await cleanOutput(root, 'site-dist');
  const output = resolve(root, 'site-dist');
  for (const [name, bytes] of [...files].filter(([name]) => name !== 'asset-manifest.json')) {
    await mkdir(dirname(join(output, name)), { recursive: true });
    await writeFile(join(output, name), bytes);
  }
  await writeFile(join(output, 'asset-manifest.json'), files.get('asset-manifest.json'));
}
