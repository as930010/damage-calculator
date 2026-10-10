import { aggregateCharacterAttributes, prepareCharacterAttributeInput } from "../calculation/attribute-aggregation.ts";
import { resolveSimulatorEquipmentContributions } from "../calculation/equipment-catalog.ts";
import { resolveInnerwearSources } from "../calculation/innerwear.ts";
import { resolveNephronArmorSources } from "../calculation/nephron-armor.ts";
import { resolveWeaponTransformationsFromCells } from "../calculation/weapon-transformations.ts";
import { resolveAccessoryEffectOptions, resolveArmorAppraisals, resolveAtmaSetEffects, resolveChipContribution, resolveCircuitBoardEffects, resolveColorSetEffect, resolveMasterBeastEffects, resolveNamedStatOption, resolveRaidSetEffects, resolveResonanceEffects, resolveRightIceSetEffects, resolveSpiritRecordEffects, resolveSpiritRecordSelections, resolveWeaponGrowth } from "../calculation/equipment-effects.ts";
import { calculateWeaponBaseAttack, resolveAttackParameters } from "../calculation/attack.ts";
import type { AttributeRule, StatContribution } from "../calculation/types.ts";
import { calculateLoadout, calculateLoadoutCombatRates } from "../calculation/loadout-engine.ts";
import { resolveClassDamagePassiveContributions } from "../calculation/class-damage-passives.ts";
import type { GameData } from "./data.ts";
import { DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT, normalizePortraitAwakeningSplit, type LoadoutState } from "./state.ts";
import { readGloveCircuitRows, validateGloveCircuitRows } from "./circuit-board-rows.ts";

/** UI state to supported stat sources; game arithmetic remains in calculation/. */
export function projectAttributes(data: GameData, state: LoadoutState) {
  const values = state.values;
  const characterBaseStats = { ...data.parameters.characterBase, ...data.parameters.characterBaseByClass?.[state.Job] };
  const text = (key: string) => String(values[key] ?? "");
  const number = (key: string) => values[key] === undefined || values[key] === "" ? undefined : Number(values[key]);
  const equipment = resolveSimulatorEquipmentContributions(data.mapping, data.catalogs, {
    selectedItems: Object.fromEntries(Object.entries(values).map(([fieldId, value]) => [fieldId, String(value)])),
    enabledValues: {
      "Lowerwear.Alternative.Enabled": state.lowerwearAlternativeEnabled,
      "Nephron.Innerwear.Upper": text("Innerwear.Upper.Type") === "內布隆",
      "Nephron.Innerwear.Lowerwear": text("Innerwear.Lowerwear.Type") === "內布隆",
      "Nephron.Innerwear.LowerwearAlternative": state.lowerwearAlternativeEnabled && text("Innerwear.LowerwearAlternative.Type") === "內布隆",
      "Nephron.Innerwear.Gloves": text("Innerwear.Gloves.Type") === "內布隆",
      "Nephron.Innerwear.Shoes": text("Innerwear.Shoes.Type") === "內布隆",
    },
  });
  const inner = resolveInnerwearSources(data.innerwear, data.attack, state.Job, values, state.lowerwearAlternativeEnabled);
  const configuredEffects: StatContribution[] = [
    ...data.parameters.optionalEffects
      .filter(effect => state[effect.stateKey] ?? effect.defaultEnabled)
      .map(({ sourceId, stats }) => ({ sourceId, stats })),
    ...data.parameters.conditionalEffects
      .filter(effect => text(effect.settingKey) === effect.selectorValue)
      .map(({ sourceId, stats }) => ({ sourceId, stats })),
  ];
  const groups: Record<"shared" | "lowerwearA" | "lowerwearB", StatContribution[]> = {
    shared: [
      { sourceId: "character-base", stats: characterBaseStats },
      ...resolveClassDamagePassiveContributions(data.classDamagePassives, state.Job),
      ...data.parameters.fixedEffects, ...configuredEffects, ...equipment.shared, ...inner.shared,
    ],
    lowerwearA: [...equipment.lowerwearA, ...inner.lowerwearA], lowerwearB: [...equipment.lowerwearB, ...inner.lowerwearB],
  };
  const nephronSelections = data.nephronArmor.fields.flatMap((field) => {
    if (field.enabledBy && !state.lowerwearAlternativeEnabled) return [];
    const slot = data.innerwear.slots.find((entry) => entry.id === field.slotId);
    if (!slot || text(slot.typeCell) !== "內布隆") return [];
    const active = [slot.enhancementCell, slot.forgingCell, field.magazineCell, field.magazineLevelCell,
      ...field.transformFields.flatMap(({ attributeCell, valueCell }) => [attributeCell, valueCell])]
      .some((cell) => values[cell] !== undefined && values[cell] !== "");
    if (!active) return [];
    return [{
      field,
      selection: {
        slotId: field.slotId,
        enhancement: values[slot.enhancementCell],
        transformations: field.transformFields.map(({ attributeCell, valueCell }) => ({
          attribute: text(attributeCell), value: number(valueCell),
        })),
        magazine: text(field.magazineCell),
        magazineLevel: values[field.magazineLevelCell],
      },
    }];
  });
  const nephronWearSetBySlot = new Map<string, "shared" | "lowerwearA" | "lowerwearB">(nephronSelections.map(({ field }) => [field.slotId, field.wearSet] as const));
  for (const contribution of resolveNephronArmorSources(data.nephronArmor, nephronSelections.map(({ selection }) => selection))) {
    const slotId = contribution.sourceId.split(":")[1];
    const wearSet = nephronWearSetBySlot.get(slotId);
    if (wearSet) groups[wearSet].push(contribution);
  }
  for (const entry of resolveArmorAppraisals(data.appraisals, {
    optionsBySlot: Object.fromEntries(data.appraisals.slots.map((slot) => [
      slot.id, text(`Innerwear.${slot.id === "lowerwearAlternative" ? "LowerwearAlternative" : slot.id === "lowerwear" ? "Lowerwear" : slot.id === "upper" ? "Upper" : slot.id === "gloves" ? "Gloves" : "Shoes"}.Type`) === "內布隆"
        ? [] : slot.inputCells.map(text),
    ])),
    enabledInputs: { "Lowerwear.Alternative.Enabled": state.lowerwearAlternativeEnabled },
  })) groups[entry.wearSet].push(...entry.contributions);
  for (const slot of data.chipSlots.slots) {
    if (slot.enabledBy && !state.lowerwearAlternativeEnabled) continue;
    const chipName = text(slot.attributeCell), tuning = text(slot.tuningCell);
    if (!chipName && !tuning) continue;
    const chip = data.chips.chips.find((entry) => entry.name === chipName);
    if (!chip || !tuning) throw new RangeError("請填完整系統芯片與芯片調校等級。");
    groups[slot.wearSet].push(resolveChipContribution(data.chips, chip.id, tuning, `chip:${slot.id}`));
  }
  if (state.lowerwearAlternativeEnabled) {
    const lowerwearChip = data.chipSlots.slots.find(slot => slot.id === "lowerwear")!;
    const alternativeChip = data.chipSlots.slots.find(slot => slot.id === "lowerwearAlternative")!;
    const lowerwearAttribute = text(lowerwearChip.attributeCell);
    const alternativeAttribute = text(alternativeChip.attributeCell);
    const conditionalAttributes = new Set(["強者%", "排熱%"]);
    if (lowerwearAttribute && lowerwearAttribute === alternativeAttribute && conditionalAttributes.has(lowerwearAttribute)
      && text(lowerwearChip.tuningCell) && text(alternativeChip.tuningCell)) {
      throw new RangeError("下衣與強/排褲不可同時使用「" + lowerwearAttribute + "」芯片。請讓兩套配置分別使用「強者%」與「排熱%」，以符合 Boss 體力切換條件。");
    }
  }
  const glovesCircuitRule = data.circuits.inputs.find(slot => slot.slot === "gloves")!;
  const glovesCircuitRows = readGloveCircuitRows(values, glovesCircuitRule.attributeCell, glovesCircuitRule.valueCell);
  validateGloveCircuitRows(glovesCircuitRows);
  for (const row of glovesCircuitRows) {
    if (row.attribute && row.percentageValue !== null && !data.circuits.statKeyByAttributeName[row.attribute] && row.attribute !== "無關傷害") {
      throw new RangeError("電路板「" + row.attribute + "」尚未有屬性對應，請使用已定義的屬性名稱。");
    }
  }
  const circuits = Object.fromEntries(data.circuits.inputs.filter(slot => state.lowerwearAlternativeEnabled || slot.wearSet !== "lowerwearB").map((slot) => {
    if (slot.slot === "gloves") return [slot.slot, glovesCircuitRows];
    const attribute = text(slot.attributeCell), percentageValue = number(slot.valueCell);
    if ((attribute && percentageValue === undefined) || (!attribute && percentageValue !== undefined)) {
      throw new RangeError("請填完整電路板項目與數值。");
    }
    if (attribute && percentageValue !== undefined && !data.circuits.statKeyByAttributeName[attribute] && attribute !== "無關傷害") {
      throw new RangeError("電路板「" + attribute + "」尚未有屬性對應，請使用已定義的屬性名稱。");
    }
    return [slot.slot, { attribute, percentageValue }];
  }));
  if (state.lowerwearAlternativeEnabled) {
    const lowerwearCircuit = data.circuits.inputs.find(slot => slot.slot === "lowerwear")!;
    const alternativeCircuit = data.circuits.inputs.find(slot => slot.slot === "lowerwearAlternative")!;
    const lowerwearAttribute = text(lowerwearCircuit.attributeCell);
    const alternativeAttribute = text(alternativeCircuit.attributeCell);
    const conditionalAttributes = new Set(["強者%", "排熱%"]);
    const lowerwearValue = number(lowerwearCircuit.valueCell);
    const alternativeValue = number(alternativeCircuit.valueCell);
    if (conditionalAttributes.has(lowerwearAttribute) && lowerwearAttribute === alternativeAttribute
      && lowerwearValue !== undefined && lowerwearValue > 0 && alternativeValue !== undefined && alternativeValue > 0) {
      throw new RangeError("下衣與強/排褲不可同時使用「" + lowerwearAttribute + "」。請讓兩套配置分別使用「強者%」與「排熱%」，以符合 Boss 體力切換條件。");
    }
  }
  for (const entry of resolveCircuitBoardEffects(data.circuits, circuits)) if (entry.contribution) groups[entry.wearSet].push(entry.contribution);
  const colorSetOption = data.colorSetEffects.options.find(option => option.name === text(data.colorSetEffects.settingKey));
  const requiredCircuitAttribute = colorSetOption?.calculatedStat?.requiredAttribute ?? "";
  const requiredCircuitValue = glovesCircuitRows
    .filter(row => row.attribute === requiredCircuitAttribute)
    .reduce((total, row) => total + (row.percentageValue ?? 0), 0);
  const colorSet = resolveColorSetEffect(data.colorSetEffects, text(data.colorSetEffects.settingKey), requiredCircuitAttribute, requiredCircuitValue);
  if (colorSet) groups.shared.push(colorSet);
  groups.shared.push(...resolveWeaponTransformationsFromCells(data.transformations, values));
  const growth = resolveWeaponGrowth(data.growth, text(data.growth.settingKey));
  if (growth) groups.shared.push(growth);
  for (const group of Object.values(data.weaponAppraisals.groups)) {
    const source = resolveNamedStatOption(group.options, text(group.settingKey), `weapon-appraisal:${group.settingKey}`);
    if (source) groups.shared.push(source);
  }
  for (const cell of data.giantStones.settingKeys) {
    const source = resolveNamedStatOption(data.giantStones.options, text(cell), `giant-stone:${cell}`);
    if (source) groups.shared.push(source);
  }
  for (const colorGroup of data.weaponGrades.colorGroups) {
    const presetId = colorGroup.presetByGrade[text(data.weaponGrades.settingKey)];
    const presetOption = colorGroup.options.find(option => option.id === presetId);
    const hasSavedSlotSelection = colorGroup.settingKeys.some(cell => values[cell] !== undefined);
    for (const [index, cell] of colorGroup.settingKeys.entries()) {
      const selection = hasSavedSlotSelection ? text(cell) : presetOption?.name ?? "";
      const source = resolveNamedStatOption(colorGroup.options, selection, `weapon-magic-stone:${colorGroup.id}:${index + 1}`);
      if (source) groups.shared.push(source);
    }
  }
  const accessoryAppraisalSelections: Record<string, string> = {};
  const accessoryAppraisalEquipment: Record<string, string> = {};
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
      accessoryAppraisalEquipment[group.selectionCell] = itemName;
    } else if (appraisal.effectCount !== 0) {
      throw new RangeError(`${itemName} 不可鑑定時，鑑定條數必須設為 0。`);
    }
  }
  groups.shared.push(...resolveAccessoryEffectOptions(data.accessoryEffects, accessoryAppraisalSelections, accessoryAppraisalEquipment));
  const accessoryCells = data.mapping.selections
    .filter(entry => entry.catalogFile.endsWith("accessories.json"))
    .map(entry => entry.selectionCell);
  const rightIceCells = data.mapping.selections.filter(entry => entry.catalogFile.endsWith("right-ice.json")).map(entry => entry.selectionCell);
  groups.shared.push(
    ...resolveRightIceSetEffects(data.rightIceSets, rightIceCells.map(text), data.rightIceSets.selectionCells.map(text)),
      ...resolveResonanceEffects(data.resonance, Object.fromEntries(data.resonance.effects.map(effect => [effect.settingKey, values[effect.settingKey]]))),
    ...resolveRaidSetEffects(data.raidSets, accessoryCells.map(text)),
  );
  const atmaPieces = accessoryCells.map(text).filter(name => name.includes("亞特瑪")).length;
  groups.shared.push(...resolveAtmaSetEffects(data.atma, atmaPieces, text("Atma.Element"), text("Atma.Color")));
  groups.shared.push(...resolveMasterBeastEffects(data.masterBeast, {
    overallOption: text("MasterBeast.OverallPotential"), headOptions: [text("MasterBeast.Head.Option1"), text("MasterBeast.Head.Option2")],
    ringOptions: ["MasterBeast.Ring1.Option1", "MasterBeast.Ring1.Option2", "MasterBeast.Ring2.Option1", "MasterBeast.Ring2.Option2"].map(text),
    headManual: { attribute: text("MasterBeast.Head.CustomAttribute"), value: number("MasterBeast.Head.CustomValue") },
    necklaceManual: { attribute: text("MasterBeast.Necklace.CustomAttribute"), value: number("MasterBeast.Necklace.CustomValue") },
    ringManual: [
      { attribute: text("MasterBeast.Ring1.CustomAttribute"), value: number("MasterBeast.Ring1.CustomValue") },
      { attribute: text("MasterBeast.Ring2.CustomAttribute"), value: number("MasterBeast.Ring2.CustomValue") },
    ],
    mirrorManual: Array.from({ length: 15 }, (_, index) => {
      const row = index + 27;
      const [part, firstRow] = row <= 29 ? ["Head", 27] : row <= 32 ? ["Armor", 30] : row <= 35 ? ["Necklace", 33] : row <= 38 ? ["Ring1", 36] : ["Ring2", 39];
      const slot = row - firstRow + 1;
      return { attribute: text(`MasterBeast.${part}.Mirror.${slot}.Attribute`), value: number(`MasterBeast.${part}.Mirror.${slot}.Value`), fractionToPercentagePoints: true };
    }),
  }));
  const selectedSpiritClasses = data.spiritRecord.classSelectors.settingKeys.map(text);
  const selectedSpiritRecords = resolveSpiritRecordSelections(data.spiritRecord, selectedSpiritClasses);
  groups.shared.push(...resolveSpiritRecordEffects(data.spiritRecord, state.Job, data.classes.classes.find(entry => entry.id === state.Job)!.attackType, selectedSpiritRecords));
  const addNamedOption = (catalog: readonly import("../calculation/equipment-effects.ts").NamedStatOption[], cell: string, source: string) => {
    const contribution = resolveNamedStatOption(catalog, text(cell), `${source}:${cell}`);
    if (contribution) groups.shared.push(contribution);
  };
  addNamedOption(data.otherEffects.titles, "Effect.Title", "title");
  addNamedOption(data.otherEffects.consumables, "Effect.Consumable", "consumable");
  addNamedOption(data.otherEffects.environments, "Effect.Environment", "environment");
  addNamedOption(data.otherEffects.peakOptions, "Peak.Option", "peak-option");
  addNamedOption(data.pets.options, "Pet.Passive", "pet");
  for (const effect of data.otherEffects.binaryEffects) addNamedOption(effect.options, effect.settingKey, effect.name);
  const portraitAwakening = data.otherEffects.portraitAwakening;
  const rawStrong = values[portraitAwakening.strongSettingKey];
  const rawTranscendence = values[portraitAwakening.transcendenceSettingKey];
  const hasStrong = rawStrong !== undefined && rawStrong !== '';
  const hasTranscendence = rawTranscendence !== undefined && rawTranscendence !== '';
  if (hasStrong || hasTranscendence) {
    const readPortraitValue = (raw: string | number | undefined, label: string): number | undefined => {
      if (raw === undefined || raw === '') return undefined;
      const value = typeof raw === 'number' ? raw : /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN;
      if (!Number.isInteger(value) || value < 0 || value > portraitAwakening.maxPct) {
        throw new RangeError(`立繪、覺醒的${label}必須是 ${portraitAwakening.minPct}–${portraitAwakening.maxPct} 的正整數；0% 僅作為自動補足結果。`);
      }
      return value;
    };
    const strongValue = readPortraitValue(rawStrong, "強烈技傷");
    const transcendenceValue = readPortraitValue(rawTranscendence, "超越技傷");
    if (strongValue !== undefined && transcendenceValue !== undefined
      && strongValue + transcendenceValue !== portraitAwakening.maxTotalPct) {
      throw new RangeError(`立繪、覺醒的強烈技傷與超越技傷合計必須為 ${portraitAwakening.maxTotalPct}%。`);
    }
    const split = normalizePortraitAwakeningSplit(strongValue, transcendenceValue, portraitAwakening.maxTotalPct);
    const portraitSkillValues = [
      { statKey: portraitAwakening.strongStatKey, value: split.strongSkillDamagePct },
      { statKey: portraitAwakening.transcendenceStatKey, value: split.transcendenceSkillDamagePct },
    ];
    groups.shared.push({
      sourceId: `立繪、覺醒:${portraitAwakening.legacySettingKey}`,
      stats: Object.fromEntries(portraitSkillValues.filter(entry => entry.value > 0).map(entry => [entry.statKey, entry.value])),
    });
  }
  for (const stage of data.otherEffects.guildFountain) addNamedOption(stage.options, stage.settingKey, `guild-fountain-${stage.stage}`);
  if (!state.lowerwearAlternativeEnabled) groups.lowerwearB = [];
  const rules: AttributeRule[] = data.attributes.attributes.filter((entry) => entry.active && entry.aggregation === "sum")
    .map((entry) => ({ key: entry.key, aggregation: "sum", cap: entry.cap }));
  const aggregate = () => aggregateCharacterAttributes(prepareCharacterAttributeInput(rules, {
    ...groups, lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
  }).attributeInput);
  const first = aggregate();
  if (text("Weapon.ENHC")) {
    const params = resolveAttackParameters(data.attack, state.Job, Number(text("Weapon.ENHC").match(/\d+/)?.[0]));
    const stats = calculateWeaponBaseAttack({ ...params, attackLevel: first.stats.attackLevel?.finalTotal ?? 0 });
    groups.shared.push({ sourceId: "weapon-base-attack", stats });
  }
  const result = aggregate();
  const calculationSources = {
    shared: groups.shared.filter(source => source.sourceId !== "character-base" && source.sourceId !== "weapon-base-attack"),
    lowerwearA: groups.lowerwearA, lowerwearB: groups.lowerwearB,
    lowerwearAlternativeEnabled: state.lowerwearAlternativeEnabled,
  };
  return { ...result, calculationSources };
}

function combatRateInputs(data: GameData, state: LoadoutState, attributes: ReturnType<typeof projectAttributes>) {
  const job = data.classes.classes.find(entry => entry.id === state.Job);
  if (!job) throw new RangeError(`找不到職業設定：${state.Job}`);
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
      "Left.Armor.Bottom.ENHC": state.values["Left.Armor.Bottom.ENHC"],
      "Left.Armor.Shoes.ENHC": state.values["Left.Armor.Shoes.ENHC"],
      masterBeastSpiritStoneColor: state.masterBeastSpiritStoneColor ?? data.masterBeast.spiritStoneColorSelector.defaultColor,
    },
  };
  return {
    classId: job.id,
    classCombatEffects: data.classCombatEffects,
    baseCritRatePct: attributes.stats.critRatePct?.finalTotal ?? 0,
    baseExtremizationPct: attributes.stats.extremizationPct?.finalTotal ?? 0,
    combatRateSourceRules: data.combatRateSources,
    combatRateSourceValues,
    targetCritPenaltyPct: percentage("Stage.CritRatePenalty"),
  };
}

/** Calculate final in-combat probability without requiring weapon level. */
export function projectCombatRates(data: GameData, state: LoadoutState) {
  const attributes = projectAttributes(data, state);
  return calculateLoadoutCombatRates(combatRateInputs(data, state, attributes));
}

/** Full formula path from the computed attack range through final damage. */
export function projectDamage(data: GameData, state: LoadoutState) {
  const attributes = projectAttributes(data, state);
  const job = data.classes.classes.find(entry => entry.id === state.Job);
  if (!job) throw new RangeError(`找不到職業設定：${state.Job}`);
  const weaponText = String(state.values["Weapon.ENHC"] ?? "");
  const weaponLevel = Number(weaponText.match(/[0-9]+/)?.[0]);
  if (!Number.isSafeInteger(weaponLevel)) throw new RangeError("請先選擇武器強化等級。");
  const percentage = (cell: string) => {
    const value = state.values[cell];
    if (value == null || value === "") return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new RangeError(`${cell} 必須是數值。`);
    return parsed;
  };
  const rateInputs = combatRateInputs(data, state, attributes);
  const result = calculateLoadout({
    classId: job.id, attackType: job.attackType,
    attributeRules: data.attributes.attributes.filter(entry => entry.active && entry.aggregation === "sum")
      .map(entry => ({ key: entry.key, aggregation: "sum" as const, cap: entry.cap })),
    characterBaseStats: { ...data.parameters.characterBase, ...data.parameters.characterBaseByClass?.[job.id] },
    sources: attributes.calculationSources,
    attackParameters: data.attack,
    weaponEnhancementLevel: weaponLevel,
    classCombatEffects: data.classCombatEffects,
    classDamagePassives: data.classDamagePassives,
    combatRateSourceRules: data.combatRateSources,
    combatRateSourceValues: rateInputs.combatRateSourceValues,
    targetCritPenaltyPct: rateInputs.targetCritPenaltyPct,
    stageAdaptabilityPenaltyPct: percentage("Stage.Adapt"),
    enemyDefensePct: percentage("Stage.BossDEF"),
    transcendenceSkillDamageSharePct: state.transcendenceSkillDamageSharePct ?? DEFAULT_TRANSCENDENCE_SKILL_DAMAGE_SHARE_PCT,
    critDamageProductBasePct: data.parameters.characterBaseByClass?.[job.id]?.critDamagePct === undefined ? data.parameters.critDamageProductBasePct : data.parameters.characterBaseByClass[job.id].critDamagePct - 100,
    critDamageProductBaselinePctToSubtract: data.parameters.characterBaseByClass?.[job.id]?.critDamagePct ?? data.parameters.critDamageProductBaselinePctToSubtract,
  });
  return { attributes: result.attributes, result };
}
