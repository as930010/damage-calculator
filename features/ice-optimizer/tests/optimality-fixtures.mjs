import { iceScenario } from './scenarios.mjs';

/** Gate for practical quality comparisons; synthetic reduced-slot mechanism tests stay separate. */
export function assertCompleteIceStudy(data, state) {
  const right = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  if (right.length !== 12 || new Set(right.map(entry => entry.slotId)).size !== 12
    || !right.some(entry => entry.selectionField === 'Ice.Weapon.Set' && entry.slotId === 'weapon')) {
    throw new RangeError('Practical comparison requires all 12 distinct right-ice slots, including the weapon.');
  }
  for (const entry of right) {
    const choice = state.values[entry.selectionField];
    if (!data.catalogs[entry.catalogFile].items.some(item => item.active && item.slotId === entry.slotId
      && item.name === choice)) {
      throw new RangeError(`Practical comparison requires real equipped gear for ${entry.selectionField}.`);
    }
  }
  for (const field of ['Stage.Adapt', 'Stage.BossDEF', 'Stage.CritRatePenalty']) {
    const input = data.simulatorInputs.inputs.find(entry => entry.fieldIds.includes(field));
    const catalog = data.simulatorInputs.catalogs.find(entry => entry.id === input?.catalogId);
    const value = state.values[field];
    if (value === '' || value === null || value === undefined
      || !catalog?.options.some(option => option.value === Number(value))) {
      throw new RangeError(`Practical comparison requires a selectable stage value for ${field}.`);
    }
  }
}

/** Reduced-slot structural fixture only; never use it to infer full-build search quality. */
export function optimalityFixture(data, example, { index = 0, slots = 8, series = ['幻影面紗', '真理假面', '紫霄花郎'], fixed = false } = {}) {
  const copy = structuredClone(data), state = iceScenario(data, example, index);
  const right = copy.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const selected = right.filter(entry => copy.catalogs[entry.catalogFile].items.some(item => item.active
    && item.slotId === entry.slotId && series.includes(item.name))).slice(0, slots);
  const fields = new Set(selected.map(entry => entry.selectionField));
  copy.mapping.selections = copy.mapping.selections.filter(entry => entry.catalogFile !== 'equipment/right-ice.json' || fields.has(entry.selectionField));
  copy.catalogs['equipment/right-ice.json'].items = copy.catalogs['equipment/right-ice.json'].items.filter(item => series.includes(item.name)
    && selected.some(entry => entry.slotId === item.slotId));
  copy.rightIceSets.effects = copy.rightIceSets.effects.filter(effect => series.includes(effect.setName));
  for (const entry of right) state.values[entry.selectionField] = '';
  for (const field of copy.rightIceSets.selectionFields) state.values[field] = '';
  const constraints = {};
  if (fixed && selected.length) {
    const item = copy.catalogs['equipment/right-ice.json'].items.find(item => item.active && item.slotId === selected[0].slotId);
    constraints.requiredItemIds = { [selected[0].selectionField]: item.id };
  }
  return { data: copy, state, constraints };
}

/** Complete 12-slot real-item catalog with two legal choices per slot for exact quality comparisons. */
export function completeIceFixture(data, example, index = 0) {
  const copy = structuredClone(data), state = iceScenario(data, example, index);
  const right = copy.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  if (right.length !== 12 || !right.some(entry => entry.selectionField === 'Ice.Weapon.Set')) {
    throw new RangeError('Exact comparison requires all 12 right-ice slots, including the weapon.');
  }
  const original = copy.catalogs['equipment/right-ice.json'].items;
  const selectedIds = new Set();
  for (const entry of right) {
    const choices = original.filter(item => item.active && item.slotId === entry.slotId
      && !['神埃', '騎士團'].includes(item.name)).slice(0, 2);
    if (choices.length !== 2) throw new RangeError(`Exact comparison requires two real items for ${entry.selectionField}.`);
    choices.forEach(item => selectedIds.add(item.id));
    state.values[entry.selectionField] = choices[0].name;
  }
  copy.catalogs['equipment/right-ice.json'].items = original.filter(item => selectedIds.has(item.id));
  for (const field of copy.rightIceSets.selectionFields) state.values[field] = '';
  assertCompleteIceStudy(copy, state);
  return { data: copy, state, constraints: {} };
}

/** A strict one/two-slot local trap: a whole alternate set is stronger, but partial conversion loses the active bonus. */
export function synergyFixture(data, example, size) {
  const fixture = optimalityFixture(data, example, { slots: size });
  const copy = fixture.data;
  const selected = copy.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const names = ['研究套裝A', '研究套裝B'];
  copy.catalogs['equipment/right-ice.json'].items = selected.flatMap(entry => names.map((name, index) => ({
    id: `research:${size}:${entry.slotId}:${index}`, name, slotId: entry.slotId, active: true,
    stats: { physicalAttack: index, magicalAttack: index },
  })));
  copy.rightIceSets = { ...copy.rightIceSets, maxSelectedSets: 1, selectionFields: copy.rightIceSets.selectionFields.slice(0, 1),
    effects: names.map((setName, index) => ({ id: `research:set:${size}:${index}`, name: setName,
      setName, active: true, requiredPieces: { operator: index ? 'atLeast' : 'exactly', count: size },
      stats: { multiplicativeDamagePct: index ? 15 : 10 } })) };
  for (const entry of selected) fixture.state.values[entry.selectionField] = names[0];
  fixture.state.values[copy.rightIceSets.selectionFields[0]] = names[0];
  return fixture;
}

export function tieFixture(data, example, weaponCount = 5, accessoryCount = 3, unequal = false) {
  const copy = structuredClone(data), state = iceScenario(data, example, 0);
  const right = copy.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const selected = right.filter(entry => ['weapon', 'weaponAccessory'].includes(entry.slotId));
  copy.mapping.selections = copy.mapping.selections.filter(entry => entry.catalogFile !== 'equipment/right-ice.json' || selected.includes(entry));
  copy.catalogs['equipment/right-ice.json'].items = selected.flatMap(entry => Array.from({ length: entry.slotId === 'weapon' ? weaponCount : accessoryCount }, (_, index) => ({
    id: `research:tie:${entry.slotId}:${index}`, name: `研究${entry.slotId}${index}`, slotId: entry.slotId, active: true,
    stats: { physicalAttack: 20 + (unequal ? index : 0), magicalAttack: 20 + (unequal ? index : 0),
      bleedDamagePct: unequal ? index % 3 : 0, polarizationPct: unequal ? index % 2 : 0 },
  })));
  copy.rightIceSets.effects = [];
  for (const entry of right) state.values[entry.selectionField] = '';
  for (const field of copy.rightIceSets.selectionFields) state.values[field] = '';
  return { data: copy, state, constraints: {} };
}

export function exceptionFixture(data, example, series = '神埃') {
  const copy = structuredClone(data), state = iceScenario(data, example, 9);
  const right = copy.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  for (const field of copy.rightIceSets.selectionFields) state.values[field] = '';
  const specified = series === '騎士團' ? right.slice(0, 4) : right.filter(entry => entry.slotId === 'top');
  for (const entry of specified) state.values[entry.selectionField] = series;
  const variable = right.filter(entry => !specified.includes(entry)).slice(0, 3);
  const requiredItemIds = Object.fromEntries(specified.map(entry => [entry.selectionField,
    copy.catalogs[entry.catalogFile].items.find(item => item.active && item.slotId === entry.slotId && item.name === series).id]));
  return { data: copy, state, constraints: { fixedFields: right.filter(entry => !variable.includes(entry)).map(entry => entry.selectionField), requiredItemIds } };
}

/** Synthetic future catalogs change only a cloned research dataset, never the checked-in game data. */
export function growIceData(data, mode, scale) {
  const copy = structuredClone(data);
  if (scale === 1) return copy;
  const file = 'equipment/right-ice.json', original = copy.catalogs[file].items;
  const allowed = original.filter(item => item.active && !['神埃', '騎士團'].includes(item.name));
  const slots = copy.mapping.selections.filter(entry => entry.catalogFile === file).map(entry => entry.slotId);
  const target = Math.round(allowed.length * (scale - 1));
  const additions = [];
  const varied = (item, ordinal) => ({ ...structuredClone(item), stats: { ...item.stats,
    physicalAttack: (item.stats?.physicalAttack ?? 0) + ordinal % 7 + 1,
    magicalAttack: (item.stats?.magicalAttack ?? 0) + ordinal % 5 + 1,
    bleedDamagePct: (item.stats?.bleedDamagePct ?? 0) + (ordinal % 4 + 1) * 0.1,
  } });
  if (mode === 'existing-slots') {
    for (const name of new Set(allowed.map(item => item.name))) for (const slotId of slots) {
      if (allowed.some(item => item.name === name && item.slotId === slotId) || additions.length >= target) continue;
      additions.push({ ...varied(allowed.find(item => item.name === name), additions.length),
        id: `research:${mode}:${name}:${slotId}`, name, slotId });
    }
  } else if (mode === 'series') {
    const series = Math.max(1, Math.round(target / slots.length));
    for (let index = 0; index < series; index++) {
      const name = `研究新套裝${index}`;
      for (const slotId of slots) {
        const item = allowed.find(item => item.slotId === slotId);
        additions.push({ ...varied(item, additions.length), id: `research:${mode}:${index}:${slotId}`, name, slotId });
      }
      for (const count of [2, 3]) copy.rightIceSets.effects.push({ id: `research:effect:${index}:${count}`, name: `${name}:${count}`,
        setName: name, active: true, requiredPieces: { operator: count === 2 ? 'exactly' : 'atLeast', count },
        stats: { bossDamagePct: 1 + index * 0.13, allSkillDamagePct: count + index * 0.07, bleedDamagePct: count * 0.6 } });
    }
  } else {
    for (let index = 0; index < target; index++) {
      const slotId = mode === 'skewed' ? 'weapon' : slots[index % slots.length];
      const item = allowed.find(item => item.slotId === slotId);
      const stats = mode === 'interaction' ? {
        ...item.stats, physicalAttack: 20 + index % 9, magicalAttack: 20 + index % 11,
        polarizationPct: 1 + index % 3, bleedDamagePct: 1 + index % 5,
        bossDamagePct: index % 2 * 2, allSkillDamagePct: (index + 1) % 3,
      } : varied(item, index).stats;
      additions.push({ ...item, id: `research:${mode}:${index}`, name: `研究散件${mode}${index}`, slotId, stats });
    }
  }
  copy.catalogs[file].items.push(...additions);
  return copy;
}
