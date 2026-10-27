/** Fixed, independent seeds for the 20 optimizer quality scenarios. */
export function iceScenario(data, example, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 20) throw new RangeError('Scenario index must be 0–19.');
  let seed = (0x85190928 + Math.imul(index, 0x9e3779b9)) >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const pick = items => items[Math.floor(random() * items.length)];
  const stageOptions = fieldId => {
    const input = data.simulatorInputs.inputs.find(entry => entry.fieldIds.includes(fieldId));
    const catalog = data.simulatorInputs.catalogs.find(entry => entry.id === input?.catalogId);
    const values = catalog?.options.map(entry => entry.value) ?? [];
    if (input?.inputType !== 'list' || !values.length || values.some(value => !Number.isFinite(value))) {
      throw new RangeError(`Scenario requires numeric selectable options for ${fieldId}.`);
    }
    return values;
  };
  const state = structuredClone(example);
  const right = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const classes = data.classes.classes.filter(entry => entry.active).map(entry => entry.id);
  state.Job = classes[(index * 17 + 3) % classes.length];
  state.values['Stage.Adapt'] = pick(stageOptions('Stage.Adapt'));
  state.values['Stage.BossDEF'] = pick(stageOptions('Stage.BossDEF'));
  state.values['Stage.CritRatePenalty'] = pick(stageOptions('Stage.CritRatePenalty'));
  const earring = data.mapping.selections.find(entry => entry.selectionField === 'Accessory.Earring');
  state.values['Accessory.Earring'] = pick(data.catalogs[earring.catalogFile].items
    .filter(item => item.active && item.slotId === earring.slotId).map(item => item.name));
  state.values['Effect.Consumable'] = pick(data.otherEffects.consumables.map(item => item.name));
  state.values['Effect.Environment'] = pick(data.otherEffects.environments.map(item => item.name));
  state.nutProtectionPotionEnabled = random() < 0.5;
  state.petSkillAttackEnabled = random() < 0.5;
  for (const entry of right) {
    const names = [...new Set(data.catalogs[entry.catalogFile].items
      .filter(item => item.active && item.slotId === entry.slotId && !['神埃', '騎士團'].includes(item.name))
      .map(item => item.name))];
    if (!names.length) throw new RangeError(`Scenario has no equipped option for ${entry.selectionField}.`);
    state.values[entry.selectionField] = pick(names);
  }
  for (const field of data.rightIceSets.selectionFields) state.values[field] = '';
  return state;
}

/** A small real-data domain retaining exactly-2 and at-least-3 set interactions. */
export function smallIceScenario(data, example, index) {
  const tiny = structuredClone(data), names = ['幻影面紗', '真理假面'];
  const right = tiny.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const selected = right.filter(entry => tiny.catalogs[entry.catalogFile].items.some(item => item.active
    && item.slotId === entry.slotId && names.includes(item.name))).slice(0, 4);
  const fields = new Set(selected.map(entry => entry.selectionField));
  tiny.mapping.selections = tiny.mapping.selections.filter(entry => entry.catalogFile !== 'equipment/right-ice.json'
    || fields.has(entry.selectionField));
  tiny.catalogs['equipment/right-ice.json'].items = tiny.catalogs['equipment/right-ice.json'].items.filter(item =>
    names.includes(item.name) && selected.some(entry => entry.slotId === item.slotId));
  tiny.rightIceSets.effects = tiny.rightIceSets.effects.filter(effect => names.includes(effect.setName));
  const state = iceScenario(data, example, index);
  for (const entry of right) state.values[entry.selectionField] = '';
  for (const field of tiny.rightIceSets.selectionFields) state.values[field] = '';
  return { data: tiny, state, selected, names };
}

/** Historical complete outfit; its recorded damage used obsolete stage inputs and must be recalculated. */
export const icePairCoverageCounterexample = {
  scenarioIndex: 18,
  damage: 95234240.82937717,
  setNames: ['幻影面紗', '日冕．灼耀花仙', '真理假面'],
  choices: {
    'Right.Ice.Necklace': '幽潮吞源',
    'Right.Ice.Support': '幻影面紗',
    'Right.Ice.WeaponAccessory': '日冕．灼耀花仙',
    'Right.Ice.Arm': '幽潮吞源',
    'Right.Ice.FaceBottom': '真理假面',
    'Right.Ice.Ring': '幻影面紗',
    'Right.Ice.Earring': '真理假面',
    'Right.Ice.FaceMiddle': '紫霄花郎',
    'Right.Ice.Bottom': '真理假面',
    'Right.Ice.FaceTop': '幻影面紗',
    'Right.Ice.Top': '日冕．灼耀花仙',
    'Ice.Weapon.Set': '日冕．灼耀花仙',
  },
};
