import { mountCircuitBoardEditor } from './circuit-board-editor.ts';
import { createSkillShareControl } from './skill-share-control.ts';
import { createPickerChoices } from './picker-choices.ts';
import * as normalization from './loadout-normalization.ts';
import { createResultCardsView, renderDamageFormula } from './result-cards-view.ts';
import { sourceLabel as resolveSourceLabel } from './source-labels.ts';
import { renderEquipmentDamageSummary, renderFinalDamageNumber, renderDamageRatio } from './damage-summary-view.ts';
import { getClassSkillVersionOptions, isClassSkillVersionEnabled } from '../calculation/class-skill-versions.ts';
import { type AccessoryEffectOption } from '../calculation/equipment-effects.ts';
import { loadGameData, readJson, escapeHtml as h, formatNumber as fmt } from './data.ts';
import { readState, readBaseline, saveState, normalizePortraitAwakeningValues as normalizePortraitValues, normalizeTranscendenceSkillDamageShare, type LoadoutState } from './state.ts';
import { createTransferLoader } from './loadout-transfer-loader.ts';
import { normalizeOptionalEffectValues, isUnrelatedEffectValue, normalizeNephronMagazineSelections, normalizeBossHealthCondition, DEFAULT_BOSS_HEALTH_CONDITION } from './state.ts';
import { evaluateLoadout, projectDamage } from './projection.ts';
import { createBaselineEvaluationCache } from './baseline-evaluation.ts';
import { createAttributeEquivalencePanel } from './attribute-equivalence-ui.ts';
import { createDisclosurePreferences } from './disclosure-preferences.ts';
import { compareLoadoutResults } from './calculation-comparison.ts';
import { renderCalculationComparisonHtml } from './calculation-comparison-view.ts';
import { createPicker, updatePicker, disposePickers, type PickerOption } from './picker.ts';
import { circuitBoardRowsField, readCircuitBoardRows, serializeCircuitBoardRows, normalizeCircuitPercentage } from './circuit-board-rows.ts';
import { icon } from './icons.ts';
import { createCatalogIndexScope } from './catalog-index.ts';
import { canonicalizeNumber, preventScientificNotation } from './numeric-input.ts';
import { sanitizeClassCode } from './class-code.ts';
import { resolveUnsignedInteger, sanitizeUnsignedInteger } from './direct-input.ts';
import { historyShortcutAction, LoadoutHistory } from './history.ts';
import { takeIceOptimizerHandoff, type IceOptimizerHandoff } from './ice-optimizer-handoff.ts';

const visibleNumberFormatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 });
const twoDecimalFormatter = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  // This page loads GameData once. Controls/import/history change state, never this data.
  // A future in-session data/parameter refresh must replace this revision token.
  const calculationDataRevision = Symbol('loaded-game-data');
  const catalogIndex = createCatalogIndexScope().get(data, calculationDataRevision);
  const renderResultCards = createResultCardsView(data, visibleNumberFormatter, catalogIndex.classById, calculationIssue);
  const baselineEvaluationCache = createBaselineEvaluationCache();
  const sampleId = new URLSearchParams(location.search).get('sample');
  if (sampleId !== null && !/^[a-z0-9-]+$/.test(sampleId)) throw new RangeError('驗算範例名稱無效。');
  const sampleMode = sampleId !== null;
  const savedLoadoutAtStartup = sampleMode ? null : (() => {
    try { return localStorage.getItem('dab-loadout-v1'); } catch { return null; }
  })();
  const state: LoadoutState = sampleMode
    ? await readJson<LoadoutState>(`examples/${sampleId}.json`)
    : readState(catalogIndex.activeClasses[0]?.id ?? 'DaB');
  state.transcendenceSkillDamageSharePct = normalizeTranscendenceSkillDamageShare(state.transcendenceSkillDamageSharePct);
  const normalizePortraitAwakeningValues = (target: LoadoutState) => normalizePortraitValues(target.values, data.otherEffects.portraitAwakening);
  const startupPortraitAwakeningNormalized = normalizePortraitAwakeningValues(state);
  const clearInvalidAccessoryAppraisals = (target: LoadoutState) => normalization.clearInvalidAccessoryAppraisals(data, target);
  const startupInvalidAccessoryAppraisalFields = clearInvalidAccessoryAppraisals(state);
  const clearDuplicateTransformationChoices = (target: LoadoutState) => normalization.clearDuplicateTransformationChoices(data, target);
  const startupDuplicateTransformationFields = clearDuplicateTransformationChoices(state);
  const clearDuplicateNephronTransformationChoices = (target: LoadoutState) => normalization.clearDuplicateNephronTransformationChoices(data, target);
  const startupDuplicateNephronTransformationFields = clearDuplicateNephronTransformationChoices(state);
  const startupDuplicateNephronMagazineFields = normalizeNephronMagazineSelections(state.values, catalogIndex);
  const startupOptionalEffectsNormalized = normalizeOptionalEffectValues(state.values, catalogIndex);
  if ((startupPortraitAwakeningNormalized || startupOptionalEffectsNormalized || startupDuplicateTransformationFields.length || startupDuplicateNephronTransformationFields.length || startupInvalidAccessoryAppraisalFields.length || startupDuplicateNephronMagazineFields.changed) && !sampleMode) saveState(state);
  const applyWeaponMagicStonePreset = (grade: string, overwrite = false) => normalization.applyWeaponMagicStonePreset(data, state, grade, overwrite);
  applyWeaponMagicStonePreset(String(state.values[data.weaponGrades.settingKey] ?? ''));
  if (startupOptionalEffectsNormalized && !sampleMode) saveState(state);
  let baseline = sampleMode ? null : readBaseline();
  let baselineIsValid = false;
  if (baseline) {
    const normalizedBaselinePortraitAwakening = normalizePortraitAwakeningValues(baseline);
    const clearedBaselineMagazines = normalizeNephronMagazineSelections(baseline.values, catalogIndex);
    const clearedBaselineTransformations = clearDuplicateNephronTransformationChoices(baseline);
    const normalizedBaselineOptionalEffects = normalizeOptionalEffectValues(baseline.values, catalogIndex);
    if (normalizedBaselineOptionalEffects || normalizedBaselinePortraitAwakening || clearedBaselineMagazines.changed || clearedBaselineTransformations.length) saveState(baseline, true);
  }
  const history = new LoadoutHistory(state);
  let optimizerApplyMessage = '';
  let optimizerApplied = false;
  if (!sampleMode) {
    const pending = (() => { try { return takeIceOptimizerHandoff(); } catch { return null; } })();
    if (pending !== null) {
      const request = pending as Partial<IceOptimizerHandoff>;
      const selections = data.mapping.selections.filter(entry =>
        entry.catalogFile === 'equipment/right-ice.json');
      const fields = selections.map(entry => entry.selectionField);
      const version = document.querySelector<HTMLMetaElement>('meta[name="game-data-url"]')?.content.split('/').pop() ?? '';
      const validChoices = request.choices && typeof request.choices === 'object'
        && Object.keys(request.choices).length === fields.length
        && fields.every(field => typeof request.choices?.[field] === 'string')
        && selections.every(entry => {
          const choice = request.choices?.[entry.selectionField];
          return choice === '' || data.catalogs[entry.catalogFile]?.items.some(item =>
              item.active && item.slotId === entry.slotId && item.name === choice) === true;
        });
      const validSets = Array.isArray(request.setNames)
        && request.setNames.length <= data.rightIceSets.maxSelectedSets
        && request.setNames.every(name => typeof name === 'string'
          && data.rightIceSets.effects.some(effect => effect.setName === name))
        && new Set(request.setNames).size === request.setNames.length;
      if (request.format !== 'ice-optimizer-selection' || request.version !== 1
        || !savedLoadoutAtStartup || request.baseRaw !== savedLoadoutAtStartup
        || !version || request.dataRevision !== version || !validChoices || !validSets
        || typeof request.expectedDamage !== 'number' || !Number.isFinite(request.expectedDamage)) {
        optimizerApplyMessage = '冰裝搜尋結果已過期或資料不完整；原配裝保持不變，請重新搜尋。';
      } else {
        const values = { ...state.values, ...request.choices };
        for (const [index, field] of data.rightIceSets.selectionFields.entries()) values[field] = request.setNames![index] ?? '';
        const candidate = { ...state, values };
        try {
          const actual = projectDamage(data, candidate).result.finalDamage.finalDamage;
          if (Math.abs(actual - request.expectedDamage) > Math.max(1e-6, Math.abs(actual) * 1e-12)) {
            optimizerApplyMessage = '冰裝結果與目前計算資料不一致；原配裝保持不變，請重新搜尋。';
          } else {
            Object.assign(state.values, values);
            optimizerApplied = true;
          }
        } catch {
          optimizerApplyMessage = '冰裝結果無法套用至目前配裝；原配裝保持不變。';
        }
      }
    }
  }
  let selected = data.layout.slots.find(slot => slot.weapon)!;
  type BeastAccessorySlotId = 'headwear' | 'armor' | 'necklace' | 'ring-one' | 'ring-two';
  type BeastManualCategory = keyof typeof data.masterBeast.customAttributeOptions;
  let selectedBeastSlotId: BeastAccessorySlotId | null = null;
  const beastAccessorySlots: readonly {
    id: BeastAccessorySlotId; label: string; icon: string;
    fixedFields?: readonly [string, string]; stoneFields?: readonly [string, string]; stoneCategory?: BeastManualCategory;
    mirrorFields: readonly (readonly [string, string])[];
  }[] = [
    { id: 'headwear', label: '頭飾', icon: 'hair', fixedFields: ['MasterBeast.Head.Option1', 'MasterBeast.Head.Option2'], stoneFields: ['MasterBeast.Head.CustomAttribute', 'MasterBeast.Head.CustomValue'], stoneCategory: 'head', mirrorFields: [['MasterBeast.Head.Mirror.1.Attribute', 'MasterBeast.Head.Mirror.1.Value'], ['MasterBeast.Head.Mirror.2.Attribute', 'MasterBeast.Head.Mirror.2.Value'], ['MasterBeast.Head.Mirror.3.Attribute', 'MasterBeast.Head.Mirror.3.Value']] },
    { id: 'armor', label: '盔甲', icon: 'upper', mirrorFields: [['MasterBeast.Armor.Mirror.1.Attribute', 'MasterBeast.Armor.Mirror.1.Value'], ['MasterBeast.Armor.Mirror.2.Attribute', 'MasterBeast.Armor.Mirror.2.Value'], ['MasterBeast.Armor.Mirror.3.Attribute', 'MasterBeast.Armor.Mirror.3.Value']] },
    { id: 'necklace', label: '項鍊', icon: 'necklace', stoneFields: ['MasterBeast.Necklace.CustomAttribute', 'MasterBeast.Necklace.CustomValue'], stoneCategory: 'necklace', mirrorFields: [['MasterBeast.Necklace.Mirror.1.Attribute', 'MasterBeast.Necklace.Mirror.1.Value'], ['MasterBeast.Necklace.Mirror.2.Attribute', 'MasterBeast.Necklace.Mirror.2.Value'], ['MasterBeast.Necklace.Mirror.3.Attribute', 'MasterBeast.Necklace.Mirror.3.Value']] },
    { id: 'ring-one', label: '指環 1', icon: 'ring', fixedFields: ['MasterBeast.Ring1.Option1', 'MasterBeast.Ring1.Option2'], stoneFields: ['MasterBeast.Ring1.CustomAttribute', 'MasterBeast.Ring1.CustomValue'], stoneCategory: 'ring', mirrorFields: [['MasterBeast.Ring1.Mirror.1.Attribute', 'MasterBeast.Ring1.Mirror.1.Value'], ['MasterBeast.Ring1.Mirror.2.Attribute', 'MasterBeast.Ring1.Mirror.2.Value'], ['MasterBeast.Ring1.Mirror.3.Attribute', 'MasterBeast.Ring1.Mirror.3.Value']] },
    { id: 'ring-two', label: '指環 2', icon: 'ring', fixedFields: ['MasterBeast.Ring2.Option1', 'MasterBeast.Ring2.Option2'], stoneFields: ['MasterBeast.Ring2.CustomAttribute', 'MasterBeast.Ring2.CustomValue'], stoneCategory: 'ring', mirrorFields: [['MasterBeast.Ring2.Mirror.1.Attribute', 'MasterBeast.Ring2.Mirror.1.Value'], ['MasterBeast.Ring2.Mirror.2.Attribute', 'MasterBeast.Ring2.Mirror.2.Value'], ['MasterBeast.Ring2.Mirror.3.Attribute', 'MasterBeast.Ring2.Mirror.3.Value']] },
  ];
  const app = document.querySelector<HTMLElement>('#app')!;
    app.innerHTML = `<section class="workbench"><header class="workspace-heading"><div class="workspace-intro"><span class="eyebrow">EQUIPMENT SIMULATOR</span><h1>裝備傷害比較</h1><p class="workspace-summary">填入當前數值並設為比較基準，再調整配裝查看傷害差異。<br>請注意僅計算理論最高傷害，並不考慮冷卻、動速等問題。</p><ol class="workflow-steps" aria-label="比較流程"><li><span>01</span><span>填入當前數值</span></li><li><span>02</span><span>設為比較基準</span></li><li><span>03</span><span>填入新數值</span></li></ol></div></header><div class="toolbar"><div id="class-picker"></div><label class="toggle"><input id="alternate" type="checkbox">啟用強/排褲切換</label><div class="toolbar-actions"><button id="baseline" type="button">設為比較基準</button><div class="transfer-actions"><button id="import-loadout" type="button">匯入配裝</button><button id="export-loadout" type="button">匯出配裝</button></div></div><input id="loadout-file" type="file" accept="application/json,.json" hidden><span id="transfer-status" role="status" aria-live="polite"></span><span id="save-status" role="status"></span></div><section class="battle-panel"><div class="panel-heading"><h2>關卡設定</h2></div><div id="battle-settings" class="battle-fields"></div></section><div class="equipment-workspace"><section class="equipment-panel"><div class="panel-heading"><h2>裝備配置</h2><span>點選部位以編輯</span></div><div id="equipment-damage-summary" class="equipment-damage-summary" aria-live="polite"></div><div class="canvas-scroll"><div class="equipment-canvas"><span class="group-label costume-label">連身時裝</span><span class="group-label left-label">左冰</span><span class="group-label inner-label">內裝左四</span><span class="group-label weapon-label">冰武 / 武器</span><span class="group-label right-label">右冰</span><span class="group-label accessory-label">飾品</span><span class="group-label beast-label">聖獸飾品</span><div id="title-input" class="canvas-title-input"></div><div id="slots"></div><div id="beast-accessory-fields" class="beast-accessories-grid gear-beast-slots" aria-label="聖獸飾品配置"></div></div></div><p class="panel-note">左冰不支援混搭，但各部位魔法石仍須獨立設定。擁有強/排褲則褲子的傷害增幅會被平均計算。</p><section class="right-ice-set-area"><div class="beast-accessories-heading"><h3>右冰套效</h3><span>最多選擇 ${data.rightIceSets.maxSelectedSets} 套</span></div><p class="panel-note">選擇要啟用的套裝效果。</p><div id="right-ice-set-selectors" class="right-ice-set-selectors"></div></section><div class="beast-accessories-area"><div class="beast-accessories-heading"><h3>聖獸效果設定</h3></div><p class="panel-note">共通顏色與潛力設定</p><div id="master-beast-controls" class="master-beast-controls"></div></div></section><div id="inspector-backdrop" class="inspector-backdrop" aria-hidden="true"></div><aside id="inspector" class="inspector" aria-label="部位設定"></aside></div><details class="global-source-panel weapon-magic-stone-panel"><summary>武器魔力石</summary><div id="weapon-magic-stone-fields"></div></details><details class="global-source-panel"><summary>其他效果來源設定</summary><p class="panel-note">未列在此處的特殊條件或 Buff／Debuff 尚未納入計算。</p><div id="global-source-fields"></div></details><section class="results-panel"><div class="panel-heading"><h2>目前填寫的屬性</h2><span id="comparison-label"></span></div><p class="panel-note">包含裝備、冰裝、飾品、聖獸、關卡、效果設定等所有已填入的屬性加總</p><div id="results" aria-live="polite"></div><section class="damage-panel"><div class="panel-heading"><h2>攻擊與最終傷害</h2></div><div id="damage-result" aria-live="polite"></div><details class="calculation-inspection-panel"><summary>計算結果驗算</summary><div class="calculation-inspection-content"><div id="calculation-comparison" class="calculation-comparison" aria-live="polite"><p>先點選「設為比較基準」保存目前配置，表格就會比較基準與目前配裝。</p></div><div id="calculation-details"></div></div></details></section></section></section>`;
  const disclosurePreferences = createDisclosurePreferences(document);
  const resultsPanel = app.querySelector<HTMLElement>('.results-panel')!;
  const resultsDisclosure = document.createElement('details');
  resultsDisclosure.className = resultsPanel.className;
  resultsDisclosure.dataset.disclosureKey = 'filled-attributes';
  resultsDisclosure.open = true;
  const resultsSummary = document.createElement('summary');
  resultsSummary.textContent = '目前填寫的屬性';
  const resultsHeading = resultsPanel.querySelector<HTMLElement>(':scope > .panel-heading')!;
  const comparisonLabel = resultsHeading.querySelector<HTMLElement>('#comparison-label')!;
  resultsPanel.querySelector<HTMLElement>(':scope > .panel-note')!.append(' ', comparisonLabel);
  resultsHeading.remove();
  resultsDisclosure.append(resultsSummary, ...resultsPanel.childNodes);
  resultsPanel.replaceWith(resultsDisclosure);
  for (const [selector, key] of [
    ['.weapon-magic-stone-panel', 'weapon-magic-stone'],
    ['.global-source-panel:not(.weapon-magic-stone-panel)', 'global-sources'],
    ['.calculation-inspection-panel', 'calculation-inspection'],
    ['.site-credits-notes', 'site-credits'],
  ] as const) document.querySelector<HTMLDetailsElement>(selector)!.dataset.disclosureKey = key;
  const attributeEquivalence = createAttributeEquivalencePanel(data.attributes.attributes, () => {
    const evaluation = evaluateLoadout(data, state, false, true);
    attributeEquivalence.update('comparisonInput' in evaluation ? evaluation.comparisonInput : undefined,
      evaluation.damage?.result);
  });
  app.querySelector<HTMLElement>('.results-panel')!.after(attributeEquivalence.root);
  const classPickerRoot = app.querySelector<HTMLElement>('#class-picker')!;
  const toolbar = app.querySelector<HTMLElement>('.toolbar')!;
  const toolbarSettings = document.createElement('div');
  toolbarSettings.className = 'toolbar-settings';
  classPickerRoot.before(toolbarSettings);
  const classSettings = document.createElement('div');
  classSettings.className = 'class-settings';
  toolbarSettings.append(classSettings);
  classSettings.append(classPickerRoot);
  toolbarSettings.append(toolbar.querySelector<HTMLElement>('.toggle')!);
  const skillShareControl = createSkillShareControl(
    () => state.transcendenceSkillDamageSharePct,
    value => { state.transcendenceSkillDamageSharePct = value; },
    () => update(),
  );
  classSettings.append(skillShareControl.root);
  const renderSkillDamageShare = skillShareControl.render;
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
  if (startupDuplicateTransformationFields.length) {
    document.querySelector<HTMLElement>('#transfer-status')!.textContent = `已清除舊配裝中的重複武器變換詞條（${startupDuplicateTransformationFields.length} 個欄位）。`;
  }
  if (startupInvalidAccessoryAppraisalFields.length) {
    document.querySelector<HTMLElement>('#transfer-status')!.textContent = `已清除不符合目前裝備的鑑定選項（${startupInvalidAccessoryAppraisalFields.length} 個欄位）。`;
  }
  const val = (fieldId: string) => String(state.values[fieldId] ?? '');
  const summary = (stats: Readonly<Record<string, number>>) => Object.entries(stats).filter(([, value]) => value !== 0).map(([key, value]) => `${data.attributes.attributes.find(a => a.key === key)?.name ?? key} ${fmt(value)}`).join(' · ');
  const pickerChoices = createPickerChoices(catalogIndex, data.mapping.magicStoneSelections.catalogFile, summary);
  const { options, magicStoneChoices, validationChoices } = pickerChoices;
  const titleChoices = options([...new Set(catalogIndex.resolveFieldChoices('Effect.Title', state.values) as readonly string[])]);
  const classPickerChoices = Object.freeze(catalogIndex.activeClasses.map(entry => Object.freeze({ value: entry.id, label: entry.name })));
  const equipmentPickerChoices = new Map<string, readonly PickerOption[]>();
  const orderedEquipmentItems = new Map<string, ReturnType<typeof catalogIndex.equipmentItems>>();
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
  const bossHealthCondition = () => state.bossHealthCondition ?? DEFAULT_BOSS_HEALTH_CONDITION;
  const isLowerwearAveraging = () => state.lowerwearAlternativeEnabled && !bossHealthCondition().enabled;
  const alternateLowerwearAvailable = () => state.lowerwearAlternativeEnabled
    || bossHealthCondition().enabled && bossHealthCondition().lowerwear === 'lowerwearB';
  const lowerwearConditionalCircuitConflict = (): string | null => {
    if (!isLowerwearAveraging()) return null;
    const lowerwear = data.circuits.inputs.find(slot => slot.slot === "lowerwear");
    const alternative = data.circuits.inputs.find(slot => slot.slot === "lowerwearAlternative");
    if (!lowerwear || !alternative) return null;
    const conditionalAttributes = new Set(["強者%", "排熱%"]);
    const lowerwearAttributes = new Set(readCircuitBoardRows(state.values, lowerwear.attributeField, lowerwear.valueField)
      .map(row => row.attribute).filter(attribute => conditionalAttributes.has(attribute)));
    return readCircuitBoardRows(state.values, alternative.attributeField, alternative.valueField)
      .find(row => lowerwearAttributes.has(row.attribute))?.attribute ?? null;
  };
  const circuitAttributeOptions = (slot: (typeof data.circuits.inputs)[number], rows: ReturnType<typeof readCircuitBoardRows>, rowIndex: number) => {
    if (!isLowerwearAveraging() || (slot.slot !== "lowerwear" && slot.slot !== "lowerwearAlternative")) return options(slot.attributeOptions);
    const peerSlot = slot.slot === "lowerwear" ? "lowerwearAlternative" : "lowerwear";
    const peer = data.circuits.inputs.find(entry => entry.slot === peerSlot);
    const conditionalAttributes = new Set(["強者%", "排熱%"]);
    const peerAttributes = new Set(peer
      ? readCircuitBoardRows(state.values, peer.attributeField, peer.valueField).map(row => row.attribute)
      : []);
    const currentAttribute = rows[rowIndex]?.attribute;
    const names = slot.attributeOptions.filter(name =>
      !conditionalAttributes.has(name) || !peerAttributes.has(name) || name === currentAttribute);
    return options(names);
  };
  const lowerwearConditionalChipConflict = (): string | null => {
    if (!isLowerwearAveraging()) return null;
    const lowerwear = data.chipSlots.slots.find(slot => slot.id === "lowerwear");
    const alternative = data.chipSlots.slots.find(slot => slot.id === "lowerwearAlternative");
    if (!lowerwear || !alternative) return null;
    const selected = val(lowerwear.attributeField);
    return selected === val(alternative.attributeField) && (selected === "強者%" || selected === "排熱%") ? selected : null;
  };
  const chipAttributeOptions = (slot: (typeof data.chipSlots.slots)[number]) => {
    const chipNames = catalogIndex.resolveFieldChoices(slot.attributeField, state.values) as readonly string[];
    if (!isLowerwearAveraging() || (slot.id !== "lowerwear" && slot.id !== "lowerwearAlternative")) return options(chipNames);
    const peerId = slot.id === "lowerwear" ? "lowerwearAlternative" : "lowerwear";
    const peer = data.chipSlots.slots.find(entry => entry.id === peerId);
    const peerAttribute = peer ? val(peer.attributeField) : "";
    const blocked = peerAttribute === "強者%" || peerAttribute === "排熱%";
    return options(blocked ? chipNames.filter(name => name !== peerAttribute) : chipNames);
  };
  const renderedHtml = new WeakMap<Element, string>();
  const writeHtml = (target: Element, html: string, preserveDetails = false) => {
    if (renderedHtml.get(target) === html) return;
    const detailKey = (detail: HTMLDetailsElement) => detail.dataset.disclosureKey
      ?? detail.querySelector('summary span')?.textContent ?? detail.querySelector('summary')?.textContent ?? '';
    const prior = preserveDetails ? new Map([...target.querySelectorAll<HTMLDetailsElement>('details')]
      .map(detail => [detailKey(detail), detail.open] as const)) : null;
    target.innerHTML = html; renderedHtml.set(target, html);
    if (html.includes('<details')) disclosurePreferences.restore(target);
    if (prior) target.querySelectorAll<HTMLDetailsElement>('details').forEach(detail => {
      const key = detailKey(detail);
      if (prior.has(key)) detail.open = prior.get(key)!;
    });
  };
  const setAttribute = (node: HTMLElement, name: string, value: string) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const toggleClass = (node: HTMLElement, name: string, enabled: boolean) => {
    if (node.classList.contains(name) !== enabled) node.classList.toggle(name, enabled);
  };
  const slotButtons = new Map<string, HTMLButtonElement>();
  const beastButtons = new Map<string, HTMLButtonElement>();
  let slotUiKey = '', beastUiKey = '', masterUiKey = '', rightIceUiKey = '';
  const slotSignature = () => JSON.stringify([selected.id, state.lowerwearAlternativeEnabled, state.bossHealthCondition,
    data.layout.slots.map(slot => slot.selectionField ? val(slot.selectionField) : slot.weapon ? val('Weapon.ENHC')
      : slot.innerwearId ? val(catalogIndex.innerwearById(slot.innerwearId)!.enhancementField) : ''),
    data.rightIceSets.selectionFields.map(val)]);
  const beastSignature = () => JSON.stringify([selectedBeastSlotId,
    beastAccessorySlots.map(slot => [...(slot.fixedFields ?? []), ...(slot.stoneFields ?? []), ...slot.mirrorFields.flat()].map(val))]);
  const masterSignature = () => JSON.stringify([state.masterBeastSpiritStoneColor, val('MasterBeast.OverallPotential')]);
  const rightIceSignature = () => JSON.stringify([data.rightIceSets.selectionFields.map(val),
    data.mapping.selections.filter(selection => selection.catalogFile.endsWith('right-ice.json')).map(selection => val(selection.selectionField))]);
  const refreshEquipmentUi = () => {
    if (slotUiKey !== slotSignature()) renderSlots();
    if (beastUiKey !== beastSignature()) renderBeastAccessories();
    if (masterUiKey !== masterSignature()) renderMasterBeastColorSelector();
  };
  // Conservative snapshot for complex controls: only Stage fields are excluded.
  // Their candidates/values never depend on Stage; all other changes may redraw them.
  const configurationControlSignature = () => JSON.stringify({ ...state,
    values: Object.fromEntries(Object.keys(state.values).filter(fieldId => !fieldId.startsWith('Stage.')).sort().map(fieldId => [fieldId, state.values[fieldId]])) });
  const configurationControlKeys = new Map<string, string>();
  const refreshRightIceSelectors = () => { if (rightIceUiKey !== rightIceSignature()) renderRightIceSetSelectors(); };
  const update = (force = false) => {
    normalizeNephronMagazineSelections(state.values, catalogIndex);
    normalizeOptionalEffectValues(state.values, catalogIndex);
    const changed = history.record(state);
    if (!changed && !force) {
      refreshHistoryControls();
      return;
    }
    document.querySelector('#save-status')!.textContent = sampleMode ? '驗算範例模式：本頁調整不儲存' : saveState(state) ? '已儲存於此裝置' : '此瀏覽器無法儲存設定';
    refreshEquipmentUi(); renderResults();
    refreshHistoryControls();
  };
  const sourceLabel = (sourceId: string) => resolveSourceLabel(sourceId, data, state);
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
  const field = (parent: HTMLElement, label: string, fieldId: string, choices: readonly PickerOption[], redraw = false, disabled = false, disabledHint = '請先選擇屬性') => {
    const picker = createPicker(label, choices, val(fieldId), value => {
      state.values[fieldId] = value;
      for (const armor of data.nephronArmor.fields) {
        const transform = armor.transformFields.find(entry => entry.attributeField === fieldId);
        if (transform) delete state.values[transform.valueField];
        if (armor.magazineField === fieldId) delete state.values[armor.magazineLevelField];
      }
      if (data.accessoryEffects.groups.some(group => group.selectionField === fieldId)) {
        const cleared = clearInvalidAccessoryAppraisals(state);
        if (cleared.length) {
          if (!sampleMode) saveState(state);
          document.querySelector<HTMLElement>('#transfer-status')!.textContent = `已清除不符合目前裝備的鑑定選項（${cleared.length} 個欄位）。`;
        }
      }
      update(); refreshRightIceSelectors();
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
    if (isUnrelatedEffectValue(fieldId, state.values, catalogIndex)) updatePicker(picker, '0', true);
    return picker;
  };
  function getEquippedRightIceSetCounts() {
    const counts = new Map<string, number>();
    for (const selection of data.mapping.selections) {
      if (!selection.catalogFile.endsWith('right-ice.json')) continue;
      const setName = val(selection.selectionField);
      if (setName) counts.set(setName, (counts.get(setName) ?? 0) + 1);
    }
    return counts;
  }
  function renderRightIceSetSelectors() {
    const root = document.querySelector<HTMLElement>('#right-ice-set-selectors');
    if (!root) return;
    rightIceUiKey = rightIceSignature();
    const fields = data.rightIceSets.selectionFields;
    const availableNames = [...new Set(validationChoices(fields[0]).map(option => option.value))];
    const allowedNames = [...availableNames.filter(name => name !== '騎士團'), ...availableNames.filter(name => name === '騎士團')];
    const defaultOrder = new Map(allowedNames.map((name, index) => [name, index]));
    const equippedCounts = getEquippedRightIceSetCounts();
    const selectedNames = fields.map(val);
    disposePickers(root); root.replaceChildren();
    fields.forEach((fieldId, index) => {
      const usedElsewhere = new Set(selectedNames.filter((name, other) => other !== index && name !== ''));
      const choices = allowedNames
        .filter(name => !usedElsewhere.has(name) || name === selectedNames[index])
        .sort((left, right) => (equippedCounts.get(right) ?? 0) - (equippedCounts.get(left) ?? 0) || defaultOrder.get(left)! - defaultOrder.get(right)!)
        .map(name => {
          const pieceCount = equippedCounts.get(name) ?? 0;
          return { value: name, label: name, ...(pieceCount > 0 ? { detail: `目前選擇 ${pieceCount} 件` } : {}) };
        });
      const picker = createPicker(`套效選擇 ${index + 1}`, choices, selectedNames[index], value => {
        state.values[fieldId] = value;
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
          const numeric = (parent: HTMLElement, label: string, fieldId: string, percentage = true, constraints?: { min?: number; max?: number; step?: number | 'any'; integer?: boolean }, disabled = false, editableDecimal = false) => {
    const wrapper = document.createElement('label'); wrapper.className = 'field'; wrapper.textContent = label;
            const integer = constraints?.integer === true;
            const input = document.createElement('input'); input.type = integer || editableDecimal ? 'text' : 'number'; input.step = integer ? '1' : 'any'; input.placeholder = disabled ? '請先選擇屬性' : '請填寫數值';
            if (integer) {
              const maximum = constraints?.max ?? 999;
              input.inputMode = 'numeric'; input.pattern = '[0-9]*'; input.maxLength = String(maximum).length;
              input.autocomplete = 'off'; input.spellcheck = false;
              input.title = `只接受 ${constraints?.min ?? 0}–${maximum} 的整數。`;
            } else if (editableDecimal) {
              input.inputMode = 'decimal'; input.autocomplete = 'off'; input.spellcheck = false;
            } else {
              preventScientificNotation(input);
            }
    if (constraints?.min !== undefined) input.min = String(constraints.min);
    if (constraints?.max !== undefined) input.max = String(constraints.max);
    if (constraints?.step !== undefined) input.step = String(constraints.step);
    const initialValue = Number(val(fieldId)) * (percentage ? 100 : 1);
    input.value = val(fieldId) === '' ? '' : String(editableDecimal ? canonicalizeNumber(initialValue) : initialValue);
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
                state.values[fieldId] = Number(input.value);
                update();
              });
              input.addEventListener('blur', () => {
                if (input.value === '') input.value = lastValidValue;
                input.setAttribute('aria-invalid', 'false');
              });
            } else if (editableDecimal) {
              const isDecimalDraft = (value: string) => /^\d*(?:\.\d*)?$/.test(value);
              const isCompleteDecimal = (value: string) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value);
              const minimum = constraints?.min;
              const maximum = constraints?.max;
              const step = typeof constraints?.step === 'number' ? constraints.step : undefined;
              const isAllowedNumber = (value: number) => {
                if (!Number.isFinite(value) || (minimum !== undefined && value < minimum - 1e-9) || (maximum !== undefined && value > maximum + 1e-9)) return false;
                if (step === undefined) return true;
                const stepIndex = (value - (minimum ?? 0)) / step;
                return Math.abs(stepIndex - Math.round(stepIndex)) <= 1e-8;
              };
              const formatEditableDecimal = (value: number) => String(canonicalizeNumber(value));
              const storeEditableDecimal = (value: number) => canonicalizeNumber(percentage ? value / 100 : value);
              let lastValidValue = input.value;
              const isValidInsertion = (inserted: string) => {
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                return isDecimalDraft(input.value.slice(0, start) + inserted + input.value.slice(end));
              };
              const commitDecimal = () => {
                const raw = input.value;
                if (raw === '') {
                  lastValidValue = '';
                  input.setAttribute('aria-invalid', 'false');
                  return;
                }
                const normalized = raw.startsWith('.') ? `0${raw}` : raw;
                const parsed = Number(normalized);
                if (!isCompleteDecimal(normalized) || normalized.endsWith('.') || !isAllowedNumber(parsed)) {
                  input.value = lastValidValue;
                  input.setAttribute('aria-invalid', 'true');
                  return;
                }
                input.value = formatEditableDecimal(parsed);
                lastValidValue = input.value;
                state.values[fieldId] = storeEditableDecimal(parsed);
                input.setAttribute('aria-invalid', 'false');
                update();
              };
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
              input.addEventListener('input', () => {
                const raw = input.value;
                if (!isDecimalDraft(raw)) {
                  input.setAttribute('aria-invalid', 'true');
                  return;
                }
                input.setAttribute('aria-invalid', 'false');
                if (raw === '') {
                  lastValidValue = '';
                  state.values[fieldId] = '';
                  update();
                  return;
                }
                if (!isCompleteDecimal(raw) || raw.endsWith('.')) return;
                const parsed = Number(raw);
                if (!isAllowedNumber(parsed)) {
                  input.setAttribute('aria-invalid', 'true');
                  return;
                }
                lastValidValue = formatEditableDecimal(parsed);
                state.values[fieldId] = storeEditableDecimal(parsed);
                update();
              });
              input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  input.blur();
                }
              });
              input.addEventListener('blur', commitDecimal);
            } else {
              input.addEventListener('input', () => {
                if (data.circuits.inputs.some(circuit => circuit.valueField === fieldId)) {
                  if (input.validity.badInput) return;
                  const value = normalizeCircuitPercentage(Number(input.value) / 100);
                  state.values[fieldId] = canonicalizeNumber(value);
                  if (input.value === '' || Number(input.value) !== canonicalizeNumber(value * 100)) input.value = String(canonicalizeNumber(value * 100));
                  update();
                  return;
                }
                if (input.value !== '' && constraints?.min !== undefined && Number(input.value) < constraints.min) {
                  input.value = val(fieldId) === '' ? '' : String(Number(val(fieldId)) * (percentage ? 100 : 1));
                  return;
                }
                if (!input.validity.valid) return;
                state.values[fieldId] = input.value === '' ? '' : Number(input.value) / (percentage ? 100 : 1);
                update();
              });
            }
    wrapper.append(input); parent.append(wrapper);
    return input;
  };
  const section = (parent: HTMLElement, label: string, open = false) => {
    const details = document.createElement('details'); details.className = 'editor-section';
    const key = `inspector:${selectedBeastSlotId ?? selected.id}:${label}`;
    details.dataset.disclosureKey = key;
    details.open = disclosurePreferences.preferredOpen(key, open);
    const title = document.createElement('summary'); title.textContent = label; details.append(title); parent.append(details); return details;
  };
  const attributeValueGrid = (parent: HTMLElement, extraClass = '') => {
    const grid = document.createElement('div'); grid.className = extraClass ? 'attribute-value-grid ' + extraClass : 'attribute-value-grid';
    parent.append(grid);
    return grid;
  };
  function renderGlobalInputs() {
    const root = document.querySelector<HTMLElement>('#global-source-fields')!;
    configurationControlKeys.set('global', configurationControlSignature());
    disposePickers(root); root.replaceChildren();
    const group = (label: string, noteText?: string) => {
      const container = document.createElement('section'); container.className = 'global-input-group';
      const heading = document.createElement('h3'); heading.textContent = label; container.append(heading);
      if (noteText) { const note = document.createElement('p'); note.className = 'global-input-note'; note.textContent = noteText; container.append(note); }
      const grid = document.createElement('div'); grid.className = 'global-input-grid'; container.append(grid); root.append(container); return grid;
    };
    const pick = (container: HTMLElement, label: string, fieldId: string, entries: readonly { name: string }[]) =>
      field(container, label, fieldId, options([...new Set(entries.map(entry => entry.name))]));
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
    const nutProtectionToggle = document.createElement('label');
    nutProtectionToggle.className = 'pet-skill-toggle';
    const nutProtectionCheckbox = document.createElement('input');
    nutProtectionCheckbox.type = 'checkbox';
    nutProtectionCheckbox.checked = state.nutProtectionPotionEnabled;
    nutProtectionCheckbox.addEventListener('change', () => { state.nutProtectionPotionEnabled = nutProtectionCheckbox.checked; update(); });
    const nutProtectionLabel = document.createElement('span');
    nutProtectionLabel.textContent = '特殊靈藥：努特的庇護';
    nutProtectionToggle.append(nutProtectionCheckbox, nutProtectionLabel);
    general.append(nutProtectionToggle);
    for (const effect of data.otherEffects.binaryEffects) pick(general, effect.name, effect.settingKey, effect.options);
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
      { fieldId: portrait.strongSettingKey, otherField: portrait.transcendenceSettingKey, label: '強烈技傷%' },
      { fieldId: portrait.transcendenceSettingKey, otherField: portrait.strongSettingKey, label: '超越技傷%' },
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
      input.value = String(state.values[entry.fieldId] ?? 0);
      input.setAttribute('aria-label', `立繪、覺醒${entry.label}`);
      input.title = `只接受 ${portrait.minPct}–${portrait.maxPct} 的正整數；另一欄會自動補足至 ${portrait.maxTotalPct}%。`;
      const error = document.createElement('small');
      error.className = 'portrait-awakening-error';
      error.setAttribute('role', 'alert');
      error.hidden = true;
      portraitInputs.set(entry.fieldId, input);
      portraitErrors.set(entry.fieldId, error);
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
          input.value = String(state.values[entry.fieldId] ?? 0);
          showError(invalidEntryMessage);
          return;
        }
        const value = Number(raw);
        const otherValue = portrait.maxTotalPct - value;
        state.values[entry.fieldId] = value;
        state.values[entry.otherField] = otherValue;
        for (const field of portraitFields) {
          const fieldInput = portraitInputs.get(field.fieldId);
          if (fieldInput) fieldInput.value = String(state.values[field.fieldId] ?? 0);
          fieldInput?.setAttribute('aria-invalid', 'false');
          const fieldError = portraitErrors.get(field.fieldId);
          if (fieldError) {
            fieldError.textContent = '';
            fieldError.hidden = true;
          }
        }
        update();
      });
      input.addEventListener('blur', () => {
        input.value = String(state.values[entry.fieldId] ?? 0);
        clearError();
      });
      wrapper.append(input, error);
      portraitGrid.append(wrapper);
    }
    portraitSection.append(portraitHeading, portraitNote, portraitGrid);
    general.append(portraitSection);
    field(general, '百億/內布隆套效', data.colorSetEffects.settingKey, options(catalogIndex.resolveFieldChoices(data.colorSetEffects.settingKey, state.values) as readonly string[]));
    const atma = group('亞特瑪');
    field(atma, '亞特瑪屬性', 'Atma.Element', options(catalogIndex.resolveFieldChoices('Atma.Element', state.values) as readonly string[]));
    field(atma, '亞特瑪顏色', 'Atma.Color', options(catalogIndex.resolveFieldChoices('Atma.Color', state.values) as readonly string[]));
            const resonance = group('共鳴輸入', '輸入已分配的共鳴點，例如適應力點滿應該填100而非7。');
            const resonanceLimits: Record<string, number> = { 雙攻: 999, 技傷: 100, 適應: 100, 兩極: 50, B傷: 50 };
            for (const effect of data.resonance.effects) {
              numeric(resonance, effect.name, effect.settingKey, false, { min: 0, max: resonanceLimits[effect.name] ?? 999, step: 1, integer: true });
            }
    const spirit = group('賦靈錄');
    const spiritClassCodes = catalogIndex.spiritClassCodes;
    const selectedSpiritClassCodes = data.spiritRecord.classSelectors.settingKeys.map(val);
    data.spiritRecord.classSelectors.settingKeys.forEach((fieldId, index) => {
      const selectedElsewhere = selectedSpiritClassCodes.filter((_, otherIndex) => otherIndex !== index && selectedSpiritClassCodes[otherIndex] !== '');
      const usedElsewhere = new Set(selectedElsewhere.map(code => catalogIndex.resolveSpiritClassCode(code)?.toLocaleLowerCase()).filter((code): code is string => Boolean(code)));
      const currentCode = catalogIndex.resolveSpiritClassCode(selectedSpiritClassCodes[index]);
      const choices = spiritClassCodes
        .filter(code => !usedElsewhere.has(code.toLocaleLowerCase()) || code === currentCode)
        .map(code => ({ value: code, label: code }));
      const error = document.createElement('span');
      error.className = 'input-hint class-picker-error';
      error.setAttribute('role', 'alert');
      const currentIsDuplicate = Boolean(currentCode && usedElsewhere.has(currentCode.toLocaleLowerCase()));
      error.textContent = currentIsDuplicate ? '職業「' + currentCode + '」已在其他欄位選擇。' : '';
      error.hidden = !currentIsDuplicate;
      const picker = createPicker('職業 ' + (index + 1), choices, val(fieldId), value => {
        state.values[fieldId] = value;
        update();
        renderGlobalInputs();
      }, {
        sanitize: sanitizeClassCode,
        resolve: value => {
          const resolved = catalogIndex.resolveSpiritClassCode(value);
          return resolved && !selectedElsewhere.some(code => catalogIndex.resolveSpiritClassCode(code)?.toLocaleLowerCase() === resolved.toLocaleLowerCase()) ? resolved : null;
        },
        onInvalid: value => {
          const resolved = catalogIndex.resolveSpiritClassCode(value);
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
    for (const stage of data.otherEffects.guildFountain) pick(fountain, `${stage.stage}階`, stage.settingKey, stage.options);
  }
  function renderWeaponMagicStones() {
    const root = document.querySelector<HTMLElement>('#weapon-magic-stone-fields')!;
    configurationControlKeys.set('stones', configurationControlSignature());
    disposePickers(root); root.replaceChildren();
    const grid = document.createElement('div'); grid.className = 'weapon-magic-stone-grid'; root.append(grid);
    const gradePicker = createPicker('武器魔力石', options(data.weaponGrades.options.map(option => option.name)), val(data.weaponGrades.settingKey), value => {
      state.values[data.weaponGrades.settingKey] = value;
      applyWeaponMagicStonePreset(value, true);
      update();
      renderWeaponMagicStones();
    });
    gradePicker.classList.add('weapon-magic-stone-grade');
    grid.append(gradePicker);
    data.giantStones.settingKeys.forEach((fieldId, index) => field(
      grid,
      `巨型魔力石 ${index + 1}`,
      fieldId,
      data.giantStones.options.map(option => ({ value: option.name, label: option.name })),
    ));
    const colors = document.createElement('div'); colors.className = 'weapon-magic-stone-colors'; root.append(colors);
    for (const colorGroup of data.weaponGrades.colorGroups) {
      const card = document.createElement('section'); card.className = `weapon-magic-stone-color weapon-magic-stone-${colorGroup.id}`;
      const heading = document.createElement('h3'); heading.textContent = `${colorGroup.name}（9 格）`; card.append(heading);
      const slots = document.createElement('div'); slots.className = 'weapon-magic-stone-slots'; card.append(slots);
      colorGroup.settingKeys.forEach((fieldId, index) => field(
        slots,
        `${index + 1}`,
        fieldId,
        colorGroup.options.map(option => ({ value: option.name, label: option.name })),
      ));
      colors.append(card);
    }
  }
  let masterColorPicker: HTMLElement | undefined;
  let masterPotentialPicker: HTMLElement | undefined;
  function renderMasterBeastColorSelector() {
    const root = document.querySelector<HTMLElement>('#master-beast-controls')!;
    masterUiKey = masterSignature();
    const color = state.masterBeastSpiritStoneColor ?? data.masterBeast.spiritStoneColorSelector.defaultColor;
    if (masterColorPicker && masterPotentialPicker) {
      updatePicker(masterColorPicker, color);
      updatePicker(masterPotentialPicker, val('MasterBeast.OverallPotential'));
      return;
    }
    const inputs = document.createElement('div'); inputs.className = 'master-beast-control-inputs'; root.append(inputs);
    masterColorPicker = createPicker(
      '聖獸精靈石顏色',
      options(data.masterBeast.spiritStoneColorSelector.options),
      color,
      value => { state.masterBeastSpiritStoneColor = value as LoadoutState['masterBeastSpiritStoneColor']; update(); },
    );
    inputs.append(masterColorPicker);
    field(inputs, '聖獸潛力', 'MasterBeast.OverallPotential', options(catalogIndex.resolveFieldChoices('MasterBeast.OverallPotential', state.values) as readonly string[]));
    masterPotentialPicker = inputs.lastElementChild as HTMLElement;
  }
  function renderTitleInput() {
    const root = document.querySelector<HTMLElement>('#title-input')!;
    const picker = root.querySelector<HTMLElement>('.picker');
    if (picker) { updatePicker(picker, val('Effect.Title'), true); return; }
    field(root, '稱號', 'Effect.Title', titleChoices);
  }
  function renderBeastAccessories() {
    const root = document.querySelector<HTMLElement>('#beast-accessory-fields')!;
    beastUiKey = beastSignature();
    const rightIceEarring = data.layout.slots.find(slot => slot.selectionField === 'Right.Ice.Earring');
    const rightIceNecklace = data.layout.slots.find(slot => slot.selectionField === 'Right.Ice.Necklace');
    const rightIceSupport = data.layout.slots.find(slot => slot.selectionField === 'Right.Ice.Support');
    const accessoryWeapon = data.layout.slots.find(slot => slot.selectionField === 'Accessory.WeaponAccessory');
    const accessoryRingOne = data.layout.slots.find(slot => slot.selectionField === 'Accessory.Ring1');
    const accessoryRingTwo = data.layout.slots.find(slot => slot.selectionField === 'Accessory.Ring2');
    if (!beastButtons.size && rightIceEarring && rightIceNecklace && rightIceSupport && accessoryWeapon && accessoryRingOne && accessoryRingTwo) {
      const rightIceToAccessoryGap = accessoryWeapon.x - rightIceSupport.x;
      const beastCenterX = rightIceEarring.x - rightIceToAccessoryGap;
      const beastRingStep = accessoryRingTwo.x - accessoryRingOne.x;
      const ringOneX = beastCenterX - beastRingStep;
      const canvas = root.closest<HTMLElement>('.equipment-canvas')!;
      canvas.style.setProperty('--beast-accessory-center-x', `${beastCenterX}%`);
      canvas.style.setProperty('--beast-ring-one-x', `${ringOneX}%`);
      canvas.style.setProperty('--beast-ring-two-x', `${beastCenterX}%`);
    }
    for (const slot of beastAccessorySlots) {
      let button = beastButtons.get(slot.id);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = `beast-accessory-slot beast-accessory-slot-${slot.id}`; button.dataset.beastSlotId = slot.id;
        button.addEventListener('click', () => {
          selectedBeastSlotId = slot.id;
          renderBeastAccessories(); renderInspector(); openMobileInspector();
        });
        beastButtons.set(slot.id, button); root.append(button);
      }
      const fields = [...(slot.fixedFields ?? []), ...(slot.stoneFields ?? []), ...slot.mirrorFields.flat()];
      const hasValue = fields.some(fieldId => val(fieldId) !== '');
      toggleClass(button, 'configured', hasValue);
      toggleClass(button, 'selected', selectedBeastSlotId === slot.id);
      setAttribute(button, 'aria-label', `${slot.label}${hasValue ? '（已設定）' : ''}`);
      setAttribute(button, 'aria-pressed', String(selectedBeastSlotId === slot.id));
      writeHtml(button, `${icon(slot.icon)}<span>${h(slot.label)}</span>${hasValue ? '<i></i>' : ''}`);
    }
  }
  let circuitEditor: ReturnType<typeof mountCircuitBoardEditor> | undefined;
  function renderBeastInspector(panel: HTMLElement) {
    disposePickers(panel);
    const slot = beastAccessorySlots.find(candidate => candidate.id === selectedBeastSlotId)!;
    panel.innerHTML = `<div class="inspector-title beast-inspector-title"><span class="beast-inspector-icon">${icon(slot.icon)}</span><div><small>聖獸飾品</small><h2>${h(slot.label)}</h2></div><button class="inspector-close" type="button" aria-label="關閉部位設定">×</button></div>`;
    const fixed = section(panel, '固定效果', true);
    if (slot.fixedFields) slot.fixedFields.forEach((fieldId, index) => field(
      fixed,
      `固定效果 ${index + 1}`,
      fieldId,
      validationChoices(fieldId),
    ));
    else fixed.insertAdjacentHTML('beforeend', `<p class="panel-note beast-mapping-note">${h(slot.label)}的鑑定效果與傷害無關，無需設定。</p>`);

    const stone = section(panel, '精靈石', true);
    if (slot.stoneFields && slot.stoneCategory) {
      const [attributeField, valueField] = slot.stoneFields;
      const stoneGrid = attributeValueGrid(stone);
      field(stoneGrid, '精靈石屬性', attributeField, options(data.masterBeast.customAttributeOptions[slot.stoneCategory]), true);
      field(stoneGrid, '精靈石數值（%）', valueField, validationChoices(valueField, true), false, val(attributeField) === '' || val(attributeField) === '無關傷害');
    } else {
      stone.insertAdjacentHTML('beforeend', `<p class="panel-note beast-mapping-note">盔甲精靈石的個別屬性不影響傷害，無需設定。精靈石套裝增幅 ${fmt(data.masterBeast.armorSpiritStoneSetEffect.multiplicativeDamagePct)}% 已預設套用。</p>`);
    }

    const mirrorArea = section(panel, '迷鏡效果', true);
    mirrorArea.classList.add('beast-mirror-section');
    const mirrorGrid = attributeValueGrid(mirrorArea, 'beast-mirror-grid');
    slot.mirrorFields.forEach(([attributeField, valueField]) => {
      const attribute = val(attributeField);
      field(mirrorGrid, '迷鏡效果屬性', attributeField, options(data.masterBeast.customAttributeOptions.mirror), true);
      const unrelated = attribute === '無關傷害';
      const valueRule = data.masterBeast.mirrorValueRules.byAttribute[attribute] ?? data.masterBeast.mirrorValueRules.default;
      const input = numeric(
        mirrorGrid,
        '迷鏡效果數值（%）',
        valueField,
        true,
        { min: 0, max: valueRule.maxPct, step: valueRule.stepPct },
        unrelated,
        true,
      );
      if (unrelated) {
        input.value = '0';
        input.placeholder = '此屬性無需數值';
        input.parentElement!.title = '此屬性無需數值';
      }
    });
  }
  function renderSlots() {
    const container = document.querySelector('#slots')!;
    slotUiKey = slotSignature();
    const rightIceSetEffectIndexes = new Map<string, number>();
    data.rightIceSets.selectionFields.forEach((fieldId, index) => {
      const setName = val(fieldId);
      if (setName && !rightIceSetEffectIndexes.has(setName)) rightIceSetEffectIndexes.set(setName, index + 1);
    });
    for (const slot of data.layout.slots) {
      const group = data.layout.groups.find(group => group.id === slot.group)!;
      let button = slotButtons.get(slot.id);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'gear-slot'; button.dataset.slotId = slot.id;
        button.style.cssText = `left:${slot.x}%;top:${slot.y}%;--group-color:${group.color}`;
        button.addEventListener('click', () => { selected = slot; selectedBeastSlotId = null; renderSlots(); renderBeastAccessories(); renderInspector(); openMobileInspector(); });
        slotButtons.set(slot.id, button); container.append(button);
      }
      const configured = slot.selectionField ? val(slot.selectionField) : slot.weapon ? val('Weapon.ENHC') : slot.innerwearId ? val(data.innerwear.slots.find(s => s.id === slot.innerwearId)!.enhancementField) : '';
      const isAccessory = slot.group === 'accessories';
      const isIceEquipment = slot.group === 'leftIce' || slot.group === 'rightIce' || slot.group === 'iceWeapon';
      const selectedItemName = slot.selectionField && slot.group !== 'costume' && !isAccessory && configured
        ? isIceEquipment ? ICE_EQUIPMENT_SHORT_NAMES[configured] ?? configured : configured
        : '';
      const isRightIceSetSlot = (slot.group === 'rightIce' || slot.group === 'iceWeapon') && !!slot.selectionField && !!configured;
      const rightIceEffectIndex = isRightIceSetSlot ? rightIceSetEffectIndexes.get(configured) : undefined;
      const rightIceSetHint = rightIceEffectIndex ? `；屬於套效 ${rightIceEffectIndex}` : '';
      toggleClass(button, 'configured', !!configured); toggleClass(button, 'selected', selected.id === slot.id);
      toggleClass(button, 'inactive', !!slot.enabledBy && !alternateLowerwearAvailable());
      toggleClass(button, 'right-ice-effect-1', rightIceEffectIndex === 1);
      toggleClass(button, 'right-ice-effect-2', rightIceEffectIndex === 2);
      toggleClass(button, 'right-ice-effect-3', rightIceEffectIndex === 3);
      setAttribute(button, 'aria-label', `${group.name} ${slot.label}：${configured || '未設定'}${rightIceSetHint}`); setAttribute(button, 'aria-pressed', String(selected.id === slot.id));
      setAttribute(button, 'title', `${group.name} ${slot.label}${configured && slot.group !== 'costume' ? '\n' + configured : ''}${rightIceSetHint}`);
      writeHtml(button, `<span class="gear-slot-label">${h(slot.label)}</span>${selectedItemName ? `<span class="gear-slot-item-name">${h(selectedItemName)}</span>` : ''}${configured ? '<i></i>' : ''}`);
    }
  }
  function renderInspector() {
    circuitEditor?.dispose();
    circuitEditor = undefined;
    const panel = document.querySelector<HTMLElement>('#inspector')!;
    configurationControlKeys.set('inspector', JSON.stringify([selected.id, selectedBeastSlotId, configurationControlSignature()]));
    if (selectedBeastSlotId) { renderBeastInspector(panel); return; }
    disposePickers(panel);
    const group = data.layout.groups.find(group => group.id === selected.group)!;
    const innerwearSlot = selected.innerwearId ? data.innerwear.slots.find(slot => slot.id === selected.innerwearId) : undefined;
    const innerwearType = innerwearSlot && val(innerwearSlot.typeField) === "內布隆" ? "內布隆" : "百億";
    const typeSwitch = innerwearSlot ? `<div class="innerwear-type-switch" role="group" aria-label="內裝防具類型"><button type="button" data-innerwear-type="百億" aria-pressed="${innerwearType === "百億"}">百億</button><button type="button" data-innerwear-type="內布隆" aria-pressed="${innerwearType === "內布隆"}">內布隆</button></div>` : "";
    panel.innerHTML = `<div class="inspector-title" style="--group-color:${group.color}">${icon(selected.icon)}<div class="inspector-title-copy"><small>${h(group.name)}</small><h2>${h(selected.label)}</h2></div>${typeSwitch}<button class="inspector-close" type="button" aria-label="關閉部位設定">×</button></div>`;
    if (innerwearSlot) panel.querySelectorAll<HTMLButtonElement>("[data-innerwear-type]").forEach(button => button.addEventListener("click", () => {
      state.values[innerwearSlot.typeField] = button.dataset.innerwearType!;
      update(); renderInspector();
    }));
    if (selected.enabledBy && !alternateLowerwearAvailable()) { panel.insertAdjacentHTML('beforeend', '<p class="panel-note">請先啟用上方「強/排褲切換」，或在 Boss 體力條件中選用強/排褲。設定會保留於裝置，停用時不參與計算。</p>'); return; }
    if (selected.selectionField) {
      const selectionField = selected.selectionField;
      const mapping = catalogIndex.equipmentMappings.get(selectionField)!;
      let items = orderedEquipmentItems.get(selectionField);
      if (!items) {
        const slotItems = catalogIndex.equipmentItems(mapping);
        const isRightIceCatalog = mapping.catalogFile.endsWith('right-ice.json');
        const isMysticSetName = (name: string) => name === '神埃' || name === '神秘的埃羅德';
        const isKnightSetName = (name: string) => name === '騎士團' || name === '艾里奧斯守護騎士團';
        items = isRightIceCatalog
          ? Object.freeze([...slotItems.filter(item => !isMysticSetName(item.name) && !isKnightSetName(item.name)), ...slotItems.filter(item => isMysticSetName(item.name)), ...slotItems.filter(item => isKnightSetName(item.name))])
          : slotItems;
        orderedEquipmentItems.set(selectionField, items);
      }
      const isAccessory = mapping.catalogFile === 'equipment/accessories.json';
      let choices = equipmentPickerChoices.get(selectionField);
      if (!choices) { choices = Object.freeze(items.map(item => Object.freeze({ value: item.name, label: item.name, detail: summary(item.stats ?? {}) }))); equipmentPickerChoices.set(selectionField, choices); }
      field(panel, selected.sharedSelection ? '左冰套裝（五部位共用）' : '選擇裝備', selectionField, choices, isAccessory);
      if (isAccessory) {
        const appraisalGroup = data.accessoryEffects.groups.find(entry => entry.selectionField === selectionField);
        const selectedItem = items.find(item => item.name === val(selectionField));
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
          } else if (appraisal.canAppraise && Number.isInteger(appraisal.effectCount) && appraisal.effectCount > 0 && appraisal.effectCount <= appraisalGroup.inputFields.length) {
            const appraisalArea = section(panel, '飾品鑑定', true);
            const itemOptions = appraisalGroup.optionsByEquipmentName?.[selectedItem.name] ?? appraisalGroup.options;
            const choices: PickerOption[] = itemOptions.map((option: AccessoryEffectOption) => ({ value: option.name, label: option.name }));
            appraisalGroup.inputFields.slice(0, appraisal.effectCount).forEach((fieldId, index) => field(appraisalArea, `鑑定效果 ${index + 1}`, fieldId, choices));
          } else if (appraisal.canAppraise) {
            panel.insertAdjacentHTML('beforeend', '<p class="input-warning">此飾品的鑑定效果條數資料不正確，請檢查裝備 JSON。</p>');
          }
        }
      }
    }
    if (selected.innerwearId) {
      const slot = data.innerwear.slots.find(slot => slot.id === selected.innerwearId)!;
      field(panel, '強化', slot.enhancementField, options(Object.keys(data.innerwear.enhancementStats).map(level => 'Lv.' + level)));
      field(panel, '鍛造', slot.forgingField, options(Object.keys(data.innerwear.forgingAttack)));
      if (innerwearType === '內布隆') {
        const nephronField = data.nephronArmor.fields.find(entry => entry.slotId === slot.id)!;
        const transformationArea = section(panel, '屬性變換', true);
        const transformationGrid = attributeValueGrid(transformationArea, 'nephron-transformation-grid');
        nephronField.transformFields.forEach((transform, index) => {
          const selectedName = val(transform.attributeField);
          const attribute = data.nephronArmor.transformations.find(entry => entry.name === selectedName);
          const selectedElsewhere = new Set(nephronField.transformFields
            .filter(other => other.attributeField !== transform.attributeField)
            .map(other => val(other.attributeField))
            .filter(Boolean));
          const availableAttributes = data.nephronArmor.transformations
            .filter(entry => entry.name === '無關傷害' || !selectedElsewhere.has(entry.name));
          field(transformationGrid, '變換 ' + (index + 1) + ' 屬性', transform.attributeField,
            availableAttributes.map(entry => ({ value: entry.name, label: entry.name.replace('（依強化等級）', '(×強化)') })), true);
          const tiers = attribute?.tierValuesPct ?? [];
          field(transformationGrid, '變換 ' + (index + 1) + ' 數值（%）', transform.valueField,
            tiers.map(value => ({ value: String(value / 100), label: value + '%' })),
            true, !selectedName || !tiers.length,
            selectedName === '無關傷害' ? '此屬性無需數值' : '請先選擇屬性');
        });

        const magazineArea = section(panel, '彈匣', true);
        const magazineGrid = attributeValueGrid(magazineArea, 'nephron-magazine-grid');
        const equippedNephronFields = data.nephronArmor.fields.filter(entry => {
          const armor = data.innerwear.slots.find(candidate => candidate.id === entry.slotId);
          return !!armor && val(armor.typeField) === '內布隆';
        });
        const otherMagazineNames = new Set(equippedNephronFields.filter(entry => entry.slotId !== nephronField.slotId)
          .map(entry => val(entry.magazineField)).filter(Boolean));
        const selectedMagazine = val(nephronField.magazineField);
        const magazineChoices = data.nephronArmor.magazines
          .filter(magazine => !otherMagazineNames.has(magazine.name) || magazine.name === selectedMagazine)
          .map(magazine => {
            const attributeName = (key: string) => key === 'multiplicativeDamagePct'
              ? '乘算%' : data.attributes.attributes.find(attribute => attribute.key === key)?.name ?? key;
            const levelKeys = [magazine.levelStatKey ?? magazine.statKey, ...(magazine.additionalLevelStatKeys ?? [])];
            const detail = magazine.id === 'combat-type-iii' ? '強烈、超越技傷%' : [
              ...levelKeys.filter((key): key is NonNullable<typeof key> => !!key).map(attributeName),
              ...Object.entries(magazine.baseStats ?? {}).map(([key, value]) => `${attributeName(key).replace(/%$/, '')}${fmt(value)}%`),
            ].join(' · ') || (magazine.otherEffects ?? []).join('；');
            return { value: magazine.name, label: magazine.name, detail };
          });
        field(magazineGrid, '彈匣種類', nephronField.magazineField, magazineChoices, true);
        const currentMagazine = data.nephronArmor.magazines.find(entry => entry.name === selectedMagazine);
        const fixedMagazineLevel = currentMagazine?.fixedLevel;
        const magazineLevelChoices = (fixedMagazineLevel === undefined ? data.nephronArmor.levelLabels : [`Lv.${fixedMagazineLevel}`]).map(level => {
          const levelIndex = Number(level.match(/[0-9]+/)?.[0]) - 1;
          const amount = currentMagazine?.levelValuesPct[levelIndex];
          return {
            value: level, label: level,
            detail: amount === undefined ? undefined
              : (currentMagazine?.statKey === 'multiplicativeDamagePct' ? '乘算傷害增幅：' : '數值：') + amount + '%',
          };
        });
        const magazineLevelPicker = field(magazineGrid, '彈匣等級', nephronField.magazineLevelField,
          magazineLevelChoices, true, !selectedMagazine || fixedMagazineLevel !== undefined,
          fixedMagazineLevel === undefined ? '請先選擇彈匣' : `此彈匣固定為 Lv.${fixedMagazineLevel}`);
        if (fixedMagazineLevel !== undefined) magazineLevelPicker.querySelector<HTMLButtonElement>('.picker-clear')!.disabled = true;
        if (currentMagazine?.otherEffects?.length) {
          const note = document.createElement('p'); note.className = 'panel-note';
          note.textContent = currentMagazine.otherEffects.join('；'); magazineArea.append(note);
        }
        if (selectedMagazine && otherMagazineNames.has(selectedMagazine)) {
          magazineArea.insertAdjacentHTML('beforeend', '<p class="input-warning">相同名稱的彈匣不可重複裝備。</p>');
        }
      }
    }
    if (selected.weapon) {
      field(panel, '武器強化', 'Weapon.ENHC', options(Object.keys(data.attack.weaponEnhancementFactors).map(level => `Lv.${level}`)));
      field(panel, '武器成長', data.growth.settingKey, data.growth.levels.map(level => ({ value: level.name, label: level.name, detail: summary(level.stats) })));
    }
    if (selected.stoneFields?.length) {
      const area = section(panel, '魔法石', true);
      const visibleStoneFields = innerwearSlot && innerwearType === "百億" ? selected.stoneFields.slice(0, 4) : selected.stoneFields;
      for (const [index, fieldId] of visibleStoneFields.entries()) {
        const mapping = catalogIndex.equipmentMappings.get(fieldId)!;
        field(area, `魔法石 ${index + 1}`, fieldId, magicStoneChoices(mapping.application!));
      }
    }
    if (selected.innerwearId) {
      if (innerwearType !== "內布隆") {
        const appraisal = data.appraisals.slots.find(slot => slot.id === selected.innerwearId)!;
        const area = section(panel, '鑑定'); appraisal.inputFields.forEach((fieldId, i) => field(area, `鑑定 ${i + 1}`, fieldId, data.appraisals.options.map(option => ({ value: option.name, label: option.name }))));
      }
      const circuit = data.circuits.inputs.find(slot => slot.slot === selected.innerwearId)!;
      const board = section(panel, '電路板');
      const readRows = () => readCircuitBoardRows(state.values, circuit.attributeField, circuit.valueField);
      const storeRows = (rows: ReturnType<typeof readRows>) => {
        state.values[circuitBoardRowsField(circuit.attributeField)] = serializeCircuitBoardRows(rows);
        state.values[circuit.attributeField] = rows[0].attribute;
        state.values[circuit.valueField] = normalizeCircuitPercentage(rows[0].percentageValue);
      };
      circuitEditor = mountCircuitBoardEditor(board, circuit.attributeOptions, readRows, rows => { storeRows(rows); update(); },
        (rows, index) => circuitAttributeOptions(circuit, rows, index));
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
      field(chipGrid, '芯片屬性', chip.attributeField, chipAttributeOptions(chip), true);
      const chosen = data.chips.chips.find(entry => entry.name === val(chip.attributeField));
      const tuningChoices: PickerOption[] = chosen?.tuningLevels.map(level => ({
        value: level.level,
        label: level.level,
        detail: `${fmt(level.value)}%`,
      })) ?? [];
      field(chipGrid, '芯片調校等級', chip.tuningField, tuningChoices, false, val(chip.attributeField) === '');
      const conditionalChipConflict = lowerwearConditionalChipConflict();
      if (conditionalChipConflict && (chip.id === "lowerwear" || chip.id === "lowerwearAlternative")) {
        const warning = document.createElement("p");
        warning.className = "input-warning";
        warning.textContent = "下衣與強/排褲不可同時使用「" + conditionalChipConflict + "」芯片。請讓兩套配置分別使用「強者%」與「排熱%」，以符合 Boss 體力切換條件。";
        chipArea.append(warning);
      }
    }
    if (selected.weapon) {
      const appraisal = section(panel, '武器鑑定'); Object.values(data.weaponAppraisals.groups).forEach((group, i) => field(appraisal, `鑑定 ${i + 1}`, group.settingKey, group.options.map(option => ({ value: option.name, label: option.name }))));
      const transform = section(panel, '武器變換');
      const transformationGrid = attributeValueGrid(transform, 'weapon-transformation-grid');
      data.transformations.slots.forEach((slot, i) => {
        const selectedElsewhere = new Set(data.transformations.slots
          .filter(other => other.choiceField !== slot.choiceField)
          .map(other => val(other.choiceField))
          .filter(Boolean));
        const availableOptions = data.transformations.options.filter(option => !selectedElsewhere.has(option));
        field(transformationGrid, `變換 ${i + 1}`, slot.choiceField, options(availableOptions), true);
        const percentage = data.transformations.rules.find(rule => rule.choice === val(slot.choiceField))?.valueMultiplier !== 1;
        numeric(transformationGrid, `變換 ${i + 1} 數值${percentage ? '（%）' : '（等級）'}`, slot.valueField, percentage);
      });
    }
  }
  function renderCalculationComparison(
    currentResult: ReturnType<typeof projectDamage>['result'] | undefined,
    baselineResult: ReturnType<typeof projectDamage>['result'] | undefined,
  ) {
    const target = document.querySelector<HTMLElement>('#calculation-comparison')!;
    if (!currentResult) {
      writeHtml(target, '<p>目前配裝的輸入尚未完成或無法計算，修正後即可與比較基準對照。</p>', true);
      return;
    }
    if (!baselineResult) {
      writeHtml(target, `<p>${baseline ? '已設定的比較基準目前無法計算，請重新設定基準。' : '先點選「設為比較基準」保存目前配置，表格就會比較基準與目前配裝。'}</p>`, true);
      return;
    }
    const rows = compareLoadoutResults(currentResult, baselineResult);

    writeHtml(target, renderCalculationComparisonHtml(
      rows, catalogIndex.classById(state.Job)?.attackType, visibleNumberFormatter,
    ), true);
  }
  function renderResults() {
    const target = document.querySelector('#results')!;
      const currentEvaluation = evaluateLoadout(data, state, true, attributeEquivalence.isOpen());
      if (attributeEquivalence.isOpen()) attributeEquivalence.update(
        'comparisonInput' in currentEvaluation ? currentEvaluation.comparisonInput : undefined,
        currentEvaluation.damage?.result,
      );
      const currentDamage = currentEvaluation.damage;
      const damageCalculationError = currentEvaluation.damageError;
      const baselineEvaluation = baselineEvaluationCache.get(data, baseline, calculationDataRevision);
      const baselineDamage = baselineEvaluation?.damage ?? null;
      const baselineAttributes = baselineEvaluation?.attributes ?? null;
      baselineIsValid = baselineAttributes !== null;
      if (!currentDamage) renderCalculationComparison(undefined, baselineDamage?.result);
      const equipmentDamageSummary = document.querySelector<HTMLElement>('#equipment-damage-summary')!;
      writeHtml(equipmentDamageSummary, renderEquipmentDamageSummary(currentDamage?.result.finalDamage.finalDamage, baselineDamage?.result.finalDamage.finalDamage, visibleNumberFormatter, twoDecimalFormatter), true);
    try {
      if (!currentEvaluation.attributes) throw currentEvaluation.attributeError;
      const before = baselineAttributes;
    document.querySelector('#comparison-label')!.textContent = before ? '' : baseline ? '比較基準已不適用目前資料，請重新設定' : '可儲存目前配置作為比較基準';

    writeHtml(target, renderResultCards(state, baseline, currentEvaluation, baselineEvaluation), true);
      const finalDamageFormat = (value: number) => renderFinalDamageNumber(value, visibleNumberFormatter);
      const damageTarget = document.querySelector('#damage-result')!;
      try {
        if (!currentDamage) throw damageCalculationError;
        const { result } = currentDamage;
        renderCalculationComparison(result, baselineDamage?.result);
        const damageRatioHtml = baseline && before ? renderDamageRatio(result.finalDamage.finalDamage, baselineDamage?.result.finalDamage.finalDamage, visibleNumberFormatter) : '';
        writeHtml(damageTarget, `<div class="damage-summary"><div><span>最小攻擊力</span><strong>${fmt(result.attack.lowerDamage)}</strong></div><div><span>最大攻擊力</span><strong>${fmt(result.attack.upperDamage)}</strong></div><div class="final-damage"><span>最終傷害</span><strong>${finalDamageFormat(result.finalDamage.finalDamage)}</strong></div></div>${damageRatioHtml}`, true);
        const calculationDetailsTarget = document.querySelector<HTMLElement>("#calculation-details")!;
        const formulaWasOpen = calculationDetailsTarget.querySelector<HTMLDetailsElement>(".formula-detail")?.open ?? false;
        writeHtml(calculationDetailsTarget, renderDamageFormula(result, sourceLabel, formulaWasOpen, visibleNumberFormatter), true);
      } catch (error) {
        writeHtml(damageTarget, `<p class="input-warning">尚未計算：${h(calculationIssue(error))}請完成後再試。</p>`, true);
        const details = document.querySelector('#calculation-details')!;
        renderedHtml.delete(details); details.replaceChildren();
      }
    } catch (error) {
      const message = h(calculationIssue(error));
      writeHtml(target, `<p class="input-warning" role="status">${message}</p>`, true);
      writeHtml(document.querySelector('#damage-result')!, `<p class="input-warning">尚未計算：${message}</p>`);
      const details = document.querySelector('#calculation-details')!;
      renderedHtml.delete(details); details.replaceChildren();
    }
  }
  let classPickerControl: HTMLElement | undefined;
  let classPickerError: HTMLElement | undefined;
  const classSkillVersionRoot = document.createElement('div');
  classSkillVersionRoot.className = 'class-skill-versions';
  const renderClassSkillVersions = () => {
    const options = getClassSkillVersionOptions(state.Job);
    if (classSkillVersionRoot.dataset.classId !== state.Job) {
      classSkillVersionRoot.dataset.classId = state.Job;
      classSkillVersionRoot.replaceChildren();
      for (const option of options) {
        const label = document.createElement('label'); label.className = 'toggle';
        const input = document.createElement('input'); input.type = 'checkbox';
        input.dataset.classSkillVersion = option.id;
        input.addEventListener('change', () => {
          state.classSkillVersions = { ...state.classSkillVersions, [option.id]: input.checked };
          update();
        });
        label.append(input, document.createTextNode(option.label));
        classSkillVersionRoot.append(label);
      }
    }
    classSkillVersionRoot.hidden = !options.length;
    for (const option of options) {
      classSkillVersionRoot.querySelector<HTMLInputElement>(`input[data-class-skill-version="${option.id}"]`)!.checked = isClassSkillVersionEnabled(option, state.classSkillVersions);
    }
  };
  const renderClassPicker = () => {
    const root = document.querySelector<HTMLElement>('#class-picker')!;
    if (classPickerControl && classPickerError) {
      updatePicker(classPickerControl, state.Job, true);
      classPickerError.textContent = ''; classPickerError.hidden = true;
      renderClassSkillVersions();
      return;
    }
    const error = document.createElement('span');
    error.className = 'input-hint class-picker-error';
    error.hidden = true;
    error.setAttribute('role', 'alert');
    const picker = createPicker('職業', classPickerChoices, state.Job, value => { state.Job = value; error.textContent = ''; error.hidden = true; renderClassSkillVersions(); update(); }, {
      sanitize: sanitizeClassCode,
      resolve: catalogIndex.resolveActiveClassCode,
      onInvalid: value => { error.textContent = value ? '查無此職業代碼，請確認後再按 Enter。' : '請輸入職業代碼。'; error.hidden = false; },
      onInput: () => { error.textContent = ''; error.hidden = true; },
      allowCharacter: character => /^[A-Za-z]$/.test(character),
    });
    const input = picker.querySelector<HTMLInputElement>('input');
    if (input) input.placeholder = '輸入職業代碼（例如 DaB）';
    classPickerControl = picker; classPickerError = error;
    root.replaceChildren(picker, error, classSkillVersionRoot);
    renderClassSkillVersions();
  };
  renderClassPicker();
  renderSkillDamageShare();
  const toggle = document.querySelector<HTMLInputElement>('#alternate')!; toggle.checked = state.lowerwearAlternativeEnabled;
  const nephronRaidLabel = document.createElement('label');
  nephronRaidLabel.className = 'toggle';
  const nephronRaidToggle = document.createElement('input');
  nephronRaidToggle.type = 'checkbox';
  nephronRaidToggle.checked = state.nephronRaidEnabled;
  nephronRaidToggle.addEventListener('change', () => { state.nephronRaidEnabled = nephronRaidToggle.checked; update(); });
  nephronRaidLabel.append(nephronRaidToggle, document.createTextNode('內布隆襲擊戰'));
  const battleHeaderControls = document.createElement('div'); battleHeaderControls.className = 'battle-header-controls';
  const bossHealthControls = document.createElement('div'); bossHealthControls.className = 'boss-health-controls';
  bossHealthControls.innerHTML = '<div class="boss-health-condition"><label class="toggle"><input id="boss-health-enabled" type="checkbox">僅針對 Boss 體力</label><select id="boss-health-comparison" aria-label="Boss 體力條件"><option value="above">大於</option><option value="below">低於</option></select><span>50% 做計算</span></div><label class="boss-health-lowerwear">以<select id="boss-health-lowerwear" aria-label="Boss 體力條件使用下衣"><option value="lowerwearA">下衣</option><option value="lowerwearB">強／排褲</option></select>做計算</label>';
  const bossHealthEnabled = bossHealthControls.querySelector<HTMLInputElement>('#boss-health-enabled')!;
  const bossHealthComparison = bossHealthControls.querySelector<HTMLSelectElement>('#boss-health-comparison')!;
  const bossHealthLowerwear = bossHealthControls.querySelector<HTMLSelectElement>('#boss-health-lowerwear')!;
  const syncBossHealthControls = () => {
    const condition = bossHealthCondition();
    bossHealthEnabled.checked = condition.enabled;
    bossHealthComparison.value = condition.comparison;
    bossHealthLowerwear.value = condition.lowerwear;
    bossHealthLowerwear.parentElement!.hidden = !condition.enabled;
  };
  const applyBossHealthControls = () => {
    state.bossHealthCondition = normalizeBossHealthCondition({ enabled: bossHealthEnabled.checked,
      comparison: bossHealthComparison.value, lowerwear: bossHealthLowerwear.value });
    syncBossHealthControls(); update(); renderInspector();
  };
  for (const control of [bossHealthEnabled, bossHealthComparison, bossHealthLowerwear]) control.addEventListener('change', applyBossHealthControls);
  syncBossHealthControls();
  battleHeaderControls.append(nephronRaidLabel, bossHealthControls);
  document.querySelector<HTMLElement>('.battle-panel > .panel-heading')!.append(battleHeaderControls);
  const battle = document.querySelector<HTMLElement>('#battle-settings')!;
  const battlePickers = new Map<string, { picker: HTMLElement; error: HTMLElement }>();
  const renderBattleSettings = () => {
    if (battlePickers.size) {
      for (const [fieldId, { picker, error }] of battlePickers) {
        updatePicker(picker, val(fieldId), true); error.textContent = ''; error.hidden = true;
      }
      return;
    }
    for (const [fieldId, label] of [['Stage.Adapt','關卡適應力'],['Stage.CritRatePenalty','關卡扣致命'],['Stage.BossDEF','Boss防禦']] as const) {
      const catalog = catalogIndex.validationCatalog(fieldId);
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
      battlePickers.set(fieldId, { picker, error });
      battle.append(picker, error);
    }
  };
  renderBattleSettings();
  toggle.addEventListener('change', () => { state.lowerwearAlternativeEnabled = toggle.checked; update(); renderInspector(); });
  const refreshConfigurationUi = (previousControlSignature: string) => {
    normalizeOptionalEffectValues(state.values, catalogIndex);
    // In-place edits can leave render keys pointing at an older snapshot. A bulk
    // restore must also compare against the configuration actually being replaced.
    if (previousControlSignature !== configurationControlSignature()) configurationControlKeys.clear();
    renderClassPicker();
    toggle.checked = state.lowerwearAlternativeEnabled;
    nephronRaidToggle.checked = state.nephronRaidEnabled;
    syncBossHealthControls();
    renderBattleSettings();
    renderSkillDamageShare();
    update(true);
    if (configurationControlKeys.get('inspector') !== JSON.stringify([selected.id, selectedBeastSlotId, configurationControlSignature()])) renderInspector();
    renderTitleInput();
    if (configurationControlKeys.get('global') !== configurationControlSignature()) renderGlobalInputs();
    if (configurationControlKeys.get('stones') !== configurationControlSignature()) renderWeaponMagicStones();
    refreshRightIceSelectors();
  };
  const applyHistorySnapshot = (snapshot: LoadoutState) => {
    const previousControlSignature = configurationControlSignature();
    Object.assign(state, snapshot);
    // Public/legacy samples may omit these settings. A complete snapshot restore
    // must not retain properties that a later import added to the same object.
    for (const key of ['masterBeastSpiritStoneColor', 'petSkillAttackEnabled', 'nutProtectionPotionEnabled', 'nephronRaidEnabled', 'classSkillVersions', 'bossHealthCondition'] as const) {
      if (!Object.hasOwn(snapshot, key)) delete (state as Partial<LoadoutState>)[key];
    }
    refreshConfigurationUi(previousControlSignature);
  };
  const undo = () => {
    const previous = history.undo();
    if (previous) applyHistorySnapshot(previous);
  };
  const redo = () => {
    const next = history.redo();
    if (next) applyHistorySnapshot(next);
  };
  undoButton.addEventListener('click', () => {
    const hadFocus = document.activeElement === undoButton;
    undo();
    if (hadFocus && undoButton.disabled && !redoButton.disabled) redoButton.focus();
  });
  redoButton.addEventListener('click', () => {
    const hadFocus = document.activeElement === redoButton;
    redo();
    if (hadFocus && redoButton.disabled && !undoButton.disabled) undoButton.focus();
  });
  restoreBaselineButton.addEventListener('click', () => {
    if (!baseline || !baselineIsValid || history.matches(baseline)) return;
    const hadFocus = document.activeElement === restoreBaselineButton;
    applyHistorySnapshot(structuredClone(baseline));
    if (hadFocus && restoreBaselineButton.disabled) baselineButton.focus();
  });
  baselineButton.addEventListener('click', () => {
    try {
      const candidate = structuredClone(state);
      const evaluation = baselineEvaluationCache.get(data, candidate, calculationDataRevision)!;
      if (!evaluation.attributes) throw evaluation.attributeError;
      baseline = candidate;
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
  const loadTransfer = createTransferLoader();
  let exporting = false;
  const exportButton = document.querySelector<HTMLButtonElement>('#export-loadout')!;
  exportButton.innerHTML = '<span class="export-label">匯出配裝</span><span class="export-feedback" aria-hidden="true"></span>';
  const exportFeedback = exportButton.querySelector<HTMLElement>('.export-feedback')!;
  let exportResetTimer: ReturnType<typeof setTimeout> | undefined;
  const setExportState = (value: 'idle' | 'working' | 'success') => {
    exportButton.dataset.exportState = value;
    exportButton.setAttribute('aria-label', value === 'working' ? '正在準備匯出' : value === 'success' ? '開始下載' : '匯出配裝');
    exportButton.disabled = value === 'working' || value === 'success';
    exportFeedback.textContent = value === 'working' ? '準備中…' : value === 'success' ? '開始下載' : '';
  };
  exportButton.addEventListener('click', async () => {
    if (exporting || exportButton.dataset.exportState === 'success') return;
    clearTimeout(exportResetTimer);
    exporting = true;
    setExportState('working');
    document.querySelector<HTMLElement>('#transfer-status')!.textContent = '正在載入配裝匯出功能…';
    try {
      const exportState = structuredClone(state);
      const { serializeLoadout } = await loadTransfer();
      const exported = serializeLoadout(exportState, data, catalogIndex);
      const blobUrl = URL.createObjectURL(new Blob([exported.json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `damage-calculator-loadout-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      const details = exported.omittedFields.length ? `；${exported.omittedFields.length} 個無法識別欄位已留空` : '';
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = `配裝 JSON 已匯出${details}。`;
      setExportState('success');
      exportResetTimer = setTimeout(() => setExportState('idle'), 1000);
    } catch (error) {
      setExportState('idle');
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = `匯出失敗：${error instanceof Error ? error.message : '功能無法載入。'}；可重試，若頁面版本已更新請重新載入。`;
    } finally { exporting = false; }
  });
  const fileInput = document.querySelector<HTMLInputElement>('#loadout-file')!;
  let importRequest = 0;
  document.querySelector<HTMLButtonElement>('#import-loadout')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const request = ++importRequest;
    try {
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = '正在載入配裝匯入功能…';
      const [json, { parseLoadoutJson }] = await Promise.all([file.text(), loadTransfer()]);
      if (request !== importRequest) return;
      const imported = parseLoadoutJson(json, state, data, catalogIndex);
      const previousControlSignature = configurationControlSignature();
      Object.assign(state, imported.state);
      if (!Object.hasOwn(imported.state, 'classSkillVersions')) delete state.classSkillVersions;
      if (!Object.hasOwn(imported.state, 'bossHealthCondition')) delete state.bossHealthCondition;
      normalizePortraitAwakeningValues(state);
      const duplicateTransformationFields = clearDuplicateTransformationChoices(state);
      const duplicateNephronTransformationFields = clearDuplicateNephronTransformationChoices(state);
      applyWeaponMagicStonePreset(String(state.values[data.weaponGrades.settingKey] ?? ''));
      refreshConfigurationUi(previousControlSignature);
      const clearedFields = [...new Set([...imported.clearedFields, ...duplicateTransformationFields, ...duplicateNephronTransformationFields])];
      const partial = clearedFields.length ? `；${clearedFields.length} 個無法對應或重複的欄位已留空（${clearedFields.slice(0, 5).join('、')}${clearedFields.length > 5 ? '…' : ''}）` : '';
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = `${sampleMode ? '配裝已匯入；範例模式不會儲存到此裝置' : '配裝已匯入並儲存於此裝置'}${partial}。`;
    } catch (error) {
      if (request !== importRequest) return;
      document.querySelector<HTMLElement>('#transfer-status')!.textContent = `匯入失敗：${error instanceof Error ? error.message : '檔案無法讀取。'}`;
    } finally {
      if (request === importRequest) fileInput.value = '';
    }
  });
  renderSlots(); renderInspector(); renderTitleInput(); renderBeastAccessories(); renderMasterBeastColorSelector(); renderGlobalInputs(); renderWeaponMagicStones(); renderRightIceSetSelectors(); renderResults(); refreshHistoryControls();
  if (optimizerApplied) {
    history.record(state);
    const stored = saveState(state);
    document.querySelector<HTMLElement>('#save-status')!.textContent = stored
      ? '冰裝穿搭已套用並儲存；可以使用復原返回原配裝。'
      : '冰裝穿搭已套用，但此瀏覽器無法儲存設定。';
    refreshHistoryControls();
  } else if (optimizerApplyMessage) {
    document.querySelector<HTMLElement>('#save-status')!.textContent = optimizerApplyMessage;
  }
  disclosurePreferences.restore(document);
}
start().catch(error => { document.querySelector('#app')!.innerHTML = `<section class="error-card"><h1>無法載入工具</h1><p>${h(error instanceof Error ? error.message : error)}</p></section>`; });
