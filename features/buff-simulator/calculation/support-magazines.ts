import type { SelectedMember, SelectedOption, SupportMagazineDetail, SupportMagazineSelection, SupportMagazineTarget } from './types.ts';

/** Verified common green-control components; class-specific extra factors remain intact. */
export const GREEN_CONTROL_BUFF_COMPONENTS = {
  attackBuff: { label: '攻擊力 Buff', value: .12 },
  allSkillDamageBuff: { label: '所有技能傷害 Buff', value: .12 },
  allSpeedBuff: { label: '所有速度 Buff', value: .1 },
} as const;
export const SUPPORT_MAGAZINE_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export const supportMagazineLevelKey = (id: string) => id + '-level';
/** Old/malformed saves restore Lv.1 without rounding a fractional or out-of-range level. */
export function normalizeSupportMagazineLevel(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6 ? value : 1;
}
export const supportMagazineBonus = (level: unknown) => normalizeSupportMagazineLevel(level) * .005;
const isGreenControl = (member: SelectedMember, codes: readonly string[]) =>
  member.uniquenessGroup === 'green-control' || codes.includes(member.classCode);

/** Attach the owning team's configuration before arena uniqueness; never merge it across teams. */
export function bindSupportMagazineSources(members: SelectedMember[], options: SelectedOption[], codes: readonly string[]): SelectedMember[] {
  const selections = options.flatMap(option => option.supportMagazine ? [option.supportMagazine] : []);
  return members.map(member => isGreenControl(member, codes) ? { ...member, supportMagazines: selections } : member);
}

export function applySupportMagazines(member: SelectedMember, options: SelectedOption[], codes: readonly string[]) {
  const details: SupportMagazineDetail[] = [];
  if (!isGreenControl(member, codes)) return { effects: member.effects, details };
  const selections = member.supportMagazines ?? options.flatMap(option => option.supportMagazine ? [option.supportMagazine] : []);
  const active = new Map<SupportMagazineTarget, SupportMagazineSelection>();
  for (const selection of selections) {
    if (selection.enabled && Object.hasOwn(GREEN_CONTROL_BUFF_COMPONENTS, selection.target) && !active.has(selection.target)) active.set(selection.target, selection);
  }
  if (!active.size) return { effects: member.effects, details };
  const effective = { attackBuff: Number(GREEN_CONTROL_BUFF_COMPONENTS.attackBuff.value), allSkillDamageBuff: Number(GREEN_CONTROL_BUFF_COMPONENTS.allSkillDamageBuff.value), allSpeedBuff: Number(GREEN_CONTROL_BUFF_COMPONENTS.allSpeedBuff.value) };
  for (const [target, selection] of active) {
    const base = GREEN_CONTROL_BUFF_COMPONENTS[target].value, level = normalizeSupportMagazineLevel(selection.level);
    effective[target] = base + supportMagazineBonus(level);
    details.push({ optionId: selection.id, target, level, classCode: member.classCode, baseValue: base, effectiveValue: effective[target] });
  }
  const effects = { ...member.effects };
  if (active.has('attackBuff') || active.has('allSkillDamageBuff')) {
    const originalCommon = (1 + GREEN_CONTROL_BUFF_COMPONENTS.attackBuff.value) * (1 + GREEN_CONTROL_BUFF_COMPONENTS.allSkillDamageBuff.value);
    const otherFactors = (1 + (effects.buff ?? 0)) / originalCommon;
    effects.buff = otherFactors * (1 + effective.attackBuff) * (1 + effective.allSkillDamageBuff) - 1;
  }
  if (active.has('allSpeedBuff')) {
    const otherSpeedFactors = (1 + (effects.actionSpeedMultiplicative ?? 0)) / (1 + GREEN_CONTROL_BUFF_COMPONENTS.allSpeedBuff.value);
    effects.actionSpeedMultiplicative = otherSpeedFactors * (1 + effective.allSpeedBuff) - 1;
  }
  return { effects, details };
}
