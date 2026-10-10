import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

function minifyCss(source) {
  let output = "";
  let quote = "";
  let inComment = false;
  let pendingSpace = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] ?? "";

    if (inComment) {
      output += character;
      if (character === "*" && next === "/") {
        output += next;
        index += 1;
        inComment = false;
      }
      continue;
    }

    if (quote) {
      output += character;
      if (character === "\\" && next) {
        output += next;
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "/" && next === "*") {
      if (pendingSpace && output && !/[{};]/.test(output.at(-1))) output += " ";
      pendingSpace = false;
      output += "/*";
      index += 1;
      inComment = true;
      continue;
    }

    if (character === "\\" && next) {
      if (pendingSpace && output && !/[{};]/.test(output.at(-1))) output += " ";
      pendingSpace = false;
      output += character + next;
      index += 1;
      continue;
    }

    if (character === "\"" || character === "'") {
      if (pendingSpace && output && !/[{};]/.test(output.at(-1)) && !/[{};]/.test(character)) output += " ";
      pendingSpace = false;
      quote = character;
      output += character;
      continue;
    }

    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace && output && !/[{};]/.test(output.at(-1)) && !/[{};]/.test(character)) output += " ";
    pendingSpace = false;
    output += character;
  }

  return output.trim();
}

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
await mkdir(join(output, "data", "examples"), { recursive: true });
for (const file of await readdir(join(root, "data", "examples"))) {
  if (file.endsWith(".json") && !file.endsWith("-expected.json")) {
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
const sourceCellLabels = {
  "E76": "fixed-effect:master-beast",
  "E93": "fixed-effect:pet-skill",
  "Q37": "fixed-effect:raid-set",
  "Q53": "fixed-effect:weapon",
  "Q86": "fixed-effect:title-adaptability",
  "R86": "fixed-effect:title-defense-ignore",
  "T101": "fixed-effect:red-upper-crit-damage",
  "T102": "fixed-effect:maestro-aura",
  "B77": "combat-rate:yellow-beast-stone",
  "B103": "combat-rate:lowerwear-enhancement",
  "B105": "combat-rate:shoes-enhancement",
};
const legacySourceProvenance = JSON.parse(await readFile(join(root, "docs/data-maintenance/legacy-source-provenance.json"), "utf8"));
const overallPotentialSourceCells = legacySourceProvenance.sourceRecords.find(record =>
  record.sourceDocument === "data/master-beast-effects.json" && record.path === "overallPotentialSourceCells",
)?.value ?? {};
for (const [statKey, cell] of Object.entries(overallPotentialSourceCells)) {
  sourceCellLabels[cell] = `master-beast-potential:${statKey}`;
}
const anonymousSourceIds = new Map();
const privateMetadataKeys = new Set([
  "sourceSheet", "sourceSheets", "sourceCell", "notes", "note", "cells", "workbook", "sheet", "sheets",
  "calculationSheet", "extractedAt", "overallPotentialSourceCells", "dataUpdatedAt", "yellowRateSourceCell",
  "sourceRanges", "sourceCells", "sourceFormula", "optionSource", "effectOutputCells", "effectOutputRows",
  "countedInputRange", "countFormulaCell", "pieceCountInput", "elementInput", "colorInput", "inputRules",
  "selectorRange", "sourceRange", "calculationRow", "calculationRows", "formula",
]);
function publicData(value, key = "") {
  if (privateMetadataKeys.has(key)) return undefined;
  if (key === "source" && value && typeof value === "object") return undefined;
  if (key === "source" && typeof value === "string") return "遊戲資料設定";
  if ((key === "id" || key === "sourceId") && typeof value === "string" && value.startsWith("sheet:計算機!")) {
    const cell = value.slice("sheet:計算機!".length);
    if (sourceCellLabels[cell]) return sourceCellLabels[cell];
    if (!anonymousSourceIds.has(value)) anonymousSourceIds.set(value, `configured-source:${anonymousSourceIds.size + 1}`);
    return anonymousSourceIds.get(value);
  }
  if (Array.isArray(value)) return value.map(item => publicData(item)).filter(item => item !== undefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, child]) => [childKey, publicData(child, childKey)])
      .filter(([, child]) => child !== undefined));
  }
  return value;
}
const bundledDataJson = `${JSON.stringify(publicData(bundledData))}\n`;
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
console.log("Built static site in dist/. Run npm run preview to open it locally.");
