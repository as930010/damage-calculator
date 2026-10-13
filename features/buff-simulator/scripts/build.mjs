import { cleanOutput, productionAssets, writeProduction } from '../../../scripts/production-assets.mjs';
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
if (dirname(output) !== root || output !== join(root, "dist")) {
  throw new Error("Refusing to clean an unexpected build directory");
}

const require = createRequire(import.meta.url);
const packagePath = require.resolve("typescript/package.json");
const compiler = JSON.parse(await readFile(packagePath, "utf8"));
const tsc = resolve(dirname(packagePath), compiler.bin.tsc);
await cleanOutput(root, 'site-dist');
await cleanOutput(root, 'dist');
const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir(join(output, "frontend"), { recursive: true });
await cp(join(root, "data"), join(output, "data"), { recursive: true });
// Authoring notes do not need to be downloaded with runtime calculation data.
function runtimeData(value) {
  if (Array.isArray(value)) return value.map(runtimeData);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== "note")
      .map(([key, child]) => [key, runtimeData(child)]));
  }
  return value;
}
async function compactRuntimeJson(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compactRuntimeJson(path);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const document = JSON.parse(await readFile(path, "utf8"));
      await writeFile(path, JSON.stringify(runtimeData(document)) + "\n");
    }
  }
}
await compactRuntimeJson(join(output, "data"));
await cp(join(root, "frontend", "styles.css"), join(output, "frontend", "styles.css"));
await cp(join(root, "index.html"), join(output, "index.html"));
await writeFile(join(output, ".nojekyll"), "");
await writeProduction(root, (await productionAssets({ root, compiled: output, buff: true })).files);
console.log('Buff deployment built in site-dist/; Node modules in dist/.');
