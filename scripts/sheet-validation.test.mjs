import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const { findValidationCatalog, rangeContainsCell } = await import(pathToFileURL(join(root, "dist/frontend/sheet-validation.js")));
const { fieldIdForCell } = await import(pathToFileURL(join(root, "dist/frontend/field-ids.js")));
const simulatorInputs = await read("data/simulator-input-options.json");

function legacyContains(range, cell) {
  if (!range.includes(":")) return range === cell;
  const [start, end] = range.split(":");
  const column = (letters) => [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  const parse = (address) => {
    const match = address.match(/^([A-Z]+)([0-9]+)$/);
    return match ? { column: column(match[1]), row: Number(match[2]) } : null;
  };
  const first = parse(start), last = parse(end), target = parse(cell);
  return !!first && !!last && !!target && target.column >= first.column && target.column <= last.column && target.row >= first.row && target.row <= last.row;
}

function cellsFor(range) {
  if (!range.includes(":")) return [range];
  const parse = (address) => {
    const match = address.match(/^([A-Z]+)([0-9]+)$/);
    if (!match) return null;
    const column = [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
    return { column, row: Number(match[2]) };
  };
  const [start, end] = range.split(":").map(parse);
  if (!start || !end) return [];
  const name = (column) => {
    let value = column, result = "";
    while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
    return result;
  };
  return Array.from({ length: (end.row - start.row + 1) * (end.column - start.column + 1) }, (_, index) => {
    const column = start.column + index % (end.column - start.column + 1);
    const row = start.row + Math.floor(index / (end.column - start.column + 1));
    return `${name(column)}${row}`;
  });
}

test("the shared range helper matches the old input-range logic for every registered option cell", () => {
  const testedCells = new Set();
  for (const input of simulatorInputs.inputs) {
    for (const range of input.simulatorCells.split(/\s+/)) {
      for (const cell of cellsFor(range)) testedCells.add(cell);
    }
  }
  assert.ok(testedCells.size > 0);
  for (const cell of testedCells) {
    const previous = simulatorInputs.inputs.find(input => input.simulatorCells.split(/\s+/).some(range => legacyContains(range, cell)));
    const actual = findValidationCatalog(simulatorInputs.inputs, simulatorInputs.catalogs, cell);
    assert.equal(actual?.id, previous ? simulatorInputs.catalogs.find(catalog => catalog.id === previous.catalogId)?.id : undefined, cell);
  }
});

test("single cells, rectangular ranges, and non-matching addresses retain their old behavior", () => {
  assert.equal(rangeContainsCell("AB10", "AB10"), true);
  assert.equal(rangeContainsCell("AB10", "AB11"), false);
  assert.equal(rangeContainsCell("Z9:AB12", "AA10"), true);
  assert.equal(rangeContainsCell("Z9:AB12", "AC10"), false);
  assert.equal(rangeContainsCell("Z9:AB12", "AA13"), false);
  assert.equal(rangeContainsCell("invalid:AB12", "AA10"), false);
});

test("battle setting fields still resolve the same exact option catalogs", () => {
  for (const cell of ["D1", "D2", "D3"]) {
    const fieldId = fieldIdForCell(cell);
    const previous = simulatorInputs.inputs.find(input => input.simulatorCells.split(/\s+/).includes(fieldId));
    const actual = findValidationCatalog(simulatorInputs.inputs, simulatorInputs.catalogs, cell);
    assert.equal(actual?.id, previous ? simulatorInputs.catalogs.find(catalog => catalog.id === previous.catalogId)?.id : undefined, cell);
    assert.equal(findValidationCatalog(simulatorInputs.inputs, simulatorInputs.catalogs, fieldId)?.id, actual?.id, `${fieldId} and its old input reference`);
  }
});
