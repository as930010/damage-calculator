import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CELL_TO_FIELD_ID, FIELD_ID_TO_CELL, FIELD_ID_TO_CODE, CODE_TO_FIELD_ID, cellForFieldId, fieldIdForCell } from "../dist/frontend/field-ids.js";
import { createFieldValues, readState, saveState } from "../dist/frontend/state.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sample = JSON.parse(await readFile(join(root, "data/examples/live-sheet-2026-09-28.json"), "utf8"));

test("all confirmed sample fields have a unique semantic ID and reversible registry entry", () => {
  const cells = Object.keys(sample.values);
  assert.equal(cells.length, 216);
  assert.equal(Object.keys(CELL_TO_FIELD_ID).length, cells.length);
  assert.equal(Object.keys(FIELD_ID_TO_CELL).length, cells.length);
  assert.equal(Object.keys(FIELD_ID_TO_CODE).length, cells.length);
  assert.equal(Object.keys(CODE_TO_FIELD_ID).length, cells.length);
  assert.deepEqual(Object.keys(FIELD_ID_TO_CODE).sort(), Object.values(CELL_TO_FIELD_ID).sort());
  for (const cell of cells) {
    const fieldId = fieldIdForCell(cell);
    assert.ok(fieldId, `${cell} has a semantic ID`);
    assert.equal(cellForFieldId(fieldId), cell);
    assert.equal(CODE_TO_FIELD_ID[String(FIELD_ID_TO_CODE[fieldId])], fieldId);
  }
});

test("class selection is represented by Job, not a simulator sheet address", async () => {
  const inputOptions = JSON.parse(await readFile(join(root, "data/simulator-input-options.json"), "utf8"));
  const classReference = inputOptions.inputs.find(input => input.simulatorCells.split(/\s+/).includes("B1"));
  assert.equal(classReference, undefined);
  assert.ok(inputOptions.inputs.some(input => input.simulatorCells.includes("SpiritRecord.Class.1")));
});

test("state values enumerate and serialize by semantic ID while preserving cell-based reads and writes", () => {
  const values = createFieldValues({ B37: "深淵" });
  assert.equal(values["Weapon.MagicStone.Grade"], "深淵");
  values.B37 = "燦爛";
  assert.equal(values["Weapon.MagicStone.Grade"], "燦爛");
  assert.deepEqual(Object.keys(values), ["Weapon.MagicStone.Grade"]);
  assert.equal(JSON.stringify(values), '{"Weapon.MagicStone.Grade":"燦爛"}');
});

test("existing local configurations migrate old cell keys to semantic IDs when read and saved", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  storage.set("dab-loadout-v1", JSON.stringify({ schemaVersion: 2, classId: "DaB", values: { B37: "深淵" } }));
  const state = readState("KE");
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.Job, "DaB");
  assert.equal(state.values["Weapon.MagicStone.Grade"], "深淵");
  assert.equal(saveState(state), true);
  const saved = JSON.parse(storage.get("dab-loadout-v1"));
  assert.deepEqual(saved.values, { "Weapon.MagicStone.Grade": "深淵" });
});

