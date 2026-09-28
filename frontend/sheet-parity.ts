import type { LoadoutCalculationResult } from "../calculation/loadout-engine.ts";

export interface SheetParityReference {
  cells: Record<string, number>;
  /** Recalculated from the sheet formula and source values, before display rounding. */
  b163RecomputedFromFormula?: number;
}

export interface SheetParityRow {
  cell: string;
  label: string;
  expected: number;
  actual: number;
  /** Website result minus the spreadsheet reference. */
  delta: number;
  matches: boolean;
}

type ValueReader = (result: LoadoutCalculationResult) => number;

const attribute = (key: string): ValueReader =>
  (result) => result.attributes.stats[key]?.finalTotal ?? 0;

const comparedCells: readonly (readonly [string, string, ValueReader])[] = [
  ["C1", "物攻", attribute("physicalAttack")],
  ["D1", "魔攻", attribute("magicalAttack")],
  ["E1", "雙攻%", attribute("doubleAttackPct")],
  ["F1", "致命一擊%", attribute("critRatePct")],
  ["G1", "極大化%", attribute("extremizationPct")],
  ["H1", "致命傷害%", attribute("critDamagePct")],
  ["I1", "Boss傷害%", attribute("bossDamagePct")],
  ["J1", "兩極化%", attribute("polarizationPct")],
  ["K1", "超越技傷%", attribute("transcendenceSkillDamagePct")],
  ["L1", "所有技能傷害%", attribute("allSkillDamagePct")],
  ["M1", "流血%", attribute("bleedDamagePct")],
  ["N1", "強者%", (result) => result.attributes.conditionalDamage.strongerPct],
  ["O1", "排熱%", (result) => result.attributes.conditionalDamage.heatPct],
  ["P1", "100%血殺%", attribute("fullHealthKillDamagePct")],
  ["Q1", "適應力%", attribute("adaptabilityPct")],
  ["R1", "無視防禦%", attribute("defenseIgnorePct")],
  ["S1", "乘算效果", (result) => result.generalMultiplicativeDamage.value],
  ["T1", "乘算暴傷", (result) => result.multiplicativeCritDamage.value],
  ["U1", "攻擊力等級", attribute("attackLevel")],
  ["V1", "技能類攻%", attribute("skillTypeAttackPct")],
  ["W1", "超適應力%", attribute("superAdaptabilityPct")],
  ["C53", "武器物攻基值", (result) => result.attack.c53],
  ["D53", "武器魔攻基值", (result) => result.attack.d53],
  ["B156", "攻擊力", (result) => result.attack.attackPower],
  ["B157", "攻擊下界", (result) => result.attack.lowerDamage],
  ["B158", "攻擊上界", (result) => result.attack.upperDamage],
  ["B159", "致命一擊率", (result) => result.combatRates.critRate.finalRate],
  ["B160", "極大化率", (result) => result.combatRates.extremization.finalRate],
  ["B161", "非遞減致命一擊", (result) => result.combatRates.critRate.nonDiminishingPct],
  ["B162", "非遞減極大化", (result) => result.combatRates.extremization.nonDiminishingPct],
  ["B163", "最終傷害", (result) => result.finalDamage.finalDamage],
];

/** Compare unformatted engine values with unformatted spreadsheet results. */
export function compareSheetParity(
  result: LoadoutCalculationResult,
  reference: SheetParityReference,
): SheetParityRow[] {
  return comparedCells.map(([cell, label, read]) => {
    const expected = cell === "B163" && reference.b163RecomputedFromFormula !== undefined
      ? reference.b163RecomputedFromFormula
      : reference.cells[cell];
    const actual = read(result);
    if (!Number.isFinite(expected)) throw new RangeError(`試算表 ${cell} 缺少有效數值。`);
    if (!Number.isFinite(actual)) throw new RangeError(`網站 ${cell} 產生無效數值。`);
    const delta = actual - expected;
    // A few ULPs allow different summation order without hiding a real formula gap.
    const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)));
    return { cell, label, expected, actual, delta, matches: Math.abs(delta) <= tolerance };
  });
}
