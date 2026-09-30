import type { EffectKey } from "../calculation/types.ts";

export function supportRankLabel(
  rank: string,
  effectKey?: EffectKey,
  superArmorRankLabels: Record<string, string> = {},
): string {
  if (effectKey === "superArmor") return superArmorRankLabels[rank] ?? rank;
  return ({ none: "無", has: "有", good: "優", strong: "強" } as Record<string, string>)[rank] ?? rank;
}
