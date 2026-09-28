import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveRightIceSetEffects } from '../dist/calculation/equipment-effects.js';

const readJson = async path => JSON.parse(await readFile(new URL(`../data/${path}`, import.meta.url), 'utf8'));

function expectedForSet(document, setName, count) {
  const tiers = document.effects.filter(effect => effect.active && effect.setName === setName);
  const eligible = tiers.filter(effect => effect.requiredPieces.operator === 'exactly'
    ? count === effect.requiredPieces.count
    : count >= effect.requiredPieces.count);
  return eligible.sort((a, b) => b.requiredPieces.count - a.requiredPieces.count)[0] ?? null;
}

test('每套右冰的 0～4 件門檻各自對應目前試算表的 exactly／atLeast 規則', async () => {
  const document = await readJson('equipment/right-ice-set-effects.json');
  const setNames = [...new Set(document.effects.map(effect => effect.setName))];
  for (const setName of setNames) {
    for (const count of [0, 1, 2, 3, 4]) {
      const actual = resolveRightIceSetEffects(document, Array.from({ length: count }, () => setName), [setName]);
      const expected = expectedForSet(document, setName, count);
      assert.deepEqual(
        actual.map(effect => [effect.sourceId, effect.stats]),
        expected ? [[expected.id, expected.stats]] : [],
        `${setName} ${count} 件`,
      );
    }
  }
});

test('七套候選右冰隨機配置在六個部位、選取 1～3 套時只套用已選套效與符合件數的最高階效果', async () => {
  const document = await readJson('equipment/right-ice-set-effects.json');
  const setNames = [...new Set(document.effects.map(effect => effect.setName))].slice(0, 7);
  assert.equal(setNames.length, 7);

  // Deterministic pseudo-random sequence keeps the cases reproducible.
  let seed = 930010;
  const random = max => {
    seed = (seed * 48271) % 0x7fffffff;
    return seed % max;
  };

  for (let trial = 0; trial < 100; trial++) {
    const counts = Object.fromEntries(setNames.map(name => [name, 0]));
    // The character has six right-ice slots. Randomly fill each slot with one
    // of seven candidate sets, allowing duplicate pieces of a set.
    const equipped = Array.from({ length: 6 }, () => {
      const name = setNames[random(setNames.length)];
      counts[name]++;
      return name;
    });
    const shuffled = [...setNames];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const target = random(index + 1);
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    const selected = shuffled.slice(0, 1 + random(3));
    const actual = resolveRightIceSetEffects(document, equipped, selected);
    const expected = selected.map(name => expectedForSet(document, name, counts[name])).filter(Boolean);

    assert.deepEqual(
      actual.map(effect => [effect.sourceId, effect.stats]).sort(([a], [b]) => a.localeCompare(b)),
      expected.map(effect => [effect.id, effect.stats]).sort(([a], [b]) => a.localeCompare(b)),
      `trial ${trial}: selected ${selected.join(', ')}, counts ${JSON.stringify(counts)}`,
    );
    assert.ok(actual.every(effect => selected.some(name => document.effects.find(row => row.id === effect.sourceId)?.setName === name)));
  }
});

test('右冰套效限制為最多三套且不接受重複選取', async () => {
  const document = await readJson('equipment/right-ice-set-effects.json');
  const [one, two, three] = [...new Set(document.effects.map(effect => effect.setName))];
  assert.throws(() => resolveRightIceSetEffects(document, [], [one, two, three, '騎士團']), /最多選擇3套/);
  assert.throws(() => resolveRightIceSetEffects(document, [], [one, one]), /不可重複選擇/);
});
