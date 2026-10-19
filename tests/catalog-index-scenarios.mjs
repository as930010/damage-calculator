import { gameData, sample, normalize } from './loadout-evaluation-harness.mjs';

export const complete = { ...sample, masterBeastSpiritStoneColor: '黃', petSkillAttackEnabled: true, transcendenceSkillDamageSharePct: 100 };
export const incomplete = { ...complete, Job: 'KE', values: { 'Weapon.ENHC': '', 'Effect.Environment': '小屋' } };
export const legacyStartup = structuredClone(complete);
Object.assign(legacyStartup.values, {
  'Effect.Environment': '小屋', 'MasterBeast.Head.CustomAttribute': '其他',
  'Left.Armor.Gloves.Circuit.Attribute': '超越技傷%', 'Effect.PortraitAwakening': '有',
  'Weapon.Transform.2.Stat': legacyStartup.values['Weapon.Transform.1.Stat'],
});
delete legacyStartup.values['Effect.PortraitAwakening.StrongSkillDamagePct'];
delete legacyStartup.values['Effect.PortraitAwakening.TranscendenceSkillDamagePct'];

export function choiceContexts() {
  const contexts = [{ id: 'complete', values: complete.values }];
  for (const chip of [gameData.chips.chips[0], gameData.chips.chips.at(-1)]) {
    contexts.push({ id: 'chip:' + chip.name, values: { [gameData.chipSlots.slots[0].attributeField]: chip.name },
      fields: [gameData.chipSlots.slots[0].tuningField] });
  }
  const transform = gameData.nephronArmor.fields[0].transformFields[0];
  for (const option of gameData.nephronArmor.transformations) contexts.push({
    id: 'nephron:' + option.name, values: { [transform.attributeField]: option.name }, fields: [transform.valueField],
  });
  contexts.push({ id: 'no-dynamic-parent', values: {}, fields: [transform.valueField, gameData.chipSlots.slots[0].tuningField] });
  return contexts;
}

export function importCases(exported) {
  const cases = [{ id: 'complete', raw: JSON.parse(exported) }];
  for (const [id, changes] of [['invalid-class', { Job: 'unknown' }], ['lowercase-class', { Job: 'ke' }],
    ['missing-toggles', { lowerwearAlternativeEnabled: undefined, masterBeastSpiritStoneColor: undefined, petSkillAttackEnabled: undefined }]]) {
    cases.push({ id, raw: { ...JSON.parse(exported), ...changes } });
  }
  for (const [id, changes] of [['legacy-venue', { '7': '小屋', '53': '其他', '146': '超越技傷%' }],
    ['invalid-fields', { BAD: {}, '999999': 'stale', '4': 'removed-option', '1': 'bad' }],
    ['legacy-portrait', { '295': 2, '296': 4 }]]) {
    const raw = JSON.parse(exported); Object.assign(raw.values, changes); cases.push({ id, raw });
  }
  const semanticStage = JSON.parse(exported);
  for (const key of ['1', '2', '3']) delete semanticStage.values[key];
  cases.push({ id: 'semantic-stage', raw: semanticStage });
  cases.push({ id: 'old-v2-rejected', raw: { format: 'damage-calculator-loadout', formatVersion: 2, values: {} } });
  cases.push({ id: 'missing-values-rejected', raw: { format: 'damage-calculator-loadout', formatVersion: 3, Job: 'KE' } });
  return cases;
}

export function monitorCatalogData(data) {
  const counts = {}, memo = new WeakMap();
  const wrap = (value, path = '') => {
    if (!value || typeof value !== 'object') return value;
    if (memo.has(value)) return memo.get(value);
    const proxy = new Proxy(value, { get(target, key, receiver) {
      if (Array.isArray(target) && typeof key === 'string' && /^\d+$/.test(key)) {
        counts.elementReads = (counts.elementReads ?? 0) + 1;
      }
      if (Array.isArray(target) && ['map', 'filter', 'find', 'some', 'includes'].includes(key)) {
        return (...args) => {
          const name = path + '.' + key; counts[name] = (counts[name] ?? 0) + 1;
          if (typeof args[0] === 'function') {
            const callback = args[0]; args[0] = (...values) => {
              counts.visited = (counts.visited ?? 0) + 1; return callback(...values);
            };
          }
          return Array.prototype[key].apply(receiver, args);
        };
      }
      return wrap(Reflect.get(target, key, receiver), path ? path + '.' + String(key) : String(key));
    } });
    memo.set(value, proxy); return proxy;
  };
  return { data: wrap(data), counts, reset() { for (const key of Object.keys(counts)) delete counts[key]; } };
}

export function candidateTransform(file, source) {
  if (file === 'frontend/catalog-index.ts') source = source.replace('Object.freeze(factory())', "Object.freeze((__count('staticChoiceArrays'), factory()))");
  if (file === 'frontend/picker.ts') source = source.replace(/(function createPicker\([\s\S]*?\)\s*\{)/, '$1\n__captureChoices(label, options);');
  return source;
}

export function captureCall(callback) {
  try { return normalize({ value: callback() }); } catch (error) { return normalize({ error }); }
}
