import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(root, "data");
const errors = [];

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
  if (!name.startsWith("data/equipment/") || !document || !Array.isArray(document.items)) continue;
  const ids = new Set();
  for (const [index, item] of document.items.entries()) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) errors.push(`${name}.items[${index}]: 缺少有效 id。`);
    else if (ids.has(item.id)) errors.push(`${name}.items: id 重複 ${item.id}。`);
    else ids.add(item.id);
    if (typeof item?.name !== "string" || !item.name.trim()) errors.push(`${name}.items[${index}]: 缺少有效名稱。`);
    if (typeof item?.slotId !== "string" || !item.slotId.trim()) errors.push(`${name}.items[${index}]: 缺少有效 slotId。`);
  }
}

const classes = documents.get("data/classes.json")?.classes;
const classIds = new Set(Array.isArray(classes) ? classes.map((entry) => entry.id) : []);
if (!Array.isArray(classes) || classIds.size !== classes.length) errors.push("data/classes.json: 職業清單缺少 id 或有重複 id。");

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
}

const simulatorOptions = documents.get("data/simulator-input-options.json");
if (simulatorOptions) {
  const catalogIds = new Set((simulatorOptions.catalogs ?? []).map((catalog) => catalog.id));
  for (const input of simulatorOptions.inputs ?? []) {
    if (!catalogIds.has(input.catalogId)) errors.push(`data/simulator-input-options.json: ${input.simulatorCells} 引用不存在的選項目錄 ${input.catalogId}。`);
  }
}

if (errors.length) {
  console.error(`資料檢查發現 ${errors.length} 個問題：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Data validation passed: parsed ${documents.size} JSON files and checked stat keys, equipment references, and option catalog references.`);
}
