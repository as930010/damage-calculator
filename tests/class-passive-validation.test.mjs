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

test('職業致命傷害被動依使用者指定加算值與覆寫值保存', async () => {
  const document = await readJson('class-damage-passives.json');
  const classesDocument = await readJson('classes.json');
  const expected = {
    KE: 8, IM: 20, GE: 20, MM: 27, AN: 50, TW: 30, PR: 48, FB: 20, RH: 20, NI: 10,
    RE: 20, CU: 20, CS: 15, CA: 20, FP: 10, VI: 15, BR: 20, SH: 20, SU: 25, ES: 16,
    FL: 15, BQ: 15, AD: 20, DB: 42, DN: 15, MP: 15, OM: 10, CT: 23, IN: 25, DA: 12, DE: 0,
    TB: 10, BMa: 10, MN: 15, PO: 20, RI: 20, BL: 25, BI: 27, EW: 15, RS: 20, NL: 15, TP: 20,
    LI: 20, CEL: 20, NP: 25, MO: 15, GB: 20, AV: 25, AC: 26, MI: 24
  };
  const preserved = { DaB: 30 };
  for (const [classId, valuePct] of Object.entries(document.critDamagePctByClass)) assert.equal(valuePct, expected[classId] ?? preserved[classId] ?? 0, classId);
  assert.deepEqual(Object.keys(document.critDamagePctByClass).sort(), classesDocument.classes.map(entry => entry.id).sort());
});

test('Boss 傷害被動只保留明確提供的增幅', async () => {
  const document = await readJson('class-damage-passives.json');
  const classesDocument = await readJson('classes.json');
  const expected = { IM: 20, TW: 10, PR: 10, FB: 15, RE: 20, CU: 15, CS: 20, CA: 12, CC: 20, CeT: 10, VI: 15, AD: 3, BMa: 15, PO: 10, RI: 10, RS: 10, LI: 8, CEL: 20, MO: 15, AV: 15, MI: 12.5 };
  for (const [classId, valuePct] of Object.entries(document.bossDamagePctByClass)) assert.equal(valuePct, expected[classId] ?? 0, classId);
  assert.deepEqual(Object.keys(document.bossDamagePctByClass).sort(), classesDocument.classes.map(entry => entry.id).sort());
});

test('LA、HE、EW、TB、BMa、MN、PO 的乘算爆傷為獨立乘積來源', async () => {
  const document = await readJson('class-damage-passives.json');
  const classesDocument = await readJson('classes.json');
  const expected = { LA: [5], HE: [28], EW: [20], CT: [23], IN: [23], DA: [23], DE: [23], TB: [10], BMa: [10], MN: [10], PO: [10] };
  for (const [classId, values] of Object.entries(document.multiplicativeCritDamagePctByClass)) assert.deepEqual(values, expected[classId] ?? [], classId);
  assert.deepEqual(Object.keys(document.multiplicativeCritDamagePctByClass).sort(), classesDocument.classes.map(entry => entry.id).sort());
});
