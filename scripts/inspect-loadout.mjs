import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGameData } from '../dist/frontend/data.js';
import { projectAttributes, projectDamage } from '../dist/frontend/projection.js';

const stateFile = process.argv[2];
if (!stateFile) throw new Error('Usage: node scripts/inspect-loadout.mjs <state.json>');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const file = new URL(`../${String(url).replace(/^\.\//, '')}`, import.meta.url);
  return new Response(await readFile(file), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

let data;
try {
  data = await loadGameData();
} finally {
  globalThis.fetch = originalFetch;
}
const state = JSON.parse(await readFile(pathToFileURL(resolve(stateFile)), 'utf8'));
const { result } = projectDamage(data, state);
const metrics = {
  classId: state.classId,
  alternateLowerwear: state.lowerwearAlternativeEnabled,
  stats: Object.fromEntries(Object.entries(result.attributes.stats).map(([key, item]) => [key, item.finalTotal])),
  strongerPct: result.attributes.conditionalDamage.strongerPct,
  heatPct: result.attributes.conditionalDamage.heatPct,
  generalMultiplicativeDamage: result.generalMultiplicativeDamage.value,
  multiplicativeCritDamage: result.multiplicativeCritDamage.value,
  weaponPhysicalAttack: result.attack.c53,
  weaponMagicalAttack: result.attack.d53,
  attackPower: result.attack.attackPower,
  lowerDamage: result.attack.lowerDamage,
  upperDamage: result.attack.upperDamage,
  critRate: result.combatRates.critRate.finalRate,
  extremization: result.combatRates.extremization.finalRate,
  finalDamage: result.finalDamage.finalDamage,
};
console.log(JSON.stringify(metrics, null, 2));
if (process.argv.includes('--sources')) {
  const targetKeys = new Set(['doubleAttackPct', 'bleedDamagePct', 'adaptabilityPct']);
  const sources = projectAttributes(data, state).calculationSources;
  console.log(JSON.stringify(Object.fromEntries(Object.entries(sources).filter(([, group]) => Array.isArray(group))
    .map(([name, group]) => [name, group.filter((entry) => Object.keys(entry.stats).some((key) => targetKeys.has(key)))
      .map((entry) => ({ sourceId: entry.sourceId, stats: Object.fromEntries(Object.entries(entry.stats).filter(([key]) => targetKeys.has(key))) }))])), null, 2));
}
