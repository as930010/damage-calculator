import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { LoadoutHistory, DEFAULT_HISTORY_LIMIT, configurationStatesEqual, historyShortcutAction } from '../dist/frontend/history.js';

const completeSample = JSON.parse(await readFile(new URL('../data/examples/public-example-2026-09-28.json', import.meta.url), 'utf8'));

function state(overrides = {}) {
  return {
    schemaVersion: 3,
    Job: 'DaB',
    values: {},
    lowerwearAlternativeEnabled: false,
    masterBeastSpiritStoneColor: '黃',
    petSkillAttackEnabled: true,
    transcendenceSkillDamageSharePct: 100,
    ...overrides,
  };
}

function setValue(target, key, value) {
  target.values[key] = value;
}

test('session starts from the restored current configuration and walks every step', () => {
  const restored = state({ Job: 'PO', values: { 'Stage.Adapt': '5', 'Effect.Environment': '小屋/溫泉' } });
  const history = new LoadoutHistory(restored);
  assert.equal(history.canUndo, false);
  restored.Job = 'DaB';
  setValue(restored, 'Stage.Adapt', '10');
  assert.equal(history.record(restored), true);
  setValue(restored, 'Effect.Environment', '集合地');
  assert.equal(history.record(restored), true);
  assert.deepEqual(history.undo(), { ...state(), Job: 'DaB', values: { 'Effect.Environment': '小屋/溫泉', 'Stage.Adapt': '10' } });
  assert.deepEqual(history.undo(), { ...state(), Job: 'PO', values: { 'Effect.Environment': '小屋/溫泉', 'Stage.Adapt': '5' } });
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.redo(), { ...state(), Job: 'DaB', values: { 'Effect.Environment': '小屋/溫泉', 'Stage.Adapt': '10' } });
  assert.deepEqual(history.redo(), { ...state(), Job: 'DaB', values: { 'Effect.Environment': '集合地', 'Stage.Adapt': '10' } });
  assert.equal(history.canRedo, false);
});

test('complete snapshots include every calculation-affecting state field and are isolated copies', () => {
  const initial = state();
  const history = new LoadoutHistory(initial);
  initial.values['Weapon.ENHC'] = 'Lv.15';
  assert.equal(history.canUndo, false);
  const changed = state({
    schemaVersion: 3,
    Job: 'TB',
    values: { 'Weapon.ENHC': 'Lv.15', 'Stage.BossDEF': '30', 'Effect.Consumable': '藥水' },
    lowerwearAlternativeEnabled: true,
    masterBeastSpiritStoneColor: '綠',
    petSkillAttackEnabled: false,
    transcendenceSkillDamageSharePct: 37.5,
  });
  history.record(changed);
  const previous = history.undo();
  assert.deepEqual(previous, state());
  const next = history.redo();
  assert.deepEqual(next, changed);
  next.values['Weapon.ENHC'] = 'mutated returned value';
  assert.deepEqual(history.undo(), state());
  assert.deepEqual(history.redo(), changed);
});

test('restoring a baseline is one reversible operation and never mutates the saved baseline', () => {
  const baseline = state({ Job: 'PO', values: { 'Stage.Adapt': '100', 'BossDEF': '10' }, petSkillAttackEnabled: false });
  const baselineBefore = structuredClone(baseline);
  const current = state({ Job: 'DaB', values: { 'Stage.Adapt': '70', 'BossDEF': '50' }, lowerwearAlternativeEnabled: true });
  const history = new LoadoutHistory(current);
  Object.assign(current, structuredClone(baseline));
  assert.equal(history.record(current), true);
  assert.equal(history.undoSteps, 1);
  assert.deepEqual(history.undo(), { ...state(), Job: 'DaB', values: { 'BossDEF': '50', 'Stage.Adapt': '70' }, lowerwearAlternativeEnabled: true });
  assert.deepEqual(history.redo(), baselineBefore);
  assert.deepEqual(baseline, baselineBefore);
});

test('saving or refreshing the same baseline state does not add history', () => {
  const current = state({ values: { 'Stage.Adapt': '100' } });
  const history = new LoadoutHistory(current);
  const baseline = structuredClone(current);
  assert.equal(history.record(current), false);
  assert.equal(history.undoSteps, 0);
  assert.equal(history.matches(baseline), true);
  assert.equal(configurationStatesEqual(current, baseline), true);
  baseline.Job = 'TB';
  assert.equal(history.matches(baseline), false);
  assert.equal(history.undoSteps, 0);
});

test('a new operation after undo clears the redo branch', () => {
  const current = state();
  const history = new LoadoutHistory(current);
  setValue(current, 'Stage.Adapt', '30'); history.record(current);
  setValue(current, 'Stage.Adapt', '60'); history.record(current);
  history.undo();
  setValue(current, 'Stage.Adapt', '40'); history.record(current);
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.undo().values, { 'Stage.Adapt': '30' });
});

test('no-op is ignored and a multi-field batch is one history step', () => {
  const current = state();
  const history = new LoadoutHistory(current);
  assert.equal(history.record(current), false);
  setValue(current, 'Weapon.ENHC', 'Lv.15');
  setValue(current, 'Effect.Environment', '集合地');
  current.petSkillAttackEnabled = false;
  assert.equal(history.record(current), true);
  assert.equal(history.undoSteps, 1);
  assert.deepEqual(history.undo(), state());
});

test('manual import can be committed as one operation; reinitializing starts a new session', () => {
  const current = state({ values: { 'Stage.Adapt': '30' } });
  const history = new LoadoutHistory(current);
  const imported = state({ Job: 'TB', values: { 'Stage.Adapt': '100', 'Effect.Environment': '強化小屋' }, petSkillAttackEnabled: false });
  Object.assign(current, structuredClone(imported));
  history.record(current);
  assert.deepEqual(history.undo(), { ...state(), values: { 'Stage.Adapt': '30' } });
  const reloaded = new LoadoutHistory(imported);
  assert.equal(reloaded.canUndo, false);
  assert.equal(reloaded.canRedo, false);
});

test('keyboard shortcut mapping supports Ctrl/Meta undo and redo while respecting editable controls', () => {
  const shortcut = overrides => ({ key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, ...overrides });
  assert.equal(historyShortcutAction(shortcut({ ctrlKey: true }), false), 'undo');
  assert.equal(historyShortcutAction(shortcut({ key: 'y', ctrlKey: true }), false), 'redo');
  assert.equal(historyShortcutAction(shortcut({ key: 'z', ctrlKey: true, shiftKey: true }), false), 'redo');
  assert.equal(historyShortcutAction(shortcut({ metaKey: true }), false), 'undo');
  assert.equal(historyShortcutAction(shortcut({ key: 'y', metaKey: true }), false), 'redo');
  assert.equal(historyShortcutAction(shortcut({ ctrlKey: true }), true), null);
  assert.equal(historyShortcutAction(shortcut({ ctrlKey: true, isComposing: true }), false), null);
  assert.equal(historyShortcutAction(shortcut({ ctrlKey: true, altKey: true }), false), null);
  assert.equal(historyShortcutAction(shortcut({ key: 'y', ctrlKey: true, shiftKey: true }), false), null);
});

test('the default cap retains 50 undo steps plus the current state; 20/50/100-step costs scale linearly', () => {
  assert.equal(DEFAULT_HISTORY_LIMIT, 50);
  const results = [];
  for (const limit of [20, 50, 100]) {
    const current = structuredClone(completeSample);
    const history = new LoadoutHistory(current, limit);
    for (let step = 1; step <= 120; step += 1) {
      current.values['Stage.Adapt'] = step;
      history.record(current);
    }
    assert.equal(history.retainedSnapshots, limit + 1);
    assert.equal(history.undoSteps, limit);
    assert.equal(history.redoSteps, 0);
    results.push({ limit, snapshots: history.retainedSnapshots, approximateBytes: history.approximateBytes });
  }
  assert.ok(results[0].approximateBytes < results[1].approximateBytes);
  assert.ok(results[1].approximateBytes < results[2].approximateBytes);
  const started = performance.now();
  for (let run = 0; run < 1000; run += 1) new LoadoutHistory(completeSample);
  const initMs = performance.now() - started;
  console.log('Complete 217-input state snapshot costs:', JSON.stringify({ sampleStateBytes: Buffer.byteLength(JSON.stringify(completeSample)), limits: results, historyInitPerStateMs: Number((initMs / 1000).toFixed(4)) }));
});

test('1000 rapid operations remain bounded and report operation latency', () => {
  const current = structuredClone(completeSample);
  const baseline = structuredClone(current);
  const history = new LoadoutHistory(current);
  const started = performance.now();
  for (let step = 1; step <= 1000; step += 1) {
    current.values['Stage.Adapt'] = step;
    history.record(current);
    history.matches(baseline);
  }
  const elapsedMs = performance.now() - started;
  assert.equal(history.retainedSnapshots, 51);
  assert.equal(history.undoSteps, 50);
  assert.ok(history.approximateBytes < 1_000_000);
  assert.equal(history.canRedo, false);
  console.log(`1000 full-state record + baseline comparisons: ${elapsedMs.toFixed(2)}ms; retained payload: ${history.approximateBytes} bytes`);
});
