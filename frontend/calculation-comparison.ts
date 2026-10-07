import type { LoadoutCalculationResult } from "../calculation/loadout-engine.ts";

export interface CalculationComparisonRow {
  key: string;
  label: string;
  expected: number;
  actual: number;
  delta: number;
  matches: boolean;
}

type ValueReader = (result: LoadoutCalculationResult) => number;
type Metric = readonly [key: string, label: string, read: ValueReader];

const attribute = (key: string): ValueReader =>
  (result) => result.attributes.stats[key]?.finalTotal ?? 0;

const metrics: readonly Metric[] = [
  ["physicalAttack", "物攻", attribute("physicalAttack")],
  ["magicalAttack", "魔攻", attribute("magicalAttack")],
  ["doubleAttackPct", "雙攻%", attribute("doubleAttackPct")],
  ["critRatePct", "致命一擊%", attribute("critRatePct")],
  ["extremizationPct", "極大化%", attribute("extremizationPct")],
  ["critDamagePct", "致命傷害%", attribute("critDamagePct")],
  ["bossDamagePct", "Boss傷害%", attribute("bossDamagePct")],
  ["polarizationPct", "兩極化%", attribute("polarizationPct")],
  ["transcendenceSkillDamagePct", "超越技傷%", attribute("transcendenceSkillDamagePct")],
  ["allSkillDamagePct", "所有技能傷害%", attribute("allSkillDamagePct")],
  ["bleedDamagePct", "流血%", attribute("bleedDamagePct")],
  ["strongerPct", "強者%", (result) => result.attributes.conditionalDamage.strongerPct],
  ["heatPct", "排熱%", (result) => result.attributes.conditionalDamage.heatPct],
  ["fullHealthKillDamagePct", "100%血殺%", attribute("fullHealthKillDamagePct")],
  ["adaptabilityPct", "適應力%", attribute("adaptabilityPct")],
  ["defenseIgnorePct", "無視防禦%", attribute("defenseIgnorePct")],
  ["multiplicativeEffect", "乘算效果", (result) => result.generalMultiplicativeDamage.value],
  ["multiplicativeCritDamage", "乘算暴傷", (result) => result.multiplicativeCritDamage.value],
  ["attackLevel", "攻擊力等級", attribute("attackLevel")],
  ["skillTypeAttackPct", "技能類攻%", attribute("skillTypeAttackPct")],
  ["superAdaptabilityPct", "超適應力%", attribute("superAdaptabilityPct")],
  ["weaponPhysicalBase", "武器物攻基值", (result) => result.attack.c53],
  ["weaponMagicalBase", "武器魔攻基值", (result) => result.attack.d53],
  ["attackPower", "攻擊力", (result) => result.attack.attackPower],
  ["lowerAttack", "最小攻擊力", (result) => result.attack.lowerDamage],
  ["upperAttack", "最大攻擊力", (result) => result.attack.upperDamage],
  ["critRate", "致命一擊率", (result) => result.combatRates.critRate.finalRate],
  ["extremizationRate", "極大化率", (result) => result.combatRates.extremization.finalRate],
  ["nonDiminishingCritRate", "非遞減致命一擊", (result) => result.combatRates.critRate.nonDiminishingPct],
  ["nonDiminishingExtremizationRate", "非遞減極大化", (result) => result.combatRates.extremization.nonDiminishingPct],
  ["finalDamage", "最終傷害", (result) => result.finalDamage.finalDamage],
];

export function readCalculationComparisonValues(result: LoadoutCalculationResult): Record<string, number> {
  return Object.fromEntries(metrics.map(([key, , read]) => [key, read(result)]));
}

/** Compare the current loadout with the user's saved baseline. */
export function compareLoadoutResults(
  currentResult: LoadoutCalculationResult,
  baselineResult: LoadoutCalculationResult,
): CalculationComparisonRow[] {
  const current = readCalculationComparisonValues(currentResult);
  const baseline = readCalculationComparisonValues(baselineResult);
  return metrics.map(([key, label]) => {
    const expected = baseline[key];
    const actual = current[key];
    if (!Number.isFinite(expected)) throw new RangeError(`基準配置的${label}缺少有效數值。`);
    if (!Number.isFinite(actual)) throw new RangeError(`目前配置的${label}產生無效數值。`);
    const delta = actual - expected;
    const tolerance = Math.max(1e-12, 32 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)));
    return { key, label, expected, actual, delta, matches: Math.abs(delta) <= tolerance };
  });
}
