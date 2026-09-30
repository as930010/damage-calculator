import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateAttack, resolveAttackParameters } from '../dist/calculation/attack.js';
import { calculateFinalDamage } from '../dist/calculation/final-damage.js';
import { calculateProductStat } from '../dist/calculation/multiplicative.js';

const data = async name => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));

test('攻擊公式使用角色選擇的物／魔屬性，武器基值不再收到 attackType 文字', async () => {
  const params = await data('attack-parameters.json');
  const resolved = resolveAttackParameters(params, 'DaB', 13);
  const result = calculateAttack({
    attackType: 'magical', physicalAttack: 1202, magicalAttack: 1202,
    doubleAttackPct: 0, skillTypeAttackPct: 0, attackLevel: 0, ...resolved,
  });
  assert.equal(result.attackType, 'magical');
  assert.equal(result.c53, Math.floor(0.85 * 400 - 0.7775 * 400 + (0.15 * 400 - 0.0225 * 400) * 149 + 0.5) * 3.35);
  assert.equal(result.lowerDamage, Math.floor(1202 - 0.55 * result.d53));
  assert.equal(result.upperDamage, Math.floor(1202 + 0.55 * result.d53));
});
test('B163 對倍率、關卡懲罰及 150% 暴傷基準逐因子保留計算', () => {
  const damage = calculateFinalDamage({
    lowerDamage: 10000, upperDamage: 12000, critRate: 0.5, extremizationRate: 0.25,
    critDamagePct: 150, classCritDamagePassivePct: 30, multiplicativeCritDamageOffset: 0.797295,
    bossDamagePct: 0, polarizationPct: 0, transcendenceSkillDamagePct: 0, allSkillDamagePct: 0,
    bleedDamagePct: 0, fullHealthKillDamagePct: 0, strongerPct: 10, heatPct: 20,
    generalMultiplicativeDamage: 1.05, adaptabilityPct: 10, superAdaptabilityPct: 5,
    stageAdaptabilityPenaltyPct: 3, enemyDefensePct: 80, defenseIgnorePct: 20,
  });
  const base = ((10000 + (12000 - 10000) * 0.25) / 2) + 12000 / 2;
  const crit = 0.5 * (1.5 + 0.3 + 0.797295) + 0.5;
  const conditional = 1 / (0.5 / 1.1 + 0.5 / 1.2);
  const defense = 1 / (1 - 0.8 * 0.2);
  const expected = base * crit * conditional * 1.05 * (1 - 0.03 + 0.1 + 0.05) * defense;
  assert.equal(damage.finalDamage, expected);
  assert.equal(damage.conditionalFactor, 1 / ((0.5 / 1.1) + (0.5 / 1.2)));
  assert.notEqual(damage.conditionalFactor, (1.1 + 1.2) / 2);
});

test('150% 基底乘上暴上 +10% 後的乘算暴傷增幅為 15 個百分點', () => {
  const result = calculateProductStat([
    { sourceId: 'sheet:計算機!T101', valuePct: 10 },
    { sourceId: 'character-base:crit-damage-product', valuePct: 50 },
  ], 150);
  assert.ok(Math.abs(result.value - 0.15) < 1e-12);
  assert.ok(Math.abs(result.value * 100 - 15) < 1e-10);
});
