/** Shared option identity and copy. Each tool supplies its own effect model. */
export interface ClassSkillVersionOption {
  id: string;
  classId: string;
  label: string;
  defaultEnabled: boolean;
  teamDefaultEnabled: boolean;
  sourceLabel?: string;
}

export const classSkillVersionOptions: readonly ClassSkillVersionOption[] = [
  { id: 'FP.FatalShotConverted', classId: 'FP', label: '致命神槍是否轉換', defaultEnabled: true, teamDefaultEnabled: false },
  { id: 'DN.FieldPowerConverted', classId: 'DN', label: '原野力量是否轉換', defaultEnabled: false, teamDefaultEnabled: true, sourceLabel: 'DN [轉換]原野力量' },
];

export const classSkillSourcePrefix = 'class-skill-version:';

export function getClassSkillVersionOptions(classId: string) {
  return classSkillVersionOptions.filter(option => option.classId === classId);
}
