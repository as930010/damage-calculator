import { getEquipmentOptionName } from '../calculation/equipment-catalog.ts';
import { type AccessoryEffectOption } from '../calculation/equipment-effects.ts';
import { loadGameData, readJson, escapeHtml as h, formatNumber as fmt } from './data.ts';
import { readState, readBaseline, saveState, normalizeTranscendenceSkillDamageShare, normalizePortraitAwakeningSplit, parseTranscendenceSkillDamageShareInput, type LoadoutState } from './state.ts';
import { parseLoadoutJson, serializeLoadout } from './loadout-transfer.ts';
import { projectAttributes, projectCombatRates, projectDamage } from './projection.ts';
import { compareLoadoutResults } from './calculation-comparison.ts';
import { createPicker, type PickerOption } from './picker.ts';
import { GLOVE_CIRCUIT_ROWS_FIELD, readGloveCircuitRows, serializeGloveCircuitRows, gloveCircuitRowsTotal } from './circuit-board-rows.ts';
import { icon } from './icons.ts';
import { capOverflowPercentage } from './cap-warnings.ts';
import { findValidationCatalog } from './input-validation.ts';
import { preventScientificNotation } from './numeric-input.ts';
import { resolveClassCode, sanitizeClassCode } from './class-code.ts';
import { resolveUnsignedInteger, sanitizeUnsignedInteger } from './direct-input.ts';
import { historyShortcutAction, LoadoutHistory } from './history.ts';

const ICE_EQUIPMENT_SHORT_NAMES: Record<string, string> = {
  '幻影面紗': '面紗',
  '真理假面': '真理',
  '紫霄花郎': '花郎',
  '星辰牧者': '星辰',
  '日冕．灼耀花仙': '日冕',
  '幽潮吞源': '幽潮',
  '猛虎奇談': '猛虎',
  '厄瑞玻斯的哀歌': '哀歌',
  '薇塔芳塔娜': '薇塔',
  '深淵的存在': '深淵',
  '飛龍乘雲': '飛龍',
  '艾里奧斯守護騎士團': '騎士團',
  '神秘的埃羅德': '神埃',
};

async function start() {
  const data = await loadGameData();
  const sampleId = new URLSearchParams(location.search).get('sample');
  if (sampleId !== null && !/^[a-z0-9-]+$/.test(sampleId)) throw new RangeError('驗算範例名稱無效。');
  const sampleMode = sampleId !== null;
  const state: LoadoutState = sampleMode
    ? await readJson<LoadoutState>(`examples/${sampleId}.json`)
    : readState(data.classes.classes.find(entry => entry.active)?.id ?? 'DaB');
  state.transcendenceSkillDamageSharePct = normalizeTranscendenceSkillDamageShare(state.transcendenceSkillDamageSharePct);
  const migrateLegacyHeadStoneLabel = (target: LoadoutState) => {
    if (target.values['MasterBeast.Head.CustomAttribute'] !== '其他') return false;
    target.values['MasterBeast.Head.CustomAttribute'] = '無關傷害';
    return true;
  };
  const migrateLegacyEnvironmentLabel = (target: LoadoutState) => {
    const cell = 'Effect.Environment';
    const value = target.values[cell];
    if (value === '小屋') target.values[cell] = '小屋/溫泉';
    else if (value === '其他') delete target.values[cell];
    else return false;
    return true;
  };
  const migrateLegacyGloveCircuitSkillDamage = (target: LoadoutState) => {
    const gloveCircuit = data.circuits.inputs.find(entry => entry.slot === 'gloves');
    if (!gloveCircuit || target.values[gloveCircuit.attributeCell] !== '超越技傷%') return false;
    target.values[gloveCircuit.attributeCell] = '單技傷%';
    return true;
  };
  const migrateLegacyPortraitAwakening = (target: LoadoutState) => {
    const portrait = data.otherEffects.portraitAwakening;
    const legacyValue = target.values[portrait.legacySelectorCell];
    if (legacyValue === undefined) return false;
    if (legacyValue === '有'
      && target.values[portrait.strongCell] === undefined
      && target.values[portrait.transcendenceCell] === undefined) {
      target.values[portrait.transcendenceCell] = portrait.maxTotalPct;
    }
    delete target.values[portrait.legacySelectorCell];
    return true;
  };
  const normalizePortraitAwakeningValues = (target: LoadoutState) => {
    const portrait = data.otherEffects.portraitAwakening;
    const split = normalizePortraitAwakeningSplit(
      target.values[portrait.strongCell],
      target.values[portrait.transcendenceCell],
      portrait.maxTotalPct,
    );
    const changed = target.values[portrait.strongCell] !== split.strongSkillDamagePct
      || target.values[portrait.transcendenceCell] !== split.transcendenceSkillDamagePct;
    target.values[portrait.strongCell] = split.strongSkillDamagePct;
    target.values[portrait.transcendenceCell] = split.transcendenceSkillDamagePct;
    return changed;
  };
  const startupLegacyHeadStoneLabelMigrated = migrateLegacyHeadStoneLabel(state);
  const startupLegacyEnvironmentLabelMigrated = migrateLegacyEnvironmentLabel(state);
  const startupLegacyGloveCircuitMigrated = migrateLegacyGloveCircuitSkillDamage(state);
  const startupLegacyPortraitAwakeningMigrated = migrateLegacyPortraitAwakening(state);
  const startupPortraitAwakeningNormalized = normalizePortraitAwakeningValues(state);
  const clearInvalidAccessoryAppraisals = (target: LoadoutState) => {
    const clearedCells: string[] = [];
    for (const group of data.accessoryEffects.groups) {
      const mapping = data.mapping.selections.find(entry => entry.selectionCell === group.selectionCell);
      const itemName = String(target.values[group.selectionCell] ?? '');
      const item = mapping && itemName
        ? data.catalogs[mapping.catalogFile].items.find(entry => entry.slotId === group.slotId && entry.name === itemName)
        : undefined;
      const options = itemName ? group.optionsByEquipmentName?.[itemName] ?? group.options : group.options;
      const effectCount = item?.appraisal?.canAppraise && Number.isInteger(item.appraisal.effectCount)
        && item.appraisal.effectCount! > 0 && item.appraisal.effectCount! <= group.inputCells.length
        ? item.appraisal.effectCount!
        : 0;
      for (const [index, cell] of group.inputCells.entries()) {
        const value = String(target.values[cell] ?? '');
        if (!value || (index < effectCount && options.some(option => option.name === value))) continue;
        delete target.values[cell];
        clearedCells.push(cell);
      }
    }
    return clearedCells;
  };
  const startupInvalidAccessoryAppraisalCells = clearInvalidAccessoryAppraisals(state);
  const clearDuplicateTransformationChoices = (target: LoadoutState) => {
    const seen = new Set<string>();
    const clearedCells: string[] = [];
    for (const slot of data.transformations.slots) {
      const choice = String(target.values[slot.choiceCell] ?? '');
      if (!choice) continue;
      if (seen.has(choice)) {
        delete target.values[slot.choiceCell];
        clearedCells.push(slot.choiceCell);
      } else seen.add(choice);
    }
    return clearedCells;
  };
  const startupDuplicateTransformationCells = clearDuplicateTransformationChoices(state);
  const clearDuplicateNephronTransformationChoices = (target: LoadoutState) => {
    const clearedCells: string[] = [];
    for (const field of data.nephronArmor.fields) {
      const seen = new Set<string>();
      for (const transform of field.transformFields) {
        const choice = String(target.values[transform.attributeCell] ?? '');
        if (!choice) continue;
        if (seen.has(choice)) {
          delete target.values[transform.attributeCell];
          delete target.values[transform.valueCell];
          clearedCells.push(transform.attributeCell, transform.valueCell);
        } else seen.add(choice);
      }
    }
    return clearedCells;
  };
  const startupDuplicateNephronTransformationCells = clearDuplicateNephronTransformationChoices(state);
  const clearDuplicateNephronMagazines = (target: LoadoutState) => {
    const seen = new Set<string>();
    const clearedCells: string[] = [];
    for (const field of data.nephronArmor.fields) {
      if (field.enabledBy && !target.lowerwearAlternativeEnabled) continue;
      const armor = data.innerwear.slots.find(entry => entry.id === field.slotId);
      if (!armor || target.values[armor.typeCell] !== '內布隆') continue;
      const name = String(target.values[field.magazineCell] ?? '');
      const level = String(target.values[field.magazineLevelCell] ?? '');
      if (!name && !level) continue;
      const magazine = data.nephronArmor.magazines.find(entry => entry.name === name);
      const key = magazine ? magazine.id + '::' + level : '';
      if (!magazine || !data.nephronArmor.levelLabels.includes(level) || seen.has(key)) {
        delete target.values[field.magazineCell]; delete target.values[field.magazineLevelCell];
        clearedCells.push(field.magazineCell, field.magazineLevelCell);
      } else seen.add(key);
    }
    return clearedCells;
  };
  const startupDuplicateNephronMagazineCells = clearDuplicateNephronMagazines(state);
  if ((startupLegacyHeadStoneLabelMigrated || startupLegacyEnvironmentLabelMigrated || startupLegacyGloveCircuitMigrated || startupLegacyPortraitAwakeningMigrated || startupPortraitAwakeningNormalized || startupDuplicateTransformationCells.length || startupDuplicateNephronTransformationCells.length || startupInvalidAccessoryAppraisalCells.length || startupDuplicateNephronMagazineCells.length) && !sampleMode) saveState(state);
  const weaponMagicStoneCells = data.weaponGrades.colorGroups.flatMap(group => group.selectorCells);
  const applyWeaponMagicStonePreset = (grade: string, overwrite = false) => {
    if (!grade) return;
    if (!overwrite && weaponMagicStoneCells.some(cell => state.values[cell] !== undefined)) return;
    for (const colorGroup of data.weaponGrades.colorGroups) {
      const optionId = colorGroup.presetByGrade[grade];
      const option = colorGroup.options.find(entry => entry.id === optionId);
      if (!option) continue;
      for (const cell of colorGroup.selectorCells) state.values[cell] = option.name;
    }
  };
  applyWeaponMagicStonePreset(String(state.values[data.weaponGrades.selectorCell] ?? ''));
  let baseline = sampleMode ? null : readBaseline();
  let baselineIsValid = false;
  if (baseline) {
    const migratedBaseline = migrateLegacyHeadStoneLabel(baseline);
    const migratedBaselineEnvironment = migrateLegacyEnvironmentLabel(baseline);
    const migratedBaselineGloveCircuit = migrateLegacyGloveCircuitSkillDamage(baseline);
    const migratedBaselinePortraitAwakening = migrateLegacyPortraitAwakening(baseline);
    const normalizedBaselinePortraitAwakening = normalizePortraitAwakeningValues(baseline);
    const clearedBaselineMagazines = clearDuplicateNephronMagazines(baseline);
    const clearedBaselineTransformations = clearDuplicateNephronTransformationChoices(baseline);
    if (migratedBaseline || migratedBaselineEnvironment || migratedBaselineGloveCircuit || migratedBaselinePortraitAwakening || normalizedBaselinePortraitAwakening || clearedBaselineMagazines.length || clearedBaselineTransformations.length) saveState(baseline, true);
  }
  const history = new LoadoutHistory(state);
  let selected = data.layout.slots.find(slot => slot.weapon)!;
  type BeastAccessorySlotId = 'headwear' | 'armor' | 'necklace' | 'ring-one' | 'ring-two';
  type BeastManualCategory = keyof typeof data.masterBeast.customAttributeOptions;
  let selectedBeastSlotId: BeastAccessorySlotId | null = null;
  const beastAccessorySlots: readonly {
    id: BeastAccessorySlotId; label: string; icon: string;
    fixedCells?: readonly [string, string]; stoneCells?: readonly [string, string]; stoneCategory?: BeastManualCategory;
    mirrorCells: readonly (readonly [string, string])[];
  }[] = [
    { id: 'headwear', label: '頭飾', icon: 'hair', fixedCells: ['MasterBeast.Head.Option1', 'MasterBeast.Head.Option2'], stoneCells: ['MasterBeast.Head.CustomAttribute', 'MasterBeast.Head.CustomValue'], stoneCategory: 'head', mirrorCells: [['MasterBeast.Head.Mirror.1.Attribute', 'MasterBeast.Head.Mirror.1.Value'], ['MasterBeast.Head.Mirror.2.Attribute', 'MasterBeast.Head.Mirror.2.Value'], ['MasterBeast.Head.Mirror.3.Attribute', 'MasterBeast.Head.Mirror.3.Value']] },
    { id: 'armor', label: '盔甲', icon: 'upper', mirrorCells: [['MasterBeast.Armor.Mirror.1.Attribute', 'MasterBeast.Armor.Mirror.1.Value'], ['MasterBeast.Armor.Mirror.2.Attribute', 'MasterBeast.Armor.Mirror.2.Value'], ['MasterBeast.Armor.Mirror.3.Attribute', 'MasterBeast.Armor.Mirror.3.Value']] },
    { id: 'necklace', label: '項鍊', icon: 'necklace', stoneCells: ['MasterBeast.Necklace.CustomAttribute', 'MasterBeast.Necklace.CustomValue'], stoneCategory: 'necklace', mirrorCells: [['MasterBeast.Necklace.Mirror.1.Attribute', 'MasterBeast.Necklace.Mirror.1.Value'], ['MasterBeast.Necklace.Mirror.2.Attribute', 'MasterBeast.Necklace.Mirror.2.Value'], ['MasterBeast.Necklace.Mirror.3.Attribute', 'MasterBeast.Necklace.Mirror.3.Value']] },
    { id: 'ring-one', label: '指環 1', icon: 'ring', fixedCells: ['MasterBeast.Ring1.Option1', 'MasterBeast.Ring1.Option2'], stoneCells: ['MasterBeast.Ring1.CustomAttribute', 'MasterBeast.Ring1.CustomValue'], stoneCategory: 'ring', mirrorCells: [['MasterBeast.Ring1.Mirror.1.Attribute', 'MasterBeast.Ring1.Mirror.1.Value'], ['MasterBeast.Ring1.Mirror.2.Attribute', 'MasterBeast.Ring1.Mirror.2.Value'], ['MasterBeast.Ring1.Mirror.3.Attribute', 'MasterBeast.Ring1.Mirror.3.Value']] },
    { id: 'ring-two', label: '指環 2', icon: 'ring', fixedCells: ['MasterBeast.Ring2.Option1', 'MasterBeast.Ring2.Option2'], stoneCells: ['MasterBeast.Ring2.CustomAttribute', 'MasterBeast.Ring2.CustomValue'], stoneCategory: 'ring', mirrorCells: [['MasterBeast.Ring2.Mirror.1.Attribute', 'MasterBeast.Ring2.Mirror.1.Value'], ['MasterBeast.Ring2.Mirror.2.Attribute', 'MasterBeast.Ring2.Mirror.2.Value'], ['MasterBeast.Ring2.Mirror.3.Attribute', 'MasterBeast.Ring2.Mirror.3.Value']] },
  ];
  const app = document.querySelector<HTMLElement>('#app')!;
    app.innerHTML = `<section class="workbench"><header class="workspace-heading"><div class="workspace-intro"><span class="eyebrow">EQUIPMENT SIMULATOR</span><h1>裝備傷害比較</h1><p class="workspace-summary">填入當前數值並設為比較基準，再調整配裝查看傷害差異。</p><ol class="workflow-steps" aria-label="比較流程"><li><span>01</span><span>填入當前數值</span></li><li><span>02</span><span>設為比較基準</span></li><li><span>03</span><span>填入新數值</span></li></ol></div></header><div class="toolbar"><div id="class-picker"></div><label class="toggle"><input id="alternate" type="checkbox">啟用強/排褲切換</label><div class="toolbar-actions"><button id="baseline" type="button">設為比較基準</button><div class="transfer-actions"><button id="import-loadout" type="button">匯入配裝</button><button id="export-loadout" type="button">匯出配裝</button></div></div><input id="loadout-file" type="file" accept="application/json,.json" hidden><span id="transfer-status" role="status" aria-live="polite"></span><span id="save-status" role="status"></span></div><section class="battle-panel"><div class="panel-heading"><h2>關卡設定</h2></div><div id="battle-settings" class="battle-fields"></div></section><div class="equipment-workspace"><section class="equipment-panel"><div class="panel-heading"><h2>裝備配置</h2><span>點選部位以編輯</span></div><div id="equipment-damage-summary" class="equipment-damage-summary" aria-live="polite"></div><div class="canvas-scroll"><div class="equipment-canvas"><span class="group-label costume-label">連身時裝</span><span class="group-label left-label">左冰</span><span class="group-label inner-label">內裝左四</span><span class="group-label weapon-label">冰武 / 武器</span><span class="group-label right-label">右冰</span><span class="group-label accessory-label">飾品</span><span class="group-label beast-label">聖獸飾品</span><div id="title-input" class="canvas-title-input"></div><div id="slots"></div><div id="beast-accessory-fields" class="beast-accessories-grid gear-beast-slots" aria-label="聖獸飾品配置"></div></div></div><p class="panel-note">左冰不支援混搭，但各部位魔法石仍須獨立設定。擁有強/排褲則褲子的傷害增幅會被平均計算。</p><section class="right-ice-set-area"><div class="beast-accessories-heading"><h3>右冰套效</h3><span>最多選擇 ${data.rightIceSets.maxSelectedSets} 套</span></div><p class="panel-note">選擇要啟用的套裝效果。</p><div id="right-ice-set-selectors" class="right-ice-set-selectors"></div></section><div class="beast-accessories-area"><div class="beast-accessories-heading"><h3>聖獸效果設定</h3><span>頭飾、盔甲、項鍊、指環 1、指環 2</span></div><p class="panel-note">共通顏色與潛力設定；各部位效果請使用裝備配置中的聖獸飾品欄位。</p><div id="master-beast-controls" class="master-beast-controls"></div></div></section><div id="inspector-backdrop" class="inspector-backdrop" aria-hidden="true"></div><aside id="inspector" class="inspector" aria-label="部位設定"></aside></div><details class="global-source-panel weapon-magic-stone-panel"><summary>武器魔力石</summary><div id="weapon-magic-stone-fields"></div></details><details class="global-source-panel"><summary>其他效果來源設定</summary><p class="panel-note">未列在此處的特殊條件或 Buff／Debuff 尚未納入計算。</p><div id="global-source-fields"></div></details><section class="results-panel"><div class="panel-heading"><h2>目前填寫的屬性</h2><span id="comparison-label"></span></div><p class="panel-note">已填入的屬性彙總，包含內裝、冰裝、武器、關卡與其他效果設定、需要特殊觸發條件的暫時沒有計入。</p><div id="results" aria-live="polite"></div><section class="damage-panel"><div class="panel-heading"><h2>攻擊與最終傷害</h2></div><p class="panel-note">此數值只反映已填寫的內容。</p><div id="damage-result" aria-live="polite"></div><details class="calculation-inspection-panel"><summary>計算結果驗算</summary><div class="calculation-inspection-content"><div id="calculation-comparison" class="calculation-comparison" aria-live="polite"><p>先點選「設為比較基準」保存目前配置，表格就會比較基準與目前配裝。</p></div><div id="calculation-details"></div></div></details></section></section></section>`;
  const classPickerRoot = app.querySelector<HTMLElement>('#class-picker')!;
  const classSettings = document.createElement('div');
  classSettings.className = 'class-settings';
  classPickerRoot.before(classSettings);
  classSettings.append(classPickerRoot);
  const skillShareControl = document.createElement('div');
  skillShareControl.className = 'skill-damage-share-control';
  const skillShareLabel = document.createElement('span');
  skillShareLabel.className = 'skill-damage-share-label';
  skillShareLabel.textContent = '超越占比';
  const skillShareOutput = document.createElement('output');
  skillShareOutput.id = 'skill-damage-share-output';
  skillShareOutput.setAttribute('aria-live', 'polite');
  const skillShareOutputLabel = document.createElement('span');
  skillShareOutputLabel.textContent = '強烈';
  const skillShareOutputValue = document.createElement('span');
  skillShareOutputValue.className = 'skill-damage-share-complement';
  const skillShareOutputPercent = document.createElement('span');
  skillShareOutputPercent.textContent = '%';
  skillShareOutput.append(skillShareOutputLabel, skillShareOutputValue, skillShareOutputPercent);
  const skillShareNumberWrap = document.createElement('div');
  skillShareNumberWrap.className = 'skill-damage-share-number-wrap';
  const skillShareNumberInput = document.createElement('input');
  skillShareNumberInput.id = 'transcendence-skill-share-number';
  skillShareNumberInput.type = 'text';
  skillShareNumberInput.inputMode = 'decimal';
  skillShareNumberInput.autocomplete = 'off';
  skillShareNumberInput.spellcheck = false;
  skillShareNumberInput.maxLength = 6;
  skillShareNumberInput.pattern = '(?:0|[1-9]\\d{0,2})(?:\\.\\d{0,2})?';
  skillShareNumberInput.setAttribute('aria-label', '超越技傷占比百分比');
  skillShareNumberInput.setAttribute('aria-describedby', 'skill-damage-share-output');
  skillShareNumberInput.title = '只接受 0–100 的數字，最多兩位小數。';
  const skillSharePercent = document.createElement('span');
  skillSharePercent.textContent = '%';
  skillShareNumberWrap.append(skillShareNumberInput, skillSharePercent);
  skillShareOutput.setAttribute('aria-label', '強烈技傷占比，自動補足至100%');
  skillShareControl.append(skillShareLabel, skillShareNumberWrap, skillShareOutput);
  classSettings.append(skillShareControl);
  const renderSkillDamageShare = (syncNumberInput = true) => {
    const share = normalizeTranscendenceSkillDamageShare(state.transcendenceSkillDamageSharePct);
    state.transcendenceSkillDamageSharePct = share;
    skillShareOutputValue.textContent = String(Math.round((100 - share) * 100) / 100);
    if (syncNumberInput) skillShareNumberInput.value = String(share);
  };
  const setSkillShareInputInvalid = (invalid: boolean) => {
    skillShareNumberInput.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    skillShareNumberWrap.classList.toggle('is-invalid', invalid);
  };
  const parseSkillShareInput = parseTranscendenceSkillDamageShareInput;
  const isSkillShareDraftValid = (raw: string) => raw === '' || parseSkillShareInput(raw) !== null;
  const isSkillShareInsertionValid = (inserted: string) => {
    const start = skillShareNumberInput.selectionStart ?? skillShareNumberInput.value.length;
    const end = skillShareNumberInput.selectionEnd ?? start;
    const nextValue = skillShareNumberInput.value.slice(0, start) + inserted + skillShareNumberInput.value.slice(end);
    return nextValue.length <= skillShareNumberInput.maxLength && isSkillShareDraftValid(nextValue);
  };
  skillShareNumberInput.addEventListener('focus', () => skillShareNumberInput.select());
  skillShareNumberInput.addEventListener('input', () => {
    const raw = skillShareNumberInput.value;
    if (raw === '') {
      setSkillShareInputInvalid(false);
      return;
    }
    const value = parseSkillShareInput(raw);
    if (value === null) {
      setSkillShareInputInvalid(true);
      renderSkillDamageShare();
      return;
    }
    setSkillShareInputInvalid(false);
    state.transcendenceSkillDamageSharePct = normalizeTranscendenceSkillDamageShare(value);
    renderSkillDamageShare(false);
    update();
  });
  const commitSkillShareNumberInput = () => {
    const value = parseSkillShareInput(skillShareNumberInput.value);
    if (value === null) {
      setSkillShareInputInvalid(true);
      renderSkillDamageShare();
      setSkillShareInputInvalid(false);
      return;
    }
    setSkillShareInputInvalid(false);
    state.transcendenceSkillDamageSharePct = normalizeTranscendenceSkillDamageShare(value);
    renderSkillDamageShare();
    update();
  };
  skillShareNumberInput.addEventListener('blur', commitSkillShareNumberInput);
  skillShareNumberInput.addEventListener('keydown', event => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1
      && !isSkillShareInsertionValid(event.key)) {
      event.preventDefault();
      setSkillShareInputInvalid(true);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      skillShareNumberInput.blur();
    }
  });
  skillShareNumberInput.addEventListener('beforeinput', event => {
    const inputEvent = event as InputEvent;
    if (inputEvent.inputType.startsWith('insert') && inputEvent.data !== null
      && !isSkillShareInsertionValid(inputEvent.data)) {
      event.preventDefault();
      setSkillShareInputInvalid(true);
    }
  });
  skillShareNumberInput.addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!isSkillShareInsertionValid(pasted)) {
      event.preventDefault();
      setSkillShareInputInvalid(true);
    }
  });
  renderSkillDamageShare();
  const inspectorPanel = document.querySelector<HTMLElement>('#inspector')!;
  const inspectorBackdrop = document.querySelector<HTMLElement>('#inspector-backdrop')!;
  const mobileInspectorQuery = window.matchMedia('(max-width: 700px)');
  const closeMobileInspector = () => {
    document.body.classList.remove('mobile-inspector-open');
    inspectorPanel.removeAttribute('aria-modal');
    inspectorPanel.removeAttribute('role');
    inspectorBackdrop.hidden = true;
    const trigger = selectedBeastSlotId
      ? [...document.querySelectorAll<HTMLElement>('#beast-accessory-fields [data-beast-slot-id]')].find(button => button.dataset.beastSlotId === selectedBeastSlotId)
      : [...document.querySelectorAll<HTMLElement>('#slots [data-slot-id]')].find(button => button.dataset.slotId === selected.id);
    trigger?.focus();
  };
  const openMobileInspector = () => {
    if (!mobileInspectorQuery.matches) return;
    document.body.classList.add('mobile-inspector-open');
    inspectorPanel.setAttribute('role', 'dialog');
    inspectorPanel.setAttribute('aria-modal', 'true');
    inspectorBackdrop.hidden = false;
    inspectorPanel.querySelector<HTMLButtonElement>('.inspector-close')?.focus();
  };
  inspectorBackdrop.addEventListener('click', closeMobileInspector);
  inspectorPanel.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.inspector-close')) closeMobileInspector();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('mobile-inspector-open')) closeMobileInspector();
  });
  mobileInspectorQuery.addEventListener('change', event => { if (!event.matches && document.body.classList.contains('mobile-inspector-open')) closeMobileInspector(); });
  const toolbarActions = app.querySelector<HTMLElement>('.toolbar-actions')!;
  const baselineButton = toolbarActions.querySelector<HTMLButtonElement>('#baseline')!;
  const transferButtons = toolbarActions.querySelector<HTMLElement>('.transfer-actions')!;
  const toolbar = app.querySelector<HTMLElement>('.toolbar')!;
  const transferStatus = toolbar.querySelector<HTMLElement>('#transfer-status')!;
  const saveStatus = toolbar.querySelector<HTMLElement>('#save-status')!;
  const historyActions = document.createElement('div');
  historyActions.className = 'history-actions';
  historyActions.setAttribute('role', 'group');
  historyActions.setAttribute('aria-label', '操作歷史');
  const makeHistoryButton = (id: string, glyph: string, label: string, shortcut: string, ariaShortcuts: string) => {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.disabled = true;
    button.title = `${label}（${shortcut}）`;
    button.setAttribute('aria-label', `${label}（${shortcut}）`);
    button.setAttribute('aria-keyshortcuts', ariaShortcuts);
    button.innerHTML = `<span class="history-action-glyph" aria-hidden="true">${h(glyph)}</span><span>${h(label)}</span>`;
    return button;
  };
  const undoButton = makeHistoryButton('undo', '↶', '復原', 'Ctrl+Z / ⌘Z', 'Control+Z Meta+Z');
  const redoButton = makeHistoryButton('redo', '↷', '重做', 'Ctrl+Y / Ctrl+Shift+Z / ⌘Y / ⌘Shift+Z', 'Control+Y Control+Shift+Z Meta+Y Meta+Shift+Z');
  historyActions.append(undoButton, redoButton);
  const baselineActions = document.createElement('div');
  baselineActions.className = 'baseline-actions';
  const baselineControlGroup = document.createElement('div');
  baselineControlGroup.className = 'baseline-control-group';
  const baselineButtons = document.createElement('div');
  baselineButtons.className = 'baseline-buttons';
  const transferControlGroup = document.createElement('div');
  transferControlGroup.className = 'transfer-control-group';
  const restoreBaselineButton = document.createElement('button');
  restoreBaselineButton.id = 'restore-baseline';
  restoreBaselineButton.type = 'button';
  restoreBaselineButton.disabled = true;
  restoreBaselineButton.textContent = '還原至比較基準';
  restoreBaselineButton.setAttribute('aria-label', '還原至比較基準配置');
  restoreBaselineButton.title = '尚未設定可用的基準配置';
  baselineButton.title = '保存目前完整配置作為比較基準；不會改動操作歷史';
  baselineButtons.append(restoreBaselineButton, baselineButton);
  baselineControlGroup.append(baselineButtons);
  transferControlGroup.append(transferButtons);
  baselineActions.append(baselineControlGroup, transferControlGroup);
  toolbarActions.replaceChildren(historyActions, baselineActions);
  const toolbarFeedback = document.createElement('div');
  toolbarFeedback.className = 'toolbar-feedback';
  toolbar.append(toolbarFeedback);
  const placeToolbarFeedback = () => {
    toolbarFeedback.append(saveStatus, transferStatus);
  };
  placeToolbarFeedback();

  if (sampleMode) {
    app.querySelector('.workspace-heading')!.insertAdjacentHTML('afterend', '<p class="sample-banner">已載入驗算範例。這個分頁的調整不會覆蓋你原本儲存在瀏覽器的配裝。</p>');
    document.querySelector('footer')!.textContent = '這個分頁使用驗算範例；調整只保留至關閉或重新整理頁面。';
    document.querySelector('#save-status')!.textContent = '驗算範例模式';
  }
  if (startupDuplicateTransformationCells.length) {
    document.querySelector<HTMLElement>('#transfer-status')!.textContent = `已清除舊配裝中的重複武器變換詞條（${startupDuplicateTransformationCells.length} 個欄位）。`;
  }
  if (startupInvalidAccessoryAppraisalCells.length) {
    document.querySelector<HTMLElement>('#transfer-status')!.textContent = `已清除不符合目前裝備的鑑定選項（${startupInvalidAccessoryAppraisalCells.length} 個欄位）。`;
  }
  const val = (fieldId: string) => String(state.values[fieldId] ?? '');
  const summary = (stats: Readonly<Record<string, number>>) => Object.entries(stats).filter(([, value]) => value !== 0).map(([key, value]) => `${data.attributes.attributes.find(a => a.key === key)?.name ?? key} ${fmt(value)}`).join(' · ');
  const options = (names: readonly string[]): PickerOption[] => names.map(name => ({ value: name, label: name }));
  const refreshHistoryControls = () => {
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
    const canRestore = Boolean(baseline && baselineIsValid && !history.matches(baseline));
    restoreBaselineButton.disabled = !canRestore;
    restoreBaselineButton.title = !baseline
      ? '請先設定比較基準'
      : !baselineIsValid
        ? '已保存的基準配置無法套用目前資料，請重新設定基準'
      : canRestore ? '一鍵還原至比較基準（可用復原撤銷）' : '目前配置已與基準一致';
  };
  const lowerwearConditionalCircuitConflict = (): string | null => {
    if (!state.lowerwearAlternativeEnabled) return null;
    const lowerwear = data.circuits.inputs.find(slot => slot.slot === "lowerwear");
    const alternative = data.circuits.inputs.find(slot => slot.slot === "lowerwearAlternative");
    if (!lowerwear || !alternative) return null;
    const selected = val(lowerwear.attributeCell);
    return selected === val(alternative.attributeCell) && (selected === "強者%" || selected === "排熱%") ? selected : null;
  };
  const circuitAttributeOptions = (slot: (typeof data.circuits.inputs)[number]) => {
    if (!state.lowerwearAlternativeEnabled || (slot.slot !== "lowerwear" && slot.slot !== "lowerwearAlternative")) return options(slot.attributeOptions);
    const peerSlot = slot.slot === "lowerwear" ? "lowerwearAlternative" : "lowerwear";
    const peer = data.circuits.inputs.find(entry => entry.slot === peerSlot);
    const peerAttribute = peer ? val(peer.attributeCell) : "";
    const names = peerAttribute === "強者%" || peerAttribute === "排熱%"
      ? slot.attributeOptions.filter(name => name !== peerAttribute)
      : slot.attributeOptions;
    return options(names);
  };
  const lowerwearConditionalChipConflict = (): string | null => {
    if (!state.lowerwearAlternativeEnabled) return null;
    const lowerwear = data.chipSlots.slots.find(slot => slot.id === "lowerwear");
    const alternative = data.chipSlots.slots.find(slot => slot.id === "lowerwearAlternative");
    if (!lowerwear || !alternative) return null;
    const selected = val(lowerwear.attributeCell);
    return selected === val(alternative.attributeCell) && (selected === "強者%" || selected === "排熱%") ? selected : null;
  };
  const chipAttributeOptions = (slot: (typeof data.chipSlots.slots)[number]) => {
    const chipNames = data.chips.chips.map(entry => entry.name);
    if (!state.lowerwearAlternativeEnabled || (slot.id !== "lowerwear" && slot.id !== "lowerwearAlternative")) return options(chipNames);
    const peerId = slot.id === "lowerwear" ? "lowerwearAlternative" : "lowerwear";
    const peer = data.chipSlots.slots.find(entry => entry.id === peerId);
    const peerAttribute = peer ? val(peer.attributeCell) : "";
    const blocked = peerAttribute === "強者%" || peerAttribute === "排熱%";
    return options(blocked ? chipNames.filter(name => name !== peerAttribute) : chipNames);
  };
  const validationChoices = (cell: string, percentLabel = false): PickerOption[] => {
    const catalog = findValidationCatalog(data.simulatorInputs.inputs, data.simulatorInputs.catalogs, cell);
    return (catalog?.options ?? []).map(option => {
      const value = String(option.value);
      return { value, label: percentLabel && typeof option.value === 'number' ? `${value}%` : value };
    });
  };
  const update = (force = false) => {
    const changed = history.record(state);
    if (!changed && !force) {
      refreshHistoryControls();
      return;
    }
    document.querySelector('#save-status')!.textContent = sampleMode ? '驗算範例模式：本頁調整不儲存' : saveState(state) ? '已儲存於此裝置' : '此瀏覽器無法儲存設定';
    renderSlots(); renderBeastAccessories(); renderMasterBeastColorSelector(); renderResults();
    refreshHistoryControls();
  };
  function sourceLabel(sourceId: string): string {
    if (sourceId === 'character-base') return '角色基礎係數';
    if (sourceId === 'character-base:crit-damage-product') return '角色原始乘算爆傷基準';
    if (sourceId === 'weapon-base-attack') return '武器基礎攻擊力';
    if (sourceId === 'hunter-instinct') return '獵人的本能';
    if (sourceId.startsWith('master-beast-potential:')) return '聖獸潛力';
    const configuredSourceLabels: Readonly<Record<string, string>> = {
      'fixed-effect:master-beast': '大師聖獸固定效果',
      'fixed-effect:pet-skill': '寵物被動',
      'fixed-effect:raid-set': '百億／內布隆套效',
      'fixed-effect:weapon': '武器',
      'fixed-effect:title-adaptability': '稱號',
      'fixed-effect:title-defense-ignore': '稱號',
      'fixed-effect:red-upper-crit-damage': '百億紅上衣、暴上',
      'fixed-effect:maestro-aura': 'MAESTRO光環',
      'combat-rate:yellow-beast-stone': '黃色聖獸精靈石效果',
      'combat-rate:lowerwear-enhancement': '下衣強化爆擊效果',
      'combat-rate:shoes-enhancement': '鞋子強化極大效果',
    };
    if (configuredSourceLabels[sourceId]) return configuredSourceLabels[sourceId];
    if (sourceId.startsWith('class-passive:')) {
      const [, classId, kind] = sourceId.split(':');
      if (kind === 'boss-damage') return classId + '自身技能';
      if (kind === 'multiplicative-crit-damage') {
        if (['TB', 'BMa', 'MN', 'PO'].includes(classId)) return classId + ' 爆發模式';
        if (['CT', 'IN', 'DA', 'DE'].includes(classId)) return classId + ' 懲戒紋章';
        return classId + '自身技能（乘算爆傷）';
      }
    }
    if (sourceId.startsWith('simulator:')) {
      const cell = sourceId.slice('simulator:'.length);
      const stoneSlot = data.layout.slots.find(entry => entry.stoneCells?.includes(cell));
      const selectedSlots = data.layout.slots.filter(entry => entry.selectionCell === cell);
      const slot = stoneSlot ?? selectedSlots[0];
      const selected = String(state.values[cell] ?? '').trim();
      if (stoneSlot) return `${stoneSlot.label}魔法石：${selected}`;
      if (selectedSlots.length > 1) {
        const group = data.layout.groups.find(entry => entry.id === selectedSlots[0].group);
        return `${group?.name ?? selectedSlots[0].group}套裝：${selected}`;
      }
      if (slot) return `${slot.label}：${selected}`;
      return `裝備選擇（${cell}）${selected ? `：${selected}` : ''}`;
    }
    if (sourceId.startsWith('nephron-transform:')) {
      const [, slotId, line] = sourceId.split(':');
      const field = data.nephronArmor.fields.find(entry => entry.slotId === slotId);
      const index = Number(line) - 1;
      const attributeCell = field && index >= 0 ? field.transformFields[index]?.attributeCell : undefined;
      const attribute = attributeCell ? String(state.values[attributeCell] ?? '') : '';
      const partNames: Record<string, string> = { Upper: '上衣', Lowerwear: '下衣', LowerwearAlternative: '強/排褲', Gloves: '手套', Shoes: '鞋子' };
      return '內布隆' + (partNames[field?.part ?? ''] ?? field?.part ?? '') + '變換：' + attribute;
    }
    if (sourceId.startsWith('nephron-magazine:')) {
      const [, slotId, magazineId, level] = sourceId.split(':');
      const field = data.nephronArmor.fields.find(entry => entry.slotId === slotId);
      const magazine = data.nephronArmor.magazines.find(entry => entry.id === magazineId);
      const partNames: Record<string, string> = { Upper: '上衣', Lowerwear: '下衣', LowerwearAlternative: '強/排褲', Gloves: '手套', Shoes: '鞋子' };
      return '內布隆' + (partNames[field?.part ?? ''] ?? field?.part ?? '') + '彈匣：' + (magazine?.name ?? magazineId) + ' ' + level;
    }
    if (sourceId.startsWith('innerwear:')) {
      const slot = data.innerwear.slots.find(entry => entry.id === sourceId.slice('innerwear:'.length));
      return slot ? `內裝${slot.name}（強化／鍛造）` : `內裝來源待確認（${sourceId}）`;
    }
    if (sourceId === 'spirit-record:default-maxed') return '賦靈錄';
    if (sourceId.startsWith('spirit-record:branch:')) return `賦靈錄：${sourceId.slice('spirit-record:branch:'.length)}`;
    if (sourceId.startsWith('spirit-record:trait:')) return `賦靈錄特性：${sourceId.slice('spirit-record:trait:'.length)}`;
    if (sourceId.startsWith('chip:')) {
      const slotId = sourceId.slice('chip:'.length);
      const slot = data.chipSlots.slots.find(entry => entry.id === slotId);
      const slotNames: Record<string, string> = { upper: '上衣', lowerwear: '下衣', lowerwearAlternative: '強/排褲', gloves: '手套', shoes: '鞋子' };
      return slot ? `${slotNames[slot.id] ?? slot.id}芯片：${String(state.values[slot.attributeCell] ?? '')}（調校 ${String(state.values[slot.tuningCell] ?? '')}）` : `芯片調校來源待確認（${sourceId}）`;
    }
    if (sourceId.startsWith('circuit-board:')) {
      const [slotId, rowNumber] = sourceId.slice('circuit-board:'.length).split(':');
      const slot = data.circuits.inputs.find(entry => entry.slot === slotId);
      if (slotId === 'gloves' && rowNumber && slot) {
        const row = readGloveCircuitRows(state.values, slot.attributeCell, slot.valueCell)[Number(rowNumber) - 1];
        if (row) return '手套電路板第 ' + rowNumber + ' 列：' + row.attribute + ' ' + fmt((row.percentageValue ?? 0) * 100) + '%';
      }
      const slotNames: Record<string, string> = { upper: '上衣電路板', lowerwear: '下衣電路板', lowerwearAlternative: '強/排褲電路板', gloves: '手套電路板', shoes: '鞋子電路板' };
      if (slotNames[slotId] && !rowNumber) return slotNames[slotId];
      return slot ? `電路板 ${slotId}：${String(state.values[slot.attributeCell] ?? '')} ${fmt(Number(state.values[slot.valueCell] ?? 0) * 100)}%` : `電路板來源待確認（${sourceId}）`;
    }
    if (sourceId === '立繪、覺醒:Effect.PortraitAwakening') return '立繪、覺醒';
    if (sourceId.startsWith('color-set:')) return `百億套效：${sourceId.slice('color-set:'.length)}`;
    if (sourceId.startsWith('master-beast:')) {
      const [, part, detail] = sourceId.split(':');
      const partNames: Record<string, string> = { head: '頭飾', ring: '指環' };
      if (part === 'mirror') {
        return '聖獸迷鏡效果';
      }
      if (part === 'head-manual') return `聖獸頭飾精靈石：${String(state.values['MasterBeast.Head.CustomAttribute'] ?? '')}`;
      if (part === 'necklace-manual') return `聖獸項鍊精靈石：${String(state.values['MasterBeast.Necklace.CustomAttribute'] ?? '')}`;
      if (part === 'ring-manual') {
        const fieldId = detail === '1' ? 'MasterBeast.Ring1.CustomAttribute' : 'MasterBeast.Ring2.CustomAttribute';
        return `聖獸指環精靈石：${String(state.values[fieldId] ?? '')}`;
      }
      if (partNames[part]) {
        const fieldId = part === 'head' ? detail === '1' ? 'MasterBeast.Head.Option1' : 'MasterBeast.Head.Option2' : detail === '1' ? 'MasterBeast.Ring1.Option1' : 'MasterBeast.Ring2.Option1';
        return `聖獸${partNames[part]}固定效果：${String(state.values[fieldId] ?? '')}`;
      }
    }
    const rightIce = data.rightIceSets.effects.find(entry => entry.id === sourceId);
    if (rightIce) return `右冰套效：${rightIce.setName}`;
    const resonance = data.resonance.effects.find(entry => entry.id === sourceId);
    if (resonance) return `共鳴：${resonance.name}`;
    const raid = data.raidSets.sets.find(entry => sourceId.startsWith(`${entry.id}:`));
    if (raid) return `襲擊套效：${raid.name}（${sourceId.slice(raid.id.length + 1)}）`;
    const atma = data.atma.rules.find(entry => entry.id === sourceId);
    const atmaNames: Record<string, string> = {
      'atma-wood-crit-rate': '草木亞特瑪致命一擊',
      'atma-water-fire-multiplicative-damage': '流水 / 火焰亞特瑪套效',
      'atma-wood-multiplicative-crit-damage': '草木亞特瑪乘算致命傷害',
    };
    if (atma) return atmaNames[atma.id] ?? `亞特瑪來源待確認（${atma.id}）`;
    if (sourceId.startsWith('weapon-growth')) return `武器成長：${String(state.values[data.growth.selectorCell] ?? '')}`;
    if (sourceId.startsWith('weapon-appraisal:')) {
      const cell = sourceId.slice('weapon-appraisal:'.length);
      const group = Object.values(data.weaponAppraisals.groups).find(entry => entry.selectorCell === cell);
      return `武器鑑定${group ? `：${String(state.values[cell] ?? '')}` : ''}`;
    }
    if (sourceId.startsWith('giant-stone:')) {
      return '巨型魔力石';
    }
    if (sourceId.startsWith('weapon-magic-stone:')) {
      const colorId = sourceId.split(':')[1];
      return `${data.weaponGrades.colorGroups.find(group => group.id === colorId)?.name ?? '武器魔力石'}效果`;
    }
    if (sourceId.startsWith('weapon-grade:')) return '武器魔力石';
    if (sourceId.startsWith('weapon-transform:')) {
      return '武器變換';
    }
    if (sourceId.startsWith('armor-appraisal:')) {
      const slotId = sourceId.split(':')[1];
      const slot = data.appraisals.slots.find(entry => entry.id === slotId);
      const slotNames: Record<string, string> = { upper: '上衣', lowerwear: '下衣', lowerwearAlternative: '強/排褲', gloves: '手套', shoes: '鞋子' };
      return slot ? `內裝${slotNames[slot.id] ?? slot.id}鑑定` : `防具鑑定來源待確認（${sourceId}）`;
    }
    if (sourceId.startsWith('accessory-effect:')) {
      const groupId = sourceId.split(':')[1];
      const group = data.accessoryEffects.groups.find(entry => entry.id === groupId);
      return group ? `${group.label}鑑定` : `飾品效果來源待確認（${sourceId}）`;
    }
    if (sourceId.startsWith('title:')) return `稱號：${String(state.values['Effect.Title'] ?? '')}`;
    if (sourceId.startsWith('consumable:')) return `消耗品：${String(state.values['Effect.Consumable'] ?? '')}`;
    if (sourceId.startsWith('environment:')) return `場地：${String(state.values['Effect.Environment'] ?? '')}`;
    if (sourceId.startsWith('peak-option:')) return `巔峰選項：${String(state.values['Peak.Option'] ?? '')}`;
    if (sourceId.startsWith('pet:')) return `寵物：${String(state.values['Pet.Passive'] ?? '')}`;
    if (sourceId === '標誌:Effect.Emblem') return '標誌';
    const binaryEffect = data.otherEffects.binaryEffects.find(entry => entry.name === sourceId);
    if (binaryEffect) return `${binaryEffect.name}：${String(state.values[binaryEffect.selectorCell] ?? '')}`;
    if (sourceId.startsWith('guild-fountain-')) {
      return '公會噴泉';
    }
    if (sourceId === 'lowerwear-crit-rate-enhancement') return '下衣強化階段+2';
    if (sourceId === 'shoes-extremization-enhancement') return '鞋子強化階段+2';
    if (sourceId === 'master-beast:armor-spirit-stone-set:S77') return '聖獸精靈石套效';
    const classPassiveSource = sourceId.match(/^([^:]+):(critRate|extremization):(crit|ext)-\d+$/);
    if (classPassiveSource && data.classCombatEffects.classes[classPassiveSource[1]]) return classPassiveSource[1] + '自身技能';
    return `來源名稱待確認（${sourceId}）`;
  }
  function calculationIssue(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '未知錯誤');
    const missingEnhancement = message.match(/Missing enhancement selection: (\S+)/);
    if (missingEnhancement?.[1] === 'Left.Armor.Bottom.ENHC') {
      return '內裝左四的「下衣」尚未選擇強化等級。請點選裝備配置中的「下衣」，填寫「強化」欄位。';
    }
    if (missingEnhancement?.[1] === 'Left.Armor.Shoes.ENHC') {
      return '內裝左四的「鞋子」尚未選擇強化等級。請點選裝備配置中的「鞋子」，填寫「強化」欄位。';
    }
    return message;
  }
  const sourceRows = (sources: readonly { sourceId: string; valuePct: number }[], isPercent: boolean) => {
    const totals = new Map<string, number>();
    for (const source of sources) {
      const label = sourceLabel(source.sourceId);
      totals.set(label, (totals.get(label) ?? 0) + source.valuePct);
    }
    return [...totals].map(([label, total]) =>
      `<p class="stat-source-row"><span>${h(label)}</span><strong>${fmt(total)}${isPercent ? '%' : ''}</strong></p>`,
    ).join('');
  };
  const field = (parent: HTMLElement, label: string, cell: string, choices: readonly PickerOption[], redraw = false, disabled = false, disabledHint = '請先選擇屬性') => {
    const picker = createPicker(label, choices, val(cell), value => {
      state.values[cell] = value;
      for (const armor of data.nephronArmor.fields) {
        const transform = armor.transformFields.find(entry => entry.attributeCell === cell);
        if (transform) delete state.values[transform.valueCell];
        if (armor.magazineCell === cell) delete state.values[armor.magazineLevelCell];
      }
      if (data.accessoryEffects.groups.some(group => group.selectionCell === cell)) {
        const cleared = clearInvalidAccessoryAppraisals(state);
        if (cleared.length) {
          if (!sampleMode) saveState(state);
          document.querySelector<HTMLElement>('#transfer-status')!.textContent = `已清除不符合目前裝備的鑑定選項（${cleared.length} 個欄位）。`;
        }
      }
      update(); renderRightIceSetSelectors();
      if (redraw) {
        const opened = [...document.querySelectorAll<HTMLDetailsElement>('#inspector details[open]')].map(node => node.querySelector('summary')!.textContent);
        renderInspector();
        document.querySelectorAll<HTMLDetailsElement>('#inspector details').forEach(node => { node.open = opened.includes(node.querySelector('summary')!.textContent); });
      }
    });
    if (disabled) {
      picker.classList.add('field-disabled');
      picker.setAttribute('aria-disabled', 'true');
      picker.title = disabledHint;
      const input = picker.querySelector<HTMLInputElement>('input');
      if (input) { input.disabled = true; input.placeholder = disabledHint; }
    }
    parent.append(picker);
  };
  function getEquippedRightIceSetCounts() {
    const counts = new Map<string, number>();
    for (const selection of data.mapping.selections) {
      if (!selection.catalogFile.endsWith('right-ice.json')) continue;
      const setName = val(selection.selectionCell);
      if (setName) counts.set(setName, (counts.get(setName) ?? 0) + 1);
    }
    return counts;
  }
  function renderRightIceSetSelectors() {
    const root = document.querySelector<HTMLElement>('#right-ice-set-selectors');
    if (!root) return;
    const cells = data.rightIceSets.selectionCells;
    const availableNames = [...new Set(validationChoices(cells[0]).map(option => option.value))];
    const allowedNames = [...availableNames.filter(name => name !== '騎士團'), ...availableNames.filter(name => name === '騎士團')];
    const defaultOrder = new Map(allowedNames.map((name, index) => [name, index]));
    const equippedCounts = getEquippedRightIceSetCounts();
    const selectedNames = cells.map(val);
    root.replaceChildren();
    cells.forEach((cell, index) => {
      const usedElsewhere = new Set(selectedNames.filter((name, other) => other !== index && name !== ''));
      const choices = allowedNames
        .filter(name => !usedElsewhere.has(name) || name === selectedNames[index])
        .sort((left, right) => (equippedCounts.get(right) ?? 0) - (equippedCounts.get(left) ?? 0) || defaultOrder.get(left)! - defaultOrder.get(right)!)
        .map(name => {
          const pieceCount = equippedCounts.get(name) ?? 0;
          return { value: name, label: name, ...(pieceCount > 0 ? { detail: `目前選擇 ${pieceCount} 件` } : {}) };
        });
      const picker = createPicker(`套效選擇 ${index + 1}`, choices, selectedNames[index], value => {
        state.values[cell] = value;
        update();
        renderRightIceSetSelectors();
      });
      const selectedName = selectedNames[index];
      picker.classList.add('right-ice-set-picker', `right-ice-effect-${index + 1}`);
      picker.classList.toggle('has-selection', !!selectedName);
      root.append(picker);
    });
    if (new Set(selectedNames.filter(Boolean)).size !== selectedNames.filter(Boolean).length) {
      const warning = document.createElement('p');
      warning.className = 'input-warning right-ice-selection-warning';
      warning.textContent = '同一套裝不可重複選擇；請清除重複項目。';
      root.append(warning);
    }
  }
          const numeric = (parent: HTMLElement, label: string, cell: string, percentage = true, constraints?: { min?: number; max?: number; step?: number | 'any'; integer?: boolean }, disabled = false) => {
    const wrapper = document.createElement('label'); wrapper.className = 'field'; wrapper.textContent = label;
            const integer = constraints?.integer === true;
            const input = document.createElement('input'); input.type = integer ? 'text' : 'number'; input.step = integer ? '1' : 'any'; input.placeholder = disabled ? '請先選擇屬性' : '請填寫數值';
            if (integer) {
              const maximum = constraints?.max ?? 999;
              input.inputMode = 'numeric'; input.pattern = '[0-9]*'; input.maxLength = String(maximum).length;
              input.autocomplete = 'off'; input.spellcheck = false;
              input.title = `只接受 ${constraints?.min ?? 0}–${maximum} 的整數。`;
            } else {
              preventScientificNotation(input);
            }
    if (constraints?.min !== undefined) input.min = String(constraints.min);
    if (constraints?.max !== undefined) input.max = String(constraints.max);
    if (constraints?.step !== undefined) input.step = String(constraints.step);
    input.value = val(cell) === '' ? '' : String(Number(val(cell)) * (percentage ? 100 : 1));
    if (disabled) { input.disabled = true; wrapper.classList.add('field-disabled'); wrapper.setAttribute('aria-disabled', 'true'); wrapper.title = '請先選擇屬性'; }
            if (integer) {
              const minimum = constraints?.min ?? 0;
              const maximum = constraints?.max ?? 999;
              const isValidInteger = (value: string) => value === '' || /^\d+$/.test(value) && Number(value) >= minimum && Number(value) <= maximum;
              const isValidInsertion = (inserted: string) => {
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                const nextValue = input.value.slice(0, start) + inserted + input.value.slice(end);
                return nextValue.length <= input.maxLength && isValidInteger(nextValue);
              };
              let lastValidValue = input.value;
              input.addEventListener('focus', () => input.select());
              input.addEventListener('keydown', event => {
                if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !isValidInsertion(event.key)) {
                  event.preventDefault();
                  input.setAttribute('aria-invalid', 'true');
                }
              });
              input.addEventListener('beforeinput', event => {
                const inputEvent = event as InputEvent;
                if (inputEvent.inputType.startsWith('insert') && inputEvent.data !== null && !isValidInsertion(inputEvent.data)) {
                  event.preventDefault();
                  input.setAttribute('aria-invalid', 'true');
                }
              });
              input.addEventListener('paste', event => {
                const pasted = event.clipboardData?.getData('text') ?? '';
                if (!isValidInsertion(pasted)) {
                  event.preventDefault();
                  input.setAttribute('aria-invalid', 'true');
                }
              });
              input.addEventListener('drop', event => {
                const dropped = event.dataTransfer?.getData('text') ?? '';
                if (!isValidInsertion(dropped)) {
                  event.preventDefault();
                  input.setAttribute('aria-invalid', 'true');
                }
              });
              input.addEventListener('input', () => {
                if (!isValidInteger(input.value)) {
                  input.value = lastValidValue;
                  input.setAttribute('aria-invalid', 'true');
                  return;
                }
                input.setAttribute('aria-invalid', 'false');
                if (input.value === '') return;
                lastValidValue = input.value;
                state.values[cell] = Number(input.value);
                update();
              });
              input.addEventListener('blur', () => {
                if (input.value === '') input.value = lastValidValue;
                input.setAttribute('aria-invalid', 'false');
              });
            } else {
              input.addEventListener('input', () => {
                if (input.value !== '' && constraints?.min !== undefined && Number(input.value) < constraints.min) {
                  input.value = val(cell) === '' ? '' : String(Number(val(cell)) * (percentage ? 100 : 1));
                  return;
                }
                if (!input.validity.valid) return;
                state.values[cell] = input.value === '' ? '' : Number(input.value) / (percentage ? 100 : 1);
                update();
              });
            }
    wrapper.append(input); parent.append(wrapper);
  };
  const section = (parent: HTMLElement, label: string, open = false) => {
    const details = document.createElement('details'); details.className = 'editor-section'; details.open = open;
    const title = document.createElement('summary'); title.textContent = label; details.append(title); parent.append(details); return details;
  };
  const attributeValueGrid = (parent: HTMLElement, extraClass = '') => {
    const grid = document.createElement('div'); grid.className = extraClass ? 'attribute-value-grid ' + extraClass : 'attribute-value-grid';
    parent.append(grid);
    return grid;
  };
  function renderGlobalInputs() {
    const root = document.querySelector<HTMLElement>('#global-source-fields')!;
    root.replaceChildren();
    const group = (label: string, noteText?: string) => {
      const container = document.createElement('section'); container.className = 'global-input-group';
      const heading = document.createElement('h3'); heading.textContent = label; container.append(heading);
      if (noteText) { const note = document.createElement('p'); note.className = 'global-input-note'; note.textContent = noteText; container.append(note); }
      const grid = document.createElement('div'); grid.className = 'global-input-grid'; container.append(grid); root.append(container); return grid;
    };
    const pick = (container: HTMLElement, label: string, cell: string, entries: readonly { name: string }[]) =>
      field(container, label, cell, options([...new Set(entries.map(entry => entry.name))]));
    const general = group('增益與環境');
    pick(general, '消耗品', 'Effect.Consumable', data.otherEffects.consumables);
    pick(general, '場地', 'Effect.Environment', data.otherEffects.environments);
    pick(general, '巔峰選項', 'Peak.Option', data.otherEffects.peakOptions);
    pick(general, '寵物', 'Pet.Passive', data.pets.options);
    const petSkillToggle = document.createElement('label');
    petSkillToggle.className = 'pet-skill-toggle';
    const petSkillCheckbox = document.createElement('input');
    petSkillCheckbox.type = 'checkbox';
    petSkillCheckbox.checked = state.petSkillAttackEnabled;
    petSkillCheckbox.addEventListener('change', () => { state.petSkillAttackEnabled = petSkillCheckbox.checked; update(); });
    const petSkillLabel = document.createElement('span');
    petSkillLabel.textContent = '寵物具有 2% 雙攻';
    petSkillToggle.append(petSkillCheckbox, petSkillLabel);
    general.append(petSkillToggle);
    for (const effect of data.otherEffects.binaryEffects) pick(general, effect.name, effect.selectorCell, effect.options);
    const portrait = data.otherEffects.portraitAwakening;
    const portraitSection = document.createElement('section');
    portraitSection.className = 'portrait-awakening-fields';
    const portraitHeading = document.createElement('h4');
    portraitHeading.textContent = '立繪、覺醒';
    const portraitNote = document.createElement('p');
    portraitNote.className = 'global-input-note';
    portraitNote.textContent = '輸入任一欄 1–5%，另一欄會自動補足，兩項合計固定為 5%。';
    const portraitGrid = document.createElement('div');
    portraitGrid.className = 'portrait-awakening-grid';
    const portraitInputs = new Map<string, HTMLInputElement>();
    const portraitErrors = new Map<string, HTMLElement>();
    const portraitFields = [
      { cell: portrait.strongCell, otherCell: portrait.transcendenceCell, label: '強烈技傷%' },
      { cell: portrait.transcendenceCell, otherCell: portrait.strongCell, label: '超越技傷%' },
    ] as const;
    for (const entry of portraitFields) {
      const wrapper = document.createElement('label');
      wrapper.className = 'field';
      wrapper.append(document.createTextNode(entry.label));
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = `[${portrait.minPct}-${portrait.maxPct}]`;
      input.maxLength = 1;
      input.placeholder = '';
      input.value = String(state.values[entry.cell] ?? 0);
      input.setAttribute('aria-label', `立繪、覺醒${entry.label}`);
      input.title = `只接受 ${portrait.minPct}–${portrait.maxPct} 的正整數；另一欄會自動補足至 ${portrait.maxTotalPct}%。`;
      const error = document.createElement('small');
      error.className = 'portrait-awakening-error';
      error.setAttribute('role', 'alert');
      error.hidden = true;
      portraitInputs.set(entry.cell, input);
      portraitErrors.set(entry.cell, error);
      const isManualValue = (raw: string) => /^\d$/.test(raw)
        && Number(raw) >= portrait.minPct && Number(raw) <= portrait.maxPct;
      const showError = (message: string) => {
        input.setAttribute('aria-invalid', 'true');
        error.textContent = message;
        error.hidden = false;
      };
      const clearError = () => {
        input.setAttribute('aria-invalid', 'false');
        error.textContent = '';
        error.hidden = true;
      };
      const invalidEntryMessage = `只能輸入 ${portrait.minPct}–${portrait.maxPct} 的正整數。`;
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
        if (!isManualValue(event.key)) {
          event.preventDefault();
          showError(invalidEntryMessage);
        }
      });
      input.addEventListener('beforeinput', event => {
        const inputEvent = event as InputEvent;
        if (inputEvent.inputType.startsWith('insert') && inputEvent.data !== null && !isManualValue(inputEvent.data)) {
          event.preventDefault();
          showError(invalidEntryMessage);
        }
      });
      input.addEventListener('paste', event => {
        const pasted = event.clipboardData?.getData('text') ?? '';
        if (!isManualValue(pasted)) {
          event.preventDefault();
          showError(invalidEntryMessage);
        }
      });
      input.addEventListener('input', () => {
        const raw = input.value;
        if (!isManualValue(raw)) {
          input.value = String(state.values[entry.cell] ?? 0);
          showError(invalidEntryMessage);
          return;
        }
        const value = Number(raw);
        const otherValue = portrait.maxTotalPct - value;
        state.values[entry.cell] = value;
        state.values[entry.otherCell] = otherValue;
        for (const field of portraitFields) {
          const fieldInput = portraitInputs.get(field.cell);
          if (fieldInput) fieldInput.value = String(state.values[field.cell] ?? 0);
          fieldInput?.setAttribute('aria-invalid', 'false');
          const fieldError = portraitErrors.get(field.cell);
          if (fieldError) {
            fieldError.textContent = '';
            fieldError.hidden = true;
          }
        }
        update();
      });
      input.addEventListener('blur', () => {
        input.value = String(state.values[entry.cell] ?? 0);
        clearError();
      });
      wrapper.append(input, error);
      portraitGrid.append(wrapper);
    }
    portraitSection.append(portraitHeading, portraitNote, portraitGrid);
    general.append(portraitSection);
    field(general, '百億/內布隆套效', data.colorSetEffects.selectorCell, options(data.colorSetEffects.options.map(option => option.name)));
    const atma = group('亞特瑪');
    field(atma, '亞特瑪屬性', 'Atma.Element', options(['火焰', '流水', '草木']));
    field(atma, '亞特瑪顏色', 'Atma.Color', options(['藍色', '綠色', '紫色', '米色']));
            const resonance = group('共鳴輸入', '輸入已分配的共鳴點，例如適應力點滿應該填100而非7。');
            const resonanceLimits: Record<string, number> = { 雙攻: 999, 技傷: 100, 適應: 100, 兩極: 50, B傷: 50 };
            for (const effect of data.resonance.effects) {
              numeric(resonance, effect.name, effect.inputCell, false, { min: 0, max: resonanceLimits[effect.name] ?? 999, step: 1, integer: true });
            }
    const spirit = group('賦靈錄');
    const spiritClassCodes = data.spiritRecord.classSelectors.classes.map(entry => entry.classCode);
    const selectedSpiritClassCodes = data.spiritRecord.classSelectors.selectorCells.map(val);
    data.spiritRecord.classSelectors.selectorCells.forEach((cell, index) => {
      const selectedElsewhere = selectedSpiritClassCodes.filter((_, otherIndex) => otherIndex !== index && selectedSpiritClassCodes[otherIndex] !== '');
      const usedElsewhere = new Set(selectedElsewhere.map(code => resolveClassCode(code, spiritClassCodes)?.toLocaleLowerCase()).filter((code): code is string => Boolean(code)));
      const currentCode = resolveClassCode(selectedSpiritClassCodes[index], spiritClassCodes);
      const choices = spiritClassCodes
        .filter(code => !usedElsewhere.has(code.toLocaleLowerCase()) || code === currentCode)
        .map(code => ({ value: code, label: code }));
      const error = document.createElement('span');
      error.className = 'input-hint class-picker-error';
      error.setAttribute('role', 'alert');
      const currentIsDuplicate = Boolean(currentCode && usedElsewhere.has(currentCode.toLocaleLowerCase()));
      error.textContent = currentIsDuplicate ? '職業「' + currentCode + '」已在其他欄位選擇。' : '';
      error.hidden = !currentIsDuplicate;
      const picker = createPicker('職業 ' + (index + 1), choices, val(cell), value => {
        state.values[cell] = value;
        update();
        renderGlobalInputs();
      }, {
        sanitize: sanitizeClassCode,
        resolve: value => {
          const resolved = resolveClassCode(value, spiritClassCodes);
          return resolved && !selectedElsewhere.some(code => resolveClassCode(code, spiritClassCodes)?.toLocaleLowerCase() === resolved.toLocaleLowerCase()) ? resolved : null;
        },
        onInvalid: value => {
          const resolved = resolveClassCode(value, spiritClassCodes);
          error.textContent = resolved && usedElsewhere.has(resolved.toLocaleLowerCase())
            ? '職業「' + resolved + '」已在其他欄位選擇。'
            : value ? '查無此職業代碼，請確認後再按 Enter。' : '請輸入職業代碼。';
          error.hidden = false;
        },
        onInput: () => { error.textContent = ''; error.hidden = true; },
        allowCharacter: character => /^[A-Za-z]$/.test(character),
      });
      const wrapper = document.createElement('div');
      wrapper.className = 'spirit-record-class-field';
      wrapper.append(picker, error);
      spirit.append(wrapper);
    });
    const fountain = group('公會噴泉');
    for (const stage of data.otherEffects.guildFountain) pick(fountain, `${stage.stage}階`, stage.selectorCell, stage.options);
  }
  function renderWeaponMagicStones() {
    const root = document.querySelector<HTMLElement>('#weapon-magic-stone-fields')!;
    root.replaceChildren();
    const grid = document.createElement('div'); grid.className = 'weapon-magic-stone-grid'; root.append(grid);
    const gradePicker = createPicker('武器魔力石', options(data.weaponGrades.options.map(option => option.name)), val(data.weaponGrades.selectorCell), value => {
      state.values[data.weaponGrades.selectorCell] = value;
      applyWeaponMagicStonePreset(value, true);
      update();
      renderWeaponMagicStones();
    });
    gradePicker.classList.add('weapon-magic-stone-grade');
    grid.append(gradePicker);
    data.giantStones.selectorCells.forEach((cell, index) => field(
      grid,
      `巨型魔力石 ${index + 1}`,
      cell,
      data.giantStones.options.map(option => ({ value: option.name, label: option.name })),
    ));
    const colors = document.createElement('div'); colors.className = 'weapon-magic-stone-colors'; root.append(colors);
    for (const colorGroup of data.weaponGrades.colorGroups) {
      const card = document.createElement('section'); card.className = `weapon-magic-stone-color weapon-magic-stone-${colorGroup.id}`;
      const heading = document.createElement('h3'); heading.textContent = `${colorGroup.name}（9 格）`; card.append(heading);
      const slots = document.createElement('div'); slots.className = 'weapon-magic-stone-slots'; card.append(slots);
      colorGroup.selectorCells.forEach((cell, index) => field(
        slots,
        `${index + 1}`,
        cell,
        colorGroup.options.map(option => ({ value: option.name, label: option.name })),
      ));
      colors.append(card);
    }
  }
  function renderMasterBeastColorSelector() {
    const root = document.querySelector<HTMLElement>('#master-beast-controls')!;
    root.replaceChildren();
    const inputs = document.createElement('div'); inputs.className = 'master-beast-control-inputs'; root.append(inputs);
    inputs.append(createPicker(
      '聖獸精靈石顏色',
      options(data.masterBeast.spiritStoneColorSelector.options),
      state.masterBeastSpiritStoneColor ?? data.masterBeast.spiritStoneColorSelector.defaultColor,
      value => { state.masterBeastSpiritStoneColor = value as LoadoutState['masterBeastSpiritStoneColor']; update(); },
    ));
    field(inputs, '聖獸潛力', 'MasterBeast.OverallPotential', options(data.masterBeast.options.filter(option => option.category === 'overall').map(option => option.name)));
  }
  function renderTitleInput() {
    const root = document.querySelector<HTMLElement>('#title-input')!;
    root.replaceChildren();
    field(root, '稱號', 'Effect.Title', options([...new Set(data.otherEffects.titles.map(entry => entry.name))]));
  }
  function renderBeastAccessories() {
    const root = document.querySelector<HTMLElement>('#beast-accessory-fields')!;
    const rightIceEarring = data.layout.slots.find(slot => slot.selectionCell === 'Right.Ice.Earring');
    const rightIceNecklace = data.layout.slots.find(slot => slot.selectionCell === 'Right.Ice.Necklace');
    const rightIceSupport = data.layout.slots.find(slot => slot.selectionCell === 'Right.Ice.Support');
    const accessoryWeapon = data.layout.slots.find(slot => slot.selectionCell === 'Accessory.WeaponAccessory');
    const accessoryRingOne = data.layout.slots.find(slot => slot.selectionCell === 'Accessory.Ring1');
    const accessoryRingTwo = data.layout.slots.find(slot => slot.selectionCell === 'Accessory.Ring2');
    if (rightIceEarring && rightIceNecklace && rightIceSupport && accessoryWeapon && accessoryRingOne && accessoryRingTwo) {
      const rightIceToAccessoryGap = accessoryWeapon.x - rightIceSupport.x;
      const beastCenterX = rightIceEarring.x - rightIceToAccessoryGap;
      const beastRingStep = accessoryRingTwo.x - accessoryRingOne.x;
      const ringOneX = beastCenterX - beastRingStep;
      const canvas = root.closest<HTMLElement>('.equipment-canvas')!;
      canvas.style.setProperty('--beast-accessory-center-x', `${beastCenterX}%`);
      canvas.style.setProperty('--beast-ring-one-x', `${ringOneX}%`);
      canvas.style.setProperty('--beast-ring-two-x', `${beastCenterX}%`);
    }
    root.replaceChildren();
    for (const slot of beastAccessorySlots) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `beast-accessory-slot beast-accessory-slot-${slot.id}`; button.dataset.beastSlotId = slot.id;
      const cells = [...(slot.fixedCells ?? []), ...(slot.stoneCells ?? []), ...slot.mirrorCells.flat()];
      const hasValue = cells.some(cell => val(cell) !== '');
      button.classList.toggle('configured', hasValue);
      button.classList.toggle('selected', selectedBeastSlotId === slot.id);
      button.setAttribute('aria-label', `${slot.label}${hasValue ? '（已設定）' : ''}`);
      button.setAttribute('aria-pressed', String(selectedBeastSlotId === slot.id));
      button.innerHTML = `${icon(slot.icon)}<span>${h(slot.label)}</span>${hasValue ? '<i></i>' : ''}`;
      button.addEventListener('click', () => {
        selectedBeastSlotId = slot.id;
        renderBeastAccessories(); renderInspector(); openMobileInspector();
      });
      root.append(button);
    }
  }
  function renderBeastInspector(panel: HTMLElement) {
    const slot = beastAccessorySlots.find(candidate => candidate.id === selectedBeastSlotId)!;
    panel.innerHTML = `<div class="inspector-title beast-inspector-title"><span class="beast-inspector-icon">${icon(slot.icon)}</span><div><small>聖獸飾品</small><h2>${h(slot.label)}</h2></div><button class="inspector-close" type="button" aria-label="關閉部位設定">×</button></div>`;
    const fixed = section(panel, '固定效果', true);
    if (slot.fixedCells) slot.fixedCells.forEach((cell, index) => field(
      fixed,
      `固定效果 ${index + 1}`,
      cell,
      validationChoices(cell),
    ));
    else fixed.insertAdjacentHTML('beforeend', `<p class="panel-note beast-mapping-note">${h(slot.label)}的鑑定效果與傷害無關，無需設定。</p>`);

    const stone = section(panel, '精靈石', true);
    if (slot.stoneCells && slot.stoneCategory) {
      const [attributeCell, valueCell] = slot.stoneCells;
      const stoneGrid = attributeValueGrid(stone);
      field(stoneGrid, '精靈石屬性', attributeCell, options(data.masterBeast.customAttributeOptions[slot.stoneCategory]), true);
      field(stoneGrid, '精靈石數值（%）', valueCell, validationChoices(valueCell, true), false, val(attributeCell) === '');
    } else {
      stone.insertAdjacentHTML('beforeend', `<p class="panel-note beast-mapping-note">盔甲精靈石的個別屬性不影響傷害，無需設定。精靈石套裝增幅 ${fmt(data.masterBeast.armorSpiritStoneSetEffect.multiplicativeDamagePct)}% 已預設套用。</p>`);
    }

    const mirrorArea = section(panel, '迷鏡效果', true);
    mirrorArea.classList.add('beast-mirror-section');
    const mirrorGrid = attributeValueGrid(mirrorArea, 'beast-mirror-grid');
    slot.mirrorCells.forEach(([attributeCell, valueCell]) => {
      field(mirrorGrid, '迷鏡效果屬性', attributeCell, options(data.masterBeast.customAttributeOptions.mirror), true);
      const valueRule = data.masterBeast.mirrorValueRules.byAttribute[val(attributeCell)] ?? data.masterBeast.mirrorValueRules.default;
      numeric(
        mirrorGrid,
        '迷鏡效果數值（%）',
        valueCell,
        true,
        { min: valueRule.minPct, max: valueRule.maxPct, step: valueRule.stepPct },
      );
    });
  }
  function renderSlots() {
    const container = document.querySelector('#slots')!; container.replaceChildren();
    const rightIceSetEffectIndexes = new Map<string, number>();
    data.rightIceSets.selectionCells.forEach((cell, index) => {
      const setName = val(cell);
      if (setName && !rightIceSetEffectIndexes.has(setName)) rightIceSetEffectIndexes.set(setName, index + 1);
    });
    for (const slot of data.layout.slots) {
      const group = data.layout.groups.find(group => group.id === slot.group)!;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'gear-slot'; button.dataset.slotId = slot.id;
      button.style.cssText = `left:${slot.x}%;top:${slot.y}%;--group-color:${group.color}`;
      const configured = slot.selectionCell ? val(slot.selectionCell) : slot.weapon ? val('Weapon.ENHC') : slot.innerwearId ? val(data.innerwear.slots.find(s => s.id === slot.innerwearId)!.enhancementCell) : '';
      const isAccessory = slot.group === 'accessories';
      const isIceEquipment = slot.group === 'leftIce' || slot.group === 'rightIce' || slot.group === 'iceWeapon';
      const selectedItemName = slot.selectionCell && slot.group !== 'costume' && !isAccessory && configured
        ? isIceEquipment ? ICE_EQUIPMENT_SHORT_NAMES[configured] ?? configured : configured
        : '';
      const isRightIceSetSlot = (slot.group === 'rightIce' || slot.group === 'iceWeapon') && !!slot.selectionCell && !!configured;
      const rightIceEffectIndex = isRightIceSetSlot ? rightIceSetEffectIndexes.get(configured) : undefined;
      const rightIceSetHint = rightIceEffectIndex ? `；屬於套效 ${rightIceEffectIndex}` : '';
      button.classList.toggle('configured', !!configured); button.classList.toggle('selected', selected.id === slot.id);
      button.classList.toggle('inactive', !!slot.enabledBy && !state.lowerwearAlternativeEnabled);
      button.classList.toggle('right-ice-effect-1', rightIceEffectIndex === 1);
      button.classList.toggle('right-ice-effect-2', rightIceEffectIndex === 2);
      button.classList.toggle('right-ice-effect-3', rightIceEffectIndex === 3);
      button.setAttribute('aria-label', `${group.name} ${slot.label}：${configured || '未設定'}${rightIceSetHint}`); button.setAttribute('aria-pressed', String(selected.id === slot.id));
      button.title = `${group.name} ${slot.label}${configured && slot.group !== 'costume' ? '\n' + configured : ''}${rightIceSetHint}`;
      button.innerHTML = `<span class="gear-slot-label">${h(slot.label)}</span>${selectedItemName ? `<span class="gear-slot-item-name">${h(selectedItemName)}</span>` : ''}${configured ? '<i></i>' : ''}`;
      button.addEventListener('click', () => { selected = slot; selectedBeastSlotId = null; renderSlots(); renderBeastAccessories(); renderInspector(); openMobileInspector(); }); container.append(button);
    }
  }
  function renderInspector() {
    const panel = document.querySelector<HTMLElement>('#inspector')!;
    if (selectedBeastSlotId) { renderBeastInspector(panel); return; }
    const group = data.layout.groups.find(group => group.id === selected.group)!;
    const innerwearSlot = selected.innerwearId ? data.innerwear.slots.find(slot => slot.id === selected.innerwearId) : undefined;
    const innerwearType = innerwearSlot && val(innerwearSlot.typeCell) === "內布隆" ? "內布隆" : "百億";
    const typeSwitch = innerwearSlot ? `<div class="innerwear-type-switch" role="group" aria-label="內裝防具類型"><button type="button" data-innerwear-type="百億" aria-pressed="${innerwearType === "百億"}">百億</button><button type="button" data-innerwear-type="內布隆" aria-pressed="${innerwearType === "內布隆"}">內布隆</button></div>` : "";
    panel.innerHTML = `<div class="inspector-title" style="--group-color:${group.color}">${icon(selected.icon)}<div class="inspector-title-copy"><small>${h(group.name)}</small><h2>${h(selected.label)}</h2></div>${typeSwitch}<button class="inspector-close" type="button" aria-label="關閉部位設定">×</button></div>`;
    if (innerwearSlot) panel.querySelectorAll<HTMLButtonElement>("[data-innerwear-type]").forEach(button => button.addEventListener("click", () => {
      state.values[innerwearSlot.typeCell] = button.dataset.innerwearType!;
      update(); renderSlots(); renderInspector();
    }));
    if (selected.enabledBy && !state.lowerwearAlternativeEnabled) { panel.insertAdjacentHTML('beforeend', '<p class="panel-note">請先啟用上方「強/排褲切換」。設定會保留於裝置，停用時不參與計算。</p>'); return; }
    if (selected.selectionCell) {
      const selectionCell = selected.selectionCell;
      const mapping = data.mapping.selections.find(entry => entry.selectionCell === selectionCell)!;
      const slotItems = data.catalogs[mapping.catalogFile].items.filter(item => item.active && item.slotId === mapping.slotId);
      const isRightIceCatalog = mapping.catalogFile.endsWith('right-ice.json');
      const isMysticSetName = (name: string) => name === '神埃' || name === '神秘的埃羅德';
      const isKnightSetName = (name: string) => name === '騎士團' || name === '艾里奧斯守護騎士團';
      const items = isRightIceCatalog
        ? [...slotItems.filter(item => !isMysticSetName(item.name) && !isKnightSetName(item.name)), ...slotItems.filter(item => isMysticSetName(item.name)), ...slotItems.filter(item => isKnightSetName(item.name))]
        : slotItems;
      const isAccessory = mapping.catalogFile === 'equipment/accessories.json';
      field(panel, selected.sharedSelection ? '左冰套裝（五部位共用）' : '選擇裝備', selectionCell, items.map(item => ({ value: item.name, label: item.name, detail: summary(item.stats ?? {}) })), isAccessory);
      if (isAccessory) {
        const appraisalGroup = data.accessoryEffects.groups.find(entry => entry.selectionCell === selectionCell);
        const selectedItem = items.find(item => item.name === val(selectionCell));
        if (selectedItem?.description) {
          const description = document.createElement('p');
          description.className = 'panel-note accessory-item-description';
          description.textContent = selectedItem.description;
          panel.append(description);
        }
        const cannotAppraise = selectedItem?.appraisal?.canAppraise === false;
        if (cannotAppraise) {
          panel.insertAdjacentHTML('beforeend', '<p class="panel-note">此飾品不可鑑定。</p>');
        } else if (appraisalGroup && selectedItem) {
          const appraisal = selectedItem.appraisal;
          if (!appraisal || appraisal.canAppraise === null || appraisal.effectCount === null) {
            panel.insertAdjacentHTML('beforeend', '<p class="panel-note">此飾品的「是否可鑑定」與「鑑定效果條數」尚未設定；未確認前不會套用鑑定效果。更新 <code>data/equipment/accessories.json</code> 後即可啟用。</p>');
          } else if (appraisal.canAppraise && Number.isInteger(appraisal.effectCount) && appraisal.effectCount > 0 && appraisal.effectCount <= appraisalGroup.inputCells.length) {
            const appraisalArea = section(panel, '飾品鑑定', true);
            const itemOptions = appraisalGroup.optionsByEquipmentName?.[selectedItem.name] ?? appraisalGroup.options;
            const choices: PickerOption[] = itemOptions.map((option: AccessoryEffectOption) => ({ value: option.name, label: option.name }));
            appraisalGroup.inputCells.slice(0, appraisal.effectCount).forEach((cell, index) => field(appraisalArea, `鑑定效果 ${index + 1}`, cell, choices));
          } else if (appraisal.canAppraise) {
            panel.insertAdjacentHTML('beforeend', '<p class="input-warning">此飾品的鑑定效果條數資料不正確，請檢查裝備 JSON。</p>');
          }
        }
      }
    }
    if (selected.innerwearId) {
      const slot = data.innerwear.slots.find(slot => slot.id === selected.innerwearId)!;
      field(panel, '強化', slot.enhancementCell, options(Object.keys(data.innerwear.enhancementStats).map(level => 'Lv.' + level)));
      field(panel, '鍛造', slot.forgingCell, options(Object.keys(data.innerwear.forgingAttack)));
      if (innerwearType === '內布隆') {
        const nephronField = data.nephronArmor.fields.find(entry => entry.slotId === slot.id)!;
        const transformationArea = section(panel, '屬性變換', true);
        const transformationGrid = attributeValueGrid(transformationArea, 'nephron-transformation-grid');
        nephronField.transformFields.forEach((transform, index) => {
          const selectedName = val(transform.attributeCell);
          const attribute = data.nephronArmor.transformations.find(entry => entry.name === selectedName);
          const selectedElsewhere = new Set(nephronField.transformFields
            .filter(other => other.attributeCell !== transform.attributeCell)
            .map(other => val(other.attributeCell))
            .filter(Boolean));
          const availableAttributes = data.nephronArmor.transformations
            .filter(entry => !selectedElsewhere.has(entry.name));
          field(transformationGrid, '變換 ' + (index + 1) + ' 屬性', transform.attributeCell,
            availableAttributes.map(entry => ({ value: entry.name, label: entry.name.replace('（依強化等級）', '(×強化)') })), true);
          const tiers = attribute?.tierValuesPct ?? [];
          field(transformationGrid, '變換 ' + (index + 1) + ' 數值（%）', transform.valueCell,
            tiers.map(value => ({ value: String(value / 100), label: value + '%' })),
            true, !selectedName || !tiers.length,
            selectedName === '無關傷害' ? '此屬性無需數值' : '請先選擇屬性');
        });

        const magazineArea = section(panel, '彈匣', true);
        const magazineGrid = attributeValueGrid(magazineArea, 'nephron-magazine-grid');
        const activeNephronFields = data.nephronArmor.fields.filter(entry => {
          if (entry.enabledBy && !state.lowerwearAlternativeEnabled) return false;
          const armor = data.innerwear.slots.find(candidate => candidate.id === entry.slotId);
          return !!armor && val(armor.typeCell) === '內布隆';
        });
        const otherSelections = activeNephronFields.filter(entry => entry.slotId !== nephronField.slotId)
          .map(entry => ({ name: val(entry.magazineCell), level: val(entry.magazineLevelCell) }))
          .filter(entry => entry.name && entry.level);
        const selectedMagazine = val(nephronField.magazineCell);
        const selectedMagazineLevel = val(nephronField.magazineLevelCell);
        const magazineChoices = data.nephronArmor.magazines
          .filter(magazine => !otherSelections.some(entry => entry.name === magazine.name
            && entry.level === selectedMagazineLevel) || magazine.name === selectedMagazine)
          .map(magazine => magazine.name);
        field(magazineGrid, '彈匣種類', nephronField.magazineCell, options(magazineChoices), true);
        const currentMagazine = data.nephronArmor.magazines.find(entry => entry.name === selectedMagazine);
        const availableLevels = data.nephronArmor.levelLabels.filter(level =>
          !otherSelections.some(entry => entry.name === selectedMagazine && entry.level === level)
          || level === selectedMagazineLevel);
        const magazineLevelChoices = availableLevels.map(level => {
          const levelIndex = Number(level.match(/[0-9]+/)?.[0]) - 1;
          const amount = currentMagazine?.levelValuesPct[levelIndex];
          return { value: level, label: level, detail: amount === undefined ? undefined : '數值：' + amount + '%' };
        });
        field(magazineGrid, '彈匣等級', nephronField.magazineLevelCell,
          magazineLevelChoices, true, !selectedMagazine, '請先選擇彈匣');
        if (currentMagazine?.otherEffects?.length) {
          const note = document.createElement('p'); note.className = 'panel-note';
          note.textContent = currentMagazine.otherEffects.join('；'); magazineArea.append(note);
        }
        if (selectedMagazine && selectedMagazineLevel && otherSelections.some(entry =>
          entry.name === selectedMagazine && entry.level === selectedMagazineLevel)) {
          magazineArea.insertAdjacentHTML('beforeend', '<p class="input-warning">相同種類與等級的彈匣不可重複裝備。</p>');
        }
      }
    }
    if (selected.weapon) {
      field(panel, '武器強化', 'Weapon.ENHC', options(Object.keys(data.attack.weaponEnhancementFactors).map(level => `Lv.${level}`)));
      field(panel, '武器成長', data.growth.selectorCell, data.growth.levels.map(level => ({ value: level.name, label: level.name, detail: summary(level.stats) })));
    }
    if (selected.stoneCells?.length) {
      const area = section(panel, '魔法石', true);
      const visibleStoneCells = innerwearSlot && innerwearType === "百億" ? selected.stoneCells.slice(0, 4) : selected.stoneCells;
      for (const [index, cell] of visibleStoneCells.entries()) {
        const mapping = data.mapping.magicStoneSelections.inputGroups.find(entry => entry.selectionCell === cell)!;
        const items = data.catalogs[data.mapping.magicStoneSelections.catalogFile].items.filter(item => item.active);
        field(area, `魔法石 ${index + 1}`, cell, items.map(item => ({ value: getEquipmentOptionName(item, mapping.application), label: getEquipmentOptionName(item, mapping.application), detail: summary(item.targetApplications?.[mapping.application]?.stats ?? item.stats ?? {}) })));
      }
    }
    if (selected.innerwearId) {
      if (innerwearType !== "內布隆") {
        const appraisal = data.appraisals.slots.find(slot => slot.id === selected.innerwearId)!;
        const area = section(panel, '鑑定'); appraisal.inputCells.forEach((cell, i) => field(area, `鑑定 ${i + 1}`, cell, data.appraisals.options.map(option => ({ value: option.name, label: option.name }))));
      }
      const circuit = data.circuits.inputs.find(slot => slot.slot === selected.innerwearId)!;
      const board = section(panel, '電路板');
      if (circuit.slot !== 'gloves') {
        const boardGrid = attributeValueGrid(board);
        field(boardGrid, '電路板項目', circuit.attributeCell, circuitAttributeOptions(circuit), true);
        numeric(boardGrid, '電路板數值（%）', circuit.valueCell, true, undefined, val(circuit.attributeCell) === '');
      } else {
        const note = document.createElement('p');
        note.className = 'panel-note circuit-board-limit-note';
        note.textContent = '可依需求新增或移除項目列；所有列的數值總和上限為 18.0%。';
        const rowList = document.createElement('div');
        rowList.className = 'circuit-board-rows';
        const totalStatus = document.createElement('p');
        totalStatus.className = 'circuit-board-total';
        totalStatus.setAttribute('aria-live', 'polite');
        const actions = document.createElement('div');
        actions.className = 'circuit-board-actions';
        const addRowButton = document.createElement('button');
        addRowButton.type = 'button';
        addRowButton.className = 'circuit-board-add';
        addRowButton.textContent = '新增電路板列';
        actions.append(addRowButton);
        board.append(note, rowList, totalStatus, actions);

        const readRows = () => readGloveCircuitRows(state.values, circuit.attributeCell, circuit.valueCell);
        const storeRows = (rows: ReturnType<typeof readRows>) => {
          state.values[GLOVE_CIRCUIT_ROWS_FIELD] = serializeGloveCircuitRows(rows);
        };
        const refreshTotal = (rows: ReturnType<typeof readRows>) => {
          const totalPct = gloveCircuitRowsTotal(rows) * 100;
          if (totalPct > 18 + 1e-9) {
            totalStatus.textContent = '目前總和 ' + fmt(totalPct) + '%，已超過 18.0% 上限。';
            totalStatus.classList.add('input-warning');
          } else {
            totalStatus.textContent = '目前總和：' + fmt(totalPct) + '% / 18.0%';
            totalStatus.classList.remove('input-warning');
          }
          [...rowList.querySelectorAll<HTMLInputElement>('input[type="number"]')].forEach((input, index) => {
            const otherTotalPct = rows.reduce((total, row, rowIndex) => total + (rowIndex === index ? 0 : (row.percentageValue ?? 0) * 100), 0);
            input.max = String(Math.max(0, 18 - otherTotalPct));
          });
        };
        const renderCircuitRows = () => {
          const rows = readRows();
          rowList.replaceChildren();
          rows.forEach((row, index) => {
            const rowElement = document.createElement('div');
            rowElement.className = 'circuit-board-row';
            const picker = createPicker('電路板項目 ' + (index + 1), options(circuit.attributeOptions), row.attribute, value => {
              rows[index] = { ...rows[index], attribute: value, percentageValue: value ? rows[index].percentageValue : null };
              storeRows(rows);
              update();
              renderCircuitRows();
            });
            rowElement.append(picker);

            const valueField = document.createElement('label');
            valueField.className = 'field circuit-board-value';
            valueField.append(document.createTextNode('電路板數值 ' + (index + 1) + '（%）'));
            const input = document.createElement('input');
            input.type = 'number';
            preventScientificNotation(input);
            input.min = '0';
            input.step = 'any';
            input.placeholder = row.attribute ? '請填寫數值' : '請先選擇屬性';
            input.value = row.percentageValue === null ? '' : String(row.percentageValue * 100);
            input.disabled = !row.attribute;
            valueField.append(input);
            rowElement.append(valueField);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'circuit-board-remove';
            removeButton.textContent = '移除';
            removeButton.setAttribute('aria-label', '移除第 ' + (index + 1) + ' 列電路板');
            removeButton.disabled = rows.length === 1;
            removeButton.title = rows.length === 1 ? '至少保留一列' : '移除此列';
            removeButton.addEventListener('click', () => {
              rows.splice(index, 1);
              storeRows(rows);
              update();
              renderCircuitRows();
              addRowButton.focus();
            });
            rowElement.append(removeButton);
            rowList.append(rowElement);

            input.addEventListener('input', () => {
              const percentageValue = input.value === '' ? null : Number(input.value) / 100;
              if (percentageValue !== null && (!Number.isFinite(percentageValue) || percentageValue < 0)) {
                input.setCustomValidity('數值不得小於 0。');
                totalStatus.textContent = '電路板數值不得小於 0%。';
                totalStatus.classList.add('input-warning');
                return;
              }
              const candidateRows = rows.map((entry, rowIndex) => rowIndex === index ? { ...entry, percentageValue } : entry);
              const totalPct = gloveCircuitRowsTotal(candidateRows) * 100;
              if (totalPct > 18 + 1e-9) {
                input.setCustomValidity('所有列的總和不可超過 18.0%。');
                totalStatus.textContent = '總和將達 ' + fmt(totalPct) + '%，不可超過 18.0%。';
                totalStatus.classList.add('input-warning');
                return;
              }
              input.setCustomValidity('');
              rows[index] = { ...rows[index], percentageValue };
              storeRows(rows);
              update();
              refreshTotal(rows);
            });
          });
          refreshTotal(rows);
        };
        addRowButton.addEventListener('click', () => {
          const rows = readRows();
          rows.push({ attribute: '', percentageValue: null });
          storeRows(rows);
          update();
          renderCircuitRows();
          rowList.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
        });
        renderCircuitRows();
      }
      const conditionalCircuitConflict = lowerwearConditionalCircuitConflict();
      if (conditionalCircuitConflict && (circuit.slot === "lowerwear" || circuit.slot === "lowerwearAlternative")) {
        const warning = document.createElement("p");
        warning.className = "input-warning";
        warning.textContent = "下衣與強/排褲不可同時選擇「" + conditionalCircuitConflict + "」。請讓兩套配置分別使用「強者%」與「排熱%」，以符合 Boss 體力切換條件。";
        board.append(warning);
      }
      const chip = data.chipSlots.slots.find(slot => slot.id === selected.innerwearId)!;
      const chipArea = section(panel, '芯片與芯片調校');
      const chipGrid = attributeValueGrid(chipArea);
      field(chipGrid, '芯片屬性', chip.attributeCell, chipAttributeOptions(chip), true);
      const chosen = data.chips.chips.find(entry => entry.name === val(chip.attributeCell));
      field(chipGrid, '芯片調校等級', chip.tuningCell, options(chosen?.tuningLevels.map(level => level.level) ?? []), false, val(chip.attributeCell) === '');
      const conditionalChipConflict = lowerwearConditionalChipConflict();
      if (conditionalChipConflict && (chip.id === "lowerwear" || chip.id === "lowerwearAlternative")) {
        const warning = document.createElement("p");
        warning.className = "input-warning";
        warning.textContent = "下衣與強/排褲不可同時使用「" + conditionalChipConflict + "」芯片。請讓兩套配置分別使用「強者%」與「排熱%」，以符合 Boss 體力切換條件。";
        chipArea.append(warning);
      }
    }
    if (selected.weapon) {
      const appraisal = section(panel, '武器鑑定'); Object.values(data.weaponAppraisals.groups).forEach((group, i) => field(appraisal, `鑑定 ${i + 1}`, group.selectorCell, group.options.map(option => ({ value: option.name, label: option.name }))));
      const transform = section(panel, '武器變換');
      const transformationGrid = attributeValueGrid(transform, 'weapon-transformation-grid');
      data.transformations.slots.forEach((slot, i) => {
        const selectedElsewhere = new Set(data.transformations.slots
          .filter(other => other.choiceCell !== slot.choiceCell)
          .map(other => val(other.choiceCell))
          .filter(Boolean));
        const availableOptions = data.transformations.options.filter(option => !selectedElsewhere.has(option));
        field(transformationGrid, `變換 ${i + 1}`, slot.choiceCell, options(availableOptions), true);
        const percentage = data.transformations.rules.find(rule => rule.choice === val(slot.choiceCell))?.valueMultiplier !== 1;
        numeric(transformationGrid, `變換 ${i + 1} 數值${percentage ? '（%）' : '（等級）'}`, slot.valueCell, percentage);
      });
    }
  }
  function renderCalculationComparison(
    currentResult: ReturnType<typeof projectDamage>['result'] | undefined,
    baselineResult: ReturnType<typeof projectDamage>['result'] | undefined,
  ) {
    const target = document.querySelector<HTMLElement>('#calculation-comparison')!;
    if (!currentResult) {
      target.innerHTML = '<p>目前配裝的輸入尚未完成或無法計算，修正後即可與比較基準對照。</p>';
      return;
    }
    if (!baselineResult) {
      target.innerHTML = `<p>${baseline ? '已設定的比較基準目前無法計算，請重新設定基準。' : '先點選「設為比較基準」保存目前配置，表格就會比較基準與目前配裝。'}</p>`;
      return;
    }
    const rows = compareLoadoutResults(currentResult, baselineResult);

    const precise = (value: number) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 10 }).format(value);
    const visiblePrecise = (value: number) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).format(value);
    const displayComparisonValue = (row: typeof rows[number], value: number) => {
      if (row.key === 'critRate' || row.key === 'extremizationRate') return `${precise(value * 100)}%`;
      return row.key === 'finalDamage' ? visiblePrecise(value) : precise(value);
    };
    const displayComparisonDelta = (row: typeof rows[number]) => {
      const sign = row.delta > 0 ? '+' : '';
      if (row.key === 'critRate' || row.key === 'extremizationRate') return `${sign}${precise(row.delta * 100)}%`;
      return `${sign}${row.key === 'finalDamage' ? visiblePrecise(row.delta) : precise(row.delta)}`;
    };
    const activeAttackType = data.classes.classes.find(entry => entry.id === state.Job)?.attackType;
    const visibleRows = rows.filter(row =>
      (!['physicalAttack', 'magicalAttack'].includes(row.key)
        || row.key === (activeAttackType === 'physical' ? 'physicalAttack' : 'magicalAttack'))
      && (!['weaponPhysicalBase', 'weaponMagicalBase'].includes(row.key)
        || row.key === (activeAttackType === 'physical' ? 'weaponPhysicalBase' : 'weaponMagicalBase')),
    );
    const mismatches = visibleRows.filter(row => !row.matches);
    const table = (items: typeof rows) => `<div class="calculation-comparison-scroll"><table><thead><tr><th>項目</th><th>基準配置</th><th>目前配置</th><th>差異</th></tr></thead><tbody>${items.map(row => {
      const rowClass = row.matches ? '' : `calculation-comparison-difference ${row.delta > 0 ? 'calculation-comparison-positive' : row.delta < 0 ? 'calculation-comparison-negative' : ''}`;
      return `<tr class="${rowClass}"><th scope="row">${h(row.label)}</th><td>${displayComparisonValue(row, row.expected)}</td><td>${displayComparisonValue(row, row.actual)}</td><td class="${row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}">${displayComparisonDelta(row)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    const differences = mismatches.length ? table(mismatches) : '<p>目前配置與比較基準的計算值相同。</p>';
    target.innerHTML = `<p>依比較基準與目前配裝的未格式化數值比對 ${visibleRows.length} 項：${visibleRows.length - mismatches.length} 項相同、${mismatches.length} 項不同。</p>${differences}<details><summary>查看全部比較值（${visibleRows.length} 項）</summary>${table(visibleRows)}</details>`;
  }
  function renderResults() {
    const target = document.querySelector('#results')!;
      let currentDamage: ReturnType<typeof projectDamage> | null = null;
      let baselineDamage: ReturnType<typeof projectDamage> | null = null;
      let damageCalculationError: unknown;
      try { currentDamage = projectDamage(data, state); } catch (error) { damageCalculationError = error; }
      baselineIsValid = false;
      if (baseline) {
        try {
          projectAttributes(data, baseline);
          baselineIsValid = true;
        } catch { /* Keep current attributes visible if the saved build is stale. */ }
        try { baselineDamage = projectDamage(data, baseline); } catch { /* Damage can be unavailable while the saved configuration is still restorable. */ }
      }
      if (!currentDamage) renderCalculationComparison(undefined, baselineDamage?.result);
      const equipmentDamageSummary = document.querySelector<HTMLElement>('#equipment-damage-summary')!;
      const baselineFinalDamage = baselineDamage?.result.finalDamage.finalDamage;
      const currentFinalDamage = currentDamage?.result.finalDamage.finalDamage;
      const summaryDamageNumber = (value: number) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).format(value);
      const summaryPercent = (value: number) => new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
      const damageGainRatio = baselineFinalDamage !== undefined && currentFinalDamage !== undefined && baselineFinalDamage !== 0
        ? currentFinalDamage / baselineFinalDamage - 1
        : undefined;
      const damageGain = damageGainRatio === undefined ? '—' : summaryPercent(damageGainRatio * 100) + '%';
      const damageGainClass = damageGainRatio === undefined || damageGainRatio === 0 ? '' : damageGainRatio > 0 ? 'gain-positive' : 'gain-negative';
      equipmentDamageSummary.innerHTML = '<div class="equipment-damage-card"><span>基準配置</span><strong>' + (baselineFinalDamage === undefined ? '—' : summaryDamageNumber(baselineFinalDamage)) + '</strong></div><div class="equipment-damage-card"><span>新配置</span><strong>' + (currentFinalDamage === undefined ? '—' : summaryDamageNumber(currentFinalDamage)) + '</strong></div><div class="equipment-damage-card equipment-damage-gain"><span>增幅</span><strong class="' + damageGainClass + '">' + damageGain + '</strong></div>';
    try {
      const current = projectAttributes(data, state); let before: ReturnType<typeof projectAttributes> | null = null;
      try { if (baseline) before = projectAttributes(data, baseline); } catch { /* Old data cannot hide current results. */ }
    document.querySelector('#comparison-label')!.textContent = before ? '與已儲存配置比較' : baseline ? '比較基準已不適用目前資料，請重新設定' : '可儲存目前配置作為比較基準';

      let currentCombatRates: ReturnType<typeof projectCombatRates> | null = null;
      try { currentCombatRates = projectCombatRates(data, state); } catch { /* Show other attributes even if rate inputs are incomplete. */ }
    const currentClass = data.classes.classes.find(entry => entry.id === state.Job);
    const baselineClass = baseline ? data.classes.classes.find(entry => entry.id === baseline?.Job) : undefined;
    const critDamageSupplement = (damage: ReturnType<typeof projectDamage> | null) => damage
      ? damage.result.classCritDamagePassivePct + damage.result.multiplicativeCritDamage.value * 100
      : 0;
    const attackKey = currentClass?.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    const baselineAttackKey = baselineClass?.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    const visibleStats = Object.entries(current.stats)
      .filter(([key]) => !['physicalAttack', 'magicalAttack', 'critRatePct', 'extremizationPct', 'strongerPct', 'heatPct'].includes(key))
      .map(([key, stat]) => ({ key, stat, previousStat: before?.stats[key] }));
    const superAdaptabilityIndex = visibleStats.findIndex(entry => entry.key === 'superAdaptabilityPct');
    if (superAdaptabilityIndex >= 0) {
      const [superAdaptability] = visibleStats.splice(superAdaptabilityIndex, 1);
      const adaptabilityIndex = visibleStats.findIndex(entry => entry.key === 'adaptabilityPct');
      visibleStats.splice(adaptabilityIndex < 0 ? visibleStats.length : adaptabilityIndex + 1, 0, superAdaptability);
    }
    const attackStat = current.stats[attackKey];
    if (attackStat) {
      visibleStats.unshift({ key: 'attackPower', stat: attackStat, previousStat: before?.stats[baselineAttackKey] });
    }
    const percentFormat = (value: number) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).format(value);
    const signedDelta = (value: number, format: (value: number) => string, suffix = '') => { const magnitude = format(Math.abs(value)); return magnitude === format(0) ? '' : (value > 0 ? '+' : '−') + magnitude + suffix; };
    const finalDamageFormat = (value: number) => {
      const parts = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).formatToParts(value);
      const integer = parts.filter(part => part.type !== 'decimal' && part.type !== 'fraction').map(part => part.value).join('');
      const decimal = parts.filter(part => part.type === 'decimal' || part.type === 'fraction').map(part => part.value).join('');
      return `<span class="damage-integer">${h(integer)}</span>${decimal ? `<span class="damage-decimal">${h(decimal)}</span>` : ''}`;
    };
    const probabilityCapWarning = (valueBeforeCap: number) => {
      const overflow = capOverflowPercentage(valueBeforeCap * 100, 100);
      return overflow === null ? '' : `<small class="cap-overflow" role="status">超出上限 ${fmt(overflow)}%</small>`;
    };
    const combatRateCards = currentCombatRates
      ? `<div class="combat-rate-pair"><div class="stat"><p>實戰致命一擊機率</p><strong>${fmt(currentCombatRates.critRate.finalRate * 100)}%</strong>${probabilityCapWarning(currentCombatRates.critRate.valueBeforeUpperCap)}</div><div class="stat"><p>實戰極大化</p><strong>${fmt(currentCombatRates.extremization.finalRate * 100)}%</strong>${probabilityCapWarning(currentCombatRates.extremization.valueBeforeUpperCap)}</div></div>`
      : `<div class="combat-rate-pair"><div class="stat"><p>實戰致命一擊機率</p><strong>待補輸入</strong><small class="input-hint">${h(calculationIssue(damageCalculationError))}</small></div><div class="stat"><p>實戰極大化</p><strong>待補輸入</strong><small class="input-hint">${h(calculationIssue(damageCalculationError))}</small></div></div>`;
    const conditionalDamageCard = (label: string, valuePct: number, sources: readonly { sourceId: string; valuePct: number }[], previousValuePct: number | undefined) => {
      const delta = previousValuePct === undefined ? null : valuePct - previousValuePct;
      const deltaText = delta === null ? '' : signedDelta(delta, percentFormat, '%');
      const deltaClass = delta === null || delta === 0 ? '' : delta > 0 ? 'positive' : 'negative';
      const deltaBadge = deltaText ? '<small class="' + deltaClass + '">' + deltaText + '</small>' : '';
      return '<details class="stat conditional-stat"><summary><span>' + h(label) + '</span><strong>' + fmt(valuePct) + '%</strong>' + deltaBadge + '</summary><div class="stat-details"><p class="stat-detail-heading">來源</p>' + (sourceRows(sources, true) || '<p class="stat-source-empty">目前沒有此條件的額外來源</p>') + '<p class="stat-average">來源合計 ' + fmt(valuePct) + '%</p></div></details>';
    };
    const baselineConditionalDamage = baselineDamage?.result.attributes.conditionalDamage;
    const conditionalDamageCards = '<div class="conditional-damage-pair">' + conditionalDamageCard('強者（Boss 體力 > 50%）', current.conditionalDamage.strongerPct, current.conditionalDamage.strongerSources, baselineConditionalDamage?.strongerPct) + conditionalDamageCard('排熱（Boss 體力 ≤ 50%）', current.conditionalDamage.heatPct, current.conditionalDamage.heatSources, baselineConditionalDamage?.heatPct) + '</div>';
    const multiplicativeDeltaValue = currentDamage && baselineDamage
      ? currentDamage.result.generalMultiplicativeDamage.value - baselineDamage.result.generalMultiplicativeDamage.value
      : null;
    const multiplicativeDeltaText = multiplicativeDeltaValue === null ? '' : signedDelta(multiplicativeDeltaValue, fmt, '×');
    const multiplicativeDeltaBadge = multiplicativeDeltaText
      ? '<small class="' + (multiplicativeDeltaValue! > 0 ? 'positive' : 'negative') + '">' + multiplicativeDeltaText + '</small>'
      : '';
    const multiplicativeEffectCard = currentDamage
      ? `<details class="stat"><summary><span>乘算效果</span><strong>×${fmt(currentDamage.result.generalMultiplicativeDamage.value)}</strong>${multiplicativeDeltaBadge}</summary><div class="stat-details">${currentDamage.result.generalMultiplicativeDamage.factors.length
        ? currentDamage.result.generalMultiplicativeDamage.factors.map(effect => `<p class="stat-source-row"><span>${h(sourceLabel(effect.sourceId))}</span><strong>×${fmt(effect.factor)}</strong></p>`).join('')
        : '<p class="stat-source-empty">目前沒有額外乘算來源</p>'}<p class="stat-average">乘算效果總倍率 ×${fmt(currentDamage.result.generalMultiplicativeDamage.value)}</p></div></details>`
      : `<div class="stat"><p>乘算效果</p><strong>待補輸入</strong><small class="input-hint">${h(calculationIssue(damageCalculationError))}</small></div>`;
    const innerwearOrder = new Map(data.innerwear.slots.map((slot, index) => [`innerwear:${slot.id}`, index]));
    target.innerHTML = `<div class="stat-list">${visibleStats.map(({ key, stat, previousStat }) => {
      const meta = data.attributes.attributes.find(entry => entry.key === key);
      const isPercent = meta?.unit === 'percent';
      const isCritDamage = key === 'critDamagePct';
      const currentSupplement = isCritDamage ? critDamageSupplement(currentDamage) : 0;
      const previousSupplement = isCritDamage ? critDamageSupplement(baselineDamage) : 0;
      const displayTotal = stat.finalTotal + currentSupplement;
      const previous = (previousStat?.finalTotal ?? 0) + previousSupplement;
      const delta = before && (!isCritDamage || (currentDamage && baselineDamage)) ? displayTotal - previous : null;
      const deltaText = delta === null ? '' : signedDelta(delta, isPercent ? percentFormat : fmt, isPercent ? '%' : '');
      const relativeDeltaText = delta === null || previous === 0 ? '' : signedDelta(delta / previous * 100, percentFormat, '%');
      const comparison = delta === null ? '' : !deltaText ? '<p>與基準配置相同。</p>' : '<p>基準 ' + fmt(previous) + (isPercent ? '%' : '') + ' → 目前 ' + fmt(displayTotal) + (isPercent ? '%' : '') + '；差異 ' + deltaText + (relativeDeltaText ? '；相對變化 ' + relativeDeltaText : '') + '</p>';
      const deltaBadge = deltaText ? '<small class="' + (delta !== null && delta > 0 ? 'positive' : 'negative') + '">' + deltaText + '</small>' : '';
      const shownName = key === 'attackPower' ? '攻擊力' : meta?.name ?? key;
      const attributeOverflow = stat.cap === undefined ? null : capOverflowPercentage(stat.totalBeforeCap, stat.cap);
      const attributeCapWarning = attributeOverflow === null
        ? ''
        : `<small class="cap-overflow" role="status">超出上限 ${fmt(attributeOverflow)}%</small>`;
      const lowerwearAverageLabel = state.lowerwearAlternativeEnabled ? '下衣+強/排褲平均' : '下衣配置';
      const lowerwearAverage = stat.lowerwearAverage + currentSupplement;
      const allCommonSources = [...stat.sharedSources, ...stat.lowerwearASources];
      const firstInnerwearIndex = allCommonSources.findIndex(source => innerwearOrder.has(source.sourceId));
      const innerwearSources = allCommonSources
        .filter(source => innerwearOrder.has(source.sourceId))
        .sort((left, right) => innerwearOrder.get(left.sourceId)! - innerwearOrder.get(right.sourceId)!);
      const commonSources = allCommonSources.filter(source => !innerwearOrder.has(source.sourceId));
      if (firstInnerwearIndex >= 0) commonSources.splice(Math.min(firstInnerwearIndex, commonSources.length), 0, ...innerwearSources);
      else commonSources.push(...innerwearSources);
      const passiveSourceRow = isCritDamage && currentDamage && currentDamage.result.classCritDamagePassivePct > 0
        ? `<p class="stat-source-row"><span>${h(currentClass?.id ?? state.Job)}自身技能</span><strong>+${fmt(currentDamage.result.classCritDamagePassivePct)}%</strong></p>`
        : '';
      const sharedDetails = commonSources.length || passiveSourceRow
        ? `<p class="stat-detail-heading">共同來源</p>${sourceRows(commonSources, isPercent)}${passiveSourceRow}`
        : '';
      const critDamageBaseFactor = currentDamage?.result.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'character-base:crit-damage-product')?.factor ?? 1.5;
      const critDamageBaselinePct = currentDamage?.result.multiplicativeCritDamage.baselinePct ?? 150;
      const critDamageDetails = isCritDamage && currentDamage
        ? `<p class="stat-detail-heading">乘算來源</p><p class="stat-source-row"><span>乘算暴傷增幅（角色基底 ${fmt(critDamageBaseFactor * 100)}% 扣除 ${fmt(critDamageBaselinePct)}% 基準後）</span><strong>+${fmt(currentDamage.result.multiplicativeCritDamage.value * 100)}%</strong></p>${currentDamage.result.multiplicativeCritDamage.factors.filter(effect => effect.sourceId !== 'character-base:crit-damage-product').map(effect => `<p class="stat-source-row"><span>${h(sourceLabel(effect.sourceId))}</span><strong>×${fmt(effect.factor)}</strong></p>`).join('')}`
        : '';
      const lowerwearBDetails = state.lowerwearAlternativeEnabled && stat.lowerwearBSources.length ? `<p class="stat-detail-heading">強/排褲來源</p>${sourceRows(stat.lowerwearBSources, isPercent)}` : '';
      return `<details class="stat"><summary><span>${h(shownName)}</span><strong>${fmt(displayTotal)}${isPercent ? '%' : ''}</strong>${attributeCapWarning}${deltaBadge}</summary><div class="stat-details">${sharedDetails}${critDamageDetails}${lowerwearBDetails}<p class="stat-average">${lowerwearAverageLabel} ${fmt(lowerwearAverage)}${isPercent ? '%' : ''}</p>${comparison}</div></details>`;
    }).join('')}${conditionalDamageCards}${multiplicativeEffectCard}${combatRateCards}</div>`;
      const damageTarget = document.querySelector('#damage-result')!;
      try {
        if (!currentDamage) throw damageCalculationError;
        const { result } = currentDamage;
        renderCalculationComparison(result, baselineDamage?.result);
        let damageRatioHtml = '';
        if (baseline && before) {
          let damageRatio: number | null = null;
          try {
            const previous = projectDamage(data, baseline).result;
            damageRatio = previous.finalDamage.finalDamage === 0
              ? null
              : result.finalDamage.finalDamage / previous.finalDamage.finalDamage * 100;
          } catch { /* Keep the current damage visible when a saved baseline is stale. */ }
          const damageDifference = damageRatio === null ? null : damageRatio - 100;
          const damageDifferenceClass = damageDifference === null || damageDifference === 0 ? '' : damageDifference > 0 ? 'positive' : 'negative';
          const damageRatioClass = damageDifference === null || damageDifference === 0 ? '' : damageDifference > 0 ? 'damage-ratio-positive' : 'damage-ratio-negative';
          const damageDifferenceLabel = damageDifference === null ? '—' : (damageDifference > 0 ? '+' : '') + percentFormat(damageDifference) + '%';
          damageRatioHtml = '<div class="damage-ratio ' + damageRatioClass + '"><div class="damage-ratio-group"><span>新配置是舊配置的</span><strong>' + (damageRatio === null ? '無法計算' : percentFormat(damageRatio) + '%') + '</strong></div><div class="damage-ratio-group"><span>與基準差異</span><strong class="' + damageDifferenceClass + '">' + damageDifferenceLabel + '</strong></div></div>';
        }
        const rateSources = (effects: typeof result.combatRates.critRate.multipliers) => effects.map(effect => `${sourceLabel(effect.sourceId)} ×${fmt(effect.factor)}`).join(' · ') || '無';
        const critDamageBaseFactor = result.multiplicativeCritDamage.factors.find(effect => effect.sourceId === 'character-base:crit-damage-product')?.factor ?? 1.5;
        const critDamageFactors = result.multiplicativeCritDamage.factors.filter(effect => effect.sourceId !== 'character-base:crit-damage-product');
        const critDamageMultiplier = critDamageFactors.map(effect => `×${fmt(effect.factor)}（${sourceLabel(effect.sourceId)}）`).join('、') || '無額外來源';
        const critDamageCalculation = `角色基底 ${fmt(critDamageBaseFactor * 100)}%（×${fmt(critDamageBaseFactor)}）${critDamageFactors.map(effect => ` ×${fmt(effect.factor)}`).join('')} − ${fmt(result.multiplicativeCritDamage.baselinePct)}% 基準 = +${fmt(result.multiplicativeCritDamage.value * 100)}%`;
        damageTarget.innerHTML = `<div class="damage-summary"><div><span>最小攻擊力</span><strong>${fmt(result.attack.lowerDamage)}</strong></div><div><span>最大攻擊力</span><strong>${fmt(result.attack.upperDamage)}</strong></div><div class="final-damage"><span>最終傷害</span><strong>${finalDamageFormat(result.finalDamage.finalDamage)}</strong></div></div>${damageRatioHtml}`;
        const skillWeighting = result.finalDamage.skillDamageWeighting;
        const skillWeightingText = `超越 ${fmt(skillWeighting.transcendenceSharePct)}% ×${fmt(skillWeighting.transcendenceFactor)} + 強烈 ${fmt(skillWeighting.strongSharePct)}% ×${fmt(skillWeighting.strongFactor)} = ×${fmt(skillWeighting.combinedFactor)}`;
        const calculationDetailsTarget = document.querySelector<HTMLElement>("#calculation-details")!;
        const formulaWasOpen = calculationDetailsTarget.querySelector<HTMLDetailsElement>(".formula-detail")?.open ?? false;
        calculationDetailsTarget.innerHTML = `<details class="formula-detail"${formulaWasOpen ? ' open' : ''}><summary>展開傷害計算明細</summary><p>強烈／超越技傷加權：${h(skillWeightingText)}</p><p>致命傷害被動：${fmt(result.classCritDamagePassivePct)}%　乘算暴傷增幅：+${fmt(result.multiplicativeCritDamage.value * 100)}%</p><p>乘算暴傷計算：${h(critDamageCalculation)}</p><p>乘算暴傷來源：${h(critDamageMultiplier)}</p><p>爆擊乘算來源：${h(rateSources(result.combatRates.critRate.multipliers))}</p><p>極大乘算來源：${h(rateSources(result.combatRates.extremization.multipliers))}</p><p>乘算傷害：${fmt(result.generalMultiplicativeDamage.value)} 倍　強者／排熱因子：${fmt(result.finalDamage.conditionalFactor)}</p><p>適應力因子：${fmt(result.finalDamage.adaptationFactor)}　防禦因子：${fmt(result.finalDamage.defenseFactor)}</p></details>`;
      } catch (error) {
        damageTarget.innerHTML = `<p class="input-warning">尚未計算：${h(calculationIssue(error))}請完成後再試。</p>`;
        document.querySelector('#calculation-details')!.replaceChildren();
      }
    } catch (error) {
      const message = h(calculationIssue(error));
      target.innerHTML = `<p class="input-warning" role="status">${message}</p>`;
      document.querySelector('#damage-result')!.innerHTML = `<p class="input-warning">尚未計算：${message}</p>`;
      document.querySelector('#calculation-details')!.replaceChildren();
    }
  }
  const renderClassPicker = () => {
    const root = document.querySelector<HTMLElement>('#class-picker')!;
    const activeClasses = data.classes.classes.filter(entry => entry.active);
    const classCodes = activeClasses.map(entry => entry.id);
    const error = document.createElement('span');
    error.className = 'input-hint class-picker-error';
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const picker = createPicker('職業', activeClasses.map(entry => ({ value: entry.id, label: entry.name })), state.Job, value => { state.Job = value; error.textContent = ''; error.hidden = true; update(); }, {
      sanitize: sanitizeClassCode,
      resolve: value => resolveClassCode(value, classCodes),
      onInvalid: value => { error.textContent = value ? '查無此職業代碼，請確認後再按 Enter。' : '請輸入職業代碼。'; error.hidden = false; },
      onInput: () => { error.textContent = ''; error.hidden = true; },
      allowCharacter: character => /^[A-Za-z]$/.test(character),
    });
    const input = picker.querySelector<HTMLInputElement>('input');
    if (input) input.placeholder = '輸入職業代碼（例如 DaB）';
    root.replaceChildren(picker, error);
  };
  renderClassPicker();
  renderSkillDamageShare();
  const toggle = document.querySelector<HTMLInputElement>('#alternate')!; toggle.checked = state.lowerwearAlternativeEnabled;
  const battle = document.querySelector<HTMLElement>('#battle-settings')!;
  const renderBattleSettings = () => {
    battle.replaceChildren();
    for (const [fieldId, label] of [['Stage.Adapt','關卡適應力'],['Stage.CritRatePenalty','關卡扣致命'],['Stage.BossDEF','Boss防禦']] as const) {
      const catalog = findValidationCatalog(data.simulatorInputs.inputs, data.simulatorInputs.catalogs, fieldId);
      const error = document.createElement('span');
      error.className = 'input-hint class-picker-error';
      error.hidden = true;
      error.setAttribute('role', 'alert');
      const picker = createPicker(label, options((catalog?.options ?? []).map(option => String(option.value))), val(fieldId), value => { state.values[fieldId] = value; error.textContent = ''; error.hidden = true; update(); }, {
        sanitize: sanitizeUnsignedInteger,
        resolve: resolveUnsignedInteger,
        onInvalid: () => { error.textContent = '請輸入純數字（非負整數），或從選項中選擇。'; error.hidden = false; },
        onInput: () => { error.textContent = ''; error.hidden = true; },
        allowCharacter: character => /^[0-9]$/.test(character),
      });
      battle.append(picker, error);
    }
  };
  renderBattleSettings();
  toggle.addEventListener('change', () => { state.lowerwearAlternativeEnabled = toggle.checked; update(); renderInspector(); });
  const refreshConfigurationUi = () => {
    renderClassPicker();
    toggle.checked = state.lowerwearAlternativeEnabled;
    renderBattleSettings();
    renderSkillDamageShare();
    update(true);
    renderInspector();
    renderTitleInput();
    renderGlobalInputs();
    renderWeaponMagicStones();
    renderRightIceSetSelectors();
  };
  const applyHistorySnapshot = (snapshot: LoadoutState) => {
    Object.assign(state, snapshot);
    refreshConfigurationUi();
  };
  const undo = () => {
    const previous = history.undo();
    if (previous) applyHistorySnapshot(previous);
  };
  const redo = () => {
    const next = history.redo();
    if (next) applyHistorySnapshot(next);
  };
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  restoreBaselineButton.addEventListener('click', () => {
    if (!baseline || !baselineIsValid || history.matches(baseline)) return;
    applyHistorySnapshot(structuredClone(baseline));
  });
  baselineButton.addEventListener('click', () => {
    try {
      projectAttributes(data, state);
      baseline = structuredClone(state);
      baselineIsValid = true;
      const stored = sampleMode ? false : saveState(baseline, true);
      renderResults();
      refreshHistoryControls();
      document.querySelector('#save-status')!.textContent = stored ? '比較基準已儲存' : '比較基準僅保留至關閉頁面';
    } catch {
      renderResults();
      refreshHistoryControls();
    }
  });
  const isEditableHistoryTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable || target.closest('[contenteditable="true"], [role="textbox"]')) return true;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement) return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'color'].includes(target.type);
    return false;
  };
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    const action = historyShortcutAction(event, isEditableHistoryTarget(event.target));
    if (action === 'undo' && history.canUndo) { event.preventDefault(); undo(); }
    else if (action === 'redo' && history.canRedo) { event.preventDefault(); redo(); }
  });
  refreshHistoryControls();
  document.querySelector<HTMLButtonElement>('#export-loadout')!.addEventListener('click', () => {
    const exported = serializeLoadout(state, data);
    const blobUrl = URL.createObjectURL(new Blob([exported.json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `damage-calculator-loadout-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(blobUrl);
    const details = exported.omittedFields.length ? `；${exported.omittedFields.length} 個無法識別欄位已留空` : '';
    document.querySelector<HTMLElement>('#transfer-status')!.textContent = `配裝 JSON 已匯出${details}。`;
  });
  const fileInput = document.querySelector<HTMLInputElement>('#loadout-file')!;
  document.querySelector<HTMLButtonElement>('#import-loadout')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = parseLoadoutJson(await file.text(), state, data);
      Object.assign(state, imported.state);
      migrateLegacyPortraitAwakening(state);
      normalizePortraitAwakeningValues(state);
      renderSkillDamageShare();
      const duplicateTransformationCells = clearDuplicateTransformationChoices(state);
      const duplicateNephronTransformationCells = clearDuplicateNephronTransformationChoices(state);
      applyWeaponMagicStonePreset(String(state.values[data.weaponGrades.selectorCell] ?? ''));
      renderClassPicker();
      toggle.checked = state.lowerwearAlternativeEnabled;
      update();
      renderInspector(); renderTitleInput(); renderGlobalInputs(); renderWeaponMagicStones(); renderRightIceSetSelectors();
      const clearedFields = [...new Set([...imported.clearedFields, ...duplicateTransformationCells, ...duplicateNephronTransformationCells])];
      const partial = clearedFields.length ? `；${clearedFields.length} 個無法對應或重複的欄位已留空（${clearedFields.slice(0, 5).join('、')}${clearedFields.length > 5 ? '…' : ''}）` : '';
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = `${sampleMode ? '配裝已匯入；範例模式不會儲存到此裝置' : '配裝已匯入並儲存於此裝置'}${partial}。`;
    } catch (error) {
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = `匯入失敗：${error instanceof Error ? error.message : '檔案無法讀取。'}`;
    } finally {
      fileInput.value = '';
    }
  });
  renderSlots(); renderInspector(); renderTitleInput(); renderBeastAccessories(); renderMasterBeastColorSelector(); renderGlobalInputs(); renderWeaponMagicStones(); renderRightIceSetSelectors(); renderResults(); refreshHistoryControls();
}
start().catch(error => { document.querySelector('#app')!.innerHTML = `<section class="error-card"><h1>無法載入工具</h1><p>${h(error instanceof Error ? error.message : error)}</p></section>`; });
