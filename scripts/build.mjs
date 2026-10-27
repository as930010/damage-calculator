import { isPublishableDataFile, publicGameData } from './public-game-data.mjs';
import { cleanOutput, contentHash, minifyCss, productionAssets, writeProduction } from './production-assets.mjs';
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build as bundle } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const require = createRequire(import.meta.url);
const packagePath = require.resolve("typescript/package.json");
const compilerPackage = JSON.parse(await readFile(packagePath, "utf8"));
const compilerPath = resolve(dirname(packagePath), compilerPackage.bin.tsc);

// Remove only the generated dist directory inside this project.
if (dirname(output) !== root || output !== join(root, "dist")) {
  throw new Error("Invalid build output directory.");
}
await cleanOutput(root, 'site-dist');
await cleanOutput(root, 'dist');

const compilation = spawnSync(process.execPath, [compilerPath, "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
if (compilation.error) throw compilation.error;
if (compilation.status !== 0) process.exit(compilation.status ?? 1);

await mkdir(join(output, "frontend"), { recursive: true });
await mkdir(join(output, "data", "examples"), { recursive: true });
for (const file of await readdir(join(root, "data", "examples"))) {
  if (file.endsWith(".json") && isPublishableDataFile(file)) {
    await cp(join(root, "data", "examples", file), join(output, "data", "examples", file));
  }
}
const { GAME_DATA_FILES } = await import(pathToFileURL(join(output, "frontend", "data.js")).href);
const bundledData = Object.fromEntries(await Promise.all(Object.entries(GAME_DATA_FILES).map(async ([key, file]) => [
  key,
  JSON.parse(await readFile(join(root, "data", file), "utf8")),
])));
const mapping = bundledData.mapping;
const catalogFiles = [...new Set([...mapping.selections.map((entry) => entry.catalogFile), mapping.magicStoneSelections.catalogFile])];
bundledData.catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async (file) => [
  file,
  JSON.parse(await readFile(join(root, "data", file), "utf8")),
])));
const bundledDataJson = `${JSON.stringify(publicGameData(bundledData))}\n`;
await writeFile(join(output, "data", "game-data.json"), bundledDataJson);
const dataRevision = createHash("sha256").update(bundledDataJson).digest("hex").slice(0, 16);
const revisionResult = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
const buildRevision = revisionResult.status === 0 ? `${revisionResult.stdout.trim()}-${dataRevision}` : `build-${Date.now()}-${dataRevision}`;
const sourceIndexHtml = await readFile(join(root, "index.html"), "utf8");
const stylesheetFiles = [...sourceIndexHtml.matchAll(/href="\.\/frontend\/([^"?]+\.css)(?:\?[^"]*)?"/g)]
  .map((match) => match[1]);
if (!stylesheetFiles.length || new Set(stylesheetFiles).size !== stylesheetFiles.length) {
  throw new Error("The page must reference a unique set of local stylesheets.");
}
for (const file of stylesheetFiles) {
  if (file.includes("/") || file.includes("\\") || !file.endsWith(".css")) {
    throw new Error("Unsupported stylesheet path: " + file);
  }
}
const stylesheets = Object.fromEntries(await Promise.all(stylesheetFiles.map(async (file) => [
  file,
  minifyCss(await readFile(join(root, "frontend", file), "utf8")),
])));
const stylesheetInput = stylesheetFiles.map((file) => `${file}\0${stylesheets[file]}`).join("\n");
const stylesheetRevision = createHash("sha256").update(stylesheetInput).digest("hex").slice(0, 16);
const indexHtml = sourceIndexHtml
  .replaceAll("__BUILD_REVISION__", buildRevision)
  .replaceAll("__STYLESHEET_REVISION__", stylesheetRevision);
await writeFile(join(output, "index.html"), indexHtml);
for (const [file, content] of Object.entries(stylesheets)) {
  await writeFile(join(output, "frontend", file), content);
}
const simulatorBuild = spawnSync(process.execPath, [join(root, "features", "buff-simulator", "scripts", "build.mjs")], {
  cwd: root,
  stdio: "inherit",
});
if (simulatorBuild.error) throw simulatorBuild.error;
if (simulatorBuild.status !== 0) process.exit(simulatorBuild.status ?? 1);
await cp(join(root, "features", "buff-simulator", "dist"), join(output, "buff-simulator"), { recursive: true });
await writeFile(join(output, ".nojekyll"), "");
const optimized = await productionAssets({ root, compiled: output });
const simulatorRoot = join(root, 'features', 'buff-simulator', 'site-dist');
async function includeSimulator(dir, prefix) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) await includeSimulator(join(dir, item.name), prefix + item.name + '/');
    else if (item.isFile()) optimized.files.set(prefix + item.name, await readFile(join(dir, item.name)));
    else throw new Error('Unsupported simulator output');
  }
}
await includeSimulator(simulatorRoot, 'buff-simulator/');
const shellCssPath = optimized.manifest.css.find(item => item.source === 'site-shell.css')?.path;
const seasonalCssPath = optimized.manifest.css.find(item => item.source === 'seasonal-effects.css')?.path;
if (!shellCssPath || !optimized.files.has(shellCssPath)) throw new Error('Missing shared site shell CSS');
const optimizerTemplate = await readFile(join(root, 'features', 'ice-optimizer', 'index.html'), 'utf8');
const shellLink = 'href="./frontend/site-shell.css"';
const optimizerStyleLink = 'href="./frontend/styles.css"';
const optimizerSeasonalLink = '<link rel="stylesheet" href="__OPTIMIZER_SEASONAL_CSS_URL__" />';
if (optimizerTemplate.split(shellLink).length !== 2 || optimizerTemplate.split(optimizerStyleLink).length !== 2
  || optimizerTemplate.split(optimizerSeasonalLink).length !== 2) {
  throw new Error('Invalid optimizer CSS references');
}
const optimizerCss = Buffer.from(minifyCss(await readFile(join(root, 'features', 'ice-optimizer', 'frontend', 'styles.css'), 'utf8')));
const optimizerCssPath = `assets/ice-optimizer-styles-${contentHash(optimizerCss)}.css`;
optimized.files.set(optimizerCssPath, optimizerCss);
optimized.manifest.css.push({ source: 'ice-optimizer/styles.css', path: optimizerCssPath });
optimized.manifest.files[optimizerCssPath] = { bytes: optimizerCss.length, hash: contentHash(optimizerCss) };
const siteRoot = join(root, 'site-dist');
const optimizerEntryPath = join(output, 'features', 'ice-optimizer', 'frontend', 'main.js');
const workerEntryPath = join(output, 'features', 'ice-optimizer', 'frontend', 'worker.js');
const optimizerBundle = await bundle({
  absWorkingDir: root,
  entryPoints: { 'ice-optimizer': optimizerEntryPath, 'ice-worker': workerEntryPath },
  outdir: join(siteRoot, 'assets'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/ice-[name]-[hash]',
  bundle: true, splitting: true, minify: true, treeShaking: true,
  format: 'esm', platform: 'browser', target: 'es2022', charset: 'utf8',
  metafile: true, write: false,
});
const slash = value => value.replaceAll('\\', '/');
let optimizerEntryPathHashed, optimizerWorkerPathHashed;
for (const file of optimizerBundle.outputFiles) {
  const asset = slash(relative(siteRoot, file.path));
  optimized.files.set(asset, file.contents);
  optimized.manifest.files[asset] = { bytes: file.contents.length, hash: contentHash(file.contents) };
  const metadata = optimizerBundle.metafile.outputs[slash(relative(root, file.path))];
  if (!metadata) throw new Error('Missing optimizer bundle metadata');
  optimized.manifest.js[asset] = {
    imports: metadata.imports.filter(item => !item.external).map(item => ({
      path: slash(relative(siteRoot, resolve(root, item.path))), kind: item.kind,
    })),
  };
  const entry = metadata.entryPoint && slash(metadata.entryPoint);
  if (entry === slash(relative(root, optimizerEntryPath))) optimizerEntryPathHashed = asset;
  if (entry === slash(relative(root, workerEntryPath))) optimizerWorkerPathHashed = asset;
}
const gameDataPath = optimized.manifest.data['data/game-data.json'];
if (!optimizerEntryPathHashed || !optimizerWorkerPathHashed || !gameDataPath) {
  throw new Error('Missing optimizer entry, worker, or game data');
}
const optimizerHtml = Buffer.from(optimizerTemplate
  .replace(shellLink, `href="../${shellCssPath}"`)
  .replace(optimizerStyleLink, `href="../${optimizerCssPath}"`)
  .replace(optimizerSeasonalLink, seasonalCssPath
    ? `<link rel="stylesheet" href="../${seasonalCssPath}" />` : '')
  .replace('content="__OPTIMIZER_GAME_DATA_URL__"', `content="../${gameDataPath}"`)
  .replace('content="__OPTIMIZER_WORKER_URL__"', `content="../${optimizerWorkerPathHashed}"`)
  .replace('src="./frontend/main.js"', `src="../${optimizerEntryPathHashed}"`));
if (optimizerHtml.includes('__OPTIMIZER_') || [shellCssPath, optimizerCssPath, optimizerEntryPathHashed,
  optimizerWorkerPathHashed, gameDataPath].some(asset => !optimized.files.has(asset))) {
  throw new Error('Optimizer deployment references are incomplete');
}
optimized.files.set('ice-optimizer/index.html', optimizerHtml);
optimized.manifest.files['ice-optimizer/index.html'] = { bytes: optimizerHtml.length, hash: contentHash(optimizerHtml) };
optimized.manifest.pages = ['buff-simulator/asset-manifest.json'];
optimized.files.set('asset-manifest.json', Buffer.from(JSON.stringify(optimized.manifest, null, 2)+'\n'));
await writeProduction(root, optimized.files);
console.log('Built deployment in site-dist/; dist/ retains Node test modules. Run pnpm run preview.');
