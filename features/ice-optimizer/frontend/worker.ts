import { rankIceRecommendations, searchIce } from './search.ts';
import type { IceResult, IceSearchResult, IceStrategyMetrics } from './search.ts';
import type { GameData } from '../../../frontend/data.ts';
import type { LoadoutState } from '../../../frontend/state.ts';
import type { IceSearchConstraints } from './search-policy.ts';

self.addEventListener('message', async (event: MessageEvent<{
  type: 'start'; searchId: string; data: GameData; state: LoadoutState; constraints?: IceSearchConstraints;
}>) => {
  if (event.data?.type !== 'start') return;
  const searchId = event.data.searchId;
  try {
    const started = performance.now();
    let merged: IceResult[] = [];
    let a: IceSearchResult | undefined;
    let mergeMs = 0;
    const merge = (groups: readonly IceResult[], baselineDamage: number) => {
      const before = performance.now();
      merged = rankIceRecommendations([...merged, ...groups].flatMap(group => group.alternatives ?? [group]), baselineDamage);
      mergeMs += performance.now() - before;
      return merged;
    };
    const run = async (strategy: 'A' | 'C') => {
      const before = performance.now();
      const result = await searchIce(event.data.data, event.data.state, progress => {
        const results = progress.results ? merge(progress.results, progress.baselineDamage) : undefined;
        self.postMessage({ type: 'progress', searchId, progress: { ...progress, results, strategy,
          bestDamage: Math.max(progress.bestDamage, merged[0]?.damage ?? progress.baselineDamage),
          completedBudget: a?.budgetUsed ?? 0, completedEvaluated: a?.evaluated ?? 0 } });
      }, event.data.constraints, strategy);
      merge(result.results, result.baselineDamage);
      const metrics: IceStrategyMetrics = { elapsedMs: performance.now() - before,
        budgetUsed: result.budgetUsed, evaluated: result.evaluated,
        duplicateCandidates: result.duplicateCandidates, lnsDuplicateCandidates: result.lnsDuplicateCandidates,
        termination: result.termination, bestDamage: result.bestSearchDomainDamage, results: result.results };
      return { result, metrics };
    };
    const first = await run('A');
    a = first.result;
    const second = await run('C');
    const result: IceSearchResult = { ...second.result, results: merged,
      evaluated: a.evaluated + second.result.evaluated,
      budgetUsed: a.budgetUsed + second.result.budgetUsed,
      mainEvaluated: a.mainEvaluated + second.result.mainEvaluated,
      duplicateCandidates: a.duplicateCandidates + second.result.duplicateCandidates,
      invalidCandidates: a.invalidCandidates + second.result.invalidCandidates,
      lnsDuplicateCandidates: a.lnsDuplicateCandidates + second.result.lnsDuplicateCandidates,
      belowBaselineEvaluated: a.belowBaselineEvaluated + second.result.belowBaselineEvaluated,
      bestSearchDomainDamage: Math.max(a.bestSearchDomainDamage ?? -Infinity, second.result.bestSearchDomainDamage ?? -Infinity),
      localOptimality: 'current-best',
      termination: a.termination === 'budget-exhausted' || second.result.termination === 'budget-exhausted'
        ? 'budget-exhausted' : 'completed',
      hybrid: { a: first.metrics, c: second.metrics, mergeMs, totalMs: performance.now() - started } };
    self.postMessage({ type: 'complete', searchId, result });
  } catch (error) {
    self.postMessage({ type: 'error', searchId,
      message: error instanceof Error ? error.message : '冰裝搜尋失敗。' });
  }
});
