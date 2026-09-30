import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
await rm(output, { recursive: true, force: true });
const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir(join(output, "frontend"), { recursive: true });
await cp(join(root, "data"), join(output, "data"), { recursive: true });
await cp(join(root, "frontend", "styles.css"), join(output, "frontend", "styles.css"));
await cp(join(root, "index.html"), join(output, "index.html"));
await writeFile(join(output, ".nojekyll"), "");
console.log("Static site built in dist/.");
