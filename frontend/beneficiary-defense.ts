import type { GameData } from './data.ts';
import { parseState } from './state.ts';
import { projectAttributes, projectDamage } from './projection.ts';

let cached: { url: string; request: Promise<GameData> } | undefined;
/** Readonly bridge to the homepage engine; no second loadout format or persisted totals. */
export async function readBeneficiaryDefense(dataUrl: string, raw: string | null): Promise<{ rates: number[]; source: 'loadout' | 'empty' }> {
  if (!raw) return { rates: [0], source: 'empty' };
  const state = parseState(raw);
  if (!state) throw new Error('首頁配裝格式無效');
  if (!cached || cached.url !== dataUrl) {
    const request = fetch(dataUrl, { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error('無法讀取首頁遊戲資料');
      return response.json() as Promise<GameData>;
    });
    cached = { url: dataUrl, request };
    request.catch(() => { if (cached?.request === request) cached = undefined; });
  }
  const data = await cached.request;
  let rates: number[];
  try {
    const result = projectDamage(data, state).result;
    rates = result.lowerwearConfigurations?.map(c => (c.result.attributes.stats.defenseIgnorePct?.finalTotal ?? 0) / 100)
      ?? [(result.attributes.stats.defenseIgnorePct?.finalTotal ?? 0) / 100];
  } catch {
    // Partial loadouts can still provide valid equipment attributes without a final damage result.
    rates = [(projectAttributes(data, state).stats.defenseIgnorePct?.finalTotal ?? 0) / 100];
  }
  return { rates, source: 'loadout' };
}
