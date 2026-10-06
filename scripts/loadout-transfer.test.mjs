import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getEquipmentOptionName } from "../dist/calculation/equipment-catalog.js";
import { parseLoadoutJson, serializeLoadout } from "../dist/frontend/loadout-transfer.js";
import { codeForFieldId, isFieldId } from "../dist/frontend/field-ids.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const [classes, mapping, simulatorInputs, manifest, masterBeast, layout, attack, innerwear, nephronArmor, appraisals, chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, colorSetEffects, spiritRecord, otherEffects, pets, rightIceSets] = await Promise.all([
  read("data/classes.json"), read("data/simulator-equipment-mapping.json"),
  read("data/simulator-input-options.json"), read("data/manifest.json"), read("data/master-beast-effects.json"),
  read("data/equipment-layout.json"), read("data/attack-parameters.json"), read("data/innerwear-rules.json"), read("data/nephron-armor-rules.json"),
  read("data/armor-appraisals.json"), read("data/equipment/chips.json"), read("data/chip-slots.json"),
  read("data/circuit-board-rules.json"), read("data/weapon-transformations.json"), read("data/weapon-growth.json"),
  read("data/weapon-appraisals.json"), read("data/weapon-grade-options.json"), read("data/giant-magic-stones.json"),
  read("data/color-set-effects.json"), read("data/spirit-record-effects.json"), read("data/other-effect-options.json"),
  read("data/pet-effects.json"), read("data/equipment/right-ice-set-effects.json"),
]);
const catalogFiles = [...new Set([...mapping.selections.map((item) => item.catalogFile), mapping.magicStoneSelections.catalogFile])];
const catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async (file) => [file, await read(`data/${file}`)])));
const data = { classes, mapping, simulatorInputs, manifest, masterBeast, catalogs, layout, attack, innerwear, nephronArmor, appraisals, chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, colorSetEffects, spiritRecord, otherEffects, pets, rightIceSets };
const semanticState = (value) => ({
  ...value,
  schemaVersion: 3,
  transcendenceSkillDamageSharePct: Number.isInteger(value.transcendenceSkillDamageSharePct) && value.transcendenceSkillDamageSharePct >= 0 && value.transcendenceSkillDamageSharePct <= 100
    ? value.transcendenceSkillDamageSharePct : 100,
  values: Object.fromEntries(Object.entries(value.values).filter(([fieldId]) => isFieldId(fieldId))),
});
const firstMapping = mapping.selections.find((entry) => catalogs[entry.catalogFile].items.some((item) => item.active && item.slotId === entry.slotId));
const firstMappingFieldId = firstMapping.selectionCell;
const firstItem = catalogs[firstMapping.catalogFile].items.find((item) => item.active && item.slotId === firstMapping.slotId);
const equipmentName = getEquipmentOptionName(firstItem, firstMapping.application);
const mappedCells = new Set([
  ...mapping.selections.map((entry) => entry.selectionCell),
  ...mapping.magicStoneSelections.inputGroups.map((entry) => entry.selectionCell),
]);
const firstInput = simulatorInputs.inputs.find((input) => {
  const cell = input.simulatorCells.trim();
  const fieldId = cell;
  return isFieldId(fieldId) && !mappedCells.has(fieldId)
    && simulatorInputs.catalogs.find((catalog) => catalog.id === input.catalogId)?.options.some((option) => String(option.value).trim() !== "");
});
const inputCell = firstInput.simulatorCells.trim();
const inputFieldId = isFieldId(inputCell) ? inputCell : undefined;
const firstOption = simulatorInputs.catalogs.find((catalog) => catalog.id === firstInput.catalogId).options.find((option) => String(option.value).trim() !== "");
const state = {
  schemaVersion: 3,
  Job: classes.classes.find((entry) => entry.active).id,
  values: { [firstMappingFieldId]: equipmentName, [inputFieldId]: String(firstOption.value), Z999: 123.45 },
  lowerwearAlternativeEnabled: true,
  masterBeastSpiritStoneColor: "綠",
  petSkillAttackEnabled: false,
  transcendenceSkillDamageSharePct: 83,
};

test("numeric-code JSON export imports back to the same loadout", () => {
  const exported = serializeLoadout(state, data);
  const envelope = JSON.parse(exported.json);
  assert.equal(envelope.formatVersion, 3);
  assert.equal(envelope.Job, state.Job);
  assert.equal(envelope.transcendenceSkillDamageSharePct, 83);
  assert.equal(typeof envelope.values[String(codeForFieldId(firstMappingFieldId))], "number");
  assert.equal(envelope.values[String(codeForFieldId(inputFieldId))], String(firstOption.value));
  assert.equal(envelope.values.Z999, undefined);
  assert.deepEqual(parseLoadoutJson(exported.json, state, data).state, semanticState(state));
  assert.deepEqual(exported.omittedFields, ["Z999"]);
});

test("older loadout exports default skill damage share to 100% transcendence", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  delete exported.transcendenceSkillDamageSharePct;
  const imported = parseLoadoutJson(JSON.stringify(exported), state, data).state;
  assert.equal(imported.transcendenceSkillDamageSharePct, 100);
});

test("legacy glove circuit Transcendence choice migrates to the combined single-skill option", () => {
  const gloveCircuit = circuits.inputs.find(entry => entry.slot === "gloves");
  const legacyState = { ...state, values: { ...state.values, [gloveCircuit.attributeCell]: "超越技傷%" } };
  const exported = serializeLoadout(legacyState, data);
  const imported = parseLoadoutJson(exported.json, state, data);
  assert.equal(imported.state.values[gloveCircuit.attributeCell], "單技傷%");
});

test("portrait awakening damage values round-trip and one-sided allocations complement to five", () => {
  const portrait = otherEffects.portraitAwakening;
  const validState = {
    ...state,
    values: { ...state.values, [portrait.strongCell]: 2, [portrait.transcendenceCell]: 3 },
  };
  const exported = JSON.parse(serializeLoadout(validState, data).json);
  assert.equal(exported.values[String(codeForFieldId(portrait.strongCell))], 2);
  assert.equal(exported.values[String(codeForFieldId(portrait.transcendenceCell))], 3);
  assert.deepEqual(parseLoadoutJson(JSON.stringify(exported), state, data).state, semanticState(validState));

  const oneSidedState = { ...state, values: { ...state.values, [portrait.transcendenceCell]: 4 } };
  const oneSidedExport = JSON.parse(serializeLoadout(oneSidedState, data).json);
  assert.equal(oneSidedExport.values[String(codeForFieldId(portrait.strongCell))], 1);
  assert.equal(oneSidedExport.values[String(codeForFieldId(portrait.transcendenceCell))], 4);

  exported.values[String(codeForFieldId(portrait.strongCell))] = 2;
  exported.values[String(codeForFieldId(portrait.transcendenceCell))] = 4;
  const normalizedImport = parseLoadoutJson(JSON.stringify(exported), state, data);
  assert.equal(normalizedImport.state.values[portrait.strongCell], 1);
  assert.equal(normalizedImport.state.values[portrait.transcendenceCell], 4);
  assert.ok(normalizedImport.clearedFields.includes(portrait.strongCell));
});

test("colored weapon magic-stone selections round-trip as compact numeric-code fields", () => {
  const values = {};
  for (const group of weaponGrades.colorGroups) {
    values[group.selectorCells[0]] = group.options[0].name;
  }
  const configured = { ...state, values: { ...state.values, [weaponGrades.selectorCell]: "深淵", ...values } };
  const exported = serializeLoadout(configured, data);
  assert.deepEqual(parseLoadoutJson(exported.json, state, data).state, semanticState(configured));
  assert.equal(Object.keys(values).length, 3);
  assert.ok(Object.keys(values).every(fieldId => Number.isInteger(codeForFieldId(fieldId))));
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
  assert.deepEqual(parseLoadoutJson(exported.json, full, data).state, semanticState(full));
  assert.ok(exported.json.length < previousFormat.length, `compact transfer is ${exported.json.length} bytes; previous format was ${previousFormat.length}`);
});

test("a removed equipment option clears only its cell and keeps the rest", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  const changedData = structuredClone(data);
  changedData.catalogs[firstMapping.catalogFile].items = changedData.catalogs[firstMapping.catalogFile].items.filter((item) => item.id !== firstItem.id);
  const result = parseLoadoutJson(JSON.stringify(exported), state, changedData);
  const selectionFieldId = firstMappingFieldId;
  assert.equal(result.state.values[selectionFieldId], undefined);
  assert.equal(result.state.values[inputFieldId], String(firstOption.value));
  assert.equal(result.state.values.Z999, undefined);
  assert.ok(result.clearedFields.includes(selectionFieldId));
});

test("a changed item label keeps the selected item by stable numeric ID", () => {
  const exported = serializeLoadout(state, data).json;
  const changedData = structuredClone(data);
  const item = changedData.catalogs[firstMapping.catalogFile].items.find((entry) => entry.id === firstItem.id);
  item.name = "更新後的測試名稱";
  const result = parseLoadoutJson(exported, state, changedData);
  const selectionFieldId = firstMappingFieldId;
  assert.equal(result.state.values[selectionFieldId], getEquipmentOptionName(item, firstMapping.application));
  assert.ok(!result.clearedFields.includes(selectionFieldId));
});

test("corrupted option codes and invalid cells are cleared without losing valid selections", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  exported.values[String(codeForFieldId(inputFieldId))] = "deleted-option";
  exported.values.BAD = {};
  const result = parseLoadoutJson(JSON.stringify(exported), state, data);
  assert.equal(result.state.values[inputFieldId], undefined);
  assert.equal(result.state.values.BAD, undefined);
  assert.equal(result.state.values[firstMappingFieldId], equipmentName);
  assert.ok(result.clearedFields.includes(inputFieldId));
  assert.ok(result.clearedFields.includes("BAD"));
});

test("deleted custom dropdown options clear only the affected field", () => {
  const customName = data.otherEffects.titles[0].name;
  const customState = { ...state, values: { ...state.values, "Effect.Title": customName, "Effect.Consumable": data.otherEffects.consumables[0].name } };
  const exported = JSON.parse(serializeLoadout(customState, data).json);
  const changedData = structuredClone(data);
  changedData.otherEffects.titles = changedData.otherEffects.titles.filter((option) => option.name !== customName);
  const result = parseLoadoutJson(JSON.stringify(exported), customState, changedData);
  assert.equal(result.state.values["Effect.Title"], undefined);
  assert.equal(result.state.values["Effect.Consumable"], customState.values["Effect.Consumable"]);
  assert.equal(result.state.values[firstMappingFieldId], equipmentName);
  assert.ok(result.clearedFields.includes("Effect.Title"));
});

test("previous name-based format is rejected because this site has not been released", () => {
  const previousFormat = {
    format: "damage-calculator-loadout",
    formatVersion: 1,
    loadout: { ...state, values: { ...state.values, [firstMapping.selectionCell]: "已刪除裝備" } },
  };
  assert.throws(() => parseLoadoutJson(JSON.stringify(previousFormat), state, data), /不支援/);
});

test("coordinate-keyed version-2 JSON is rejected and unknown numeric field codes stay empty", () => {
  const oldPayload = {
    format: "damage-calculator-loadout", formatVersion: 2,
    Job: state.Job, values: { B20: equipmentName },
  };
  assert.throws(() => parseLoadoutJson(JSON.stringify(oldPayload), state, data), /不支援/);

  const exported = JSON.parse(serializeLoadout(state, data).json);
  exported.values["999999"] = "stale-field";
  const result = parseLoadoutJson(JSON.stringify(exported), state, data);
  assert.ok(result.clearedFields.includes("999999"));
});

test("malformed JSON and unsupported format versions are rejected", () => {
  assert.throws(() => parseLoadoutJson("{broken", state, data), /不是有效的 JSON/);
  assert.throws(() => parseLoadoutJson(JSON.stringify({ format: "damage-calculator-loadout", formatVersion: 99 }), state, data), /不支援/);
});
