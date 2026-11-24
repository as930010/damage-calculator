import type { WeaponGrowthDocument } from './equipment-effects.ts';
import type { StatContribution } from './types.ts';

export const defaultWeapon = '死龍遺言';
export const abyssWeapon = '深淵暗鬼';
export const weaponTypeField = 'Weapon.Type';

type GrowthSelection = WeaponGrowthDocument & { settingKey: string };
export interface WeaponGrowthOptions extends GrowthSelection {
  abyss: GrowthSelection & {
    attackLevelOffset: number;
    enhancementMilestones: readonly { level: number; stats: StatContribution['stats'] }[];
  };
}

/** Saves without a weapon selection use the original weapon. */
export function selectedWeapon(values: Readonly<Record<string, unknown>>) {
  return values[weaponTypeField] === abyssWeapon ? abyssWeapon : defaultWeapon;
}

export function selectedWeaponGrowth(data: WeaponGrowthOptions, values: Readonly<Record<string, unknown>>): GrowthSelection {
  return selectedWeapon(values) === abyssWeapon ? data.abyss : data;
}

export function resolveWeaponEnhancementMilestones(data: WeaponGrowthOptions, level: number | undefined): StatContribution[] {
  return data.abyss.enhancementMilestones.filter(milestone => (level ?? 0) >= milestone.level).map(({level, stats}) => ({
    sourceId: 'abyss-weapon-enhancement:' + level,
    stats,
  }));
}
