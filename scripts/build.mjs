import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
await cp(join(root, "index.html"), join(output, "index.html"));
await cp(join(root, "frontend", "styles.css"), join(output, "frontend", "styles.css"));
await writeFile(join(output, ".nojekyll"), "");
console.log("Built static site in dist/. Run npm run preview to open it locally.");
