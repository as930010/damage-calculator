import type { StatContribution } from "./types.ts";

export interface NephronTransformationOption {
  id: string;
  name: string;
  statKey?: string;
  tierValuesPct: readonly number[];
  multipliesByEnhancementLevel?: boolean;
}

export interface NephronMagazineOption {
  id: string;
  name: string;
  statKey?: string;
  additionalLevelStatKeys?: readonly string[];
  levelStatKey?: string;
  baseStats?: Readonly<Record<string, number>>;
  levelValuesPct: readonly number[];
  otherEffects?: readonly string[];
}

export interface NephronArmorFieldRules {
  part: string;
  slotId: string;
  transformFields: readonly { attributeCell: string; valueCell: string }[];
  magazineCell: string;
  magazineLevelCell: string;
  wearSet: "shared" | "lowerwearA" | "lowerwearB";
  enabledBy?: string;
}

export interface NephronArmorRulesDocument {
  schemaVersion: 1;
  dataUpdatedAt: string;
  source: string;
  transformations: readonly NephronTransformationOption[];
  magazines: readonly NephronMagazineOption[];
  levelLabels: readonly string[];
  fields: readonly NephronArmorFieldRules[];
  notes: readonly string[];
}

export interface NephronTransformationInput {
  attribute: string | null | undefined;
  value: number | null | undefined;
}

export interface NephronArmorInput {
  slotId: string;
  enhancement: string | number | null | undefined;
  transformations: readonly NephronTransformationInput[];
  magazine: string | null | undefined;
  magazineLevel: string | number | null | undefined;
}

function enhancementNumber(value: string | number | null | undefined, label: string): number {
  const match = String(value ?? "").match(/[0-9]+/);
  const parsed = match ? Number(match[0]) : NaN;
  if (!Number.isSafeInteger(parsed)) throw new RangeError(label + "尚未選擇有效強化等級。");
  return parsed;
}

function magazineLevelIndex(value: string | number | null | undefined): number {
  const match = String(value ?? "").match(/[0-9]+/);
  const parsed = match ? Number(match[0]) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 6) throw new RangeError("彈匣等級須介於 Lv.1 與 Lv.6。");
  return parsed - 1;
}

/** Resolve one Nephron armor's three selectable conversion lines and one unique magazine. */
export function resolveNephronArmorSources(
  document: NephronArmorRulesDocument,
  selections: readonly NephronArmorInput[],
): StatContribution[] {
  const result: StatContribution[] = [];
  const usedMagazines = new Set<string>();
  const slotIds = new Set<string>();
  for (const selection of selections) {
    if (slotIds.has(selection.slotId)) throw new RangeError("Nephron armor slot was supplied twice: " + selection.slotId);
    slotIds.add(selection.slotId);
    if (selection.transformations.length !== 3) throw new RangeError(selection.slotId + " must have exactly three transformation lines.");
    const level = enhancementNumber(selection.enhancement, selection.slotId);
    const usedTransformations = new Set<string>();
    selection.transformations.forEach((entry, index) => {
      const name = String(entry.attribute ?? "").trim();
      const rawValue = entry.value;
      if (!name && rawValue == null) return;
      if (!name) throw new RangeError(selection.slotId + " 變換 " + (index + 1) + " 請先選擇屬性。");
      const option = document.transformations.find((candidate) => candidate.name === name);
      if (!option) throw new RangeError("未知的內布隆變換屬性：" + name);
      if (usedTransformations.has(name)) throw new RangeError("同一件內布隆防具的變換屬性不可重複。");
      usedTransformations.add(name);
      if (!option.statKey) return;
      if (rawValue == null) throw new RangeError(selection.slotId + " 變換 " + (index + 1) + " 請填寫數值檔位。");
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) throw new TypeError("內布隆變換數值須為有限數字。");
      const percentagePoints = rawValue * 100;
      if (!option.tierValuesPct.some((candidate) => Math.abs(candidate - percentagePoints) < 1e-8)) {
        throw new RangeError(name + "的數值必須使用所列的十檔之一。");
      }
      const value = option.multipliesByEnhancementLevel ? level * percentagePoints : percentagePoints;
      result.push({ sourceId: "nephron-transform:" + selection.slotId + ":" + (index + 1), stats: { [option.statKey]: value } });
    });

    const magazineName = String(selection.magazine ?? "").trim();
    const rawMagazineLevel = selection.magazineLevel;
    if (!magazineName && (rawMagazineLevel == null || rawMagazineLevel === "")) continue;
    if (!magazineName) throw new RangeError(selection.slotId + " 請先選擇彈匣。");
    if (rawMagazineLevel == null || rawMagazineLevel === "") throw new RangeError(selection.slotId + " 請選擇彈匣等級。");
    const magazine = document.magazines.find((candidate) => candidate.name === magazineName);
    if (!magazine) throw new RangeError("未知的內布隆彈匣：" + magazineName);
    const magazineLevelIndexValue = magazineLevelIndex(rawMagazineLevel);
    const uniqueKey = magazine.id + "::" + (magazineLevelIndexValue + 1);
    if (usedMagazines.has(uniqueKey)) throw new RangeError("相同種類與等級的彈匣不可重複裝備。");
    usedMagazines.add(uniqueKey);
    const levelValue = magazine.levelValuesPct[magazineLevelIndexValue];
    if (levelValue === undefined || !Number.isFinite(levelValue)) throw new RangeError(magazineName + "沒有此彈匣等級的數值。");
    const stats: Record<string, number> = { ...(magazine.baseStats ?? {}) };
    const statKey = magazine.levelStatKey ?? magazine.statKey;
    if (statKey) stats[statKey] = (stats[statKey] ?? 0) + levelValue;
    for (const additionalStatKey of magazine.additionalLevelStatKeys ?? []) {
      stats[additionalStatKey] = (stats[additionalStatKey] ?? 0) + levelValue;
    }
    result.push({ sourceId: "nephron-magazine:" + selection.slotId + ":" + magazine.id + ":Lv." + (magazineLevelIndexValue + 1), stats });
  }
  return result;
}
