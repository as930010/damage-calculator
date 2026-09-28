import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getEquipmentOptionName } from "../dist/calculation/equipment-catalog.js";
import { parseLoadoutJson, serializeLoadout } from "../dist/frontend/loadout-transfer.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const [classes, mapping, simulatorInputs, manifest, masterBeast, layout, attack, innerwear, appraisals, chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, colorSetEffects, spiritRecord, otherEffects, pets, rightIceSets] = await Promise.all([
  read("data/classes.json"), read("data/simulator-equipment-mapping.json"),
  read("data/simulator-input-options.json"), read("data/manifest.json"), read("data/master-beast-effects.json"),
  read("data/equipment-layout.json"), read("data/attack-parameters.json"), read("data/innerwear-rules.json"),
  read("data/armor-appraisals.json"), read("data/equipment/chips.json"), read("data/chip-slots.json"),
  read("data/circuit-board-rules.json"), read("data/weapon-transformations.json"), read("data/weapon-growth.json"),
  read("data/weapon-appraisals.json"), read("data/weapon-grade-options.json"), read("data/giant-magic-stones.json"),
  read("data/color-set-effects.json"), read("data/spirit-record-effects.json"), read("data/other-effect-options.json"),
  read("data/pet-effects.json"), read("data/equipment/right-ice-set-effects.json"),
]);
const catalogFiles = [...new Set([...mapping.selections.map((item) => item.catalogFile), mapping.magicStoneSelections.catalogFile])];
const catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async (file) => [file, await read(`data/${file}`)])));
const data = { classes, mapping, simulatorInputs, manifest, masterBeast, catalogs, layout, attack, innerwear, appraisals, chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, colorSetEffects, spiritRecord, otherEffects, pets, rightIceSets };
const firstMapping = mapping.selections.find((entry) => catalogs[entry.catalogFile].items.some((item) => item.active && item.slotId === entry.slotId));
const firstItem = catalogs[firstMapping.catalogFile].items.find((item) => item.active && item.slotId === firstMapping.slotId);
const equipmentName = getEquipmentOptionName(firstItem, firstMapping.application);
const mappedCells = new Set([
  ...mapping.selections.map((entry) => entry.selectionCell),
  ...mapping.magicStoneSelections.inputGroups.map((entry) => entry.selectionCell),
]);
const firstInput = simulatorInputs.inputs.find((input) => {
  const cell = input.simulatorCells.trim();
  return /^[A-Z]+[0-9]+$/.test(cell) && !mappedCells.has(cell)
    && simulatorInputs.catalogs.find((catalog) => catalog.id === input.catalogId)?.options.some((option) => String(option.value).trim() !== "");
});
const inputCell = firstInput.simulatorCells.trim();
const firstOption = simulatorInputs.catalogs.find((catalog) => catalog.id === firstInput.catalogId).options.find((option) => String(option.value).trim() !== "");
const state = {
  schemaVersion: 2,
  classId: classes.classes.find((entry) => entry.active).id,
  values: { [firstMapping.selectionCell]: equipmentName, [inputCell]: String(firstOption.value), Z999: 123.45 },
  lowerwearAlternativeEnabled: true,
  masterBeastSpiritStoneColor: "綠",
  petSkillAttackEnabled: false,
};

test("numeric-code JSON export imports back to the same loadout", () => {
  const exported = serializeLoadout(state, data);
  const envelope = JSON.parse(exported.json);
  assert.equal(envelope.formatVersion, 2);
  assert.equal(typeof envelope.values[firstMapping.selectionCell], "number");
  assert.equal(envelope.values[inputCell], String(firstOption.value));
  assert.equal(envelope.values.Z999, 123.45);
  assert.deepEqual(parseLoadoutJson(exported.json, state, data).state, state);
  assert.deepEqual(exported.omittedFields, []);
});

test("the complete saved example round-trips and stays smaller than the previous name-based export", async () => {
  const saved = await read("data/examples/live-sheet-2026-09-28.json");
  const full = { ...saved, masterBeastSpiritStoneColor: "黃", petSkillAttackEnabled: true };
  const exported = serializeLoadout(full, data);
  const previousFormat = JSON.stringify({
    format: "damage-calculator-loadout", formatVersion: 1,
    exportedAt: "2026-09-28T00:00:00.000Z", loadout: full,
  }, null, 2);
  assert.deepEqual(exported.omittedFields, []);
  assert.deepEqual(parseLoadoutJson(exported.json, full, data).state, full);
  assert.ok(exported.json.length < previousFormat.length, `compact transfer is ${exported.json.length} bytes; previous format was ${previousFormat.length}`);
});

test("a removed equipment option clears only its cell and keeps the rest", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  const changedData = structuredClone(data);
  changedData.catalogs[firstMapping.catalogFile].items = changedData.catalogs[firstMapping.catalogFile].items.filter((item) => item.id !== firstItem.id);
  const result = parseLoadoutJson(JSON.stringify(exported), state, changedData);
  assert.equal(result.state.values[firstMapping.selectionCell], undefined);
  assert.equal(result.state.values[inputCell], String(firstOption.value));
  assert.equal(result.state.values.Z999, 123.45);
  assert.ok(result.clearedFields.includes(firstMapping.selectionCell));
});

test("a changed item label keeps the selected item by stable numeric ID", () => {
  const exported = serializeLoadout(state, data).json;
  const changedData = structuredClone(data);
  const item = changedData.catalogs[firstMapping.catalogFile].items.find((entry) => entry.id === firstItem.id);
  item.name = "更新後的測試名稱";
  const result = parseLoadoutJson(exported, state, changedData);
  assert.equal(result.state.values[firstMapping.selectionCell], getEquipmentOptionName(item, firstMapping.application));
  assert.ok(!result.clearedFields.includes(firstMapping.selectionCell));
});

test("corrupted option codes and invalid cells are cleared without losing valid selections", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  exported.values[inputCell] = "deleted-option";
  exported.values.BAD = {};
  const result = parseLoadoutJson(JSON.stringify(exported), state, data);
  assert.equal(result.state.values[inputCell], undefined);
  assert.equal(result.state.values.BAD, undefined);
  assert.equal(result.state.values[firstMapping.selectionCell], equipmentName);
  assert.ok(result.clearedFields.includes(inputCell));
  assert.ok(result.clearedFields.includes("BAD"));
});

test("deleted custom dropdown options clear only the affected field", () => {
  const customName = data.otherEffects.titles[0].name;
  const customState = { ...state, values: { ...state.values, B2: customName, B4: data.otherEffects.consumables[0].name } };
  const exported = JSON.parse(serializeLoadout(customState, data).json);
  const changedData = structuredClone(data);
  changedData.otherEffects.titles = changedData.otherEffects.titles.filter((option) => option.name !== customName);
  const result = parseLoadoutJson(JSON.stringify(exported), customState, changedData);
  assert.equal(result.state.values.B2, undefined);
  assert.equal(result.state.values.B4, customState.values.B4);
  assert.equal(result.state.values[firstMapping.selectionCell], equipmentName);
  assert.ok(result.clearedFields.includes("B2"));
});

test("legacy name-based files remain importable and unknown names become blank", () => {
  const legacy = {
    format: "damage-calculator-loadout",
    formatVersion: 1,
    loadout: { ...state, values: { ...state.values, [firstMapping.selectionCell]: "已刪除裝備" } },
  };
  const result = parseLoadoutJson(JSON.stringify(legacy), state, data);
  assert.equal(result.legacyFormat, true);
  assert.equal(result.state.values[firstMapping.selectionCell], undefined);
  assert.equal(result.state.values[inputCell], String(firstOption.value));
  assert.ok(result.clearedFields.includes(firstMapping.selectionCell));
});

test("malformed JSON and unsupported format versions are rejected", () => {
  assert.throws(() => parseLoadoutJson("{broken", state, data), /不是有效的 JSON/);
  assert.throws(() => parseLoadoutJson(JSON.stringify({ format: "damage-calculator-loadout", formatVersion: 99 }), state, data), /不支援/);
});
