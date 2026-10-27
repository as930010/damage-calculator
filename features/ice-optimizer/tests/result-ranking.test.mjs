import test from 'node:test';
import assert from 'node:assert/strict';
import { describeIceSearchStatus, rankIceRecommendations, sameDamage } from '../../../dist/features/ice-optimizer/frontend/search.js';

const outfit = (name, damage, isBaseline = false) => ({
  choices: { 'Right.Ice.FaceTop': name }, setNames: ['A', 'B', 'C'], damage, isBaseline,
});

test('recommendations exclude below-baseline outfits and retain all ties at the Top-K boundary', () => {
  const groups = rankIceRecommendations([
    outfit('weaker', 99), outfit('baseline', 100, true), outfit('first-equal', 110),
    outfit('second-equal', 110), outfit('third-equal', 110), outfit('next-rank', 105),
  ], 100, 1);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].damage, 110);
  assert.deepEqual(groups[0].alternatives.map(item => item.choices['Right.Ice.FaceTop']),
    ['first-equal', 'second-equal', 'third-equal']);
  assert.ok(groups.flatMap(group => group.alternatives).every(item => item.damage >= 100));
});

test('baseline-equal configurations are retained with a tight floating-point tolerance', () => {
  const baseline = 100_000_000;
  const groups = rankIceRecommendations([
    outfit('current', baseline, true),
    outfit('rounding-equal', baseline - 0.00005),
    outfit('materially-lower', baseline - 0.0002),
  ], baseline);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].alternatives.length, 2);
  assert.ok(groups[0].alternatives.some(item => item.isBaseline));
  assert.equal(sameDamage(baseline, baseline - 0.00005), true);
  assert.equal(sameDamage(baseline, baseline - 0.0002), false);
});

test('incremental best updates reorder earlier winners without duplicating ties', () => {
  const seen = [outfit('current', 100, true)];
  seen.push(outfit('first', 110));
  assert.deepEqual(rankIceRecommendations(seen, 100).map(group => group.damage), [110, 100]);
  seen.push(outfit('better', 120), outfit('equal-better', 120), outfit('better', 120));
  const live = rankIceRecommendations(seen, 100);
  assert.deepEqual(live.map(group => group.damage), [120, 110, 100]);
  assert.deepEqual(live[0].alternatives.map(item => item.choices['Right.Ice.FaceTop']),
    ['better', 'equal-better']);
  assert.deepEqual(live, rankIceRecommendations(seen, 100),
    '逐筆更新後與一次處理相同已評估集合應得到相同排名');
});

test('an ineligible baseline remains external to the legal recommendation ranking', () => {
  assert.deepEqual(rankIceRecommendations([outfit('weaker-legal', 99)], 100), []);
  const equal = rankIceRecommendations([outfit('equal-legal', 100)], 100);
  assert.equal(equal.length, 1);
  assert.equal(equal[0].alternatives[0].isBaseline, false);
});

test('no-improvement messages distinguish a legal baseline from an external comparison', () => {
  const baselineInScope = describeIceSearchStatus({
    baselineDamage: 100, baselineInScope: true, bestSearchDomainDamage: 100,
    results: [outfit('baseline', 100, true)], termination: 'completed', localOptimality: 'single-local',
  });
  assert.match(baselineInScope, /未找到更高傷害配置/);
  assert.equal(baselineInScope, '本輪搜尋已完成；未找到更高傷害配置。');

  const outsideScope = describeIceSearchStatus({
    baselineDamage: 100, baselineInScope: false, bestSearchDomainDamage: 99,
    results: [], termination: 'budget-exhausted', localOptimality: 'current-best',
  });
  assert.match(outsideScope, /目前配裝僅作基準/);
  assert.match(outsideScope, /高於已找到的合法候選/);
});
