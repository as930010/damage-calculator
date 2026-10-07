import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(root, "data");
const errors = [];
const require = createRequire(import.meta.url);

async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listJsonFiles(path) : entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }));
  return nested.flat();
}

const files = await listJsonFiles(dataRoot);
const documents = new Map();
for (const path of files) {
  const name = relative(root, path).replaceAll("\\", "/");
  try {
    documents.set(name, JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    errors.push(`${name}: JSON 無法解析（${error instanceof Error ? error.message : error}）`);
  }
}

const requiredFields = {
  "data/accessory-special-effects.json": ["schemaVersion", "groups"],
  "data/armor-appraisals.json": ["schemaVersion", "options", "slots"],
  "data/atma-effects.json": ["schemaVersion", "activeWhenPieceCountEquals", "rules"],
  "data/attack-parameters.json": ["schemaVersion", "classes", "weaponEnhancementFactors"],
  "data/attributes.json": ["schemaVersion", "attributes"],
  "data/chip-slots.json": ["schemaVersion", "slots"],
  "data/circuit-board-rules.json": ["schemaVersion", "statKeyBySheetName", "inputs"],
  "data/class-combat-effects.json": ["schemaVersion", "methods", "classes"],
  "data/class-damage-passives.json": ["schemaVersion", "critDamagePctByClass", "bossDamagePctByClass", "multiplicativeCritDamagePctByClass"],
  "data/classes.json": ["schemaVersion", "classes"],
  "data/color-set-effects.json": ["schemaVersion", "selectorCell", "options"],
  "data/combat-rate-source-rules.json": ["schemaVersion", "sources"],
  "data/equipment-layout.json": ["schemaVersion", "groups", "slots"],
  "data/equipment/accessories.json": ["schemaVersion", "items"],
  "data/equipment/chips.json": ["schemaVersion", "chips"],
  "data/equipment/left-ice.json": ["schemaVersion", "items"],
  "data/equipment/magic-stones.json": ["schemaVersion", "items"],
  "data/equipment/one-piece-costumes.json": ["schemaVersion", "items"],
  "data/equipment/right-ice-set-effects.json": ["schemaVersion", "selectionCells", "maxSelectedSets", "effects"],
  "data/equipment/right-ice.json": ["schemaVersion", "items"],
  "data/giant-magic-stones.json": ["schemaVersion", "selectorCells", "effectOutputRows", "options"],
  "data/innerwear-rules.json": ["schemaVersion", "baseLevel", "slots", "enhancementStats", "forgingAttack", "forgingBonuses"],
  "data/nephron-armor-rules.json": ["schemaVersion", "dataUpdatedAt", "transformations", "magazines", "levelLabels", "fields", "notes"],
  "data/master-beast-effects.json": ["schemaVersion", "armorSpiritStoneSetEffect", "spiritStoneColorSelector", "options", "customAttributeOptions"],
  "data/other-effect-options.json": ["schemaVersion", "consumables", "environments", "titles", "guildFountain", "binaryEffects", "peakOptions"],
  "data/parameters.json": ["schemaVersion", "characterBase", "fixedEffects", "optionalEffects", "conditionalEffects"],
  "data/pet-effects.json": ["schemaVersion", "options"],
  "data/raid-set-effects.json": ["schemaVersion", "sets"],
  "data/resonance-effects.json": ["schemaVersion", "selectorCells", "effects"],
  "data/simulator-equipment-mapping.json": ["schemaVersion", "selections", "magicStoneSelections"],
  "data/simulator-input-options.json": ["schemaVersion", "catalogs", "inputs"],
  "data/simulator-input-rules.json": ["schemaVersion", "innerwear", "lowerwearAlternatives", "circuitBoards", "chips", "weapon", "rightIceSetEffects"],
  "data/slots.json": ["schemaVersion", "slots"],
  "data/spirit-record-effects.json": ["schemaVersion", "classSelectors", "defaultMaxedStats", "branchBonuses", "traits"],
  "data/weapon-appraisals.json": ["schemaVersion", "groups"],
  "data/weapon-grade-options.json": ["schemaVersion", "selectorCell", "options", "colorGroups"],
  "data/weapon-growth.json": ["schemaVersion", "selectorCell", "levels"],
  "data/weapon-transformations.json": ["schemaVersion", "rules", "slots"],
  "data/examples/public-example-2026-09-28.json": ["schemaVersion", "Job", "values", "lowerwearAlternativeEnabled"],
};

for (const [name, fields] of Object.entries(requiredFields)) {
  const document = documents.get(name);
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    errors.push(`${name}: 根節點必須是 JSON 物件。`);
    continue;
  }
  for (const field of fields) {
    if (!(field in document) || document[field] === null) errors.push(`${name}: 缺少必要欄位 ${field}。`);
  }
  if (name.startsWith("data/") && !name.startsWith("data/examples/") && document.schemaVersion !== 1) {
    errors.push(`${name}: 不支援的資料結構版本 ${document.schemaVersion}，預期版本 1。`);
  }
  if (typeof document.dataUpdatedAt === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(document.dataUpdatedAt)) {
    errors.push(`${name}: dataUpdatedAt 必須使用 YYYY-MM-DD 格式。`);
  }
}

const attributes = documents.get("data/attributes.json")?.attributes;
const attributeKeys = new Set(Array.isArray(attributes) ? attributes.map((attribute) => attribute.key) : []);
if (!attributes || attributeKeys.size !== attributes.length) errors.push("data/attributes.json: 屬性清單缺少 key 或有重複 key。");

function validateStats(value, path) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateStats(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "stats" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const [statKey, amount] of Object.entries(child)) {
        if (!attributeKeys.has(statKey)) errors.push(`${path}.stats: 未定義屬性 ${statKey}。`);
        if (typeof amount !== "number" || !Number.isFinite(amount)) errors.push(`${path}.stats.${statKey}: 屬性值必須是有限數字。`);
      }
    } else validateStats(child, `${path}.${key}`);
  }
}

for (const [name, document] of documents) {
  validateStats(document, name);
  if (!document || typeof document !== "object") continue;
  const visitArrays = (value, path) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      const itemsWithIds = value.filter((item) => item && typeof item === "object" && "id" in item);
      if (itemsWithIds.length === value.length && value.length) {
        const ids = new Set();
        for (const [index, item] of value.entries()) {
          if (typeof item.id !== "string" || !item.id.trim()) errors.push(`${path}[${index}]: 缺少有效 id。`);
          else if (ids.has(item.id)) errors.push(`${path}: id 重複 ${item.id}。`);
          else ids.add(item.id);
        }
      }
      value.forEach((child, index) => visitArrays(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) visitArrays(child, `${path}.${key}`);
  };
  visitArrays(document, name);
}

const classes = documents.get("data/classes.json")?.classes;
const classIds = new Set(Array.isArray(classes) ? classes.map((entry) => entry.id) : []);
if (!Array.isArray(classes) || classIds.size !== classes.length) errors.push("data/classes.json: 職業清單缺少 id 或有重複 id。");

for (const classId of classIds) {
  for (const file of ["data/attack-parameters.json", "data/class-combat-effects.json", "data/class-damage-passives.json"]) {
    const document = documents.get(file);
    const section = file === "data/attack-parameters.json" ? document?.classes
      : file === "data/class-combat-effects.json" ? document?.classes
        : document?.critDamagePctByClass;
    if (!section || !(classId in section)) errors.push(`${file}: 缺少職業 ${classId} 的資料。`);
  }
}

const classDamagePassives = documents.get("data/class-damage-passives.json");
if (classDamagePassives) {
  for (const field of ["critDamagePctByClass", "bossDamagePctByClass"]) {
    const section = classDamagePassives[field];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      errors.push("data/class-damage-passives.json: " + field + " 必須是物件。");
      continue;
    }
    for (const classId of classIds) if (!(classId in section)) errors.push("data/class-damage-passives.json: " + field + " 缺少職業 " + classId + "。");
    for (const [classId, value] of Object.entries(section)) {
      if (!classIds.has(classId)) errors.push("data/class-damage-passives.json: " + field + " 包含未知職業 " + classId + "。");
      if (typeof value !== "number" || !Number.isFinite(value)) errors.push("data/class-damage-passives.json: " + field + "." + classId + " 必須是有限數字。");
    }
  }
  const multiplicative = classDamagePassives.multiplicativeCritDamagePctByClass;
  if (!multiplicative || typeof multiplicative !== "object" || Array.isArray(multiplicative)) {
    errors.push("data/class-damage-passives.json: multiplicativeCritDamagePctByClass 必須是物件。");
  } else {
    for (const classId of classIds) if (!(classId in multiplicative)) errors.push("data/class-damage-passives.json: multiplicativeCritDamagePctByClass 缺少職業 " + classId + "。");
    for (const [classId, values] of Object.entries(multiplicative)) {
      if (!classIds.has(classId)) errors.push("data/class-damage-passives.json: multiplicativeCritDamagePctByClass 包含未知職業 " + classId + "。");
      if (!Array.isArray(values) || values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
        errors.push("data/class-damage-passives.json: multiplicativeCritDamagePctByClass." + classId + " 必須是有限數值陣列。");
      }
    }
  }
}

const mapping = documents.get("data/simulator-equipment-mapping.json");
if (mapping) {
  const selectionCells = new Set();
  const references = [
    ...(mapping.selections ?? []).map((entry) => ({ ...entry, source: "selections" })),
    ...((mapping.magicStoneSelections?.inputGroups ?? []).map((entry) => ({ ...entry, catalogFile: mapping.magicStoneSelections.catalogFile, slotId: mapping.magicStoneSelections.slotId, source: "magicStoneSelections" }))),
  ];
  for (const entry of references) {
    if (selectionCells.has(entry.selectionCell)) errors.push(`data/simulator-equipment-mapping.json: 選擇儲存格重複 ${entry.selectionCell}。`);
    selectionCells.add(entry.selectionCell);
    const catalogPath = `data/${entry.catalogFile}`.replaceAll("\\", "/");
    const catalog = documents.get(catalogPath);
    if (!catalog) errors.push(`data/simulator-equipment-mapping.json: 找不到目錄 ${catalogPath}。`);
    else if (!catalog.items?.some((item) => item.slotId === entry.slotId)) errors.push(`data/simulator-equipment-mapping.json: ${catalogPath} 沒有部位 ${entry.slotId} 的項目。`);
  }

  const hash32 = (value) => {
    let hash = 2166136261;
    for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  };
  const transferIds = new Map();
  for (const [, document] of documents) for (const item of document?.items ?? []) {
    if (!item?.id) continue;
    const code = hash32(item.id);
    const previous = transferIds.get(code);
    if (previous && previous !== item.id) errors.push(`數字配裝 ID 碰撞：${previous} 與 ${item.id} 都對應 ${code}。`);
    else transferIds.set(code, item.id);
  }
}

const simulatorOptions = documents.get("data/simulator-input-options.json");
if (simulatorOptions) {
  const catalogIds = new Set((simulatorOptions.catalogs ?? []).map((catalog) => catalog.id));
  if (catalogIds.size !== (simulatorOptions.catalogs ?? []).length) errors.push("data/simulator-input-options.json: 選項目錄 id 重複。");
  for (const input of simulatorOptions.inputs ?? []) {
    if (!catalogIds.has(input.catalogId)) errors.push(`data/simulator-input-options.json: ${input.simulatorCells} 引用不存在的選項目錄 ${input.catalogId}。`);
    if (input.inputType !== "list") errors.push(`data/simulator-input-options.json: ${input.simulatorCells} 使用不支援的輸入類型 ${input.inputType}。`);
  }
}

const weaponGrades = documents.get("data/weapon-grade-options.json");
if (weaponGrades) {
  const gradesByName = new Map((weaponGrades.options ?? []).map(option => [option.name, option]));
  const groups = weaponGrades.colorGroups ?? [];
  if (groups.length !== 3) errors.push("data/weapon-grade-options.json: 武器魔力石必須有紅、藍、黃三組。");
  const allCells = groups.flatMap(group => group.selectorCells ?? []);
  if (allCells.length !== 27 || new Set(allCells).size !== 27) errors.push("data/weapon-grade-options.json: 三色魔力石必須各有 9 個不重複欄位。");
  for (const grade of gradesByName.keys()) {
    const totals = {};
    for (const group of groups) {
      if ((group.selectorCells ?? []).length !== 9) errors.push(`data/weapon-grade-options.json: ${group.name} 必須有 9 格。`);
      const option = group.options?.find(entry => entry.id === group.presetByGrade?.[grade]);
      if (!option) { errors.push(`data/weapon-grade-options.json: ${grade} 缺少 ${group.name} 預設。`); continue; }
      for (const [stat, value] of Object.entries(option.stats ?? {})) totals[stat] = (totals[stat] ?? 0) + value * 9;
    }
    const aggregate = gradesByName.get(grade)?.stats ?? {};
    for (const stat of new Set([...Object.keys(totals), ...Object.keys(aggregate)])) {
      if (totals[stat] !== aggregate[stat]) errors.push(`data/weapon-grade-options.json: ${grade} 預設加總 ${stat} 與工作表彙總不一致。`);
    }
  }
}

const typescriptPackagePath = require.resolve("typescript/package.json");
const typescriptPackage = JSON.parse(await readFile(typescriptPackagePath, "utf8"));
const typescriptCompiler = resolve(dirname(typescriptPackagePath), typescriptPackage.bin.tsc);
const contracts = spawnSync(process.execPath, [typescriptCompiler, "--ignoreConfig", "--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--resolveJsonModule", "--allowSyntheticDefaultImports", "--allowImportingTsExtensions", "--skipLibCheck", "scripts/data-contracts.ts"], { cwd: root, encoding: "utf8" });
if (contracts.error) errors.push(`TypeScript 資料合約檢查無法執行：${contracts.error.message}`);
else if (contracts.status !== 0) errors.push(`TypeScript 資料合約檢查失敗：\n${contracts.stdout}${contracts.stderr}`);

if (errors.length) {
  console.error(`資料檢查發現 ${errors.length} 個問題：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Data validation passed: ${documents.size} JSON files, required structures and types, stat keys, class and catalog references, and numeric equipment-code collisions.`);
}
