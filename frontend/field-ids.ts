import { FIELD_ID_TO_CODE } from "./field-transfer-codes.ts";

/**
 * Transitional compatibility registry: spreadsheet input cells -> stable, readable domain IDs.
 * Keep calculation code using the old input references until each calculation/data layer is migrated.
 */
const cellToFieldId: Record<string, string> = {};

function add(cell: string, fieldId: string): void {
  if (cellToFieldId[cell] || Object.values(cellToFieldId).includes(fieldId)) {
    throw new Error(`Duplicate field ID mapping: ${cell} -> ${fieldId}`);
  }
  cellToFieldId[cell] = fieldId;
}

function addMany(cells: string[], fieldIds: string[]): void {
  if (cells.length !== fieldIds.length) throw new Error("Field ID mapping lengths do not match.");
  cells.forEach((cell, index) => add(cell, fieldIds[index]));
}

function sequence(column: string, rows: number[], prefix: string, suffixes: string[]): void {
  addMany(rows.map(row => `${column}${row}`), suffixes.map(suffix => `${prefix}.${suffix}`));
}

addMany(["D1", "D2", "D3", "B2", "B3", "B4", "B5", "G2", "M2", "O2", "S2"], [
  "Stage.Adapt", "Stage.CritRatePenalty", "Stage.BossDEF", "Effect.Title", "Effect.Emblem", "Effect.Consumable", "Effect.Environment",
  "Left.Armor.SetColor", "Accessory.WeaponAccessory", "Accessory.Support", "Peak.Option",
]);
addMany(["B7", "C8", "B10", "B17"], ["Costume.OnePiece", "Costume.MagicStone", "Left.Ice.Set", "Ice.Weapon.Set"]);
sequence("C", [11, 12, 13, 14, 15], "Left.Ice", ["Hair.MagicStone", "Upper.MagicStone", "Bottom.MagicStone", "Gloves.MagicStone", "Shoes.MagicStone"]);
sequence("D", [17, 18], "Ice.Weapon.MagicStone", ["1", "2"]);
sequence("S", [4, 5, 6, 7, 8, 9], "SpiritRecord.Class", ["1", "2", "3", "4", "5", "6"]);

addMany(["B20", "D20", "B21", "B22", "B23", "B24", "D21", "D22", "D23", "D24", "D25"], [
  "Right.Ice.WeaponAccessory", "Right.Ice.Support", "Right.Ice.FaceTop", "Right.Ice.FaceMiddle", "Right.Ice.FaceBottom", "Right.Ice.Earring",
  "Right.Ice.Top", "Right.Ice.Bottom", "Right.Ice.Arm", "Right.Ice.Necklace", "Right.Ice.Ring",
]);
addMany(["M3", "O3", "M4", "O4", "M5", "O5", "M6", "O6", "M7", "O7"], [
  "Accessory.FaceTop", "Accessory.Top", "Accessory.FaceMiddle", "Accessory.Bottom", "Accessory.FaceBottom", "Accessory.Arm",
  "Accessory.Earring", "Accessory.Necklace", "Accessory.Ring1", "Accessory.Ring2",
]);
sequence("B", [27, 28, 29], "Right.Ice.SetEffect", ["1", "2", "3"]);

addMany(["M27", "M28", "N27", "N28", "M33", "M34", "M36", "M37", "N36", "N37", "M39", "M40", "N39", "N40", "S25"], [
  "MasterBeast.Head.CustomAttribute", "MasterBeast.Head.CustomValue", "MasterBeast.Head.Option1", "MasterBeast.Head.Option2",
  "MasterBeast.Necklace.CustomAttribute", "MasterBeast.Necklace.CustomValue", "MasterBeast.Ring1.CustomAttribute", "MasterBeast.Ring1.CustomValue",
  "MasterBeast.Ring1.Option1", "MasterBeast.Ring1.Option2", "MasterBeast.Ring2.CustomAttribute", "MasterBeast.Ring2.CustomValue",
  "MasterBeast.Ring2.Option1", "MasterBeast.Ring2.Option2", "MasterBeast.OverallPotential",
]);
for (const [part, firstRow, slots] of [["Head", 27, 3], ["Armor", 30, 3], ["Necklace", 33, 3], ["Ring1", 36, 3], ["Ring2", 39, 3]] as const) {
  for (let slot = 1; slot <= slots; slot++) {
    const row = firstRow + slot - 1;
    add(`O${row}`, `MasterBeast.${part}.Mirror.${slot}.Attribute`);
    add(`P${row}`, `MasterBeast.${part}.Mirror.${slot}.Value`);
  }
}

const armorParts = [
  { part: "Upper", enhancement: 3, forging: 3, stones: [4, 5, 6, 7], appraisal: [8, 9, 10], circuit: [4, 5], chip: [6, 7] },
  { part: "Bottom", enhancement: 12, forging: 12, stones: [13, 14, 15, 16], appraisal: [17, 18, 19], circuit: [13, 14], chip: [15, 16] },
  { part: "SwitchBottom", enhancement: 21, forging: 21, stones: [22, 23, 24, 25], appraisal: [26, 27, 28], circuit: [22, 23], chip: [24, 25] },
  { part: "Gloves", enhancement: 30, forging: 30, stones: [31, 32, 33, 34], appraisal: [35, 36, 37], circuit: [31, 32], chip: [33, 34] },
  { part: "Shoes", enhancement: 39, forging: 39, stones: [40, 41, 42, 43], appraisal: [44, 45, 46], circuit: [40, 41], chip: [42, 43] },
] as const;
for (const { part, enhancement, forging, stones, appraisal, circuit, chip } of armorParts) {
  add(`H${enhancement}`, `Left.Armor.${part}.ENHC`);
  add(`J${forging}`, `Left.Armor.${part}.FORGE`);
  stones.forEach((row, index) => add(`H${row}`, `Left.Armor.${part}.MagicStone.${index + 1}`));
  appraisal.forEach((row, index) => add(`H${row}`, `Left.Armor.${part}.Appraisal.${index + 1}`));
  add(`J${circuit[0]}`, `Left.Armor.${part}.Circuit.Attribute`);
  add(`J${circuit[1]}`, `Left.Armor.${part}.Circuit.Value`);
  add(`J${chip[0]}`, `Left.Armor.${part}.Chip.Attribute`);
  add(`J${chip[1]}`, `Left.Armor.${part}.Chip.Tuning`);
}

addMany(["B32", "B33", "B34", "B35", "B36", "B37"], [
  "Weapon.ENHC", "Weapon.Growth", "Weapon.Appraisal.Primary", "Weapon.Appraisal.Additional1", "Weapon.Appraisal.Additional2", "Weapon.MagicStone.Grade",
]);
sequence("D", [32, 33, 34, 35, 36, 37], "Weapon.MagicStone", ["1", "2", "3", "4", "5", "6"]);
sequence("B", [38, 39, 40], "Weapon.GiantStone", ["1", "2", "3"]);
for (let slot = 1; slot <= 4; slot++) {
  const row = 41 + slot;
  add(`B${row}`, `Weapon.Transform.${slot}.Stat`);
  add(`C${row}`, `Weapon.Transform.${slot}.Value`);
}

for (const [part, column, rows] of [
  ["Top", "O", [11, 12, 13]], ["FaceMiddle", "M", [15, 16, 17]], ["FaceBottom", "M", [19, 20, 21]],
  ["Arm", "O", [15, 16, 17]], ["Necklace", "O", [19, 20, 21]], ["Ring1", "M", [23, 24]], ["Ring2", "O", [23, 24]],
] as const) rows.forEach((row, index) => add(`${column}${row}`, `Accessory.${part}.Appraisal.${index + 1}`));
addMany(["L9", "N9", "T11", "T12", "T13", "T14", "T15", "S17", "S18", "S19", "S21", "S23"], [
  "Atma.Element", "Atma.Color", "Resonance.AllATK.Points", "Resonance.TranscendenceSkillDMG.Points", "Resonance.Polarization.Points",
  "Resonance.BossDMG.Points", "Resonance.Adapt.Points", "GuildFountain.Stage2", "GuildFountain.Stage3", "GuildFountain.Stage4",
  "Effect.PortraitAwakening", "Pet.Passive",
]);

export const CELL_TO_FIELD_ID: Readonly<Record<string, string>> = Object.freeze(cellToFieldId);
export const FIELD_ID_TO_CELL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(cellToFieldId).map(([cell, fieldId]) => [fieldId, cell])),
);
// Numeric codes are used only in transfer files and are assigned from a fixed append-only registry.
export { FIELD_ID_TO_CODE };
export const CODE_TO_FIELD_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(FIELD_ID_TO_CODE).map(([fieldId, code]) => [String(code), fieldId])),
);

export function fieldIdForCell(cell: string): string | undefined {
  return CELL_TO_FIELD_ID[cell.replaceAll("$", "").split("!").at(-1)!];
}

export function cellForFieldId(fieldId: string): string | undefined {
  return FIELD_ID_TO_CELL[fieldId];
}

export function isFieldId(value: string): boolean {
  return Object.hasOwn(FIELD_ID_TO_CELL, value);
}

export function codeForFieldId(fieldId: string): number | undefined {
  return FIELD_ID_TO_CODE[fieldId];
}

export function fieldIdForCode(code: string): string | undefined {
  return CODE_TO_FIELD_ID[code];
}

