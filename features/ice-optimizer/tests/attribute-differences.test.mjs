import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeDifferences } from '../../../dist/features/ice-optimizer/frontend/attribute-differences.js';

const data = {
  classes: { classes: [{ id: 'test', attackType: 'physical' }] },
  attributes: { attributes: [
    { key: 'physicalAttack', name: '物攻', unit: 'flat' },
    { key: 'magicalAttack', name: '魔攻', unit: 'flat' },
    { key: 'doubleAttackPct', name: '雙攻%', unit: 'percent' },
    { key: 'polarizationPct', name: '兩極化%', unit: 'percent' },
    { key: 'critDamagePct', name: '致命傷害%', unit: 'percent' },
  ] },
};

function projection({ attack = 100, double = 10, polarization = 20, crit = 30,
  critProduct = 0.05, stronger = 3, multiplier = 1.08 } = {}) {
  const stat = finalTotal => ({ finalTotal });
  return {
    attributes: {
      stats: {
        physicalAttack: stat(attack), magicalAttack: stat(80),
        doubleAttackPct: stat(double), polarizationPct: stat(polarization),
        critDamagePct: stat(crit),
      },
      conditionalDamage: { strongerPct: stronger, heatPct: 0 },
    },
    result: {
      classCritDamagePassivePct: 15,
      multiplicativeCritDamage: { value: critProduct },
      generalMultiplicativeDamage: { value: multiplier },
    },
  };
}

test('推薦穿搭只顯示有效屬性總差，不逐項列出裝備來源', () => {
  const before = projection();
  const after = projection({ attack: 135, double: 12.5, polarization: 19,
    critProduct: 0.08, stronger: 0, multiplier: 1.12 });
  assert.deepEqual(attributeDifferences(data, 'test', before, after), [
    '攻擊力 +35', '雙攻 +2.5%', '兩極化 −1%', '致命傷害 +3%',
    '強者 −3%', '乘算效果倍率 +0.04×',
  ]);
  assert.deepEqual(attributeDifferences(data, 'test', before, before), []);
});
