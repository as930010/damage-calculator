import type { AttackParametersDocument, StatContribution } from "./types.ts";
import type { SimulatorEquipmentContributionGroups } from "./equipment-catalog.ts";

export interface InnerwearSlot {
  id: string;
  name: string;
  typeCell: string;
  enhancementCell: string;
  forgingCell: string;
  attackType: "physical" | "magical";
  attackFraction: number;
  wearSet: "shared" | "lowerwearA" | "lowerwearB";
  enabledBy?: string;
  allSkillDamagePerEnhancement?: number;
  multiplicativeDamageEnhancementBonusPct?: number;
}

export interface InnerwearRulesDocument {
  schemaVersion: 2;
  baseLevel: number;
  itemLevelBonus: number;
  baselineCoefficient: number;
  slots: readonly InnerwearSlot[];
  enhancementStats: Readonly<Record<string, Readonly<Record<string, number>>>>;
  forgingAttack: Readonly<Record<string, number>>;
  forgingBonuses: readonly {
    statKey: string;
    steps: readonly { minimum: number; value: number }[];
    otherwise: number | "sheetError";
  }[];
  extraAdaptability: { forgingEquals: number; value: number };
  nephron: {
    baseStats: Readonly<Record<string, number>>;
    forgingAttack: Readonly<Record<string, number>>;
    enhancementStats: Readonly<Record<string, Readonly<Record<string, number>>>>;
    forgingMilestones: readonly { minimum: number; stats: Readonly<Record<string, number>> }[];
  };
}

/** C/D/E/H/I/K/Q38:42 plus gloves' enhancement contribution in L41. */
export function resolveInnerwearSources(
  rules: InnerwearRulesDocument,
  attackParameters: AttackParametersDocument,
  classId: string,
  values: Readonly<Record<string, string | number | undefined>>,
  lowerwearAlternativeEnabled: boolean,
): SimulatorEquipmentContributionGroups {
  const groups: Record<"shared" | "lowerwearA" | "lowerwearB", StatContribution[]> = {
    shared: [], lowerwearA: [], lowerwearB: [],
  };
  const coefficients = attackParameters.classes[classId];
  if (!coefficients) throw new RangeError(`職業係數未設定：${classId}`);
  for (const slot of rules.slots) {
    if (slot.enabledBy && !lowerwearAlternativeEnabled) continue;
    const enhancement = values[slot.enhancementCell];
    const forging = values[slot.forgingCell];
    if ((enhancement == null || enhancement === "") && (forging == null || forging === "")) continue;
    if (enhancement == null || enhancement === "" || forging == null || forging === "") {
      throw new RangeError(`請填完整${slot.name}的強化與鍛造等級。`);
    }
    const level = Number(String(enhancement).match(/\d+/)?.[0]);
    const nephron = String(values[slot.typeCell] ?? "百億") === "內布隆";
    const factor = attackParameters.weaponEnhancementFactors[String(level)];
    const forgeLevel = Number(forging);
    const enhanceStats = (nephron ? rules.nephron.enhancementStats : rules.enhancementStats)[String(level)];
    const forgeAttack = (nephron ? rules.nephron.forgingAttack : rules.forgingAttack)[String(forgeLevel)];
    if (!Number.isInteger(level) || factor === undefined || !enhanceStats || !Number.isInteger(forgeLevel) || forgeAttack === undefined) {
      throw new RangeError(`${slot.name}的強化或鍛造等級不在資料範圍內。`);
    }
    const coefficient = coefficients[slot.attackType];
    const raw = slot.attackFraction * (0.85 * coefficient - 0.7775 * rules.baselineCoefficient)
      + slot.attackFraction * (0.15 * coefficient - 0.0225 * rules.baselineCoefficient)
      * (rules.baseLevel + rules.itemLevelBonus) + 0.5;
    const stats: Record<string, number> = {
      ...(nephron ? rules.nephron.baseStats : {}),
      ...enhanceStats,
      [slot.attackType === "physical" ? "physicalAttack" : "magicalAttack"]: Math.floor(raw) * factor + forgeAttack,
    };
    if (nephron) {
      for (const milestone of rules.nephron.forgingMilestones) {
        if (forgeLevel < milestone.minimum) continue;
        for (const [key, value] of Object.entries(milestone.stats)) stats[key] = (stats[key] ?? 0) + value;
      }
    } else {
      for (const bonus of rules.forgingBonuses) {
        const value = bonus.steps.find((step) => forgeLevel >= step.minimum)?.value ?? bonus.otherwise;
        if (value === "sheetError") {
          throw new RangeError(`${slot.name}鍛造 ${forgeLevel}：原試算表的 IFS 未定義此等級的效果，需確認後才能計算。`);
        }
        stats[bonus.statKey] = value;
      }
      if (forgeLevel === rules.extraAdaptability.forgingEquals) stats.adaptabilityPct += rules.extraAdaptability.value;
    }
    if (slot.allSkillDamagePerEnhancement !== undefined) stats.allSkillDamagePct = level * slot.allSkillDamagePerEnhancement;
    if (slot.multiplicativeDamageEnhancementBonusPct !== undefined) {
      stats.multiplicativeDamagePct = level + slot.multiplicativeDamageEnhancementBonusPct;
    }
    groups[slot.wearSet].push({ sourceId: `innerwear:${slot.id}`, stats });
  }
  return { ...groups, lowerwearAlternativeEnabled };
}
