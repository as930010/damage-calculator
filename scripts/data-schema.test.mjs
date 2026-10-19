import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async path => JSON.parse(await readFile(join(root, path), "utf8"));
const [effects, inputOptions, colorSet, parameters, resonance, spiritRecord, weaponAppraisals, weaponGrades, weaponGrowth, giantStones, armorAppraisals, atma, chips, combatRate, masterBeast, raidSets, accessoryEffects, attack, attributes, circuits, classCombat, classPassives, classes, innerwear, nephron, pets, rightIce, equipmentLayout] = await Promise.all([
  read("data/other-effect-options.json"),
  read("data/simulator-input-options.json"),
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
  read("data/equipment-layout.json"),
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


});

test("simulator input fields reference existing option catalogs", () => {
  assert.equal(inputOptions.schemaVersion, 2);
  const catalogIds = new Set(inputOptions.catalogs.map(catalog => catalog.id));
  assert.equal(catalogIds.size, inputOptions.catalogs.length);
  for (const input of inputOptions.inputs) {
    assert.ok(input.fieldIds.length > 0);
    assert.ok(input.fieldIds.every(isFieldId));
    assert.ok(catalogIds.has(input.catalogId), input.catalogId);
  }
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
  assert.equal(combatRate.sources[1].valueSource.inputFieldId, "Left.Armor.Bottom.ENHC");
  assert.ok(Object.hasOwn(circuits.statKeyByAttributeName, "物攻"));
  assert.ok(Object.hasOwn(masterBeast.statKeyByAttributeName, "致命傷害%"));
  assert.ok(colorSet.options.find(option => option.calculatedStat)?.calculatedStat.inputValueLabel);
});

test("equipment layout has unique identities and valid gameplay field references", () => {
  const groupIds = new Set(equipmentLayout.groups.map(group => group.id));
  assert.equal(new Set(equipmentLayout.slots.map(slot => slot.id)).size, equipmentLayout.slots.length);
  for (const slot of equipmentLayout.slots) {
    assert.ok(groupIds.has(slot.group), slot.id);
    if (slot.selectionField) assert.ok(isFieldId(slot.selectionField), slot.selectionField);
    assert.ok((slot.stoneFields ?? []).every(isFieldId), slot.id);
    assert.ok(Number.isFinite(slot.x) && Number.isFinite(slot.y), slot.id);
  }
});
