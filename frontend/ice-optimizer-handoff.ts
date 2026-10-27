/** A one-navigation request. The optimizer never writes the calculator's saved loadout. */
const key = 'dab-ice-optimizer-apply-v1';

export interface IceOptimizerHandoff {
  format: 'ice-optimizer-selection';
  version: 1;
  baseRaw: string;
  dataRevision: string;
  choices: Record<string, string>;
  setNames: string[];
  expectedDamage: number;
}

export function stageIceOptimizerHandoff(selection: IceOptimizerHandoff): void {
  sessionStorage.setItem(key, JSON.stringify(selection));
}

export function takeIceOptimizerHandoff(): unknown {
  const raw = sessionStorage.getItem(key);
  if (raw === null) return null;
  sessionStorage.removeItem(key);
  try { return JSON.parse(raw) as unknown; }
  catch { return { invalid: true }; }
}
