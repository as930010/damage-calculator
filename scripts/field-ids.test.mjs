import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CODE_TO_FIELD_ID, FIELD_ID_TO_CODE, fieldIdForCode, isFieldId } from "../dist/frontend/field-ids.js";
import { readState, saveState } from "../dist/frontend/state.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sample = JSON.parse(await readFile(join(root, "data/examples/public-example-2026-09-28.json"), "utf8"));

test("the confirmed sample stores all 217 inputs using semantic IDs and compact codes", () => {
  const fields = Object.keys(sample.values);
  assert.equal(fields.length, 217);
  assert.ok(fields.every(isFieldId));
  assert.equal(Object.keys(FIELD_ID_TO_CODE).length, Object.keys(CODE_TO_FIELD_ID).length);
  for (const fieldId of fields) {
    const code = FIELD_ID_TO_CODE[fieldId];
    assert.ok(Number.isInteger(code), `${fieldId} has a numeric transfer code`);
    assert.equal(fieldIdForCode(String(code)), fieldId);
  }
});

test("class selection is represented by Job and option catalogs reference semantic IDs", async () => {
  const inputOptions = JSON.parse(await readFile(join(root, "data/simulator-input-options.json"), "utf8"));
  assert.ok(!inputOptions.inputs.some(input => /(?:^|\s)[A-Z]+[0-9]+(?=\s|$)/.test(input.simulatorCells)));
  assert.ok(inputOptions.inputs.some(input => input.simulatorCells.includes("SpiritRecord.Class.1")));
  assert.equal(sample.Job, "DaB");
  for (const color of ["Red", "Blue", "Yellow"]) {
    for (let index = 1; index <= 9; index++) {
      const fieldId = `Weapon.MagicStone.${color}.${index}`;
      assert.ok(isFieldId(fieldId), `${fieldId} has a stable semantic ID`);
      assert.ok(Number.isInteger(FIELD_ID_TO_CODE[fieldId]), `${fieldId} has a compact transfer code`);
    }
  }
});

test("saved state accepts semantic IDs and ignores unrecognized field keys", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  storage.set("dab-loadout-v1", JSON.stringify({ schemaVersion: 3, Job: "DaB", values: { "Weapon.MagicStone.Grade": "深淵", B37: "舊格式" } }));
  const state = readState("KE");
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.Job, "DaB");
  assert.equal(state.values["Weapon.MagicStone.Grade"], "深淵");
  assert.equal(state.values.B37, undefined);
  assert.equal(saveState(state), true);
  const saved = JSON.parse(storage.get("dab-loadout-v1"));
  assert.deepEqual(saved.values, { "Weapon.MagicStone.Grade": "深淵" });
});
