import { createIceSearchDomains } from '../../../dist/features/ice-optimizer/frontend/search-policy.js';
import { resolveRightIceSetEffects } from '../../../dist/calculation/equipment-effects.js';
import { projectDamage } from '../../../dist/frontend/projection.js';
import { groupIceResults } from '../../../dist/features/ice-optimizer/frontend/search.js';

export function* subsets(items, limit, prefix = [], start = 0) {
  yield prefix;
  if (prefix.length === limit) return;
  for (let index = start; index < items.length; index++) yield* subsets(items, limit, [...prefix, items[index]], index + 1);
}

export function effectiveSetNames(data, equipmentNames) {
  const result = [];
  for (const name of new Set(data.rightIceSets.effects.filter(effect => effect.active).map(effect => effect.setName))) {
    if (resolveRightIceSetEffects(data.rightIceSets, equipmentNames, [name]).length) result.push(name);
  }
  return result;
}

/** Independent complete equipment traversal; selected effects are always resolved by the real rules. */
export function* exactCandidates(data, state, constraints = {}) {
  const domains = createIceSearchDomains(data, state.values, constraints);
  const choices = {};
  function* visit(slot) {
    if (slot < domains.length) {
      const domain = domains[slot];
      for (const name of domain.names) { choices[domain.field] = name; yield* visit(slot + 1); }
      return;
    }
    const names = effectiveSetNames(data, Object.values(choices));
    for (const selected of subsets(names, data.rightIceSets.maxSelectedSets)) {
      yield { choices: { ...choices }, setNames: [...selected].sort((a, b) => a.localeCompare(b, 'zh-Hant')) };
    }
  }
  yield* visit(0);
}

export function evaluateCandidate(data, state, candidate) {
  const values = { ...state.values, ...candidate.choices };
  data.rightIceSets.selectionFields.forEach((field, index) => { values[field] = candidate.setNames[index] ?? ''; });
  const damage = projectDamage(data, { ...state, values }).result.finalDamage.finalDamage;
  return { ...candidate, damage };
}

/** Counts every legal outfit/effect-selection pair using exact BigInt polynomial DP. */
export function countSearchSpace(data, state, constraints = {}) {
  const domains = createIceSearchDomains(data, state.values, constraints);
  const available = new Set(domains.flatMap(domain => domain.names));
  const names = [...new Set(data.rightIceSets.effects.filter(effect => effect.active && available.has(effect.setName)).map(effect => effect.setName))];
  let total = 0n;
  const radix = domains.length + 1;
  for (const selected of subsets(names, data.rightIceSets.maxSelectedSets)) {
    let counts = new Map([[0, 1n]]);
    const weights = selected.map((_, index) => radix ** index);
    for (const domain of domains) {
      const next = new Map();
      const selectedIndices = domain.names.map(name => selected.indexOf(name)).filter(index => index >= 0);
      const other = domain.names.length - selectedIndices.length;
      for (const [key, ways] of counts) {
        if (other) next.set(key, (next.get(key) ?? 0n) + ways * BigInt(other));
        for (const index of selectedIndices) next.set(key + weights[index], (next.get(key + weights[index]) ?? 0n) + ways);
      }
      counts = next;
    }
    for (const [key, ways] of counts) {
      const equipped = selected.flatMap((name, index) => Array.from({ length: Math.floor(key / weights[index]) % radix }, () => name));
      const effects = resolveRightIceSetEffects(data.rightIceSets, equipped, selected);
      const resolved = new Set(effects.map(source => data.rightIceSets.effects.find(effect => effect.id === source.sourceId)?.setName));
      if (selected.every(name => resolved.has(name))) total += ways;
    }
  }
  return { count: total, equipmentAssignments: domains.reduce((product, domain) => product * BigInt(domain.names.length), 1n),
    domains, activeSeries: names.length };
}

/** This reference may exceed the production budget only when explicitly requested by the research caller. */
export function exhaustiveReference(data, state, constraints = {}, limit = Infinity, eligible = () => true) {
  const evaluated = [];
  let complete = true;
  for (const candidate of exactCandidates(data, state, constraints)) {
    if (!eligible(candidate)) continue;
    if (evaluated.length === limit) { complete = false; break; }
    evaluated.push(evaluateCandidate(data, state, candidate));
  }
  const groups = groupIceResults(evaluated, 5);
  return { evaluated, groups, complete, upperBound: complete ? groups[0]?.damage ?? null : null };
}
