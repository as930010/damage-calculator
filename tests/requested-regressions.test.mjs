import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveResonanceEffects, resolveRightIceSetEffects } from '../dist/calculation/equipment-effects.js';
import { calculateFinalDamage } from '../dist/calculation/final-damage.js';
import { codeForFieldId } from '../dist/frontend/field-ids.js';
import { deserializeLoadout } from '../dist/frontend/loadout-transfer.js';
import { parseTranscendenceSkillDamageShareInput, readState } from '../dist/frontend/state.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

function finalDamageForShare(share) {
  return calculateFinalDamage({
    lowerDamage: 100,
    upperDamage: 100,
    critRate: 0,
    extremizationRate: 0,
    critDamagePct: 0,
    classCritDamagePassivePct: 0,
    multiplicativeCritDamageOffset: 0,
    bossDamagePct: 0,
    polarizationPct: 0,
    transcendenceSkillDamagePct: 127,
    strongSkillDamagePct: 90,
    transcendenceSkillDamageSharePct: share,
    allSkillDamagePct: 0,
    bleedDamagePct: 0,
    fullHealthKillDamagePct: 0,
    strongerPct: 0,
    heatPct: 0,
    generalMultiplicativeDamage: 1,
    adaptabilityPct: 0,
    superAdaptabilityPct: 0,
    stageAdaptabilityPenaltyPct: 0,
    enemyDefensePct: 0,
    defenseIgnorePct: 0,
  });
}

test('強烈／超越技傷占比接受 0 與 100 端點，且加權倍率端點正確', () => {
  assert.equal(parseTranscendenceSkillDamageShareInput('0'), 0);
  assert.equal(parseTranscendenceSkillDamageShareInput('100'), 100);
  assert.equal(parseTranscendenceSkillDamageShareInput('100.01'), null);
  assert.equal(parseTranscendenceSkillDamageShareInput('-1'), null);
  assert.equal(parseTranscendenceSkillDamageShareInput('1e2'), null);

  assert.equal(finalDamageForShare(100).damageFactors.skillDamage, 2.27);
  assert.equal(finalDamageForShare(100).finalDamage, 227);
  assert.equal(finalDamageForShare(0).damageFactors.skillDamage, 1.9);
  assert.equal(finalDamageForShare(0).finalDamage, 190);
  assert.equal(finalDamageForShare(40).damageFactors.skillDamage, 2.048);
  assert.equal(finalDamageForShare(40).finalDamage, 204.8);
  assert.throws(() => finalDamageForShare(-0.01), /between 0 and 100/);
  assert.throws(() => finalDamageForShare(100.01), /between 0 and 100/);
});

test('舊版配裝匯入保留有效共鳴值，清除負數、小數及超過欄位上限的值', async () => {
  const data = await readJson('dist/data/game-data.json');
  const fieldCode = fieldId => {
    const code = codeForFieldId(fieldId);
    assert.notEqual(code, undefined, `missing transfer code for ${fieldId}`);
    return String(code);
  };
  const oldLoadout = {
    format: 'damage-calculator-loadout',
    formatVersion: 3,
    Job: 'KE',
    // Earlier exports did not carry schemaVersion, share percentage, or the newer toggles.
    values: {
      [fieldCode('Resonance.AllATK.Points')]: 0,
      [fieldCode('Resonance.TranscendenceSkillDMG.Points')]: 100,
      [fieldCode('Resonance.Polarization.Points')]: 50,
      [fieldCode('Resonance.BossDMG.Points')]: 50,
      [fieldCode('Resonance.Adapt.Points')]: 100,
    },
  };

  const current = {
    schemaVersion: 3,
    Job: 'KE',
    values: {},
    lowerwearAlternativeEnabled: false,
    masterBeastSpiritStoneColor: '黃',
    petSkillAttackEnabled: true,
    transcendenceSkillDamageSharePct: 100,
  };
  const result = deserializeLoadout(oldLoadout, current, data);

  assert.equal(result.state.transcendenceSkillDamageSharePct, 100);
  assert.deepEqual(result.state.values, {
    'Resonance.AllATK.Points': 0,
    'Resonance.TranscendenceSkillDMG.Points': 100,
    'Resonance.Polarization.Points': 50,
    'Resonance.BossDMG.Points': 50,
    'Resonance.Adapt.Points': 100,
  });
  assert.equal(result.clearedFields.some(field => field.startsWith('Resonance.')), false);

  const malformed = {
    ...oldLoadout,
    values: {
      [fieldCode('Resonance.AllATK.Points')]: 1000,
      [fieldCode('Resonance.TranscendenceSkillDMG.Points')]: 1.5,
      [fieldCode('Resonance.Polarization.Points')]: -1,
      [fieldCode('Resonance.BossDMG.Points')]: '1e2',
      [fieldCode('Resonance.Adapt.Points')]: '101',
    },
  };
  const invalid = deserializeLoadout(malformed, current, data);
  assert.deepEqual(invalid.state.values, {});
  for (const field of [
    'Resonance.AllATK.Points',
    'Resonance.TranscendenceSkillDMG.Points',
    'Resonance.Polarization.Points',
    'Resonance.BossDMG.Points',
    'Resonance.Adapt.Points',
  ]) assert.ok(invalid.clearedFields.includes(field), `invalid value should be reported: ${field}`);
});

test('計算入口再次驗證共鳴輸入範圍，0 與空欄視為未分配', async () => {
  const document = await readJson('data/resonance-effects.json');
  const pointCell = 'Resonance.TranscendenceSkillDMG.Points';
  const input = value => ({ [pointCell]: value });

  assert.deepEqual(resolveResonanceEffects(document, input(0)), []);
  assert.deepEqual(resolveResonanceEffects(document, input('')), []);
  assert.equal(resolveResonanceEffects(document, input(100))[0].stats.transcendenceSkillDamagePct, 35);
  assert.equal(resolveResonanceEffects(document, input(100))[0].stats.strongSkillDamagePct, 35);
  for (const invalid of [-1, 1.5, 101, '1e2', '100.0']) {
    assert.throws(() => resolveResonanceEffects(document, input(invalid)), /範圍內的非負整數/);
  }
});

test('載入舊本機狀態時只保留範圍內的共鳴非負整數', () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = JSON.stringify({
    schemaVersion: 3,
    Job: 'KE',
    values: {
      'Resonance.AllATK.Points': '0',
      'Resonance.TranscendenceSkillDMG.Points': '100',
      'Resonance.Polarization.Points': '-1',
      'Resonance.BossDMG.Points': '1.5',
      'Resonance.Adapt.Points': '1e2',
      'Weapon.ENHC': 'Lv.12',
    },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: key => key === 'dab-loadout-v1' ? stored : null },
  });
  try {
    const state = readState('KE');
    assert.deepEqual(state.values, {
      'Resonance.AllATK.Points': 0,
      'Resonance.TranscendenceSkillDMG.Points': 100,
      'Weapon.ENHC': 'Lv.12',
    });
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  }
});

test('右冰套效在 2 件與 3 件以上分別套用對應最高階，幻影面紗 3 件保留 2set 流血', async () => {
  const document = await readJson('data/equipment/right-ice-set-effects.json');
  const setName = '幻影面紗';
  const effectsAt = count => resolveRightIceSetEffects(
    document,
    Array.from({ length: count }, () => setName),
    [setName],
  );

  assert.deepEqual(effectsAt(1), []);
  assert.deepEqual(effectsAt(2).map(effect => effect.stats), [{ bleedDamagePct: 10 }]);
  assert.deepEqual(effectsAt(3).map(effect => effect.stats), [{ bleedDamagePct: 10, fullHealthKillDamagePct: 10 }]);
  assert.deepEqual(effectsAt(4).map(effect => effect.stats), [{ bleedDamagePct: 10, fullHealthKillDamagePct: 10 }]);
});
