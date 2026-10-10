import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async path => JSON.parse(await readFile(join(root, path), "utf8"));
const { findValidationCatalog } = await import(pathToFileURL(join(root, "dist/frontend/input-validation.js")));
const { isFieldId } = await import(pathToFileURL(join(root, "dist/frontend/field-ids.js")));
const simulatorInputs = await read("data/simulator-input-options.json");

test("every validation input is a semantic ID with a valid catalog", () => {
  for (const input of simulatorInputs.inputs) {
    const fields = input.fieldIds;
    assert.ok(fields.length > 0);
    assert.ok(fields.every(isFieldId), input.fieldIds.join(" "));
    assert.ok(simulatorInputs.catalogs.some(catalog => catalog.id === input.catalogId), input.catalogId);
  }
});

test("semantic IDs resolve their exact option catalogs", () => {
  for (const input of simulatorInputs.inputs) {
    for (const fieldId of input.fieldIds) {
      const actual = findValidationCatalog(simulatorInputs.inputs, simulatorInputs.catalogs, fieldId);
      assert.equal(actual?.id, input.catalogId, fieldId);
    }
  }
});

test("coordinate-like references no longer resolve as runtime fields", () => {
  assert.equal(findValidationCatalog(simulatorInputs.inputs, simulatorInputs.catalogs, "D1"), undefined);
  assert.equal(findValidationCatalog(simulatorInputs.inputs, simulatorInputs.catalogs, "計算機!D1"), undefined);
});
