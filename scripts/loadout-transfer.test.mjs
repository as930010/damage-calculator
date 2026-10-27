import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getEquipmentOptionName } from "../dist/calculation/equipment-catalog.js";
import { parseLoadoutJson, serializeLoadout } from "../dist/frontend/loadout-transfer.js";
import { codeForFieldId, isFieldId } from "../dist/frontend/field-ids.js";
import { createCatalogIndex } from "../dist/frontend/catalog-index.js";
import { normalizeOptionalEffectValues } from "../dist/frontend/state.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const [classes, mapping, simulatorInputs, masterBeast, layout, attack, innerwear, nephronArmor, appraisals, chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, colorSetEffects, spiritRecord, otherEffects, pets, rightIceSets] = await Promise.all([
  read("data/classes.json"), read("data/simulator-equipment-mapping.json"),
  read("data/simulator-input-options.json"), read("data/master-beast-effects.json"),
  read("data/equipment-layout.json"), read("data/attack-parameters.json"), read("data/innerwear-rules.json"), read("data/nephron-armor-rules.json"),
  read("data/armor-appraisals.json"), read("data/equipment/chips.json"), read("data/chip-slots.json"),
  read("data/circuit-board-rules.json"), read("data/weapon-transformations.json"), read("data/weapon-growth.json"),
  read("data/weapon-appraisals.json"), read("data/weapon-grade-options.json"), read("data/giant-magic-stones.json"),
  read("data/color-set-effects.json"), read("data/spirit-record-effects.json"), read("data/other-effect-options.json"),
  read("data/pet-effects.json"), read("data/equipment/right-ice-set-effects.json"),
]);
const catalogFiles = [...new Set([...mapping.selections.map((item) => item.catalogFile), mapping.magicStoneSelections.catalogFile])];
const catalogs = Object.fromEntries(await Promise.all(catalogFiles.map(async (file) => [file, await read(`data/${file}`)])));
const data = { classes, mapping, simulatorInputs, masterBeast, catalogs, layout, attack, innerwear, nephronArmor, appraisals, chips, chipSlots, circuits, transformations, growth, weaponAppraisals, weaponGrades, giantStones, colorSetEffects, spiritRecord, otherEffects, pets, rightIceSets };
const catalogIndex = createCatalogIndex(data);
const semanticState = (value) => {
  const values = Object.fromEntries(Object.entries(value.values).filter(([fieldId]) => isFieldId(fieldId)));
  normalizeOptionalEffectValues(values, catalogIndex);
  return {
    ...value,
    schemaVersion: 3,
    nutProtectionPotionEnabled: value.nutProtectionPotionEnabled === true,
    nephronRaidEnabled: value.nephronRaidEnabled === true,
    transcendenceSkillDamageSharePct: Number.isInteger(value.transcendenceSkillDamageSharePct) && value.transcendenceSkillDamageSharePct >= 0 && value.transcendenceSkillDamageSharePct <= 100
      ? value.transcendenceSkillDamageSharePct : 100,
    values,
  };
};
const firstMapping = mapping.selections.find((entry) => catalogs[entry.catalogFile].items.some((item) => item.active && item.slotId === entry.slotId));
const firstMappingFieldId = firstMapping.selectionField;
const firstItem = catalogs[firstMapping.catalogFile].items.find((item) => item.active && item.slotId === firstMapping.slotId);
const equipmentName = getEquipmentOptionName(firstItem, firstMapping.application);
const mappedFields = new Set([
  ...mapping.selections.map((entry) => entry.selectionField),
  ...mapping.magicStoneSelections.inputGroups.map((entry) => entry.selectionField),
]);
const firstInputField = simulatorInputs.inputs.flatMap(input => input.fieldIds.map(fieldId => ({ input, fieldId })))
  .find(({ input, fieldId }) => isFieldId(fieldId) && !mappedFields.has(fieldId)
    && simulatorInputs.catalogs.find(catalog => catalog.id === input.catalogId)?.options.some(option => String(option.value).trim() !== ""));
const firstInput = firstInputField?.input;
const inputFieldId = firstInputField?.fieldId;
const firstOption = simulatorInputs.catalogs.find((catalog) => catalog.id === firstInput.catalogId).options.find((option) => String(option.value).trim() !== "");
const state = {
  schemaVersion: 3,
  Job: classes.classes.find((entry) => entry.active).id,
  values: { [firstMappingFieldId]: equipmentName, [inputFieldId]: String(firstOption.value), UnknownField: 123.45 },
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
  assert.equal(envelope.values.UnknownField, undefined);
  assert.deepEqual(parseLoadoutJson(exported.json, state, data).state, semanticState(state));
  assert.deepEqual(exported.omittedFields, ["UnknownField"]);
});

test('exporting an older sample fills optional defaults before a JSON round trip', async () => {
  const sample = await read('data/examples/public-example-2026-09-28.json');
  const exported = serializeLoadout(sample, data);
  const payload = JSON.parse(exported.json);
  assert.equal(payload.masterBeastSpiritStoneColor, masterBeast.spiritStoneColorSelector.defaultColor);
  assert.equal(payload.petSkillAttackEnabled, true);
  const imported = parseLoadoutJson(exported.json, state, data);
  assert.deepEqual(imported.clearedFields, []);
  assert.equal(imported.state.masterBeastSpiritStoneColor, payload.masterBeastSpiritStoneColor);
  assert.equal(imported.state.petSkillAttackEnabled, true);
});

test("export visibly includes job and stage settings, and import accepts semantic stage fields", () => {
  const configured = {
    ...state,
    Job: classes.classes.find((entry) => entry.active && entry.id !== state.Job)?.id ?? state.Job,
    values: { ...state.values, "Stage.Adapt": 95, "Stage.CritRatePenalty": 30, "Stage.BossDEF": 71.92 },
  };
  const exported = JSON.parse(serializeLoadout(configured, data).json);
  assert.equal(exported.Job, configured.Job);
  assert.equal(exported["Stage.Adapt"], 95);
  assert.equal(exported["Stage.CritRatePenalty"], 30);
  assert.equal(exported["Stage.BossDEF"], 71.92);
  assert.equal(exported.values[String(codeForFieldId("Stage.Adapt"))], 95);
  assert.equal(exported.values[String(codeForFieldId("Stage.CritRatePenalty"))], 30);
  assert.equal(exported.values[String(codeForFieldId("Stage.BossDEF"))], 71.92);
  assert.deepEqual(parseLoadoutJson(JSON.stringify(exported), state, data).state, semanticState(configured));

  const compactV3 = { ...exported };
  delete compactV3["Stage.Adapt"];
  delete compactV3["Stage.CritRatePenalty"];
  delete compactV3["Stage.BossDEF"];
  assert.deepEqual(parseLoadoutJson(JSON.stringify(compactV3), state, data).state, semanticState(configured));

  delete exported.values[String(codeForFieldId("Stage.Adapt"))];
  delete exported.values[String(codeForFieldId("Stage.CritRatePenalty"))];
  delete exported.values[String(codeForFieldId("Stage.BossDEF"))];
  const semanticImport = parseLoadoutJson(JSON.stringify(exported), state, data).state;
  assert.equal(semanticImport.Job, configured.Job);
  assert.equal(semanticImport.values["Stage.Adapt"], 95);
  assert.equal(semanticImport.values["Stage.CritRatePenalty"], 30);
  assert.equal(semanticImport.values["Stage.BossDEF"], 71.92);
});

test("older loadout exports default skill damage share to 100% transcendence", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  delete exported.transcendenceSkillDamageSharePct;
  const imported = parseLoadoutJson(JSON.stringify(exported), state, data).state;
  assert.equal(imported.transcendenceSkillDamageSharePct, 100);
});

test('new optional potion and raid settings normalize legacy omissions and retain explicit enabled values', () => {
  const exported = serializeLoadout({ ...state, values: semanticState(state).values }, data);
  const legacy = JSON.parse(exported.json);
  assert.equal(legacy.nutProtectionPotionEnabled, false);
  assert.equal(legacy.nephronRaidEnabled, false);
  const normalized = parseLoadoutJson(exported.json, state, data);
  assert.equal(serializeLoadout(normalized.state, data).json, exported.json);
  delete legacy.nutProtectionPotionEnabled;
  delete legacy.nephronRaidEnabled;
  const missing = parseLoadoutJson(JSON.stringify(legacy), state, data);
  assert.equal(missing.state.nutProtectionPotionEnabled, false);
  assert.equal(missing.state.nephronRaidEnabled, false);
  assert.deepEqual(missing.clearedFields, []);
  const enabled = { ...state, nutProtectionPotionEnabled: true, nephronRaidEnabled: true };
  const restored = parseLoadoutJson(serializeLoadout(enabled, data).json, state, data);
  assert.equal(restored.state.nutProtectionPotionEnabled, true);
  assert.equal(restored.state.nephronRaidEnabled, true);
});

test("legacy venue names migrate on import without changing unrelated values", () => {
  const legacyHut = JSON.parse(serializeLoadout(state, data).json);
  const environmentCode = String(codeForFieldId("Effect.Environment"));
  legacyHut.values[environmentCode] = "小屋";
  const migrated = parseLoadoutJson(JSON.stringify(legacyHut), state, data);
  assert.equal(migrated.state.values["Effect.Environment"], "小屋/溫泉");

  legacyHut.values[environmentCode] = "其他";
  const cleared = parseLoadoutJson(JSON.stringify(legacyHut), state, data);
  assert.equal(cleared.state.values["Effect.Environment"], undefined);
  assert.ok(cleared.clearedFields.includes("Effect.Environment"));
});

test("legacy glove circuit Transcendence choice migrates to the combined single-skill option", () => {
  const gloveCircuit = circuits.inputs.find(entry => entry.slot === "gloves");
  const legacyState = { ...state, values: { ...state.values, [gloveCircuit.attributeField]: "超越技傷%" } };
  const exported = serializeLoadout(legacyState, data);
  const imported = parseLoadoutJson(exported.json, state, data);
  assert.equal(imported.state.values[gloveCircuit.attributeField], "單技傷%");
});

test("portrait awakening damage values round-trip and one-sided allocations complement to five", () => {
  const portrait = otherEffects.portraitAwakening;
  const validState = {
    ...state,
    values: { ...state.values, [portrait.strongSettingKey]: 2, [portrait.transcendenceSettingKey]: 3 },
  };
  const exported = JSON.parse(serializeLoadout(validState, data).json);
  assert.equal(exported.values[String(codeForFieldId(portrait.strongSettingKey))], 2);
  assert.equal(exported.values[String(codeForFieldId(portrait.transcendenceSettingKey))], 3);
  assert.deepEqual(parseLoadoutJson(JSON.stringify(exported), state, data).state, semanticState(validState));

  const oneSidedState = { ...state, values: { ...state.values, [portrait.transcendenceSettingKey]: 4 } };
  const oneSidedExport = JSON.parse(serializeLoadout(oneSidedState, data).json);
  assert.equal(oneSidedExport.values[String(codeForFieldId(portrait.strongSettingKey))], 1);
  assert.equal(oneSidedExport.values[String(codeForFieldId(portrait.transcendenceSettingKey))], 4);

  exported.values[String(codeForFieldId(portrait.strongSettingKey))] = 2;
  exported.values[String(codeForFieldId(portrait.transcendenceSettingKey))] = 4;
  const normalizedImport = parseLoadoutJson(JSON.stringify(exported), state, data);
  assert.equal(normalizedImport.state.values[portrait.strongSettingKey], 1);
  assert.equal(normalizedImport.state.values[portrait.transcendenceSettingKey], 4);
  assert.ok(normalizedImport.clearedFields.includes(portrait.strongSettingKey));
});

test("colored weapon magic-stone selections round-trip as compact numeric-code fields", () => {
  const values = {};
  for (const group of weaponGrades.colorGroups) {
    values[group.settingKeys[0]] = group.options[0].name;
  }
  const configured = { ...state, values: { ...state.values, [weaponGrades.settingKey]: "深淵", ...values } };
  const exported = serializeLoadout(configured, data);
  assert.deepEqual(parseLoadoutJson(exported.json, state, data).state, semanticState(configured));
  assert.equal(Object.keys(values).length, 3);
  assert.ok(Object.keys(values).every(fieldId => Number.isInteger(codeForFieldId(fieldId))));
});

test("the complete saved example round-trips and stays smaller than the previous name-based export", async () => {
  const saved = await read("data/examples/public-example-2026-09-28.json");
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

test("a removed equipment option clears only its fieldId and keeps the rest", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  const changedData = structuredClone(data);
  changedData.catalogs[firstMapping.catalogFile].items = changedData.catalogs[firstMapping.catalogFile].items.filter((item) => item.id !== firstItem.id);
  const result = parseLoadoutJson(JSON.stringify(exported), state, changedData);
  const selectionFieldId = firstMappingFieldId;
  assert.equal(result.state.values[selectionFieldId], undefined);
  assert.equal(result.state.values[inputFieldId], String(firstOption.value));
  assert.equal(result.state.values.UnknownField, undefined);
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

test("corrupted option codes and invalid fields are cleared without losing valid selections", () => {
  const exported = JSON.parse(serializeLoadout(state, data).json);
  exported.values[String(codeForFieldId(inputFieldId))] = "deleted-option";
  exported.values.BAD = {};
  const result = parseLoadoutJson(JSON.stringify(exported), state, data);
  assert.equal(result.state.values[inputFieldId], '無關傷害');
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

test("unsupported name-based format is rejected", () => {
  const previousFormat = {
    format: "damage-calculator-loadout",
    formatVersion: 1,
    loadout: { ...state, values: { ...state.values, [firstMapping.selectionField]: "已刪除裝備" } },
  };
  assert.throws(() => parseLoadoutJson(JSON.stringify(previousFormat), state, data), /不支援/);
});

test("unsupported version-2 JSON is rejected and unknown numeric field codes stay empty", () => {
  const oldPayload = {
    format: "damage-calculator-loadout", formatVersion: 2,
    Job: state.Job, values: { UnknownField: equipmentName },
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

test('unrelated effect zero values round-trip without false warnings while invalid values remain reported', () => {
  const source = { ...state, Job: 'FP', values: {}, classSkillVersions: { 'FP.FatalShotConverted': false } };
  normalizeOptionalEffectValues(source.values, catalogIndex);
  const custom = 'MasterBeast.Head.CustomValue';
  const transform = data.nephronArmor.fields[0].transformFields[0];
  const validOption = data.nephronArmor.transformations.find(option => option.statKey);
  source.values[transform.attributeField] = validOption.name;
  source.values[transform.valueField] = validOption.tierValuesPct[0] / 100;
  const exported = serializeLoadout(source, data, catalogIndex);
  assert.deepEqual(exported.omittedFields, []);
  const imported = parseLoadoutJson(exported.json, state, data, catalogIndex);
  assert.deepEqual(imported.clearedFields, []);
  assert.deepEqual(imported.state.values, source.values);
  assert.deepEqual(imported.state.classSkillVersions, source.classSkillVersions);
  assert.equal(serializeLoadout(imported.state, data, catalogIndex).json, exported.json);

  const invalid = JSON.parse(exported.json);
  invalid.values[String(codeForFieldId(custom))] = 0.5;
  invalid.values[String(codeForFieldId(transform.valueField))] = 999;
  invalid.classSkillVersions.unknown = true;
  const rejected = parseLoadoutJson(JSON.stringify(invalid), state, data, catalogIndex);
  assert.ok(rejected.clearedFields.includes(custom));
  assert.ok(rejected.clearedFields.includes(transform.valueField));
  assert.ok(rejected.clearedFields.includes('classSkillVersions.unknown'));
  assert.equal(rejected.state.values[custom], 0);
  assert.equal(rejected.state.values[transform.attributeField], validOption.name);
});
