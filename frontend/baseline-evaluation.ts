import type { GameData } from './data.ts';
import type { LoadoutState } from './state.ts';
import { evaluateLoadout } from './projection.ts';

// Include every own input field; object insertion order does not affect the key.
// Preserve non-finite numbers/undefined too, instead of JSON's null/omission aliases.
function inputKey(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return '[' + value.map(inputKey).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + inputKey((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return typeof value + ':' + (typeof value === 'number' && Object.is(value, -0) ? '-0' : JSON.stringify(String(value)));
}

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** One detached baseline result. A new data load/parameter revision must use a new token. */
export function createBaselineEvaluationCache() {
  let last: { data: GameData; revision: unknown; key: string;
    evaluation: ReturnType<typeof evaluateLoadout> } | undefined;
  return {
    clear() { last = undefined; },
    get(data: GameData, baseline: LoadoutState | null, revision: unknown) {
      if (!baseline) { last = undefined; return null; }
      const key = inputKey(baseline);
      if (!last || last.data !== data || last.revision !== revision || last.key !== key) {
        const evaluation = freezeSnapshot(structuredClone(evaluateLoadout(data, baseline, false)));
        last = { data, revision, key, evaluation };
      }
      return last.evaluation;
    },
  };
}
