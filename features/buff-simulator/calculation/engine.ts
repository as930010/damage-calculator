import {
  cappedMultiplicativeBonus,
  collectValues,
  combineDefenseBreak,
  combineShield,
  multiplyBonuses,
  rankSupport,
  sumEffects,
} from "./aggregation.ts";
import { calculateDefenseDamageMultiplier } from "./defense.ts";
import { applyUniquenessScope } from "./team-uniqueness.ts";
import type {
  ChallengeCalculationInput,
  ChallengeCalculationResult,
  EffectBreakdown,
  EffectValues,
  SelectedOption,
  TeamCalculationInput,
  TeamCalculationResult,
} from "./types.ts";

const optionEffects = (input: TeamCalculationInput): EffectValues[] =>
  (input.options ?? []).map((option) => option.effects);

/** Keep one arena-wide copy of each option ID and retain its strongest configured value. */
function mergeArenaOptionsBySource(options: SelectedOption[]): SelectedOption[] {
  const bySource = new Map<string, SelectedOption>();
  for (const option of options) {
    const existing = bySource.get(option.id);
    if (!existing) {
      bySource.set(option.id, { ...option, effects: { ...option.effects } });
      continue;
    }
    for (const key of Object.keys(option.effects) as Array<keyof EffectValues>) {
      existing.effects[key] = Math.max(existing.effects[key] ?? 0, option.effects[key] ?? 0);
    }
  }
  return [...bySource.values()];
}

function makeBreakdown(
  members: EffectValues[],
  options: EffectValues[],
  result: TeamCalculationResult,
): EffectBreakdown[] {
  const entries: Array<[keyof EffectValues, EffectBreakdown["aggregation"], number | string]> = [
    ["buff", "multiply", result.buffMultiplier],
    ["debuff", "multiply", result.debuffMultiplier],
    ["defenseBreak", "remaining-product", result.defenseBreak],
    ["shield", "remaining-product", result.shield],
    ["attackReduction", "multiply", result.attackReduction],
    ["cooldownAcceleration", "multiply", result.cooldownAcceleration],
    ["cooldownReductionSeconds", "sum", result.cooldownReductionSeconds],
    ["resistanceReduction", "sum", result.resistanceReduction],
    ["mpRecoveryPerSecond", "multiply", result.mpRecoveryPerSecond],
    ["actionSpeedMultiplicative", "capped-multiply", result.actionSpeedMultiplicative],
    ["actionSpeedDiminishing", "multiply", result.actionSpeedDiminishing],
    ["roarBlock", "rank", result.roarBlock],
    ["debuffCleanse", "rank", result.debuffCleanse],
    ["superArmor", "rank", result.superArmor],
  ];

  return entries.map(([key, aggregation, value]) => ({
    key: key as EffectBreakdown["key"],
    values: collectValues(members, options, key),
    aggregation,
    result: value as number | TeamCalculationResult["roarBlock"],
  }));
}

export function calculateTeam(input: TeamCalculationInput): TeamCalculationResult {
  const uniqueness = applyUniquenessScope(input.members, input.uniqueClassCodes);
  const members = uniqueness.activeMembers.map((member) => member.effects);
  const options = optionEffects(input);
  const values = (key: keyof EffectValues) => collectValues(members, options, key);

  const buffMultiplier = multiplyBonuses(values("buff"));
  const debuffMultiplier = multiplyBonuses(values("debuff"));
  const defenseBreak = combineDefenseBreak(values("defenseBreak"));
  const defenseDamageMultiplier = calculateDefenseDamageMultiplier(
    input.mode,
    defenseBreak,
    input.defense.bossDamageReduction,
    input.defense.challengeBreakCoefficient,
  );
  const defenseBreakDamageIncrease = defenseDamageMultiplier - 1;
  const actionSpeedMultiplicative = cappedMultiplicativeBonus(
    values("actionSpeedMultiplicative"),
    input.actionSpeedCap ?? 0.4,
  );

  const result: TeamCalculationResult = {
    mode: input.mode,
    buffMultiplier,
    debuffMultiplier,
    buffIncrease: buffMultiplier - 1,
    debuffIncrease: debuffMultiplier - 1,
    defenseBreak,
    defenseBreakDamageIncrease,
    defenseDamageMultiplier,
    totalDamageMultiplier: buffMultiplier * debuffMultiplier * defenseDamageMultiplier,
    shield: combineShield(values("shield")),
    attackReduction: multiplyBonuses(values("attackReduction")) - 1,
    cooldownAcceleration: multiplyBonuses(values("cooldownAcceleration")) - 1,
    cooldownReductionSeconds: sumEffects(values("cooldownReductionSeconds")),
    resistanceReduction: sumEffects(values("resistanceReduction")),
    mpRecoveryPerSecond: multiplyBonuses(values("mpRecoveryPerSecond")) - 1,
    actionSpeedMultiplicative,
    actionSpeedDiminishing: multiplyBonuses(values("actionSpeedDiminishing")) - 1,
    roarBlock: rankSupport(values("roarBlock")),
    debuffCleanse: rankSupport(values("debuffCleanse")),
    superArmor: rankSupport(values("superArmor")),
    breakdown: [],
    ignoredClassIds: uniqueness.ignoredClassIds,
  };
  result.breakdown = makeBreakdown(members, options, result);
  return result;
}

/** Produces both per-route results and a fresh 8-person same-arena result. */
export function calculateChallenge(
  input: ChallengeCalculationInput,
): ChallengeCalculationResult {
  const sharedOptions = input.sharedOptions ?? [];
  const team1: TeamCalculationInput = {
    ...input.firstTeam,
    mode: "challenge",
    defense: input.defense,
    uniqueClassCodes: input.uniqueClassCodes,
    actionSpeedCap: input.actionSpeedCap,
  };
  const team2: TeamCalculationInput = {
    ...input.secondTeam,
    mode: "challenge",
    defense: input.defense,
    uniqueClassCodes: input.uniqueClassCodes,
    actionSpeedCap: input.actionSpeedCap,
  };
  const sharedArena: TeamCalculationInput = {
    mode: "challenge",
    members: [...input.firstTeam.members, ...input.secondTeam.members],
    options: mergeArenaOptionsBySource([
      ...(input.firstTeam.options ?? []),
      ...(input.secondTeam.options ?? []),
      ...sharedOptions,
    ]),
    defense: input.defense,
    uniqueClassCodes: input.uniqueClassCodes,
    actionSpeedCap: input.actionSpeedCap,
  };

  return {
    firstTeam: calculateTeam(team1),
    secondTeam: calculateTeam(team2),
    sharedArena: calculateTeam(sharedArena),
  };
}
