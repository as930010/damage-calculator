import { projectDamage } from '../../../frontend/projection.ts';
import { resolveRightIceSetEffects } from '../../../calculation/equipment-effects.ts';
import type { GameData } from '../../../frontend/data.ts';
import type { LoadoutState } from '../../../frontend/state.ts';
import { createIceSearchDomains, requiredIceSetNames, snapshotIceSearchConstraints } from './search-policy.ts';
import type { IceSearchConstraints, IceSearchDomain } from './search-policy.ts';

export interface IceResult {
  choices: Record<string, string>;
  setNames: string[];
  damage: number;
  /** All exact outfit alternatives tied with this damage rank. */
  alternatives?: IceResultAlternative[];
  isBaseline?: boolean;
}
export interface IceResultAlternative {
  choices: Record<string, string>;
  setNames: string[];
  damage: number;
  isBaseline?: boolean;
}
export interface IceProgress {
  evaluated: number;
  budgetUsed: number;
  phase: string;
  bestDamage: number;
  baselineDamage: number;
  baselineInScope: boolean;
  /** Only present when the formal recommendation ranking has changed. */
  results?: IceResult[];
  strategy?: 'A' | 'C';
  completedBudget?: number;
  completedEvaluated?: number;
}
export interface IceStructureStats {
  /** False means these are observed prefix counts, not totals for the entire legal space. */
  generationComplete: boolean;
  raw: number;
  tierRejected: number;
  infeasible: number;
  feasible: number;
  seedCandidates: number;
  seedAttempts: number;
  seedEvaluated: number;
  priorityThreeSetProfiles: number;
  priorityThreeSetSeeds: number;
  profilesBySelectedSetCount: number[];
}
export interface IceSearchResult {
  baseline: IceResultAlternative;
  baselineDamage: number;
  baselineInScope: boolean;
  /** Game legality is separate from this run's candidate policy and explicit constraints. */
  baselineGameLegal: boolean;
  candidatePolicy: Required<IceSearchConstraints>;
  bestSearchDomainDamage: number | null;
  belowBaselineEvaluated: number;
  evaluated: number;
  budgetUsed: number;
  mainEvaluated: number;
  duplicateCandidates: number;
  invalidCandidates: number;
  lnsDuplicateCandidates: number;
  structures: IceStructureStats;
  results: IceResult[];
  /** Complete right-ice outfit with three active sets of at least three pieces each. */
  scope: 'three-set-3x3-bounded';
  globallyOptimalProven: false;
  exploredSetCounts: number[];
  localOptimality: 'current-best' | 'single-local' | 'double-local';
  termination: 'completed' | 'budget-exhausted';
  hybrid?: { a: IceStrategyMetrics; c: IceStrategyMetrics; mergeMs: number; totalMs: number };
}
export interface IceStrategyMetrics {
  elapsedMs: number;
  budgetUsed: number;
  evaluated: number;
  duplicateCandidates: number;
  lnsDuplicateCandidates: number;
  termination: IceSearchResult['termination'];
  bestDamage: number | null;
  results: IceResult[];
}
type Domain = IceSearchDomain;
type StructureSeed = { setNames: string[]; counts: number[]; choices: Record<string, string>; variant: number };

const RESULT_LIMIT = 5;
const MAX_EVALUATIONS = 50_000;
const FINAL_SINGLE_RESERVE = 1_500;
const EXPLORATION_LIMIT = MAX_EVALUATIONS - FINAL_SINGLE_RESERVE - RESULT_LIMIT;
const MAX_RESULT_POOL = 500;
const STRUCTURE_ASSIGNMENT_VARIANTS = 6;
const LOCAL_STARTS = 24;
const PAIR_STARTS = 8;
const PAIR_CANDIDATES_PER_START = 1_500;
const LNS_STARTS = 8;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function iceFields(data: GameData) {
  const right = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  if (right.length !== 12 || new Set(right.map(entry => entry.selectionField)).size !== 12
    || new Set(right.map(entry => entry.slotId)).size !== 12
    || !right.some(entry => entry.selectionField === 'Ice.Weapon.Set' && entry.slotId === 'weapon')) {
    throw new RangeError('冰裝資料必須包含武器及完整的 12 個右冰部位。');
  }
  return { right, setFields: data.rightIceSets.selectionFields };
}

/** The search policy is stricter than the game's general set-effect rules. */
export function isThreeSetIceCandidate(data: GameData, choices: Readonly<Record<string, string>>,
  selected: readonly string[], constraints: IceSearchConstraints = {},
  currentChoices: Readonly<Record<string, string | number>> = choices): boolean {
  if (selected.length !== 3 || new Set(selected).size !== 3) return false;
  try { if (!requiredIceSetNames(data, constraints).every(name => selected.includes(name))) return false; }
  catch { return false; }
  const fields = iceFields(data).right;
  const counts = new Map(selected.map(name => [name, 0]));
  let domains: IceSearchDomain[];
  const baselineChoices = Object.fromEntries(fields.map(field => [field.selectionField,
    String(currentChoices[field.selectionField] ?? '')]));
  try { domains = createIceSearchDomains(data, baselineChoices, constraints); }
  catch { return false; }
  for (const field of fields) {
    const name = choices[field.selectionField];
    if (!name || !domains.some(domain => domain.field === field.selectionField && domain.names.includes(name))) return false;
    if (counts.has(name)) counts.set(name, counts.get(name)! + 1);
  }
  if ([...counts.values()].some(count => count < 3)) return false;
  try {
    const resolved = resolveRightIceSetEffects(data.rightIceSets,
      fields.map(field => choices[field.selectionField]), selected);
    const effective = new Set(resolved.flatMap(source => data.rightIceSets.effects
      .filter(effect => effect.id === source.sourceId).map(effect => effect.setName)));
    return selected.every(name => effective.has(name));
  } catch { return false; }
}

function withSelections(base: LoadoutState, choices: Record<string, string>, setNames: readonly string[],
  setFields: readonly string[]): LoadoutState {
  const values = { ...base.values, ...choices };
  for (const [index, field] of setFields.entries()) values[field] = setNames[index] ?? '';
  return { ...base, values };
}

function damage(data: GameData, state: LoadoutState): number | null {
  try {
    const value = projectDamage(data, state).result.finalDamage.finalDamage;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

function rank<T extends { damage: number }>(items: T[], limit: number): T[] {
  return items.sort((a, b) => b.damage - a.damage || JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
    .slice(0, limit);
}

export function damageTolerance(value: number): number {
  return Math.max(1e-6, Math.abs(value) * 1e-12);
}

export function sameDamage(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(damageTolerance(left), damageTolerance(right));
}

function resultIdentity(result: IceResultAlternative): string {
  return JSON.stringify([Object.entries(result.choices).sort(([a], [b]) => a.localeCompare(b, 'en')),
    [...result.setNames].sort((a, b) => a.localeCompare(b, 'zh-Hant'))]);
}

/** Groups full-engine results by a tight, explicit floating-point tolerance. */
export function groupIceResults(candidates: readonly IceResultAlternative[], limit = RESULT_LIMIT): IceResult[] {
  const unique = new Map<string, IceResultAlternative>();
  for (const candidate of candidates) {
    const key = resultIdentity(candidate);
    const previous = unique.get(key);
    if (!previous || candidate.damage > previous.damage
      || (candidate.isBaseline && !previous.isBaseline)) {
      unique.set(key, { ...candidate, isBaseline: Boolean(previous?.isBaseline || candidate.isBaseline) });
    }
  }
  const ordered = [...unique].sort(([leftKey, left], [rightKey, right]) => right.damage - left.damage
    || leftKey.localeCompare(rightKey, 'en')).map(([, candidate]) => candidate);
  const groups: IceResult[] = [];
  for (const candidate of ordered) {
    const group = groups.at(-1);
    if (group && sameDamage(group.damage, candidate.damage)) {
      group.alternatives!.push({ ...candidate });
      continue;
    }
    if (groups.length >= limit) break;
    groups.push({ ...candidate, alternatives: [{ ...candidate }] });
  }
  return groups;
}

/** Recommendations may tie with the baseline, but must never be materially weaker. */
export function rankIceRecommendations(candidates: readonly IceResultAlternative[], baselineDamage: number,
  limit = RESULT_LIMIT): IceResult[] {
  return groupIceResults(candidates.filter(candidate => candidate.damage > baselineDamage
    || sameDamage(candidate.damage, baselineDamage)), limit);
}

export function describeIceSearchStatus(search: Pick<IceSearchResult,
  'baselineDamage' | 'baselineInScope' | 'bestSearchDomainDamage' | 'results' | 'termination' | 'localOptimality'>): string {
  const hasImprovement = search.results.some(result => result.damage > search.baselineDamage
    && !sameDamage(result.damage, search.baselineDamage));
  const completion = search.termination === 'budget-exhausted' ? '已達搜尋次數上限' : '本輪搜尋已完成';
  if (!hasImprovement) {
    if (search.baselineInScope) {
      return `${completion}；未找到更高傷害配置。`;
    }
    const found = search.bestSearchDomainDamage;
    if (found !== null && found < search.baselineDamage && !sameDamage(found, search.baselineDamage)) {
      return `${completion}；目前配裝僅作基準，傷害高於已找到的合法候選。`;
    }
    if (found !== null && sameDamage(found, search.baselineDamage)) {
      return `${completion}；已找到與目前基準等傷害的合法候選。`;
    }
    return `${completion}；目前配裝僅作基準，尚無優於基準的合法推薦。`;
  }
  const local = search.localOptimality === 'single-local'
    ? '，第一名已檢查完整單部位鄰域。尚未證明全域最佳' : '';
  return `${completion}；已找到符合本次搜尋條件的更高傷害配置${local}。`;
}

function choiceKey(choices: Record<string, string>, fields: readonly string[]): string {
  return JSON.stringify(fields.map(field => choices[field] ?? ''));
}

function* combinations<T>(items: readonly T[], count: number): Generator<T[]> {
  function* visit(start: number, selected: T[]): Generator<T[]> {
    if (selected.length === count) { yield selected; return; }
    for (let index = start; index <= items.length - (count - selected.length); index += 1) {
      yield* visit(index + 1, [...selected, items[index]]);
    }
  }
  if (count <= items.length) yield* visit(0, []);
}

function countVectors(slotCount: number, setCount: number, minimum = 3): number[][] {
  const result: number[][] = [];
  const visit = (remaining: number, prefix: number[]): void => {
    if (prefix.length === setCount - 1) {
      if (remaining >= minimum) result.push([...prefix, remaining]);
      return;
    }
    const left = setCount - prefix.length - 1;
    for (let count = minimum; count <= remaining - minimum * left; count += 1) {
      visit(remaining - count, [...prefix, count]);
    }
  };
  for (let total = minimum * setCount; total <= slotCount; total += 1) visit(total, []);
  return result;
}

function activeSetNames(data: GameData, steps: readonly Domain[]): string[] {
  const available = new Set(steps.flatMap(step => step.names));
  return [...new Set(data.rightIceSets.effects.filter(effect => effect.active && available.has(effect.setName))
    .map(effect => effect.setName))];
}

function hasEffectiveTiers(data: GameData, setNames: readonly string[], counts: readonly number[]): boolean {
  const equipped = setNames.flatMap((name, index) => Array.from({ length: counts[index] }, () => name));
  try {
    const resolved = resolveRightIceSetEffects(data.rightIceSets, equipped, setNames);
    const resolvedNames = new Set(resolved.flatMap(source => {
      const effect = data.rightIceSets.effects.find(candidate => candidate.id === source.sourceId);
      return effect ? [effect.setName] : [];
    }));
    return setNames.every(name => resolvedNames.has(name));
  } catch { return false; }
}

/**
 * Exact b-matching feasibility for set pieces versus equipment slots.
 * Each piece of a set has the same eligible slots, so Hall's condition only
 * needs the unions of complete set categories. Larger slot grids use the
 * existing assignment search instead of overflowing a 32-bit mask.
 */
export function canAssignSetCounts(supportMasks: readonly number[], counts: readonly number[],
  slotCount: number): boolean {
  if (slotCount > 30 || supportMasks.length > 30) return true;
  for (let subset = 1; subset < 1 << supportMasks.length; subset += 1) {
    let slots = 0;
    let demand = 0;
    for (let index = 0; index < supportMasks.length; index += 1) {
      if (subset & (1 << index)) {
        slots |= supportMasks[index];
        demand += counts[index];
      }
    }
    let available = 0;
    while (slots) { slots &= slots - 1; available += 1; }
    if (available < demand) return false;
  }
  return true;
}

function setSupportMasks(steps: readonly Domain[], names: readonly string[]): ReadonlyMap<string, number> {
  if (steps.length > 30) return new Map();
  return new Map(names.map(name => [name, steps.reduce((mask, step, index) =>
    step.names.includes(name) ? mask | (1 << index) : mask, 0)]));
}

function structurallyFeasible(masks: ReadonlyMap<string, number>, setNames: readonly string[],
  counts: readonly number[], slotCount: number): boolean {
  return canAssignSetCounts(setNames.map(name => masks.get(name) ?? 0), counts, slotCount);
}

/** Exact joint field assignment; flexible slots retain the base item unless it breaks the target counts. */
function findExactAssignment(steps: readonly Domain[], suiteNames: readonly string[], targetCounts: readonly number[],
  currentChoices: Record<string, string>, variant = 0): Record<string, string> | null {
  const placed: Record<string, string> = {};
  const remainingCounts = [...targetCounts];
  for (const domain of steps) if (domain.names.length === 1) {
    placed[domain.field] = domain.names[0];
    const suite = suiteNames.indexOf(domain.names[0]);
    if (suite >= 0) remainingCounts[suite] -= 1;
  }
  if (remainingCounts.some(count => count < 0)) return null;
  const slots = steps.map((domain, index) => ({ domain, index,
    support: suiteNames.filter(name => domain.names.includes(name)).length }))
    .filter(slot => slot.domain.names.length > 1)
    .sort((a, b) => a.support - b.support
      || ((a.index - variant % steps.length + steps.length) % steps.length)
        - ((b.index - variant % steps.length + steps.length) % steps.length));
  const failed = new Set<string>();
  const visit = (position: number, remaining: number[]): boolean => {
    if (position >= slots.length) return remaining.every(value => value === 0);
    const key = position + ':' + remaining.join(',');
    if (failed.has(key)) return false;
    const slot = slots[position];
    const options = suiteNames.map((name, index) => ({ name, index }))
      .filter(item => remaining[item.index] > 0 && slot.domain.names.includes(item.name))
      .sort((a, b) => remaining[b.index] - remaining[a.index]
        || ((a.index + variant) % suiteNames.length) - ((b.index + variant) % suiteNames.length));
    for (const item of options) {
      const next = [...remaining];
      next[item.index] -= 1;
      placed[slot.domain.field] = item.name;
      if (visit(position + 1, next)) return true;
      delete placed[slot.domain.field];
    }
    const outside = slot.domain.names.filter(name => !suiteNames.includes(name));
    if (outside.length) {
      const current = String(currentChoices[slot.domain.field] ?? '');
      placed[slot.domain.field] = outside.includes(current) ? current : outside[variant % outside.length];
      if (visit(position + 1, remaining)) return true;
      delete placed[slot.domain.field];
    }
    failed.add(key);
    return false;
  };
  if (!visit(0, remainingCounts)) return null;
  const choices: Record<string, string> = {};
  for (const { field, names } of steps) {
    choices[field] = placed[field] ?? names[0];
  }
  return choices;
}

export function generateThreeSetStructures(data: GameData,
  currentChoices: Record<string, string>, constraints: IceSearchConstraints = {}, seedLimit = Infinity): { stats: IceStructureStats; seeds: StructureSeed[] } {
  if (seedLimit !== Infinity && (!Number.isSafeInteger(seedLimit) || seedLimit < 1)) throw new RangeError('Invalid structural seed limit.');
  const steps = createIceSearchDomains(data, currentChoices, constraints);
  const suites = activeSetNames(data, steps);
  const requiredSets = requiredIceSetNames(data, constraints);
  const supportMasks = setSupportMasks(steps, suites);
  const vectors = countVectors(steps.length, 3);
  const stats: IceStructureStats = { generationComplete: true, raw: 0, tierRejected: 0, infeasible: 0, feasible: 0, seedCandidates: 0,
    seedAttempts: 0, seedEvaluated: 0,
    priorityThreeSetProfiles: 0, priorityThreeSetSeeds: 0, profilesBySelectedSetCount: [0, 0, 0, 0] };
  const seeds: StructureSeed[] = [];
  priorityProfiles: for (const setNames of combinations(suites, 3)) for (const counts of vectors) {
    if (!requiredSets.every(name => setNames.includes(name))) continue;
    stats.raw += 1;
    if (!hasEffectiveTiers(data, setNames, counts)) { stats.tierRejected += 1; continue; }
    if (!structurallyFeasible(supportMasks, setNames, counts, steps.length)) {
      stats.infeasible += 1; continue;
    }
    const first = findExactAssignment(steps, setNames, counts, currentChoices);
    if (!first) { stats.infeasible += 1; continue; }
    stats.feasible += 1;
    const assigned = new Set<string>();
    for (let variant = 0; variant < STRUCTURE_ASSIGNMENT_VARIANTS; variant += 1) {
      const candidate = variant === 0 ? first
        : findExactAssignment(steps, setNames, counts, currentChoices, variant);
      if (!candidate) continue;
      const key = choiceKey(candidate, steps.map(step => step.field));
      if (assigned.has(key)) continue;
      assigned.add(key);
      seeds.push({ setNames, counts, choices: candidate, variant });
      if (seeds.length >= seedLimit) { stats.generationComplete = false; break priorityProfiles; }
    }
  }
  stats.seedCandidates = seeds.length;
  stats.priorityThreeSetProfiles = stats.feasible;
  stats.priorityThreeSetSeeds = seeds.length;
  stats.profilesBySelectedSetCount[3] = stats.feasible;
  return { stats, seeds };
}

/** Only feasible three-set profiles with at least three pieces per active set enter the search. */
export function generateIceSearchStructures(data: GameData,
  currentChoices: Record<string, string>, constraints: IceSearchConstraints = {}, seedLimit = Infinity): { stats: IceStructureStats; seeds: StructureSeed[] } {
  iceFields(data);
  return generateThreeSetStructures(data, currentChoices, constraints, seedLimit);
}

/** Bounded heuristic over complete right ice with exactly three active 3-piece-or-higher bonuses. */
export async function searchIce(data: GameData, base: LoadoutState,
  onProgress: (progress: IceProgress) => void, constraints: IceSearchConstraints = {},
  strategy: 'A' | 'C' = 'A'): Promise<IceSearchResult> {
  constraints = snapshotIceSearchConstraints(constraints);
  for (const field of ['Stage.Adapt', 'Stage.BossDEF', 'Stage.CritRatePenalty']) {
    const input = data.simulatorInputs.inputs.find(entry => entry.fieldIds.includes(field));
    const catalog = data.simulatorInputs.catalogs.find(entry => entry.id === input?.catalogId);
    const value = base.values[field];
    if (value === '' || value === null || value === undefined || !catalog?.options.some(option => option.value === Number(value))) {
      throw new RangeError(`搜尋設定無效：${field} 必須是傷害計算機可選的關卡數值。`);
    }
  }
  const baselineDamage = projectDamage(data, base).result.finalDamage.finalDamage;
  if (!Number.isFinite(baselineDamage) || baselineDamage <= 0) throw new RangeError('目前配裝無法取得有效的最終傷害。');
  const fields = iceFields(data);
  const rawChoices = Object.fromEntries(iceFields(data).right.map(entry => [entry.selectionField,
    String(base.values[entry.selectionField] ?? '')]));
  const steps = createIceSearchDomains(data, rawChoices, constraints);
  const rightFieldOrder = fields.right.map(entry => entry.selectionField);
  const fieldOrder = steps.map(step => step.field);
  const allowedNames = new Map(steps.map(step => [step.field, new Set(step.names)]));
  const effectSetNames = new Map<string, string>();
  for (const effect of data.rightIceSets.effects) {
    if (!effectSetNames.has(effect.id)) effectSetNames.set(effect.id, effect.setName);
  }
  const currentChoices = Object.fromEntries(fieldOrder.map(field => [field, String(base.values[field] ?? '')]));
  const allSuitNames = activeSetNames(data, steps);
  const requiredSets = requiredIceSetNames(data, constraints);
  let evaluated = 1;
  // One shared candidate-attempt budget includes full engine calls and cheap invalid candidates.
  let budgetUsed = 1;
  let mainEvaluated = 0;
  let duplicateCandidates = 0;
  let invalidCandidates = 0;
  let lnsDuplicateCandidates = 0;
  let belowBaselineEvaluated = 0;
  let budgetExhausted = false;
  let singleComplete = false;
  let results: IceResult[] = [];
  let bestMain: IceResult | null = null;
  let rankingDirty = true;
  let lastRankingSignature = '';
  let lastProgressAt = -Infinity;
  let lastRankingAt = -Infinity;
  // Exact per-search cache: the full ice state is in the key and all non-ice inputs
  // are fixed by `base`. It stores numbers only and cannot exceed the 50k evaluation cap.
  const scored = new Map<string, number | null>();
  const resultPool = new Map<string, IceResult>();
  const eliteByStructure = new Map<string, IceResult>();
  const better = (candidate: IceResult | null, incumbent: IceResult) =>
    candidate !== null && candidate.damage > incumbent.damage + damageTolerance(incumbent.damage);
  let nextResultPoolPrune = MAX_RESULT_POOL;
  const currentResults = () => {
    if (rankingDirty) {
      results = groupIceResults([...resultPool.values()], RESULT_LIMIT);
      rankingDirty = false;
    }
    return results;
  };
  const equippedCounts = (choices: Record<string, string>, names: readonly string[]) =>
    names.map(name => rightFieldOrder.filter(field => choices[field] === name).length);
  const structureKey = (choices: Record<string, string>, names: readonly string[]) => {
    const sorted = [...names].sort();
    return JSON.stringify([sorted, equippedCounts(choices, sorted)]);
  };
  const candidateKey = (candidate: IceResultAlternative) => JSON.stringify([
    choiceKey(candidate.choices, fieldOrder), [...candidate.setNames].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
  ]);
  const validSelectedEffects = (choices: Record<string, string>, selected: readonly string[], allowed = allowedNames) => {
    if (selected.length > data.rightIceSets.maxSelectedSets
      || selected.length > data.rightIceSets.selectionFields.length
      || new Set(selected).size !== selected.length
      || steps.some(step => !allowed.get(step.field)!.has(choices[step.field] ?? ''))) return false;
    try {
      const resolvedNames = new Set(resolveRightIceSetEffects(data.rightIceSets,
        rightFieldOrder.map(field => choices[field] ?? ''), selected).flatMap(source => {
        const name = effectSetNames.get(source.sourceId);
        return name ? [name] : [];
      }));
      return selected.every(name => resolvedNames.has(name));
    } catch { return false; }
  };
  const meetsThreeSetPolicy = (choices: Record<string, string>, selected: readonly string[]) =>
    selected.length === 3 && new Set(selected).size === 3
    && requiredSets.every(name => selected.includes(name))
    && selected.every(name => rightFieldOrder.filter(field => choices[field] === name).length >= 3);
  const baselineSetNames = fields.setFields.map(field => String(base.values[field] ?? ''))
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const baselineCandidate: IceResultAlternative = {
    choices: { ...currentChoices }, setNames: baselineSetNames, damage: baselineDamage, isBaseline: true,
  };
  const baselineInScope = meetsThreeSetPolicy(currentChoices, baselineSetNames)
    && validSelectedEffects(currentChoices, baselineSetNames);
  const gameAllowedNames = new Map(createIceSearchDomains(data, currentChoices, { excludedSeries: [] })
    .map(step => [step.field, new Set(step.names)]));
  const baselineGameLegal = validSelectedEffects(currentChoices, baselineSetNames, gameAllowedNames);
  const progress = (phase: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastProgressAt < 160) return;
    lastProgressAt = now;
    const update: IceProgress = { evaluated, budgetUsed, phase,
      bestDamage: Math.max(bestMain?.damage ?? baselineDamage, baselineDamage),
      baselineDamage, baselineInScope };
    if (force || now - lastRankingAt >= 500) {
      lastRankingAt = now;
      const ranked = rankIceRecommendations([
        ...resultPool.values(), ...(baselineInScope ? [baselineCandidate] : []),
      ], baselineDamage, RESULT_LIMIT);
      const signature = JSON.stringify(ranked.map(group => group.alternatives?.map(item =>
        [candidateKey(item), item.damage, Boolean(item.isBaseline)])));
      if (signature !== lastRankingSignature || force) {
        update.results = ranked;
        lastRankingSignature = signature;
      }
    }
    onProgress(update);
  };
  const rememberMain = (candidate: IceResult) => {
    const key = candidateKey(candidate);
    const previous = resultPool.get(key);
    const retained = { ...candidate, isBaseline: Boolean(previous?.isBaseline || candidate.isBaseline) };
    if (!previous || better(retained, previous) || retained.isBaseline !== previous.isBaseline) {
      resultPool.set(key, retained);
      rankingDirty = true;
    }
    if (resultPool.size >= nextResultPoolPrune) {
      const keep = new Set(groupIceResults([...resultPool.values()], RESULT_LIMIT)
        .flatMap(group => group.alternatives ?? [group]).map(candidateKey));
      for (const storedKey of resultPool.keys()) if (!keep.has(storedKey)) resultPool.delete(storedKey);
      nextResultPoolPrune = resultPool.size + MAX_RESULT_POOL;
      rankingDirty = true;
    }
    const profileKey = structureKey(retained.choices, retained.setNames);
    const previousElite = eliteByStructure.get(profileKey);
    if (!previousElite || better(retained, previousElite)) eliteByStructure.set(profileKey, retained);
    if (!bestMain || retained.damage > bestMain.damage) bestMain = retained;
  };
  if (baselineInScope) {
    scored.set(candidateKey(baselineCandidate), baselineDamage);
    rememberMain(baselineCandidate);
  }
  const score = (choices: Record<string, string>, selected: readonly string[], ceiling: number): IceResult | null | undefined => {
    const names = [...selected].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    const key = JSON.stringify([choiceKey(choices, fieldOrder), names]);
    if (scored.has(key)) {
      duplicateCandidates += 1;
      const cached = scored.get(key) ?? null;
      const candidate = cached === null ? null : { choices: { ...choices }, setNames: names, damage: cached };
      if (candidate && !resultPool.has(key)) rememberMain(candidate);
      return candidate;
    }
    if (budgetUsed >= ceiling) { budgetExhausted = true; return undefined; }
    budgetUsed += 1;
    if (!meetsThreeSetPolicy(choices, names) || !validSelectedEffects(choices, names)) {
      invalidCandidates += 1;
      scored.set(key, null);
      return null;
    }
    const value = damage(data, withSelections(base, choices, names, fields.setFields));
    evaluated += 1;
    mainEvaluated += 1;
    const candidate = value === null ? null : { choices: { ...choices }, setNames: names, damage: value };
    if (candidate && candidate.damage < baselineDamage
      && !sameDamage(candidate.damage, baselineDamage)) belowBaselineEvaluated += 1;
    scored.set(key, candidate?.damage ?? null);
    if (candidate) rememberMain(candidate);
    return candidate;
  };

  progress('正在整理合法套效結構', true);
  // Seeds are unique: a full outfit fixes the selected-set piece-count profile;
  // variants within that profile are deduplicated. Only the baseline can already
  // be cached here. This prefix therefore includes the first budget-stopping
  // attempt even if that one cached baseline is encountered along the way.
  const generated = generateIceSearchStructures(data, currentChoices, constraints, EXPLORATION_LIMIT + 1);
  if (!generated.seeds.length) {
    throw new RangeError('搜尋約束無可行解：無法組成三組各至少三件的有效右冰套效。');
  }
  let seedsAttempted = 0;
  const evaluationsBeforeSeeds = mainEvaluated;
  // Every structural seed meets the three-active-set, three-piece minimum policy.
  for (const seed of generated.seeds) {
    const candidate = score(seed.choices, seed.setNames, EXPLORATION_LIMIT);
    if (candidate === undefined) { budgetExhausted = true; break; }
    seedsAttempted += 1;
    if (seedsAttempted % 120 === 0) {
      progress('合法套效結構初始評估 ' + seedsAttempted + '/' + generated.stats.seedCandidates);
      await pause();
    }
    if (budgetExhausted) break;
  }
  const seedEvaluated = mainEvaluated - evaluationsBeforeSeeds;
  progress('合法套效結構初始評估完成');
  await pause();

  const distance = (a: IceResult, b: IceResult) =>
    fieldOrder.filter(field => a.choices[field] !== b.choices[field]).length;
  const diverseStarts = (items: readonly IceResult[], limit: number): IceResult[] => {
    const unique = new Map<string, IceResult>();
    for (const item of items) unique.set(JSON.stringify([choiceKey(item.choices, fieldOrder), item.setNames]), item);
    const candidates = rank([...unique.values()], Math.max(limit * 14, limit));
    const starts: IceResult[] = [];
    const suiteProfiles = new Set<string>();
    const setCountQuota = strategy === 'C' ? limit : Math.max(1, Math.floor(limit / (Math.min(data.rightIceSets.maxSelectedSets,
      data.rightIceSets.selectionFields.length) + 1)));
    for (let setCount = 0; setCount <= data.rightIceSets.maxSelectedSets; setCount += 1) {
      let count = 0;
      for (const candidate of candidates) {
        if (candidate.setNames.length !== setCount) continue;
        const suites = [...candidate.setNames].sort().join('|');
        if (suiteProfiles.has(suites) || starts.some(item => distance(item, candidate) < 2)) continue;
        suiteProfiles.add(suites);
        starts.push(candidate);
        count += 1;
        if (starts.length >= limit || count >= setCountQuota) break;
      }
      if (starts.length >= limit) return starts;
    }
    for (const candidate of candidates) {
      if (starts.some(item => JSON.stringify([choiceKey(item.choices, fieldOrder), item.setNames])
        === JSON.stringify([choiceKey(candidate.choices, fieldOrder), candidate.setNames]))) continue;
      if (starts.some(item => distance(item, candidate) < 1)) continue;
      starts.push(candidate);
      if (starts.length >= limit) break;
    }
    return starts;
  };

  const completedSingleScans = new Set<string>();
  const improveSingles = async (start: IceResult, ceiling: number): Promise<{ result: IceResult; complete: boolean }> => {
    let current = start;
    for (;;) {
      const scanKey = candidateKey(current);
      if (strategy === 'C' && completedSingleScans.has(scanKey)) return { result: current, complete: true };
      let best = current;
      for (const [index, domain] of steps.entries()) {
        for (const name of domain.names) {
          if (name === current.choices[domain.field]) continue;
          const choices = { ...current.choices, [domain.field]: name };
          if (!meetsThreeSetPolicy(choices, current.setNames)) continue;
          const trial = score(choices, current.setNames, ceiling);
          if (trial === undefined) return { result: best, complete: false };
          if (better(trial, best)) best = trial!;
        }
        if (index % 4 === 3) {
          progress('單部位局部改善 ' + (index + 1) + '/' + steps.length);
          await pause();
        }
      }
      const currentNames = [...current.setNames];
      const neighbors = new Map<string, string[]>();
      const addSetNeighbor = (names: string[]) => {
        const normalized = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        if (normalized.length <= data.rightIceSets.maxSelectedSets) {
          neighbors.set(JSON.stringify(normalized), normalized);
        }
      };
      for (let index = 0; index < currentNames.length; index += 1) for (const name of allSuitNames) {
        if (currentNames.includes(name)) continue;
        const replacement = [...currentNames];
        replacement[index] = name;
        addSetNeighbor(replacement);
      }
      for (const names of neighbors.values()) {
        if (!meetsThreeSetPolicy(current.choices, names)) continue;
        const trial = score(current.choices, names, ceiling);
        if (trial === undefined) return { result: best, complete: false };
        if (better(trial, best)) best = trial!;
      }
      if (!better(best, current)) {
        if (strategy === 'C') completedSingleScans.add(scanKey);
        return { result: current, complete: true };
      }
      current = best;
      progress('單部位找到改善，重新掃描完整鄰域');
      await pause();
    }
  };

  const localStarts = diverseStarts([...eliteByStructure.values(), ...resultPool.values()], LOCAL_STARTS);
  for (const [index, start] of localStarts.entries()) {
    const refined = await improveSingles(start, EXPLORATION_LIMIT);
    if (!refined.complete) { budgetExhausted = true; break; }
    progress('結構內局部改善 ' + (index + 1) + '/' + localStarts.length);
    await pause();
  }

  function* pairNeighborhood(start: IceResult): Generator<Record<string, string>> {
    for (let i = 0; i < steps.length; i += 1) for (let j = i + 1; j < steps.length; j += 1) {
      const first = steps[i], second = steps[j];
      for (const a of first.names) for (const b of second.names) {
        if (a === start.choices[first.field] || b === start.choices[second.field]) continue;
        const choices = { ...start.choices, [first.field]: a, [second.field]: b };
        if (meetsThreeSetPolicy(choices, start.setNames)) yield choices;
      }
    }
  }
  const pairStarts = diverseStarts([...resultPool.values(), ...eliteByStructure.values()], PAIR_STARTS);
  const pairStates = pairStarts.map(start => ({ start, iterator: pairNeighborhood(start), tried: 0, done: false }));
  let pairImprovement = false;
  while (budgetUsed < EXPLORATION_LIMIT) {
    let active = false;
    for (const state of pairStates) {
      if (state.done || state.tried >= PAIR_CANDIDATES_PER_START) continue;
      const next = state.iterator.next();
      if (next.done) { state.done = true; continue; }
      active = true;
      state.tried += 1;
      const previous = bestMain;
      const trial = score(next.value, state.start.setNames, EXPLORATION_LIMIT);
      if (trial === undefined) { budgetExhausted = true; break; }
      if (trial && previous && better(trial, previous)) pairImprovement = true;
      if (budgetUsed % 240 === 0) { progress('跨結構雙部位交叉替換'); await pause(); }
    }
    if (!active || budgetExhausted) break;
  }
  if (pairImprovement && bestMain && budgetUsed < EXPLORATION_LIMIT) {
    const refined = await improveSingles(currentResults()[0], EXPLORATION_LIMIT);
    singleComplete = refined.complete;
    if (!refined.complete) budgetExhausted = true;
  }

  const lnsStarts = diverseStarts([...resultPool.values(), ...eliteByStructure.values()], LNS_STARTS);
  const lnsSeen = new Set<string>();
  const makeAlternatives = async (start: IceResult, startIndex: number) => {
    const options = new Map<string, string[]>();
    for (const [fieldIndex, domain] of steps.entries()) {
      const individual: { name: string; damage: number }[] = [];
      for (const name of domain.names) {
        if (name === start.choices[domain.field]) continue;
        const choices = { ...start.choices, [domain.field]: name };
        if (!meetsThreeSetPolicy(choices, start.setNames)) continue;
        const trial = score(choices, start.setNames, EXPLORATION_LIMIT);
        if (trial === undefined) { budgetExhausted = true; break; }
        if (trial) individual.push({ name, damage: trial.damage });
      }
      const bestIndividual = rank(individual, individual.length)[0]?.name;
      const target = start.setNames[(fieldIndex + startIndex + 1) % start.setNames.length];
      let structural = domain.names.find(name => name !== start.choices[domain.field]
        && name !== bestIndividual && name === target);
      const outsider = domain.names.find(name => name !== start.choices[domain.field]
        && name !== bestIndividual && name !== structural && !start.setNames.includes(name));
      if (!structural) structural = domain.names.find(name => name !== start.choices[domain.field]
        && name !== bestIndividual);
      options.set(domain.field, [...new Set([bestIndividual, structural, outsider]
        .filter((name): name is string => name !== undefined))]);
      if (fieldIndex % 4 === 3) await pause();
    }
    return options;
  };
  function* product(start: IceResult, selectedFields: readonly string[],
    options: ReadonlyMap<string, string[]>): Generator<Record<string, string>> {
    const visit = function* (index: number, choices: Record<string, string>): Generator<Record<string, string>> {
      if (index === selectedFields.length) {
        if (meetsThreeSetPolicy(choices, start.setNames)) yield choices;
        return;
      }
      const field = selectedFields[index];
      for (const name of options.get(field) ?? []) {
        yield* visit(index + 1, { ...choices, [field]: name });
      }
    };
    yield* visit(0, { ...start.choices });
  }
  function* lnsNeighborhood(start: IceResult,
    options: ReadonlyMap<string, string[]>): Generator<Record<string, string>> {
    for (const size of [3, 4]) for (const selectedFields of combinations(fieldOrder, size)) {
      yield* product(start, selectedFields, options);
    }
  }
  const lnsStates: Array<{ start: IceResult; iterator: Generator<Record<string, string>>; done: boolean }> = [];
  for (const [index, start] of lnsStarts.entries()) {
    lnsStates.push({ start, iterator: lnsNeighborhood(start, await makeAlternatives(start, index)), done: false });
  }
  let lnsImprovement = false;
  let lnsVisited = 0;
  while (budgetUsed < EXPLORATION_LIMIT) {
    let active = false;
    for (const state of lnsStates) {
      if (state.done) continue;
      const next = state.iterator.next();
      if (next.done) { state.done = true; continue; }
      // A duplicate still advances this iterator; later neighbors may be new.
      active = true;
      lnsVisited += 1;
      if (lnsVisited % 240 === 0) { progress('三／四部位冰裝重組'); await pause(); }
      const key = JSON.stringify([choiceKey(next.value, fieldOrder), state.start.setNames]);
      if (lnsSeen.has(key)) { lnsDuplicateCandidates += 1; continue; }
      lnsSeen.add(key);
      const previous = bestMain;
      const trial = score(next.value, state.start.setNames, EXPLORATION_LIMIT);
      if (trial === undefined) { budgetExhausted = true; break; }
      if (trial && previous && better(trial, previous)) lnsImprovement = true;
      if (budgetUsed % 240 === 0) { progress('三／四部位冰裝重組'); await pause(); }
    }
    if (!active || budgetExhausted) break;
  }
  if ((lnsImprovement || pairImprovement) && bestMain && budgetUsed < EXPLORATION_LIMIT) {
    const refined = await improveSingles(currentResults()[0], EXPLORATION_LIMIT);
    singleComplete = refined.complete;
    if (!refined.complete) budgetExhausted = true;
  }

  if (bestMain && budgetUsed < MAX_EVALUATIONS - RESULT_LIMIT) {
    const finalSingleCeiling = MAX_EVALUATIONS - RESULT_LIMIT;
    const finalSingle = await improveSingles(currentResults()[0], finalSingleCeiling);
    singleComplete = finalSingle.complete;
    if (!singleComplete) budgetExhausted = true;
  }

  for (const result of currentResults()) {
    if (budgetUsed >= MAX_EVALUATIONS) { budgetExhausted = true; break; }
    budgetUsed += 1;
    const representative = result.alternatives?.[0] ?? result;
    const verified = damage(data, withSelections(base, representative.choices, representative.setNames, fields.setFields));
    evaluated += 1;
    if (verified === null || Math.abs(verified - result.damage) > damageTolerance(result.damage)) {
      throw new RangeError('冰裝排名與完整傷害引擎的驗算結果不一致。');
    }
  }
  const bestSearchDomainDamage = currentResults()[0]?.damage ?? null;
  const recommendations = rankIceRecommendations([
    ...resultPool.values(), ...(baselineInScope ? [baselineCandidate] : []),
  ], baselineDamage, RESULT_LIMIT);
  progress('搜尋結束', true);
  return {
    baseline: baselineCandidate, baselineDamage, baselineInScope, baselineGameLegal,
    candidatePolicy: snapshotIceSearchConstraints(constraints), bestSearchDomainDamage, belowBaselineEvaluated,
    evaluated, budgetUsed, mainEvaluated, duplicateCandidates, invalidCandidates, lnsDuplicateCandidates,
    structures: { ...generated.stats, seedAttempts: seedsAttempted, seedEvaluated },
    results: recommendations, scope: 'three-set-3x3-bounded', globallyOptimalProven: false,
    exploredSetCounts: generated.stats.profilesBySelectedSetCount
      .map((count, setCount) => count > 0 ? setCount : -1).filter(setCount => setCount >= 0),
    localOptimality: singleComplete ? 'single-local' : 'current-best',
    termination: budgetExhausted ? 'budget-exhausted' : 'completed',
  };
}
