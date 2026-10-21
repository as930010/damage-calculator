import { calculateAttack, resolveAttackParameters } from './attack.ts';
import { calculateFinalDamage } from './final-damage.ts';
import { calculateLoadout, finalDamageInputs, type LoadoutCalculationInput, type LoadoutCalculationResult } from './loadout-engine.ts';
import { calculateProductStat } from './multiplicative.ts';

type Channel = 'attack' | 'final' | 'conditional' | 'product' | 'critProduct';

// Add a key here when an existing engine input gains a comparable source.
const channels = {
  doubleAttackPct: 'attack', skillTypeAttackPct: 'attack',
  critDamagePct: 'final', bossDamagePct: 'final', polarizationPct: 'final',
  allSkillDamagePct: 'final', strongSkillDamagePct: 'final', transcendenceSkillDamagePct: 'final',
  bleedDamagePct: 'final', fullHealthKillDamagePct: 'final', adaptabilityPct: 'final',
  superAdaptabilityPct: 'final', defenseIgnorePct: 'final',
  strongerPct: 'conditional', heatPct: 'conditional',
  multiplicativeDamagePct: 'product', multiplicativeCritDamagePct: 'critProduct',
} as const satisfies Record<string, Channel>;

export type EquivalenceKey = keyof typeof channels;
export interface EquivalenceAttribute { key: EquivalenceKey; name: string }
export type EquivalenceStatus = 'ok' | 'unreachable' | 'notApplicable';
export interface EquivalenceRow { key: EquivalenceKey; delta: number | null; gainPct: number | null; status: EquivalenceStatus }
export interface EquivalenceComparison { targetGainPct: number | null; rows: readonly EquivalenceRow[] }
export interface AttributeEquivalenceCalculator {
  baseDamage: number;
  damageWith(key: EquivalenceKey, delta: number): number | null;
  compare(baseKey: EquivalenceKey, delta: number): EquivalenceComparison;
}

export interface CombinedAttributeComparison {
  baseDamage: number;
  simulatedDamage: number;
  gainPct: number;
}

const MAX_DELTA_PCT = 1_000_000;
const isEquivalenceKey = (key: string): key is EquivalenceKey => Object.hasOwn(channels, key);

/** Labels and order come from the current game's attribute catalog. */
export function comparableAttributes(metadata: readonly { key: string; name: string; unit: string; active: boolean }[]): EquivalenceAttribute[] {
  return metadata.filter(entry => entry.active && entry.unit === 'percent' && isEquivalenceKey(entry.key))
    .map(entry => ({ key: entry.key as EquivalenceKey, name: entry.name }));
}

/** Apply the complete set of temporary deltas in one ordinary engine evaluation. */
export function calculateCombinedAttributeChange(input: LoadoutCalculationInput, baseline: LoadoutCalculationResult,
  deltas: Readonly<Partial<Record<EquivalenceKey, number>>>): CombinedAttributeComparison | null {
  const baseDamage = baseline.finalDamage.finalDamage;
  if (!Number.isFinite(baseDamage) || baseDamage < 0) return null;
  const stats: Partial<Record<EquivalenceKey, number>> = {};
  for (const [key, value] of Object.entries(deltas)) {
    if (!isEquivalenceKey(key) || !Number.isFinite(value) || Math.abs(value) > MAX_DELTA_PCT) return null;
    if (value !== 0) stats[key] = value;
  }
  if (!Object.keys(stats).length) return { baseDamage, simulatedDamage: baseDamage, gainPct: 0 };
  if (baseDamage === 0) return null;
  try {
    const temporary = { ...input, sources: { ...input.sources, shared: [...input.sources.shared,
      { sourceId: 'attribute-equivalence:combined', stats }] } };
    const simulatedDamage = calculateLoadout(temporary).finalDamage.finalDamage;
    const gainPct = (simulatedDamage / baseDamage - 1) * 100;
    return Number.isFinite(simulatedDamage) && simulatedDamage >= 0 && Number.isFinite(gainPct)
      ? { baseDamage, simulatedDamage, gainPct } : null;
  } catch { return null; }
}

/** Keep all hypothetical inputs outside the saved loadout and reuse the existing engine stages. */
export function createAttributeEquivalenceCalculator(input: LoadoutCalculationInput, baseline: LoadoutCalculationResult,
  attributes: readonly EquivalenceAttribute[]): AttributeEquivalenceCalculator {
  const baseDamage = baseline.finalDamage.finalDamage;
  const configurations = baseline.lowerwearConfigurations?.map(({ result }) =>
    createAttributeEquivalenceCalculator({ ...input, lowerwearBonusSources: undefined }, result, attributes));
  const baseFinalInput = finalDamageInputs(input, baseline);
  const attackParameters = resolveAttackParameters(input.attackParameters, input.classId, input.weaponEnhancementLevel);
  const generalFactors = baseline.generalMultiplicativeDamage.factors.map(({ sourceId, valuePct }) => ({ sourceId, valuePct }));
  const critFactors = baseline.multiplicativeCritDamage.factors.map(({ sourceId, valuePct }) => ({ sourceId, valuePct }));
  const stat = (key: string) => baseline.attributes.stats[key]?.finalTotal ?? 0;
  const effectiveTotal = (key: EquivalenceKey, delta: number) => {
    const detail = baseline.attributes.stats[key];
    return detail ? Math.min(detail.cap ?? Infinity, detail.totalBeforeCap + delta) : 0;
  };
  const maximumDelta = (key: EquivalenceKey) => {
    const detail = baseline.attributes.stats[key];
    if (detail?.cap !== undefined) return Math.max(0, Math.min(MAX_DELTA_PCT, detail.cap - detail.totalBeforeCap));
    if (key === 'defenseIgnorePct' && baseFinalInput.enemyDefensePct > 0) {
      const pole = 10_000 / baseFinalInput.enemyDefensePct - baseFinalInput.defenseIgnorePct;
      if (pole > 0) return Math.max(0, Math.min(MAX_DELTA_PCT, pole - Math.max(1e-8, pole * 1e-9)));
    }
    return MAX_DELTA_PCT;
  };

  const damageWith = (key: EquivalenceKey, delta: number): number | null => {
    if (delta === 0) return baseDamage;
    if (!Number.isFinite(delta) || delta < 0 || delta > MAX_DELTA_PCT
      || (key === 'defenseIgnorePct' && delta > maximumDelta(key))) return null;
    if (configurations) {
      const damages = configurations.map(calculator => calculator.damageWith(key, delta));
      return damages.some(value => value === null) ? null : (damages[0]! + damages[1]!) / 2;
    }
    const next = { ...baseFinalInput };
    try {
      switch (channels[key]) {
        case 'attack': {
          const attack = calculateAttack({
            attackType: input.attackType,
            physicalAttack: stat('physicalAttack'), magicalAttack: stat('magicalAttack'),
            doubleAttackPct: key === 'doubleAttackPct' ? effectiveTotal(key, delta) : stat('doubleAttackPct'),
            skillTypeAttackPct: key === 'skillTypeAttackPct' ? effectiveTotal(key, delta) : stat('skillTypeAttackPct'),
            attackLevel: stat('attackLevel'), ...attackParameters,
          });
          next.lowerDamage = attack.lowerDamage; next.upperDamage = attack.upperDamage;
          break;
        }
        case 'conditional':
          Object.assign(next, { [key]: (key === 'strongerPct' ? baseFinalInput.strongerPct : baseFinalInput.heatPct) + delta });
          break;
        case 'product':
          next.generalMultiplicativeDamage = calculateProductStat([...generalFactors,
            { sourceId: 'attribute-equivalence:temporary', valuePct: delta }]).value;
          break;
        case 'critProduct':
          next.multiplicativeCritDamageOffset = calculateProductStat([...critFactors,
            { sourceId: 'attribute-equivalence:temporary', valuePct: delta }], baseline.multiplicativeCritDamage.baselinePct).value;
          break;
        case 'final':
          Object.assign(next, { [key]: effectiveTotal(key, delta) });
          break;
      }
      const damage = calculateFinalDamage(next).finalDamage;
      return Number.isFinite(damage) && damage >= 0 ? damage : null;
    } catch { return null; }
  };

  const solve = (key: EquivalenceKey, targetDamage: number, startingDelta: number): EquivalenceRow => {
    const max = maximumDelta(key);
    const unavailable = (status: EquivalenceStatus): EquivalenceRow => ({ key, delta: null, gainPct: null, status });
    if (max <= 0) return unavailable('unreachable');
    const tolerance = Math.abs(targetDamage) * 1e-11;
    let high = Math.min(max, Math.max(1, startingDelta));
    let highDamage = damageWith(key, high);
    while (highDamage !== null && highDamage < targetDamage - tolerance && high < max) {
      high = Math.min(max, high * 2);
      highDamage = damageWith(key, high);
    }
    if (highDamage === null) return unavailable('unreachable');
    if (highDamage < targetDamage - tolerance) {
      return unavailable(highDamage <= baseDamage + tolerance ? 'notApplicable' : 'unreachable');
    }
    let low = 0;
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (low + high) / 2;
      if (middle === low || middle === high) break;
      const damage = damageWith(key, middle);
      if (damage === null || damage >= targetDamage - tolerance) high = middle;
      else low = middle;
      if (high - low <= Math.max(1e-9, high * 1e-10)) break;
    }
    const attainedDamage = damageWith(key, high);
    return attainedDamage === null ? unavailable('unreachable')
      : { key, delta: high, gainPct: (attainedDamage / baseDamage - 1) * 100, status: 'ok' };
  };

  return {
    baseDamage,
    damageWith,
    compare(baseKey: EquivalenceKey, delta: number): EquivalenceComparison {
      const notApplicable = (): EquivalenceComparison => ({ targetGainPct: null,
        rows: attributes.map(({ key }) => ({ key, delta: null, gainPct: null, status: 'notApplicable' })) });
      if (!attributes.some(attribute => attribute.key === baseKey) || !Number.isFinite(baseDamage) || baseDamage <= 0
        || !Number.isFinite(delta) || delta < 0 || delta > MAX_DELTA_PCT) return notApplicable();
      if (delta === 0) return { targetGainPct: 0,
        rows: attributes.map(({ key }) => ({ key, delta: 0, gainPct: 0, status: 'ok' })) };
      const targetDamage = damageWith(baseKey, delta);
      if (targetDamage === null || targetDamage <= baseDamage + Math.abs(baseDamage) * 1e-11) return notApplicable();
      return { targetGainPct: (targetDamage / baseDamage - 1) * 100,
        rows: attributes.map(({ key }) => key === baseKey
          ? { key, delta, gainPct: (targetDamage / baseDamage - 1) * 100, status: 'ok' }
          : solve(key, targetDamage, delta)) };
    },
  };
}
