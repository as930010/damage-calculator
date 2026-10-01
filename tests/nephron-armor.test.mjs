import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveNephronArmorSources } from '../dist/calculation/nephron-armor.js';
import { resolveInnerwearSources } from '../dist/calculation/innerwear.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const [armor, innerwear, attack] = await Promise.all([
  readJson('nephron-armor-rules.json'), readJson('innerwear-rules.json'), readJson('attack-parameters.json'),
]);
const statsFor = sourceList => Object.assign({}, ...sourceList.map(source => source.stats));

test('Nephron forge attack table and cumulative milestone bonuses match the supplied values', () => {
  assert.deepEqual(Object.values( innerwear.nephron.forgingAttack), [
    0,119,238,357,476,595,714,833,952,1071,1190,1309,1428,1547,1666,1785,1904,2023,2142,2261,2380,2500,
  ]);
  assert.deepEqual(innerwear.nephron.enhancementStats['10'], { bossDamagePct: 5 });
  assert.deepEqual(innerwear.nephron.enhancementStats['11'], { bossDamagePct: 5, superAdaptabilityPct: 2 });
  const slot = innerwear.slots.find(entry => entry.id === 'upper');
  for (const [forge, expected] of [
    [2, {}], [3, { critDamagePct: 3 }], [6, { critDamagePct: 3, transcendenceSkillDamagePct: 3 }],
    [9, { critDamagePct: 3, transcendenceSkillDamagePct: 3, doubleAttackPct: 3 }],
    [12, { critDamagePct: 3, transcendenceSkillDamagePct: 6, doubleAttackPct: 3 }],
    [15, { critDamagePct: 3, transcendenceSkillDamagePct: 6, doubleAttackPct: 3, adaptabilityPct: 2 }],
    [18, { critDamagePct: 3, transcendenceSkillDamagePct: 10, doubleAttackPct: 3, adaptabilityPct: 2 }],
    [19, { critDamagePct: 3, transcendenceSkillDamagePct: 10, doubleAttackPct: 3, adaptabilityPct: 2 }],
    [21, { critDamagePct: 3, transcendenceSkillDamagePct: 10, doubleAttackPct: 3, adaptabilityPct: 2, superAdaptabilityPct: 2.5 }],
  ]) {
    const values = { [slot.typeCell]: '內布隆', [slot.enhancementCell]: 'Lv.11', [slot.forgingCell]: forge };
    const groups = resolveInnerwearSources(innerwear, attack, 'KE', values, false);
    const source = groups.shared.find(entry => entry.sourceId === 'innerwear:upper');
    assert.ok(source, `forge ${forge}: upper source missing`);
    const expectedStats = { bossDamagePct: 5, superAdaptabilityPct: 2, ...expected };
    for (const [key, value] of Object.entries(expectedStats)) assert.equal(source.stats[key], value, `forge ${forge}: ${key}`);
    for (const key of ['critDamagePct','transcendenceSkillDamagePct','doubleAttackPct','adaptabilityPct']) {
      if (!(key in expected)) assert.equal(source.stats[key] ?? 0, 0, `forge ${forge}: unexpected ${key}`);
    }
  }
});

test('all Nephron transformations expose ten exact tiers and first three scale by enhancement level', () => {
  const expected = [
    [0.02,0.04,0.06,0.08,0.10,0.12,0.14,0.16,0.18,0.20],
    [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1],
    [0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1,1.2],
  ];
  assert.equal(armor.transformations.length, 15);
  for (const option of armor.transformations) {
    if (option.name === '無關傷害') {
      assert.deepEqual(option.tierValuesPct, []);
      continue;
    }
    assert.equal(option.tierValuesPct.length, 10, option.name);
    const tierGroup = option.multipliesByEnhancementLevel ? expected[0] : option.id === 'crit-rate' || option.id === 'extremization' ? expected[2] : expected[1];
    assert.deepEqual(option.tierValuesPct, tierGroup, option.name);
  }
  const sources = resolveNephronArmorSources(armor, [{
    slotId: 'upper', enhancement: 'Lv.10', magazine: '', magazineLevel: '',
    transformations: [
      { attribute: '雙攻%（依強化等級）', value: 0.002 },
      { attribute: '流血%', value: 0.01 },
      { attribute: '無關傷害' },
    ],
  }]);
  assert.deepEqual(statsFor(sources), { doubleAttackPct: 2, bleedDamagePct: 1 });
  const enhancementScaledSources = resolveNephronArmorSources(armor, [{
    slotId: 'upper', enhancement: 'Lv.12', magazine: '', magazineLevel: '',
    transformations: [
      { attribute: '雙攻%（依強化等級）', value: 0.0014 },
      { attribute: '', value: undefined }, { attribute: '', value: undefined },
    ],
  }]);
  assert.ok(Math.abs(statsFor(enhancementScaledSources).doubleAttackPct - 1.68) < 1e-12);
  assert.throws(() => resolveNephronArmorSources(armor, [{
    slotId: 'upper', enhancement: 'Lv.10', magazine: '', magazineLevel: '',
    transformations: [
      { attribute: '雙攻%（依強化等級）', value: 0.0001 },
      { attribute: '', value: undefined }, { attribute: '', value: undefined },
    ],
  }]), /十檔/);
});

test('all Nephron magazines have six specified levels and resolve the advertised stat', () => {
  const regular = [0.5,1,1.5,2,2.5,3];
  assert.equal(armor.magazines.length, 8);
  for (const magazine of armor.magazines) {
    assert.deepEqual(magazine.levelValuesPct, magazine.id === 'super-booster' ? [0.5,1,1.5,2,3,4] : regular, magazine.name);
  }
  const slow = resolveNephronArmorSources(armor, [{
    slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'超級彈匣[極度緩慢]', magazineLevel:'Lv.5',
  }]);
  assert.deepEqual(statsFor(slow), { allSkillDamagePct: 2.5 });
  const booster = resolveNephronArmorSources(armor, [{
    slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'超級彈匣[推進器]', magazineLevel:'Lv.6',
  }]);
  assert.deepEqual(statsFor(booster), { polarizationPct: -10, superAdaptabilityPct: 4 });
  assert.throws(() => resolveNephronArmorSources(armor, [
    { slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.1' },
    { slotId:'gloves', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.1' },
  ]), /不可重複/);
});

test('all transformation tiers map to the stated stat, and only the first three scale with enhancement', () => {
  for (const option of armor.transformations.filter(entry => entry.statKey)) {
    for (const [tierIndex, tierValuePct] of option.tierValuesPct.entries()) {
      const sources = resolveNephronArmorSources(armor, [{
        slotId: 'upper', enhancement: 'Lv.12', magazine: '', magazineLevel: '',
        transformations: [
          { attribute: option.name, value: tierValuePct / 100 },
          { attribute: '', value: undefined }, { attribute: '', value: undefined },
        ],
      }]);
      const actual = statsFor(sources);
      const expected = tierValuePct * (option.multipliesByEnhancementLevel ? 12 : 1);
      assert.ok(Math.abs(actual[option.statKey] - expected) < 1e-10, option.name + ' tier ' + (tierIndex + 1));
      assert.deepEqual(Object.keys(actual), [option.statKey], option.name + ' tier ' + (tierIndex + 1) + ': stat mapping');
    }
  }
  const unrelated = resolveNephronArmorSources(armor, [{
    slotId: 'upper', enhancement: 'Lv.10', magazine: '', magazineLevel: '',
    transformations: [{ attribute: '無關傷害' }, { attribute: '', value: undefined }, { attribute: '', value: undefined }],
  }]);
  assert.deepEqual(statsFor(unrelated), {});
});

test('every Nephron magazine level resolves to its mapped stat and duplicate rule', () => {
  for (const magazine of armor.magazines) {
    for (const [index, value] of magazine.levelValuesPct.entries()) {
      const sources = resolveNephronArmorSources(armor, [{
        slotId: 'upper', enhancement: 'Lv.10', transformations: [{},{},{}],
        magazine: magazine.name, magazineLevel: 'Lv.' + (index + 1),
      }]);
      const expected = { ...(magazine.baseStats ?? {}) };
      const statKey = magazine.levelStatKey ?? magazine.statKey;
      if (statKey) expected[statKey] = (expected[statKey] ?? 0) + value;
      assert.deepEqual(statsFor(sources), expected, magazine.name + ' Lv.' + (index + 1));
    }
  }
  assert.throws(() => resolveNephronArmorSources(armor, [
    { slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.4' },
    { slotId:'gloves', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.4' },
  ]), /不可重複/);
  assert.doesNotThrow(() => resolveNephronArmorSources(armor, [
    { slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.4' },
    { slotId:'gloves', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.5' },
  ]));
});

test('Nephron and Billion share the attack enhancement formula for every innerwear slot and level', () => {
  for (const slot of innerwear.slots) {
    const attackKey = slot.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    for (let level = 8; level <= 13; level += 1) {
      const input = { [slot.enhancementCell]: 'Lv.' + level, [slot.forgingCell]: 0 };
      const collect = type => {
        const groups = resolveInnerwearSources(innerwear, attack, 'KE', { ...input, [slot.typeCell]: type }, true);
        return [...groups.shared, ...groups.lowerwearA, ...groups.lowerwearB]
          .find(source => source.sourceId === 'innerwear:' + slot.id);
      };
      const billion = collect('百億');
      const nephron = collect('內布隆');
      assert.equal(nephron.stats[attackKey], billion.stats[attackKey], slot.id + ' Lv.' + level + ' attack');
    }
  }
});

test('Nephron enhancement Lv.10 and Lv.11 bonuses persist at higher supported levels', () => {
  const slot = innerwear.slots.find(entry => entry.id === 'upper');
  for (const [level, expected] of [
    [8, {}], [9, {}], [10, { bossDamagePct: 5 }],
    [11, { bossDamagePct: 5, superAdaptabilityPct: 2 }],
    [12, { bossDamagePct: 5, superAdaptabilityPct: 2 }],
    [13, { bossDamagePct: 5, superAdaptabilityPct: 2 }],
  ]) {
    const source = resolveInnerwearSources(innerwear, attack, 'KE', {
      [slot.typeCell]: '內布隆', [slot.enhancementCell]: 'Lv.' + level, [slot.forgingCell]: 0,
    }, false).shared.find(entry => entry.sourceId === 'innerwear:upper');
    for (const key of ['bossDamagePct', 'superAdaptabilityPct']) {
      assert.equal(source.stats[key] ?? 0, expected[key] ?? 0, 'Lv.' + level + ' ' + key);
    }
  }
});


test('duplicate magazines compare normalized levels, including numeric aliases', () => {
  assert.throws(() => resolveNephronArmorSources(armor, [
    { slotId: 'upper', enhancement: 'Lv.10', transformations: [{},{},{}], magazine: '戰鬥彈匣Type - I', magazineLevel: 'Lv.1' },
    { slotId: 'gloves', enhancement: 'Lv.10', transformations: [{},{},{}], magazine: '戰鬥彈匣Type - I', magazineLevel: 1 },
  ]), /不可重複/);
});
