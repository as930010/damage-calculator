import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async path => JSON.parse(await readFile(join(root, path), "utf8"));
const [effects, provenance, inputOptions, inputProvenance, legacySourceProvenance, colorSet, parameters, resonance, spiritRecord, weaponAppraisals, weaponGrades, weaponGrowth, giantStones, armorAppraisals, atma, chips, combatRate, masterBeast, raidSets, accessoryEffects, attack, attributes, circuits, classCombat, classPassives, classes, innerwear, nephron, pets, rightIce, accessories, equipmentLayout, slots] = await Promise.all([
  read("data/other-effect-options.json"),
  read("docs/data-maintenance/other-effect-options-provenance.json"),
  read("data/simulator-input-options.json"),
  read("docs/data-maintenance/input-option-source-cells.json"),
  read("docs/data-maintenance/legacy-source-provenance.json"),
  read("data/color-set-effects.json"),
  read("data/parameters.json"),
  read("data/resonance-effects.json"),
  read("data/spirit-record-effects.json"),
  read("data/weapon-appraisals.json"),
  read("data/weapon-grade-options.json"),
  read("data/weapon-growth.json"),
  read("data/giant-magic-stones.json"),
  read("data/armor-appraisals.json"),
  read("data/atma-effects.json"),
  read("data/equipment/chips.json"),
  read("data/combat-rate-source-rules.json"),
  read("data/master-beast-effects.json"),
  read("data/raid-set-effects.json"),
  read("data/accessory-special-effects.json"),
  read("data/attack-parameters.json"),
  read("data/attributes.json"),
  read("data/circuit-board-rules.json"),
  read("data/class-combat-effects.json"),
  read("data/class-damage-passives.json"),
  read("data/classes.json"),
  read("data/innerwear-rules.json"),
  read("data/nephron-armor-rules.json"),
  read("data/pet-effects.json"),
  read("data/equipment/right-ice-set-effects.json"),
  read("data/equipment/accessories.json"),
  read("data/equipment-layout.json"),
  read("data/slots.json"),
]);
const { isFieldId } = await import(pathToFileURL(join(root, "dist/frontend/field-ids.js")));

test("other-effect schema contains semantic keys and current environment options", () => {
  assert.equal(effects.schemaVersion, 2);
  assert.deepEqual(effects.environments.map(option => option.name), ["小屋/溫泉", "強化小屋", "集合地", "共存節"]);
  assert.ok(effects.consumables.some(option => option.name === "其他"), "consumable fallback remains distinct from venue choices");
  const guildFountainCritDamage = effects.guildFountain.find(stage => stage.stage === 4)?.options.find(option => option.id === "guild-fountain-4-7");
  assert.deepEqual(guildFountainCritDamage, {
    id: "guild-fountain-4-7",
    name: "致命傷害+0.6%",
    stats: { critDamagePct: 0.6 },
  });

  const keys = [
    ...effects.guildFountain.map(stage => stage.settingKey),
    ...effects.binaryEffects.map(effect => effect.settingKey),
    effects.portraitAwakening.legacySettingKey,
    effects.portraitAwakening.strongSettingKey,
    effects.portraitAwakening.transcendenceSettingKey,
  ];
  assert.ok(keys.every(isFieldId), keys.join(", "));

  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      assert.ok(!["source", "sourceSheets", "selectorCell", "legacySelectorCell", "strongCell", "transcendenceCell"].includes(key), key);
      visit(value[key]);
    }
  };
  visit(effects);
});

test("removed source coordinates remain in developer-only provenance", () => {
  assert.equal(provenance.sourceDocument, "data/other-effect-options.json");
  assert.ok(provenance.sourceSheets.includes("係數區"));
  assert.ok(provenance.sourceRecords.length > 0);
});

test("simulator option catalog uses semantic field IDs and keeps source coordinates outside runtime data", () => {
  assert.equal(inputOptions.schemaVersion, 2);
  assert.equal(inputProvenance.sourceDocument, "data/simulator-input-options.json");
  const runtimeCatalogs = new Map(inputOptions.catalogs.map(catalog => [catalog.id, catalog.options]));
  for (const catalog of inputProvenance.catalogOptions) {
    const runtimeOptions = runtimeCatalogs.get(catalog.catalogId);
    assert.ok(runtimeOptions, catalog.catalogId);
    assert.ok(catalog.options.every(option => typeof option.sourceCell === "string" && option.sourceCell.length > 0), catalog.catalogId);
    assert.ok(catalog.options.every(option => runtimeOptions.some(runtimeOption => runtimeOption.value === option.value)), catalog.catalogId);
  }
  assert.ok(inputOptions.inputs.every(input => input.fieldIds.every(isFieldId)));
  assert.ok(inputOptions.catalogs.every(catalog => catalog.options.every(option => !Object.hasOwn(option, "cell"))));
});

test("live selection schemas use semantic setting keys without changing state field IDs", () => {
  const documents = [colorSet, parameters, resonance, spiritRecord, weaponAppraisals, weaponGrades, weaponGrowth, giantStones, armorAppraisals, atma, chips, combatRate, masterBeast, raidSets, accessoryEffects, attack, attributes, circuits, classCombat, classPassives, classes, innerwear, nephron, pets, rightIce];
  for (const document of documents) assert.equal(document.schemaVersion, 2);
  const keys = [
    colorSet.settingKey,
    ...parameters.conditionalEffects.map(effect => effect.settingKey),
    ...resonance.effects.map(effect => effect.settingKey),
    ...spiritRecord.classSelectors.settingKeys,
    ...Object.values(weaponAppraisals.groups).map(group => group.settingKey),
    weaponGrades.settingKey,
    ...weaponGrades.colorGroups.flatMap(group => group.settingKeys),
    weaponGrowth.settingKey,
    ...giantStones.settingKeys,
  ];
  assert.ok(keys.every(isFieldId), keys.join(", "));
  assert.equal(Object.hasOwn(resonance, "selectorCells"), false, "unused duplicate list is removed; effects are the source of truth");
  assert.equal(combatRate.sources[1].valueSource.inputFieldId, "Left.Armor.Bottom.ENHC");
  assert.equal(Object.hasOwn(combatRate.sources[1].valueSource, "inputCell"), false);
  assert.ok(Object.hasOwn(circuits.statKeyByAttributeName, "物攻"));
  assert.ok(Object.hasOwn(masterBeast.statKeyByAttributeName, "致命傷害%"));
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["selectorCell", "selectorCells", "inputCell"].includes(key), key);
      visit(child);
    }
  };
  for (const document of documents) visit(document);
});

test("removed maintenance-only coordinates remain traceable outside the runtime data schemas", () => {
  assert.ok(legacySourceProvenance.sourceRecords.length > 30);
  const sourceDocuments = new Set(legacySourceProvenance.sourceRecords.map(record => record.sourceDocument));
  for (const path of [
    "data/color-set-effects.json", "data/giant-magic-stones.json", "data/manifest.json",
    "data/simulator-equipment-mapping.json", "data/simulator-input-rules.json",
    "data/spirit-record-effects.json", "data/weapon-appraisals.json", "data/weapon-grade-options.json",
    "data/weapon-growth.json", "data/weapon-transformations.json",
    "data/accessory-special-effects.json", "data/armor-appraisals.json", "data/atma-effects.json",
    "data/attack-parameters.json", "data/attributes.json", "data/circuit-board-rules.json",
    "data/class-combat-effects.json", "data/class-damage-passives.json", "data/classes.json",
    "data/equipment/accessories.json", "data/equipment/chips.json", "data/equipment/right-ice-set-effects.json", "data/equipment-layout.json", "data/innerwear-rules.json",
    "data/master-beast-effects.json", "data/nephron-armor-rules.json", "data/pet-effects.json", "data/raid-set-effects.json",
    "data/slots.json", "data/simulator-input-rules.json",
  ]) assert.ok(sourceDocuments.has(path), path);
  assert.ok(legacySourceProvenance.sourceRecords.some(record => record.path.endsWith("sourceValueCell")));
  for (const document of [armorAppraisals, atma, chips, combatRate, masterBeast, raidSets, accessoryEffects, attack, attributes, circuits, classCombat, classPassives, classes, innerwear, nephron, pets, rightIce, accessories, equipmentLayout, slots]) {
    const visit = value => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        assert.ok(!["source", "sourceRange", "sourceCells", "sourceSheets", "sourceSheet", "sourceCell", "valueSourceColumn", "countFormulaCell", "countedInputRange", "yellowRateSourceCell", "overallPotentialSourceCells", "inputRules", "selectorRange", "calculationRow", "optionSource", "sourceFormula", "formula", "notes"].includes(key), key);
        visit(child);
      }
    };
    visit(document);
  }
  assert.ok(legacySourceProvenance.sourceRecords.some(record => record.sourceDocument === "data/equipment/chips.json" && record.path.endsWith("valueSourceColumn")));
  assert.equal(Object.hasOwn(colorSet.options.find(option => option.calculatedStat)?.calculatedStat ?? {}, "sourceValueCell"), false);
  assert.ok(colorSet.options.find(option => option.calculatedStat)?.calculatedStat.inputValueLabel);
});
