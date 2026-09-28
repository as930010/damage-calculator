import { aggregateCharacterAttributes, prepareCharacterAttributeInput } from "../calculation/attribute-aggregation.ts";
import { resolveSimulatorEquipmentContributions } from "../calculation/equipment-catalog.ts";
import { resolveInnerwearSources } from "../calculation/innerwear.ts";
import { resolveWeaponTransformationsFromCells } from "../calculation/weapon-transformations.ts";
import { resolveAccessoryEffectOptions, resolveArmorAppraisals, resolveAtmaSetEffects, resolveChipContribution, resolveCircuitBoardEffects, resolveColorSetEffect, resolveMasterBeastEffects, resolveNamedStatOption, resolveRaidSetEffects, resolveResonanceEffects, resolveRightIceSetEffects, resolveSpiritRecordEffects, resolveSpiritRecordSelections, resolveWeaponGrowth } from "../calculation/equipment-effects.ts";
import { calculateWeaponBaseAttack, resolveAttackParameters } from "../calculation/attack.ts";
import type { AttributeRule, StatContribution } from "../calculation/types.ts";
import { calculateLoadout } from "../calculation/loadout-engine.ts";
import { localCell, type GameData } from "./data.ts";
import type { LoadoutState } from "./state.ts";

/** UI state to supported stat sources; game arithmetic remains in calculation/. */
export function projectAttributes(data: GameData, state: LoadoutState) {
  const values = state.values;
  const text = (key: string) => String(values[localCell(key)] ?? "");
  const number = (key: string) => values[localCell(key)] === undefined || values[localCell(key)] === "" ? undefined : Number(values[localCell(key)]);
  const equipment = resolveSimulatorEquipmentContributions(data.mapping, data.catalogs, {
    selectedItems: Object.fromEntries(Object.entries(values).map(([cell, value]) => [cell, String(value)])),
    enabledValues: { F20: state.lowerwearAlternativeEnabled },
  });
  const inner = resolveInnerwearSources(data.innerwear, data.attack, state.classId, values, state.lowerwearAlternativeEnabled);
  const configuredEffects: StatContribution[] = [
    ...data.parameters.optionalEffects
      .filter(effect => state[effect.stateKey] ?? effect.defaultEnabled)
      .map(({ sourceId, stats }) => ({ sourceId, stats })),
    ...data.parameters.conditionalEffects
      .filter(effect => text(localCell(effect.selectorCell)) === effect.selectorValue)
      .map(({ sourceId, stats }) => ({ sourceId, stats })),
  ];
  const groups: Record<"shared" | "lowerwearA" | "lowerwearB", StatContribution[]> = {
    shared: [{ sourceId: "character-base", stats: data.parameters.characterBase }, ...data.parameters.fixedEffects, ...configuredEffects, ...equipment.shared, ...inner.shared],
    lowerwearA: [...equipment.lowerwearA, ...inner.lowerwearA], lowerwearB: [...equipment.lowerwearB, ...inner.lowerwearB],
  };
  for (const entry of resolveArmorAppraisals(data.appraisals, {
    optionsBySlot: Object.fromEntries(data.appraisals.slots.map((slot) => [slot.id, slot.inputCells.map(text)])),
    enabledInputs: { "裝備模擬區!F20": state.lowerwearAlternativeEnabled },
  })) groups[entry.wearSet].push(...entry.contributions);
  for (const slot of data.chipSlots.slots) {
    if (slot.enabledBy && !state.lowerwearAlternativeEnabled) continue;
    const chipName = text(slot.attributeCell), tuning = text(slot.tuningCell);
    if (!chipName && !tuning) continue;
    const chip = data.chips.chips.find((entry) => entry.name === chipName);
    if (!chip || !tuning) throw new RangeError("請填完整系統芯片與芯片調校等級。");
    groups[slot.wearSet].push(resolveChipContribution(data.chips, chip.id, tuning, `chip:${slot.id}`));
  }
  const circuits = Object.fromEntries(data.circuits.inputs.filter(slot => state.lowerwearAlternativeEnabled || slot.wearSet !== "lowerwearB").map((slot) => {
    const attribute = text(slot.attributeCell), percentageValue = number(slot.valueCell);
    if ((attribute && percentageValue === undefined) || (!attribute && percentageValue !== undefined)) {
      throw new RangeError("請填完整電路板項目與數值。");
    }
    if (attribute && percentageValue !== undefined && !data.circuits.statKeyBySheetName[attribute] && attribute !== "無關傷害") {
      throw new RangeError(`電路板「${attribute}」尚未有屬性對應，請使用已定義的屬性名稱。`);
    }
    return [slot.slot, { attribute, percentageValue }];
  }));
  for (const entry of resolveCircuitBoardEffects(data.circuits, circuits)) if (entry.contribution) groups[entry.wearSet].push(entry.contribution);
  const colorSet = resolveColorSetEffect(data.colorSetEffects, text(data.colorSetEffects.selectorCell), text("J31"), number("J32") ?? 0);
  if (colorSet) groups.shared.push(colorSet);
  groups.shared.push(...resolveWeaponTransformationsFromCells(data.transformations, values));
  const growth = resolveWeaponGrowth(data.growth, text(data.growth.selectorCell));
  if (growth) groups.shared.push(growth);
  for (const group of Object.values(data.weaponAppraisals.groups)) {
    const source = resolveNamedStatOption(group.options, text(group.selectorCell), `weapon-appraisal:${localCell(group.selectorCell)}`);
    if (source) groups.shared.push(source);
  }
  for (const cell of data.giantStones.selectorCells) {
    const source = resolveNamedStatOption(data.giantStones.options, text(cell), `giant-stone:${localCell(cell)}`);
    if (source) groups.shared.push(source);
  }
  const weaponGrade = resolveNamedStatOption(data.weaponGrades.options, text(data.weaponGrades.selectorCell), "weapon-grade:B37");
  if (weaponGrade) groups.shared.push(weaponGrade);
  const accessoryAppraisalSelections: Record<string, string> = {};
  for (const group of data.accessoryEffects.groups) {
    const mapping = data.mapping.selections.find(entry => entry.selectionCell === group.selectionCell);
    const itemName = text(group.selectionCell);
    if (!mapping || !itemName) continue;
    const item = data.catalogs[mapping.catalogFile]?.items.find(entry => entry.slotId === group.slotId && entry.name === itemName);
    const appraisal = item?.appraisal;
    if (!appraisal || appraisal.canAppraise === null || appraisal.effectCount === null) continue;
    if (appraisal.canAppraise) {
      if (!Number.isInteger(appraisal.effectCount) || appraisal.effectCount < 1 || appraisal.effectCount > group.inputCells.length) {
        throw new RangeError(`${itemName} 的鑑定條數必須介於 1 與 ${group.inputCells.length} 之間。`);
      }
      for (const cell of group.inputCells.slice(0, appraisal.effectCount)) accessoryAppraisalSelections[cell] = text(cell);
    } else if (appraisal.effectCount !== 0) {
      throw new RangeError(`${itemName} 不可鑑定時，鑑定條數必須設為 0。`);
    }
  }
  groups.shared.push(...resolveAccessoryEffectOptions(data.accessoryEffects, accessoryAppraisalSelections));
  const accessoryCells = data.mapping.selections.map(entry => entry.selectionCell).filter(cell => /^[M-O][2-7]$/.test(cell));
  const rightIceCells = data.mapping.selections.filter(entry => entry.catalogFile.endsWith("right-ice.json")).map(entry => entry.selectionCell);
  groups.shared.push(
    ...resolveRightIceSetEffects(data.rightIceSets, rightIceCells.map(text), data.rightIceSets.selectionCells.map(text)),
    ...resolveResonanceEffects(data.resonance, Object.fromEntries(data.resonance.effects.map(effect => [effect.inputCell, number(effect.inputCell) ?? 0]))),
    ...resolveRaidSetEffects(data.raidSets, accessoryCells.map(text)),
  );
  const atmaPieces = accessoryCells.map(text).filter(name => name.includes("亞特瑪")).length;
  groups.shared.push(...resolveAtmaSetEffects(data.atma, atmaPieces, text("L9"), text("N9")));
  groups.shared.push(...resolveMasterBeastEffects(data.masterBeast, {
    overallOption: text("S25"), headOptions: [text("N27"), text("N28")],
    ringOptions: ["N36", "N37", "N39", "N40"].map(text),
    headManual: { attribute: text("M27"), value: number("M28") },
    necklaceManual: { attribute: text("M33"), value: number("M34") },
    ringManual: [
      { attribute: text("M36"), value: number("M37") },
      { attribute: text("M39"), value: number("M40") },
    ],
    mirrorManual: Array.from({ length: 15 }, (_, index) => {
      const row = index + 27;
      return { attribute: text(`O${row}`), value: number(`P${row}`), fractionToPercentagePoints: true };
    }),
  }));
  const selectedSpiritClasses = data.spiritRecord.classSelectors.selectorCells.map(text);
  const selectedSpiritRecords = resolveSpiritRecordSelections(data.spiritRecord, selectedSpiritClasses);
  groups.shared.push(...resolveSpiritRecordEffects(data.spiritRecord, state.classId, data.classes.classes.find(entry => entry.id === state.classId)!.attackType, selectedSpiritRecords));
  const addNamedOption = (catalog: readonly import("../calculation/equipment-effects.ts").NamedStatOption[], cell: string, source: string) => {
    const contribution = resolveNamedStatOption(catalog, text(cell), `${source}:${cell}`);
    if (contribution) groups.shared.push(contribution);
  };
  addNamedOption(data.otherEffects.titles, "B2", "title");
  addNamedOption(data.otherEffects.consumables, "B4", "consumable");
  addNamedOption(data.otherEffects.environments, "B5", "environment");
  addNamedOption(data.otherEffects.peakOptions, "S2", "peak-option");
  addNamedOption(data.pets.options, "S23", "pet");
  for (const effect of data.otherEffects.binaryEffects) addNamedOption(effect.options, localCell(effect.selectorCell), effect.name);
  for (const stage of data.otherEffects.guildFountain) addNamedOption(stage.options, localCell(stage.selectorCell), `guild-fountain-${stage.stage}`);
  if (!state.lowerwearAlternativeEnabled) groups.lowerwearB = [];
  const rules: AttributeRule[] = data.attributes.attributes.filter((entry) => entry.active && entry.aggregation === "sum")
    .map((entry) => ({ key: entry.key, aggregation: "sum", cap: entry.cap }));
  const aggregate = () => aggregateCharacterAttributes(prepareCharacterAttributeInput(rules, {
    ...groups, lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
  }).attributeInput);
  const first = aggregate();
  if (text("B32")) {
    const params = resolveAttackParameters(data.attack, state.classId, Number(text("B32").match(/\d+/)?.[0]));
    const stats = calculateWeaponBaseAttack({ ...params, attackLevel: first.stats.attackLevel?.finalTotal ?? 0 });
    groups.shared.push({ sourceId: "weapon-base-attack:C53:D53", stats });
  }
  const result = aggregate();
  const calculationSources = {
    shared: groups.shared.filter(source => source.sourceId !== "character-base" && source.sourceId !== "weapon-base-attack:C53:D53"),
    lowerwearA: groups.lowerwearA, lowerwearB: groups.lowerwearB,
    lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
  };
  return { ...result, calculationSources };
}

/** Full formula path through B157:B163 using the selected spreadsheet-mapped values. */
export function projectDamage(data: GameData, state: LoadoutState) {
  const attributes = projectAttributes(data, state);
  const job = data.classes.classes.find(entry => entry.id === state.classId);
  if (!job) throw new RangeError(`找不到職業設定：${state.classId}`);
  const weaponText = String(state.values.B32 ?? "");
  const weaponLevel = Number(weaponText.match(/[0-9]+/)?.[0]);
  if (!Number.isSafeInteger(weaponLevel)) throw new RangeError("請先選擇武器強化等級。");
  const percentage = (cell: string) => {
    const value = state.values[cell];
    if (value == null || value === "") return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new RangeError(`${cell} 必須是數值。`);
    return parsed;
  };
  const combatRateSourceValues = {
    parameters: { yellowBeastSpiritStoneRatePct: data.parameters.yellowBeastSpiritStoneRatePct },
    selections: {
      H12: state.values.H12, H39: state.values.H39,
      masterBeastSpiritStoneColor: state.masterBeastSpiritStoneColor ?? data.masterBeast.spiritStoneColorSelector.defaultColor,
    },
  };
  const result = calculateLoadout({
    classId: job.id, attackType: job.attackType,
    attributeRules: data.attributes.attributes.filter(entry => entry.active && entry.aggregation === "sum")
      .map(entry => ({ key: entry.key, aggregation: "sum" as const, cap: entry.cap })),
    characterBaseStats: data.parameters.characterBase,
    sources: attributes.calculationSources,
    attackParameters: data.attack,
    weaponEnhancementLevel: weaponLevel,
    classCombatEffects: data.classCombatEffects,
    classDamagePassives: data.classDamagePassives,
    combatRateSourceRules: data.combatRateSources,
    combatRateSourceValues,
    targetCritPenaltyPct: percentage("D2"),
    stageAdaptabilityPenaltyPct: percentage("D1"),
    enemyDefensePct: percentage("D3"),
    critDamageProductBasePct: data.parameters.critDamageProductBasePct,
    critDamageProductBaselinePctToSubtract: data.parameters.critDamageProductBaselinePctToSubtract,
  });
  return { attributes: result.attributes, result };
}
