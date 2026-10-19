import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveNephronArmorSources, resolveGrettMedalMagazineBonuses } from '../dist/calculation/nephron-armor.js';
import { resolveInnerwearSources } from '../dist/calculation/innerwear.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const [armor, innerwear, attack] = await Promise.all([
  readJson('nephron-armor-rules.json'), readJson('innerwear-rules.json'), readJson('attack-parameters.json'),
]);
const statsFor = sourceList => Object.assign({}, ...sourceList.map(source => source.stats));

test('support magazines force level one without providing intrinsic damage stats', () => {
  for (const name of ['支援彈匣I', '支援彈匣II']) {
    const magazine = armor.magazines.find(entry => entry.name === name);
    assert.ok(magazine); assert.equal(magazine.fixedLevel, 1);
    for (const level of [undefined, '', 'Lv.1', 'Lv.6', 3]) {
      const sources = resolveNephronArmorSources(armor, [{
        slotId: 'upper', enhancement: 'Lv.10', transformations: [{},{},{}], magazine: name, magazineLevel: level,
      }]);
      assert.deepEqual(statsFor(sources), {});
      assert.equal(sources[0].sourceId, `nephron-magazine:upper:${magazine.id}:Lv.1`);
    }
  }
  assert.deepEqual(resolveGrettMedalMagazineBonuses(['支援彈匣I', '支援彈匣II']), [
    { sourceId: 'grett-medal:support-magazines', stats: { multiplicativeDamagePct: 1.5 } },
  ]);
});

test('Grett medal magazine bonuses use exactly one tier for 0, 1, 2 and 3 magazines', () => {
  for (const [prefix, sourceId, statKey, tiers] of [
    ['超級彈匣', 'super-magazines', 'multiplicativeDamagePct', [0, 0.5, 1, 1]],
    ['支援彈匣', 'support-magazines', 'multiplicativeDamagePct', [0, 1, 1.5, 1.5]],
    ['經典彈匣', 'classic-combat-magazines', 'multiplicativeCritDamagePct', [0, 0.5, 1, 1]],
    ['戰鬥彈匣', 'classic-combat-magazines', 'multiplicativeCritDamagePct', [0, 0.5, 1, 1]],
  ]) {
    for (let count = 0; count <= 3; count++) {
      // Synthetic full names exercise caps without adding equipment to the game catalog.
      const names = Array.from({ length: count }, (_, index) => `${prefix}[測試${index + 1}]`);
      assert.deepEqual(resolveGrettMedalMagazineBonuses(names), count === 0 ? []
        : [{ sourceId: `grett-medal:${sourceId}`, stats: { [statKey]: tiers[count] } }]);
    }
  }
});

test('Grett medal magazine groups coexist and classic plus combat magazines share one capped bonus', () => {
  const result = resolveGrettMedalMagazineBonuses([
    '超級彈匣[極度緩慢]', '超級彈匣[推進器]',
    '支援彈匣[測試1]', '支援彈匣[測試2]', '支援彈匣[測試3]',
    '經典彈匣Type - I', '戰鬥彈匣Type - I', '戰鬥彈匣Type - II', '其他彈匣', '',
  ]);
  assert.deepEqual(result, [
    { sourceId: 'grett-medal:super-magazines', stats: { multiplicativeDamagePct: 1 } },
    { sourceId: 'grett-medal:support-magazines', stats: { multiplicativeDamagePct: 1.5 } },
    { sourceId: 'grett-medal:classic-combat-magazines', stats: { multiplicativeCritDamagePct: 1 } },
  ]);
  assert.deepEqual(resolveGrettMedalMagazineBonuses(['經典彈匣Type - I', '戰鬥彈匣Type - I']), [result[2]]);
});

test('百億內裝鍛造的強烈技傷與超越技傷門檻、數值相同', () => {
  const transcendence = innerwear.forgingBonuses.find(entry => entry.statKey === 'transcendenceSkillDamagePct');
  const strong = innerwear.forgingBonuses.find(entry => entry.statKey === 'strongSkillDamagePct');
  assert.ok(transcendence);
  assert.ok(strong);
  assert.deepEqual(strong.steps, transcendence.steps);
  const slot = innerwear.slots.find(entry => entry.id === 'upper');
  for (const [forge, expected] of [[0, 0], [6, 3], [12, 6], [18, 10]]) {
    const groups = resolveInnerwearSources(innerwear, attack, 'KE', {
      [slot.typeField]: '百億', [slot.enhancementField]: 'Lv.8', [slot.forgingField]: forge,
    }, false);
    const source = groups.shared.find(entry => entry.sourceId === 'innerwear:upper');
    assert.equal(source.stats.strongSkillDamagePct, expected, 'strong forge ' + forge);
    assert.equal(source.stats.transcendenceSkillDamagePct, expected, 'transcendence forge ' + forge);
  }
});

test('Nephron forge attack table and cumulative milestone bonuses match the supplied values', () => {
  assert.deepEqual(Object.values( innerwear.nephron.forgingAttack), [
    0,119,238,357,476,595,714,833,952,1071,1190,1309,1428,1547,1666,1785,1904,2023,2142,2261,2380,2500,
  ]);
  assert.deepEqual(innerwear.nephron.enhancementStats['10'], { bossDamagePct: 5 });
  assert.deepEqual(innerwear.nephron.enhancementStats['11'], { bossDamagePct: 5, superAdaptabilityPct: 2 });
  const slot = innerwear.slots.find(entry => entry.id === 'upper');
  for (const [forge, expected] of [
    [2, {}], [3, { critDamagePct: 3 }], [6, { critDamagePct: 3, transcendenceSkillDamagePct: 3, strongSkillDamagePct: 3 }],
    [9, { critDamagePct: 3, transcendenceSkillDamagePct: 3, strongSkillDamagePct: 3, doubleAttackPct: 3 }],
    [12, { critDamagePct: 3, transcendenceSkillDamagePct: 6, strongSkillDamagePct: 6, doubleAttackPct: 3 }],
    [15, { critDamagePct: 3, transcendenceSkillDamagePct: 6, strongSkillDamagePct: 6, doubleAttackPct: 3, adaptabilityPct: 2 }],
    [18, { critDamagePct: 3, transcendenceSkillDamagePct: 10, strongSkillDamagePct: 10, doubleAttackPct: 3, adaptabilityPct: 2 }],
    [19, { critDamagePct: 3, transcendenceSkillDamagePct: 10, strongSkillDamagePct: 10, doubleAttackPct: 3, adaptabilityPct: 2 }],
    [21, { critDamagePct: 3, transcendenceSkillDamagePct: 10, strongSkillDamagePct: 10, doubleAttackPct: 3, adaptabilityPct: 2, superAdaptabilityPct: 2.5 }],
  ]) {
    const values = { [slot.typeField]: '內布隆', [slot.enhancementField]: 'Lv.11', [slot.forgingField]: forge };
    const groups = resolveInnerwearSources(innerwear, attack, 'KE', values, false);
    const source = groups.shared.find(entry => entry.sourceId === 'innerwear:upper');
    assert.ok(source, `forge ${forge}: upper source missing`);
    const expectedStats = { ...expected, bossDamagePct: 5, superAdaptabilityPct: expected.superAdaptabilityPct ?? 2, adaptabilityPct: 2 + (expected.adaptabilityPct ?? 0) };
    for (const [key, value] of Object.entries(expectedStats)) assert.equal(source.stats[key], value, `forge ${forge}: ${key}`);
    for (const key of ['critDamagePct','transcendenceSkillDamagePct','strongSkillDamagePct','doubleAttackPct']) {
      if (!(key in expected)) assert.equal(source.stats[key] ?? 0, 0, `forge ${forge}: unexpected ${key}`);
    }
  }
});

test('Nephron transformation attributes cannot repeat within one armor item, except unrelated damage', () => {
  const repeated = { attribute: '雙攻%（依強化等級）', value: 0.002 };
  const empty = { attribute: '', value: undefined };
  const selection = (slotId, transformations) => ({
    slotId, enhancement: 'Lv.10', magazine: '', magazineLevel: '', transformations,
  });
  assert.throws(() => resolveNephronArmorSources(armor, [
    selection('upper', [repeated, repeated, empty]),
  ]), /變換屬性不可重複/);
  assert.deepEqual(resolveNephronArmorSources(armor, [
    selection('upper', [
      { attribute: '無關傷害', value: 0 },
      { attribute: '無關傷害', value: 0 },
      { attribute: '無關傷害', value: 0 },
    ]),
  ]), []);
  const contributions = resolveNephronArmorSources(armor, [
    selection('upper', [repeated, empty, empty]),
    selection('gloves', [repeated, empty, empty]),
  ]);
  assert.equal(contributions.filter(source => source.sourceId.startsWith('nephron-transform:')).length, 2);
});

test('all Nephron transformations expose ten exact tiers and first three scale by enhancement level', () => {
  const expected = [
    [0.02,0.04,0.06,0.08,0.10,0.12,0.14,0.16,0.18,0.20],
    [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1],
    [0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,1.1,1.2],
  ];
  assert.equal(armor.transformations.length, 16);
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

test('all Nephron magazines retain their specified values and resolve the advertised stat', () => {
  const regular = [0.5,1,1.5,2,2.5,3];
  assert.equal(armor.magazines.length, 10);
  for (const magazine of armor.magazines) {
    assert.deepEqual(magazine.levelValuesPct, magazine.fixedLevel === 1 ? [0,0,0,0,0,0]
      : magazine.id === 'super-booster' ? [0.5,1,1.5,2,3,4] : regular, magazine.name);
  }
  const slow = resolveNephronArmorSources(armor, [{
    slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'超級彈匣[極度緩慢]', magazineLevel:'Lv.5',
  }]);
  assert.deepEqual(statsFor(slow), { multiplicativeDamagePct: 2.5 });
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

  const bothSkillTypes = resolveNephronArmorSources(armor, [{
    slotId: 'upper', enhancement: 'Lv.10', magazine: '', magazineLevel: '',
    transformations: [
      { attribute: '強烈技傷%', value: 0.01 },
      { attribute: '超越技傷%', value: 0.01 },
      { attribute: '', value: undefined },
    ],
  }]);
  assert.deepEqual(statsFor(bothSkillTypes), { strongSkillDamagePct: 1, transcendenceSkillDamagePct: 1 });
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
      for (const additionalStatKey of magazine.additionalLevelStatKeys ?? []) {
        expected[additionalStatKey] = (expected[additionalStatKey] ?? 0) + value;
      }
      assert.deepEqual(statsFor(sources), expected, magazine.name + ' Lv.' + (index + 1));
    }
  }
  assert.throws(() => resolveNephronArmorSources(armor, [
    { slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.4' },
    { slotId:'gloves', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.4' },
  ]), /不可重複/);
  assert.throws(() => resolveNephronArmorSources(armor, [
    { slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.4' },
    { slotId:'gloves', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'戰鬥彈匣Type - I', magazineLevel:'Lv.5' },
  ]), /相同名稱/);
  assert.doesNotThrow(() => resolveNephronArmorSources(armor, [
    { slotId:'upper', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'超級彈匣[極度緩慢]', magazineLevel:'Lv.4' },
    { slotId:'gloves', enhancement:'Lv.10', transformations:[{},{},{}], magazine:'超級彈匣[推進器]', magazineLevel:'Lv.4' },
  ]));
});

test('Nephron and Billion share the attack enhancement formula for every innerwear slot and level', () => {
  for (const slot of innerwear.slots) {
    const attackKey = slot.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    for (let level = 8; level <= 13; level += 1) {
      const input = { [slot.enhancementField]: 'Lv.' + level, [slot.forgingField]: 0 };
      const collect = type => {
        const groups = resolveInnerwearSources(innerwear, attack, 'KE', { ...input, [slot.typeField]: type }, true);
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
      [slot.typeField]: '內布隆', [slot.enhancementField]: 'Lv.' + level, [slot.forgingField]: 0,
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


test('Nephron armor intrinsic adaptability +2 applies to every slot and supported enhancement level', () => {
  for (const slot of innerwear.slots) {
    for (let level = 8; level <= 13; level += 1) {
      const groups = resolveInnerwearSources(innerwear, attack, 'KE', {
        [slot.typeField]: '內布隆',
        [slot.enhancementField]: 'Lv.' + level,
        [slot.forgingField]: 0,
      }, true);
      const source = [...groups.shared, ...groups.lowerwearA, ...groups.lowerwearB]
        .find(entry => entry.sourceId === 'innerwear:' + slot.id);
      assert.equal(source.stats.adaptabilityPct, 2, slot.id + ' Lv.' + level);
    }
  }
});
