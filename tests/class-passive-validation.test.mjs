import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCombatRates } from '../dist/calculation/engine.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const classes = ['ES', 'BQ', 'DE'];

function spreadsheetCritTier(pct) {
  const raw = pct / 100;
  return Math.min(Math.max(0, raw), 0.4)
    + 0.8 * Math.min(Math.max(0, raw - 0.4), 0.35)
    + 0.6 * Math.min(Math.max(0, raw - 0.75), 0.3)
    + 0.4 * Math.min(Math.max(0, raw - 1.05), 0.35);
}

function spreadsheetExtremizationTier(pct) {
  const raw = pct / 100;
  return Math.min(Math.max(0, raw), 0.4)
    + 0.75 * Math.min(Math.max(0, raw - 0.4), 0.4)
    + 0.5 * Math.min(Math.max(0, raw - 0.8), 0.4)
    + 0.25 * Math.min(Math.max(0, raw - 1.2), 0.4);
}

test('ES、BQ、DE 被動方式與各自重複來源都保留', async () => {
  const document = await readJson('class-combat-effects.json');
  const expectedProfiles = {
    ES: { critRate: [['diminishing', 10], ['multiplicative', 15]], extremization: [['diminishing', 10], ['multiplicative', 15]] },
    BQ: { critRate: [['nonDiminishing', 18], ['multiplicative', 5]], extremization: [['nonDiminishing', 20], ['multiplicative', 5]] },
    DE: { critRate: [['diminishing', 23], ['nonDiminishing', 15]], extremization: [['nonDiminishing', 15]] },
  };
  const baseCritRatePct = 42.5;
  const baseExtremizationPct = 55;

  for (const classId of classes) {
    const profile = document.classes[classId];
    for (const attribute of ['critRate', 'extremization']) {
      assert.deepEqual(profile[attribute].map(effect => [effect.method, effect.valuePct]), expectedProfiles[classId][attribute], `${classId}.${attribute}`);
    }

    const actual = calculateCombatRates({ classId, classEffects: document, baseCritRatePct, baseExtremizationPct });
    for (const [attribute, rawBase, tierFn] of [
      ['critRate', baseCritRatePct, spreadsheetCritTier],
      ['extremization', baseExtremizationPct, spreadsheetExtremizationTier],
    ]) {
      const effects = expectedProfiles[classId][attribute];
      const diminishing = effects.filter(([method]) => method === 'diminishing').reduce((sum, [, value]) => sum + value, 0);
      const multiplier = effects.filter(([method]) => method === 'multiplicative').reduce((product, [, value]) => product * (1 + value / 100), 1);
      const nonDiminishing = effects.filter(([method]) => method === 'nonDiminishing').reduce((sum, [, value]) => sum + value, 0);
      const expected = Math.min(1, tierFn(rawBase + diminishing) * multiplier + nonDiminishing / 100);
      assert.ok(Math.abs(actual[attribute].finalRate - expected) < 1e-12, `${classId}.${attribute}: ${actual[attribute].finalRate} != ${expected}`);
    }
  }

  const esRates = calculateCombatRates({ classId: 'ES', classEffects: document, baseCritRatePct, baseExtremizationPct });
  assert.ok(Math.abs(esRates.critRate.finalRate - 0.575) < 1e-12);
  assert.ok(Math.abs(esRates.extremization.finalRate - 0.675625) < 1e-12);

  const bqRates = calculateCombatRates({ classId: 'BQ', classEffects: document, baseCritRatePct, baseExtremizationPct });
  assert.ok(Math.abs(bqRates.critRate.finalRate - 0.621) < 1e-12);
  assert.ok(Math.abs(bqRates.extremization.finalRate - 0.738125) < 1e-12);
});

test('爆擊與極大化超過 100% 時僅以 100% 實戰機率計算', async () => {
  const document = await readJson('class-combat-effects.json');
  const actual = calculateCombatRates({
    classId: 'ES', classEffects: document, baseCritRatePct: 200, baseExtremizationPct: 200,
    otherCritEffects: [{ sourceId: 'over-cap-crit', method: 'nonDiminishing', valuePct: 50 }],
    otherExtremizationEffects: [{ sourceId: 'over-cap-extreme', method: 'nonDiminishing', valuePct: 50 }],
  });
  assert.ok(actual.critRate.valueBeforeUpperCap > 1);
  assert.ok(actual.extremization.valueBeforeUpperCap > 1);
  assert.equal(actual.critRate.finalRate, 1);
  assert.equal(actual.extremization.finalRate, 1);
});
