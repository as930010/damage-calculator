import { getEquipmentOptionName, type EquipmentCatalogItem, type SimulatorEquipmentSelectionMapping } from '../calculation/equipment-catalog.ts';
import type { GameData } from './data.ts';
import { createValidationCatalogIndex } from './input-validation.ts';
import { createClassCodeResolver } from './class-code.ts';

export type CatalogData = Pick<GameData,
  | 'classes' | 'mapping' | 'catalogs' | 'simulatorInputs' | 'masterBeast'
  | 'layout' | 'attack' | 'innerwear' | 'appraisals' | 'chips' | 'chipSlots' | 'circuits'
  | 'transformations' | 'growth' | 'weaponAppraisals' | 'weaponGrades' | 'giantStones' | 'nephronArmor'
  | 'colorSetEffects' | 'spiritRecord' | 'otherEffects' | 'pets' | 'rightIceSets'>;
type Choices = readonly (string | number)[];
type Values = Readonly<Record<string, unknown>>;
const emptyChoices: Choices = Object.freeze([]);
const emptyItems: readonly EquipmentCatalogItem[] = Object.freeze([]);

/** Stable compact-v3 code; keep the original hash and byte order. */
export function equipmentTransferCode(itemId: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(itemId)) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}

function memoizeChoices(factory: () => Choices): () => Choices {
  let choices: Choices | undefined;
  return () => choices ??= Object.freeze(factory());
}

function firstBy<T>(items: readonly T[], key: (item: T) => string) {
  const result = new Map<string, T>();
  for (const item of items) if (!result.has(key(item))) result.set(key(item), item);
  return result;
}

/** Owned by one immutable data-load revision; candidates are materialized only on demand. */
export function createCatalogIndex(data: CatalogData, revision: unknown = Symbol('catalog-data')) {
  const classById = firstBy(data.classes.classes, entry => entry.id);
  const activeClasses = Object.freeze(data.classes.classes.filter(entry => entry.active));
  const activeIds = new Set(activeClasses.map(entry => entry.id));
  const resolveActiveClassCode = createClassCodeResolver(activeClasses.map(entry => entry.id));
  const spiritClassCodes = Object.freeze(data.spiritRecord.classSelectors.classes.map(entry => entry.classCode));
  const resolveSpiritClassCode = createClassCodeResolver(spiritClassCodes);
  const validationCatalog = createValidationCatalogIndex(data.simulatorInputs.inputs, data.simulatorInputs.catalogs);
  const innerwearById = firstBy(data.innerwear.slots, entry => entry.id);
  const gloveCircuit = data.circuits.inputs.find(entry => entry.slot === 'gloves');
  const rightIceEffectById = firstBy(data.rightIceSets.effects, entry => entry.id);
  const mappings = new Map<string, SimulatorEquipmentSelectionMapping>();
  for (const mapping of data.mapping.selections) mappings.set(mapping.selectionCell, mapping);
  for (const mapping of data.mapping.magicStoneSelections.inputGroups) mappings.set(mapping.selectionCell, {
    ...mapping, catalogFile: data.mapping.magicStoneSelections.catalogFile, slotId: data.mapping.magicStoneSelections.slotId,
  });

  const resolvers = new Map<string, (values: Values) => Choices>();
  const register = (fields: readonly string[], resolve: (values: Values) => Choices) => {
    for (const field of fields) if (!resolvers.has(field)) resolvers.set(field, resolve);
  };
  const names = (options: readonly { name: string }[]) => memoizeChoices(() => options.map(entry => entry.name));
  register(['Effect.Title'], names(data.otherEffects.titles));
  register(['Effect.Consumable'], names(data.otherEffects.consumables));
  register(['Effect.Environment'], names(data.otherEffects.environments));
  register(['Peak.Option'], names(data.otherEffects.peakOptions));
  register(['Pet.Passive'], names(data.pets.options));
  register(['Atma.Element'], memoizeChoices(() => ['火焰', '流水', '草木']));
  register(['Atma.Color'], memoizeChoices(() => ['藍色', '綠色', '紫色', '米色']));
  register(['MasterBeast.OverallPotential'], memoizeChoices(() => data.masterBeast.options.filter(entry => entry.category === 'overall').map(entry => entry.name)));
  for (const entry of data.otherEffects.binaryEffects) register([entry.settingKey], names(entry.options));
  for (const entry of data.otherEffects.guildFountain) register([entry.settingKey], names(entry.options));
  if (data.colorSetEffects.settingKey) register([data.colorSetEffects.settingKey], names(data.colorSetEffects.options));
  register(data.spiritRecord.classSelectors.settingKeys, () => spiritClassCodes);
  const armorTypes = memoizeChoices(() => ['百億', '內布隆']);
  for (const slot of data.innerwear.slots) register([slot.typeCell], armorTypes);
  const transformNames = names(data.nephronArmor.transformations);
  const transformTiers = firstBy(data.nephronArmor.transformations, entry => entry.name);
  const tiersByName = new Map([...transformTiers].map(([name, entry]) => [name, memoizeChoices(() => entry.tierValuesPct.map(value => value / 100))]));
  const magazines = names(data.nephronArmor.magazines);
  const magazineLevels = memoizeChoices(() => [...data.nephronArmor.levelLabels]);
  for (const field of data.nephronArmor.fields) {
    for (const transform of field.transformFields) {
      register([transform.attributeCell], transformNames);
      register([transform.valueCell], values => tiersByName.get(values[transform.attributeCell] as string)?.() ?? emptyChoices);
    }
    register([field.magazineCell], magazines); register([field.magazineLevelCell], magazineLevels);
  }
  const armorEnhancements = memoizeChoices(() => Object.keys(data.innerwear.enhancementStats).map(level => `Lv.${level}`));
  const forging = memoizeChoices(() => Object.keys(data.innerwear.forgingAttack));
  for (const slot of data.layout.slots) if (slot.innerwearId) {
    const innerwear = innerwearById.get(slot.innerwearId);
    if (innerwear) { register([innerwear.enhancementCell], armorEnhancements); register([innerwear.forgingCell], forging); }
  }
  register([data.weaponGrades.settingKey], names(data.weaponGrades.options));
  for (const group of data.weaponGrades.colorGroups) register(group.settingKeys, names(group.options));
  register(['Weapon.ENHC'], memoizeChoices(() => Object.keys(data.attack.weaponEnhancementFactors).map(level => `Lv.${level}`)));
  register([data.growth.settingKey], names(data.growth.levels));
  const appraisals = names(data.appraisals.options);
  for (const slot of data.appraisals.slots) register(slot.inputCells, appraisals);
  const circuits = memoizeChoices(() => [...Object.keys(data.circuits.statKeyByAttributeName), '無關傷害']);
  for (const input of data.circuits.inputs) register([input.attributeCell], circuits);
  const chipNames = names(data.chips.chips);
  const chipTunings = new Map([...firstBy(data.chips.chips, entry => entry.name)].map(([name, entry]) =>
    [name, memoizeChoices(() => entry.tuningLevels.map(level => level.level))]));
  for (const slot of data.chipSlots.slots) {
    register([slot.attributeCell], chipNames);
    register([slot.tuningCell], values => chipTunings.get(values[slot.attributeCell] as string)?.() ?? emptyChoices);
  }
  for (const group of Object.values(data.weaponAppraisals.groups)) register([group.settingKey], names(group.options));
  register(data.giantStones.settingKeys, names(data.giantStones.options));
  const transformations = memoizeChoices(() => [...data.transformations.options]);
  for (const slot of data.transformations.slots) register([slot.choiceCell], transformations);
  register(data.rightIceSets.selectionCells, memoizeChoices(() => [...new Set(data.rightIceSets.effects.map(entry => entry.setName))]));
  const attributes = data.masterBeast.customAttributeOptions;
  register(['MasterBeast.Head.CustomAttribute'], memoizeChoices(() => [...attributes.head]));
  register(['MasterBeast.Necklace.CustomAttribute'], memoizeChoices(() => [...attributes.necklace]));
  register(['MasterBeast.Ring1.CustomAttribute', 'MasterBeast.Ring2.CustomAttribute'], memoizeChoices(() => [...attributes.ring]));
  const mirror = memoizeChoices(() => [...attributes.mirror]);
  const validationChoices = new Map<string, () => Choices>();
  for (const catalog of data.simulatorInputs.catalogs) if (!validationChoices.has(catalog.id)) {
    validationChoices.set(catalog.id, memoizeChoices(() => catalog.options.map(entry => entry.value)));
  }

  const catalogItems = new Map<string, readonly EquipmentCatalogItem[]>();
  function activeCatalogItems(file: string) {
    if (!Object.hasOwn(data.catalogs, file)) return emptyItems;
    let items = catalogItems.get(file);
    if (!items) { items = Object.freeze(data.catalogs[file]?.items.filter(item => item.active) ?? []); catalogItems.set(file, items); }
    return items;
  }
  const codes = new Map<string, number>();
  const codeForItem = (id: string) => { let code = codes.get(id); if (code === undefined) { code = equipmentTransferCode(id); codes.set(id, code); } return code; };
  const groups = new Map<string, { items: readonly EquipmentCatalogItem[];
    byName?: ReadonlyMap<string, readonly EquipmentCatalogItem[]>; byCode?: ReadonlyMap<number, readonly EquipmentCatalogItem[]> }>();
  function equipmentGroup(mapping: SimulatorEquipmentSelectionMapping) {
    const key = JSON.stringify([mapping.catalogFile, mapping.slotId, mapping.application]);
    let group = groups.get(key);
    if (!group) {
      const items = Object.freeze(activeCatalogItems(mapping.catalogFile).filter(item => item.slotId === mapping.slotId));
      group = { items }; groups.set(key, group);
    }
    return group;
  }
  function matchEquipment(mapping: SimulatorEquipmentSelectionMapping, name: string) {
    const group = equipmentGroup(mapping);
    if (!group.byName) {
      const byName = new Map<string, EquipmentCatalogItem[]>();
      for (const item of group.items) try {
        const label = getEquipmentOptionName(item, mapping.application);
        const matches = byName.get(label) ?? []; matches.push(item); byName.set(label, matches);
      } catch { /* Transfer historically ignores unavailable application labels. */ }
      for (const matches of byName.values()) Object.freeze(matches);
      group.byName = byName;
    }
    return group.byName.get(name) ?? emptyItems;
  }
  function resolveEquipmentCode(mapping: SimulatorEquipmentSelectionMapping, code: unknown) {
    if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 0xffffffff) return null;
    const group = equipmentGroup(mapping);
    if (!group.byCode) {
      const byCode = new Map<number, EquipmentCatalogItem[]>();
      for (const item of group.items) {
        const itemCode = codeForItem(item.id), matches = byCode.get(itemCode) ?? [];
        matches.push(item); byCode.set(itemCode, matches);
      }
      for (const matches of byCode.values()) Object.freeze(matches);
      group.byCode = byCode;
    }
    const matches = group.byCode.get(code);
    return matches?.length === 1 ? matches[0] : null;
  }
  function resolveFieldChoices(fieldId: string, values: Values): Choices | null {
    const custom = resolvers.get(fieldId);
    if (custom) return custom(values);
    if (/^MasterBeast\..+\.Mirror\.\d+\.Attribute$/.test(fieldId)) return mirror();
    const catalog = validationCatalog(fieldId);
    return catalog ? validationChoices.get(catalog.id)!() : null;
  }
  return Object.freeze({
    data, revision, activeClasses, spiritClassCodes, resolveActiveClassCode, resolveSpiritClassCode,
    classById: (id: string) => classById.get(id), isActiveClass: (id: string) => activeIds.has(id),
    innerwearById: (id: string) => innerwearById.get(id), gloveCircuit, validationCatalog,
    rightIceEffectById: (id: string) => rightIceEffectById.get(id),
    equipmentMappings: mappings as ReadonlyMap<string, SimulatorEquipmentSelectionMapping>, activeCatalogItems,
    equipmentItems: (mapping: SimulatorEquipmentSelectionMapping) => equipmentGroup(mapping).items,
    equipmentCode: codeForItem,
    matchEquipment, resolveEquipmentCode,
    resolveFieldChoices,
  });
}
export type CatalogIndex = ReturnType<typeof createCatalogIndex>;

/** One retained revision; mutable callers must advance the token after any data change. */
export function createCatalogIndexScope() {
  let last: CatalogIndex | undefined;
  return { get(data: CatalogData, revision: unknown) {
    if (!last || last.data !== data || last.revision !== revision) last = createCatalogIndex(data, revision);
    return last;
  } };
}
