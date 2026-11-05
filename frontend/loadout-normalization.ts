import type { GameData } from './data.ts';
import type { LoadoutState } from './state.ts';

export function clearInvalidAccessoryAppraisals(data: GameData, target: LoadoutState): string[] {
  const clearedFields: string[] = [];
  for (const group of data.accessoryEffects.groups) {
    const mapping = data.mapping.selections.find(entry => entry.selectionField === group.selectionField);
    const itemName = String(target.values[group.selectionField] ?? '');
    const item = mapping && itemName
      ? data.catalogs[mapping.catalogFile].items.find(entry => entry.slotId === group.slotId && entry.name === itemName)
      : undefined;
    const options = itemName ? group.optionsByEquipmentName?.[itemName] ?? group.options : group.options;
    const effectCount = item?.appraisal?.canAppraise && Number.isInteger(item.appraisal.effectCount)
      && item.appraisal.effectCount! > 0 && item.appraisal.effectCount! <= group.inputFields.length
      ? item.appraisal.effectCount!
      : 0;
    for (const [index, fieldId] of group.inputFields.entries()) {
      const value = String(target.values[fieldId] ?? '');
      if (!value || (index < effectCount && options.some(option => option.name === value))) continue;
      delete target.values[fieldId];
      clearedFields.push(fieldId);
    }
  }
  return clearedFields;
}

export function clearDuplicateTransformationChoices(data: GameData, target: LoadoutState): string[] {
  const seen = new Set<string>();
  const clearedFields: string[] = [];
  for (const slot of data.transformations.slots) {
    const choice = String(target.values[slot.choiceField] ?? '');
    if (!choice) continue;
    if (seen.has(choice)) {
      delete target.values[slot.choiceField];
      clearedFields.push(slot.choiceField);
    } else seen.add(choice);
  }
  return clearedFields;
}

export function clearDuplicateNephronTransformationChoices(data: GameData, target: LoadoutState): string[] {
  const clearedFields: string[] = [];
  for (const field of data.nephronArmor.fields) {
    const seen = new Set<string>();
    for (const transform of field.transformFields) {
      const choice = String(target.values[transform.attributeField] ?? '');
      if (!choice || choice === '無關傷害') continue;
      if (seen.has(choice)) {
        delete target.values[transform.attributeField];
        delete target.values[transform.valueField];
        clearedFields.push(transform.attributeField, transform.valueField);
      } else seen.add(choice);
    }
  }
  return clearedFields;
}

export function applyWeaponMagicStonePreset(data: GameData, target: LoadoutState, grade: string, overwrite = false): void {
  const weaponMagicStoneFields = data.weaponGrades.colorGroups.flatMap(group => group.settingKeys);
  if (!grade) return;
  if (!overwrite && weaponMagicStoneFields.some(fieldId => target.values[fieldId] !== undefined)) return;
  for (const colorGroup of data.weaponGrades.colorGroups) {
    const optionId = colorGroup.presetByGrade[grade];
    const option = colorGroup.options.find(entry => entry.id === optionId);
    if (!option) continue;
    for (const fieldId of colorGroup.settingKeys) target.values[fieldId] = option.name;
  }
}
