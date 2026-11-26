import { calculateDamageBuff } from './damage-buff.ts';
import { applySupportMagazines, bindSupportMagazineSources } from './support-magazines.ts';
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
  DefenseContribution,
  EffectBreakdown,
  EffectValues,
  SelectedOption,
  TeamCalculationInput,
  TeamCalculationResult,
} from "./types.ts";

function defenseContributions(id: string, label: string, category: "class" | "loadout", effects: EffectValues): DefenseContribution[] {
  const contributions: DefenseContribution[] = [];
  const { defenseBreak = 0, defenseIgnoreAdditive = 0 } = effects;
  if (defenseBreak > 0) contributions.push({ id, label, category, rate: defenseBreak });
  if (defenseIgnoreAdditive > 0) contributions.push({ id, label, category: "defense-ignore", rate: defenseIgnoreAdditive });
  return contributions;
}

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

  if (result.defenseIgnoreAdditive) entries.push(["defenseIgnoreAdditive", "sum", result.defenseIgnoreAdditive]);
  const magicAttackReductions = collectValues(members, options, "magicalAttackReduction");
  if (magicAttackReductions.some(Boolean)) entries.push(["magicalAttackReduction", "multiply", multiplyBonuses(magicAttackReductions) - 1]);

  return entries.map(([key, aggregation, value]) => ({
    key: key as EffectBreakdown["key"],
    values: collectValues(members, options, key),
    aggregation,
    result: value as number | TeamCalculationResult["roarBlock"],
  }));
}

export function calculateTeam(input: TeamCalculationInput): TeamCalculationResult {
  const uniqueness = applyUniquenessScope(input.members, input.uniqueClassCodes);
  const augmented = uniqueness.activeMembers.map(member => applySupportMagazines(member, input.options ?? [], input.uniqueClassCodes ?? []));
  const members = augmented.map(member => member.effects);
  const magazineDetails = augmented.flatMap(member => member.details);
  const activeOptions = (input.options ?? []).filter(option => !option.supportMagazine);
  const options = activeOptions.map(option => option.effects);
  const values = (key: keyof EffectValues) => collectValues(members, options, key);

  const attackFactor = multiplyBonuses(values("buff"));
  const damageBuff = calculateDamageBuff(input, uniqueness.activeMembers.map((member, index) => ({ ...member, effects: members[index] })), activeOptions, attackFactor);
  const buffMultiplier = attackFactor * multiplyBonuses(values("legacyCompositeBuff"))
    * (damageBuff ? damageBuff.critFactor * damageBuff.bossFactor : 1);
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
    ...(damageBuff ? { damageBuff } : {}),
    mode: input.mode,
    ...(input.includeDefenseContributions ? { defenseContributions: [
      ...uniqueness.activeMembers.flatMap((member, index) => defenseContributions("class:" + member.classId, member.classCode, "class", members[index])),
      ...activeOptions.flatMap(option => defenseContributions("loadout:" + option.id, option.id, "loadout", option.effects)),
    ] } : {}),
    buffMultiplier,
    debuffMultiplier,
    buffIncrease: buffMultiplier - 1,
    debuffIncrease: debuffMultiplier - 1,
    defenseBreak,
    defenseBreakDamageIncrease,
    defenseDamageMultiplier,
    totalDamageMultiplier: buffMultiplier * debuffMultiplier * defenseDamageMultiplier,
    ...(sumEffects(values("defenseIgnoreAdditive")) === 0 ? {} : { defenseIgnoreAdditive: sumEffects(values("defenseIgnoreAdditive")) }),
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
    ...(magazineDetails.length ? { supportMagazineDetails: magazineDetails } : {}),
  };
  result.breakdown = makeBreakdown(members, options, result);
  return result;
}

/** Produces both per-route results and a fresh 8-person same-arena result. */
export function calculateChallenge(
  input: ChallengeCalculationInput,
): ChallengeCalculationResult {
  const sharedOptions = input.sharedOptions ?? [];
  const sharedSettings = { defense: input.defense, uniqueClassCodes: input.uniqueClassCodes,
    actionSpeedCap: input.actionSpeedCap, includeDefenseContributions: input.includeDefenseContributions,
    damageBase: input.damageBase };
  const team1: TeamCalculationInput = {
    ...input.firstTeam,
    mode: "challenge",
    ...sharedSettings,
  };
  const team2: TeamCalculationInput = {
    ...input.secondTeam,
    mode: "challenge",
    ...sharedSettings,
  };
  const sharedArena: TeamCalculationInput = {
    mode: "challenge",
    members: [
      ...bindSupportMagazineSources(input.firstTeam.members, input.firstTeam.options ?? [], input.uniqueClassCodes ?? []),
      ...bindSupportMagazineSources(input.secondTeam.members, input.secondTeam.options ?? [], input.uniqueClassCodes ?? []),
    ],
    options: mergeArenaOptionsBySource([
      ...(input.firstTeam.options ?? []),
      ...(input.secondTeam.options ?? []),
      ...sharedOptions,
    ].filter(option => !option.supportMagazine)),
    ...sharedSettings,
  };

  return {
    firstTeam: calculateTeam(team1),
    secondTeam: calculateTeam(team2),
    sharedArena: calculateTeam(sharedArena),
  };
}
