import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
await rm(output, { recursive: true, force: true });

const compilation = spawnSync(process.execPath, [compilerPath, "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
if (compilation.error) throw compilation.error;
if (compilation.status !== 0) process.exit(compilation.status ?? 1);

await mkdir(join(output, "frontend"), { recursive: true });
await cp(join(root, "data"), join(output, "data"), { recursive: true });
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
const bundledDataJson = `${JSON.stringify(bundledData)}\n`;
await writeFile(join(output, "data", "game-data.json"), bundledDataJson);
const dataRevision = createHash("sha256").update(bundledDataJson).digest("hex").slice(0, 16);
const revisionResult = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
const buildRevision = revisionResult.status === 0 ? `${revisionResult.stdout.trim()}-${dataRevision}` : `build-${Date.now()}-${dataRevision}`;
const indexHtml = (await readFile(join(root, "index.html"), "utf8")).replaceAll("__BUILD_REVISION__", buildRevision);
await writeFile(join(output, "index.html"), indexHtml);
await cp(join(root, "frontend", "styles.css"), join(output, "frontend", "styles.css"));
await cp(join(root, "frontend", "polish.css"), join(output, "frontend", "polish.css"));
await writeFile(join(output, ".nojekyll"), "");
console.log("Built static site in dist/. Run npm run preview to open it locally.");
