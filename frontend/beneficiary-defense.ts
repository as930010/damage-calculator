import type { DamageBase } from '../features/buff-simulator/calculation/types.ts';
import { validDamageBase } from '../features/buff-simulator/frontend/damage-basis-state.ts';
import { createCatalogIndex } from './catalog-index.ts';
import { invalidLoadoutFields } from './loadout-transfer.ts';
import type { GameData } from './data.ts';
import { parseState } from './state.ts';
import { projectAttributes, projectDamage } from './projection.ts';

let cached: { url: string; request: Promise<GameData> } | undefined;
function loadBeneficiaryData(dataUrl: string) {
  if (!cached || cached.url !== dataUrl) {
    const request = fetch(dataUrl, { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error('無法讀取首頁遊戲資料');
      return response.json() as Promise<GameData>;
    });
    cached = { url: dataUrl, request };
    request.catch(() => { if (cached?.request === request) cached = undefined; });
  }
  return cached.request;
}

/** Readonly bridge to the homepage engine; no second loadout format or persisted totals. */
export async function readBeneficiaryDefense(dataUrl: string, raw: string | null): Promise<{ rates: number[]; source: 'loadout' | 'empty' }> {
  if (!raw) return { rates: [0], source: 'empty' };
  const state = parseState(raw);
  if (!state) throw new Error('首頁配裝格式無效');
  const data = await loadBeneficiaryData(dataUrl);
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

/** Read the working draft with the same rules and effective totals as the calculator. */
export function projectBeneficiaryDamage(data: GameData, raw: string): DamageBase {
  let state;
  try { state = parseState(raw); } catch { throw new Error('首頁工作草稿格式無效。'); }
  if (!state) throw new Error('首頁工作草稿格式無效。');
  const catalog = createCatalogIndex(data);
  const role = catalog.classById(state.Job);
  if (!role?.active || invalidLoadoutFields(state, data, catalog).length) {
    throw new Error('首頁工作草稿含無效或已變更的選項，請在傷害計算機確認並保存後再引用。');
  }
  const result = projectDamage(data, state).result;
  if (!Number.isFinite(result.finalDamage.finalDamage) || result.finalDamage.finalDamage <= 0) {
    throw new Error('首頁工作草稿未能計算有效傷害。');
  }
  const crit = result.attributes.stats.critDamagePct;
  const boss = result.attributes.stats.bossDamagePct;
  if (!crit || !boss) throw new Error('首頁工作草稿缺少致命傷害或 Boss 傷害。');

  const effectiveCrit = (stats: number, damage: typeof result) => stats
    + damage.classCritDamagePassivePct + damage.multiplicativeCritDamage.value * 100;
  const base = { critDamagePct: effectiveCrit(crit.finalTotal, result), bossDamagePct: boss.finalTotal };
  if (state.lowerwearAlternativeEnabled && !state.bossHealthCondition?.enabled) {
    const actual = (stat: typeof crit, slot: 'lowerwearA' | 'lowerwearB') =>
      Math.min(stat.cap ?? Infinity, stat.sharedTotal + stat[slot]);
    const critIn = (slot: 'lowerwearA' | 'lowerwearB') => effectiveCrit(actual(crit, slot),
      result.lowerwearConfigurations?.find(entry => entry.configuration === slot)?.result ?? result);
    if (Math.abs(critIn('lowerwearA') - critIn('lowerwearB')) > 1e-9
      || Math.abs(actual(boss, 'lowerwearA') - actual(boss, 'lowerwearB')) > 1e-9) {
      throw new Error('下衣與強／排褲的致命傷害或 Boss 傷害不同。請在首頁選定單一情境，或自行設定。');
    }
  }
  if (!validDamageBase(base)) throw new Error('首頁工作草稿沒有合法的基礎傷害屬性。');

  return base;
}

export async function readBeneficiaryDamage(dataUrl: string, raw: string): Promise<DamageBase> {
  return projectBeneficiaryDamage(await loadBeneficiaryData(dataUrl), raw);
}
