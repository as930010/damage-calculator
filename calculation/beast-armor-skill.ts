export const beastArmorSkillSourceId = 'master-beast:armor-skill';

const unrelated = { id: 'unrelated', label: '無關傷害', statKey: null } as const;

export const beastArmorSkillEffects = [
  { id: 'super-adaptability', label: '超適應力', statKey: 'superAdaptabilityPct' },
  { id: 'all-damage', label: '所有傷害', statKey: 'multiplicativeDamagePct' },
  { id: 'all-skill-damage', label: '所有技能傷害', statKey: 'multiplicativeDamagePct' },
  { id: 'critical-damage', label: '致命一擊傷害', statKey: 'multiplicativeCritDamagePct' },
  { id: 'boss-damage', label: 'Boss 傷害', statKey: 'bossDamagePct' },
  { id: 'defense-ignore', label: '無視防禦力', statKey: 'defenseIgnorePct' },
  unrelated,
] as const;

const ringSkillEffects = [{ id: 'armor-skill-boost', label: '增加聖獸盔甲效果' }, unrelated] as const;
const ringRolls = Array.from({ length: 20 }, (_, index) => index + 1);

export const beastArmorSkillFields = {
  slotId: 'armor',
  enabled: 'MasterBeast.Armor.Skill.Enabled',
  effect: 'MasterBeast.Armor.Skill.Effect',
  value: 'MasterBeast.Armor.Skill.Value',
  effects: beastArmorSkillEffects,
  rolls: [3, 4, 5],
} as const;

const ringSlots = [['ring-one', 'Ring1'], ['ring-two', 'Ring2']] as const;
export const beastRingSkills = ringSlots.map(([slotId, part]) => ({
  slotId,
  enabled: 'MasterBeast.' + part + '.Skill.Enabled',
  effect: 'MasterBeast.' + part + '.Skill.Effect',
  value: 'MasterBeast.' + part + '.Skill.Value',
  effects: ringSkillEffects,
  rolls: ringRolls,
}));
export const beastSkills = [beastArmorSkillFields, ...beastRingSkills];

type BeastSkillFields = typeof beastSkills[number];
export interface BeastSkillSelection {
  enabled?: string | number;
  effect?: string | number;
  value?: string | number;
}

export const beastSkillEnabledChoices = [0, 1] as const;
const unrelatedRolls = [0] as const;
const emptyRolls = [] as const;

export function beastArmorSkillEffect(id: unknown) {
  return beastArmorSkillEffects.find(effect => effect.id === id);
}

export function beastSkillValueChoices(skill: BeastSkillFields, id: unknown): readonly number[] {
  if (!skill.effects.some(effect => effect.id === id)) return emptyRolls;
  return id === unrelated.id ? unrelatedRolls : skill.rolls;
}

export function readBeastSkillSelection(skill: BeastSkillFields, values: Readonly<Record<string, string | number>>): BeastSkillSelection {
  return { enabled: values[skill.enabled], effect: values[skill.effect], value: values[skill.value] };
}

function participationSetting(enabled: BeastSkillSelection['enabled']): boolean | undefined {
  return enabled === undefined || enabled === '' ? undefined : enabled === 1 || enabled === '1';
}

export function beastSkillParticipates(skill: BeastSkillFields, selection: BeastSkillSelection): boolean {
  // Before the checkbox existed, a valid configured roll always participated.
  return participationSetting(selection.enabled) ?? (readSkillValue(skill, selection) > 0);
}

export function invalidBeastSkillFields(values: Readonly<Record<string, string | number>>): string[] {
  const invalid: string[] = [];
  for (const skill of beastSkills) {
    const enabled = values[skill.enabled];
    if (enabled !== undefined && enabled !== '' && !beastSkillEnabledChoices.some(choice => String(choice) === String(enabled))) invalid.push(skill.enabled);
    const id = values[skill.effect], raw = values[skill.value];
    const choices = beastSkillValueChoices(skill, id);
    if (id !== undefined && id !== '' && !choices.length) invalid.push(skill.effect);
    if (raw !== undefined && raw !== '' && !choices.some(value => raw === value || raw === String(value))) invalid.push(skill.value);
  }
  return invalid;
}

function readSkillValue(fields: BeastSkillFields, selection: BeastSkillSelection | undefined): number {
  return beastSkillValueChoices(fields, selection?.effect)
    .find(value => selection?.value === value || selection?.value === String(value)) ?? 0;
}

function readParticipatingSkillValue(skill: BeastSkillFields, selection: BeastSkillSelection | undefined): number {
  return participationSetting(selection?.enabled) === false ? 0 : readSkillValue(skill, selection);
}

/** In-game verification: 5% with 16% and 17% ring bonuses yields 6.65%. */
export function effectiveBeastArmorSkillValue(
  armor: BeastSkillSelection | undefined,
  rings: readonly BeastSkillSelection[] = [],
): number | undefined {
  const base = readParticipatingSkillValue(beastArmorSkillFields, armor);
  if (!base) return undefined;
  const bonus = beastRingSkills.reduce((total, fields, index) => total + readParticipatingSkillValue(fields, rings[index]), 0);
  return base * (100 + bonus) / 100;
}
