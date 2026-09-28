import { getEquipmentOptionName } from '../calculation/equipment-catalog.ts';
import { loadGameData, localCell, readJson, escapeHtml as h, formatNumber as fmt } from './data.ts';
import { readState, readBaseline, saveState, type LoadoutState } from './state.ts';
import { projectAttributes } from './projection.ts';
import { projectDamage } from './projection.ts';
import { compareDamageResults } from './damage-comparison.ts';
import { compareSheetParity, type SheetParityReference } from './sheet-parity.ts';
import { createPicker, type PickerOption } from './picker.ts';
import { icon } from './icons.ts';

async function start() {
  const data = await loadGameData();
  const sampleId = new URLSearchParams(location.search).get('sample');
  if (sampleId !== null && !/^[a-z0-9-]+$/.test(sampleId)) throw new RangeError('驗算範例名稱無效。');
  const sampleMode = sampleId !== null;
  const state: LoadoutState = sampleMode
    ? await readJson<LoadoutState>(`examples/${sampleId}.json`)
    : readState(data.classes.classes.find(entry => entry.active)?.id ?? 'DaB');
  const sheetReference = sampleMode
    ? await readJson<SheetParityReference>(`examples/${sampleId}-expected.json`)
    : null;
  let baseline = sampleMode ? null : readBaseline(), selected = data.layout.slots.find(slot => slot.weapon)!;
  type BeastAccessorySlotId = 'headwear' | 'armor' | 'necklace' | 'ring-one' | 'ring-two';
  type BeastManualCategory = keyof typeof data.masterBeast.customAttributeOptions;
  let selectedBeastSlotId: BeastAccessorySlotId | null = null;
  const beastAccessorySlots: readonly {
    id: BeastAccessorySlotId; label: string; icon: string;
    fixedCells?: readonly [string, string]; stoneCells?: readonly [string, string]; stoneCategory?: BeastManualCategory;
    mirrorRows: readonly [number, number, number];
  }[] = [
    { id: 'headwear', label: '頭飾', icon: 'hair', fixedCells: ['N27', 'N28'], stoneCells: ['M27', 'M28'], stoneCategory: 'head', mirrorRows: [27, 28, 29] },
    { id: 'armor', label: '盔甲', icon: 'upper', mirrorRows: [30, 31, 32] },
    { id: 'necklace', label: '項鍊', icon: 'necklace', stoneCells: ['M33', 'M34'], stoneCategory: 'necklace', mirrorRows: [33, 34, 35] },
    { id: 'ring-one', label: '指環 1', icon: 'ring', fixedCells: ['N36', 'N37'], stoneCells: ['M36', 'M37'], stoneCategory: 'ring', mirrorRows: [36, 37, 38] },
    { id: 'ring-two', label: '指環 2', icon: 'ring', fixedCells: ['N39', 'N40'], stoneCells: ['M39', 'M40'], stoneCategory: 'ring', mirrorRows: [39, 40, 41] },
  ];
  const app = document.querySelector<HTMLElement>('#app')!;
  app.innerHTML = `<section class="workbench"><header class="workspace-heading"><div><span class="eyebrow">EQUIPMENT SIMULATOR</span><h1>配出你的戰鬥風格</h1><p>依照裝備位置點選部位，調整搭配與數值。</p></div></header><div class="toolbar"><div id="class-picker"></div><label class="toggle"><input id="alternate" type="checkbox">啟用強/排褲切換</label><button id="baseline" type="button">設為比較基準</button><span id="save-status" role="status"></span></div><section class="battle-panel"><div class="panel-heading"><h2>關卡設定</h2></div><div id="battle-settings" class="battle-fields"></div></section><div class="equipment-workspace"><section class="equipment-panel"><div class="panel-heading"><h2>裝備配置</h2><span>點選部位以編輯</span></div><div class="canvas-scroll"><div class="equipment-canvas"><span class="group-label costume-label">連身時裝</span><span class="group-label left-label">左冰</span><span class="group-label inner-label">內裝左四</span><span class="group-label weapon-label">冰武 / 武器</span><span class="group-label right-label">右冰</span><span class="group-label accessory-label">飾品</span><div id="title-input" class="canvas-title-input"></div><div id="slots"></div></div></div><p class="panel-note">左冰共用一組套裝選擇，各部位魔法石分別設定。強/排褲開啟後，普通屬性依兩套下衣平均。</p><section class="right-ice-set-area"><div class="beast-accessories-heading"><h3>右冰套效</h3><span>最多選擇 ${data.rightIceSets.maxSelectedSets} 套</span></div><p class="panel-note">先選擇要套用效果的套裝，再依已裝備的右冰件數計算效果。</p><div id="right-ice-set-selectors" class="right-ice-set-selectors"></div></section><div class="beast-accessories-area"><div class="beast-accessories-heading"><h3>聖獸飾品</h3><span>頭飾、盔甲、項鍊、指環 1、指環 2</span></div><p class="panel-note">依部位設定固定效果、精靈石與三組迷鏡效果。盔甲精靈石套裝增幅 ${fmt(data.masterBeast.armorSpiritStoneSetEffect.multiplicativeDamagePct)}% 已預設套用。</p><div id="beast-accessory-fields" class="beast-accessories-grid"></div></div></section><aside id="inspector" class="inspector" aria-label="部位設定"></aside></div><details class="global-source-panel"><summary>其他效果來源設定</summary><p class="panel-note">未列在此處的特殊條件或 Buff／Debuff 尚未納入計算。</p><div id="global-source-fields"></div></details><section class="results-panel"><div class="panel-heading"><h2>目前填寫的屬性</h2><span id="comparison-label"></span></div><p class="panel-note">屬性彙總與傷害依畫面已接入的裝備、內裝、關卡及其他效果設定計算。特殊條件與 Buff／Debuff 若尚無明確欄位映射，不會計入結果。</p><div id="results" aria-live="polite"></div><section class="damage-panel"><div class="panel-heading"><h2>攻擊與最終傷害</h2></div><p class="panel-note">此數值只反映已接入的輸入；其餘來源完成接線前，請視為部分配置的估算。</p><div id="damage-result" aria-live="polite"></div></section></section></section>`;
  if (sampleMode) {
    app.querySelector('.workspace-heading')!.insertAdjacentHTML('afterend', '<p class="sample-banner">已載入驗算範例。這個分頁的調整不會覆蓋你原本儲存在瀏覽器的配裝。</p>');
    app.querySelector('.results-panel')!.insertAdjacentHTML('beforeend', '<section id="sheet-parity" class="sheet-parity" aria-live="polite"></section>');
    document.querySelector('footer')!.textContent = '這個分頁使用驗算範例；調整只保留至關閉或重新整理頁面。';
    document.querySelector('#save-status')!.textContent = '驗算範例模式';
  }
  document.querySelector('#beast-accessory-fields')!.insertAdjacentHTML('beforebegin', '<div id="master-beast-controls" class="master-beast-controls"></div>');
  const val = (cell: string) => String(state.values[localCell(cell)] ?? '');
  const summary = (stats: Readonly<Record<string, number>>) => Object.entries(stats).filter(([, value]) => value !== 0).map(([key, value]) => `${data.attributes.attributes.find(a => a.key === key)?.name ?? key} ${fmt(value)}`).join(' · ');
  const options = (names: readonly string[]): PickerOption[] => names.map(name => ({ value: name, label: name }));
  const columnNumber = (letters: string) => [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  const rangeContains = (range: string, cell: string) => {
    if (!range.includes(':')) return range === cell;
    const [start, end] = range.split(':');
    const parse = (address: string) => {
      const match = address.match(/^([A-Z]+)([0-9]+)$/);
      return match ? { column: columnNumber(match[1]), row: Number(match[2]) } : null;
    };
    const a = parse(start), b = parse(end), target = parse(cell);
    return !!a && !!b && !!target && target.column >= a.column && target.column <= b.column && target.row >= a.row && target.row <= b.row;
  };
  const validationChoices = (cell: string, percentLabel = false): PickerOption[] => {
    const input = data.simulatorInputs.inputs.find(entry => entry.simulatorCells.split(/\s+/).some(range => rangeContains(range, cell)));
    const catalog = input && data.simulatorInputs.catalogs.find(entry => entry.id === input.catalogId);
    return (catalog?.options ?? []).map(option => {
      const value = String(option.value);
      return { value, label: percentLabel && typeof option.value === 'number' ? `${value}%` : value };
    });
  };
  const update = () => {
    document.querySelector('#save-status')!.textContent = sampleMode ? '驗算範例模式：本頁調整不儲存' : saveState(state) ? '已儲存於此裝置' : '此瀏覽器無法儲存設定';
    renderSlots(); renderBeastAccessories(); renderMasterBeastColorSelector(); renderResults();
  };
  function sourceLabel(sourceId: string): string {
    if (sourceId === 'character-base') return '角色基礎係數';
    if (sourceId === 'character-base:crit-damage-product') return '角色原始乘算爆傷基準';
    if (sourceId === 'weapon-base-attack:C53:D53') return '武器基礎攻擊力';
    if (sourceId.startsWith('sheet:計算機!')) {
      const cell = sourceId.slice('sheet:計算機!'.length);
      if (Object.values(data.masterBeast.overallPotentialSourceCells).includes(cell)) return '聖獸潛力';
      if (cell === 'E76') return '大師聖獸固定效果（技能類雙攻）';
      if (cell === 'E93') return '寵物被動（技能類雙攻）';
      if (cell === 'Q37') return '百億套效';
      if (cell === 'Q53') return '武器';
      if (cell === 'Q86' || cell === 'R86') return '稱號';
      if (cell === 'T101') return '百億紅上衣、暴上';
      if (cell === 'T102') return 'MAESTRO光環';
      return `試算表固定數值（計算機!${cell}）`;
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
      const slotId = sourceId.slice('circuit-board:'.length);
      const slot = data.circuits.inputs.find(entry => entry.slot === slotId);
      return slot ? `電路板 ${slotId}：${String(state.values[localCell(slot.attributeCell)] ?? '')} ${fmt(Number(state.values[localCell(slot.valueCell)] ?? 0) * 100)}%` : `電路板來源待確認（${sourceId}）`;
    }
    if (sourceId.startsWith('color-set:')) return `百億套效：${sourceId.slice('color-set:'.length)}`;
    if (sourceId.startsWith('master-beast:')) {
      const [, part, detail] = sourceId.split(':');
      const partNames: Record<string, string> = { head: '頭飾', ring: '指環' };
      if (part === 'mirror') {
        const row = Number(detail) + 26;
        return `聖獸迷鏡效果：${String(state.values[`O${row}`] ?? '')}`;
      }
      if (part === 'head-manual') return `聖獸頭飾精靈石：${String(state.values.M27 ?? '')}`;
      if (part === 'necklace-manual') return `聖獸項鍊精靈石：${String(state.values.M33 ?? '')}`;
      if (part === 'ring-manual') {
        const cell = detail === '1' ? 'M36' : 'M39';
        return `聖獸指環精靈石：${String(state.values[cell] ?? '')}`;
      }
      if (partNames[part]) {
        const cell = part === 'head' ? detail === '1' ? 'N27' : 'N28' : detail === '1' ? 'N36' : 'N39';
        return `聖獸${partNames[part]}固定效果：${String(state.values[cell] ?? '')}`;
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
      'atma-water-fire-multiplicative-damage': '流水／火焰亞特瑪乘算傷害',
      'atma-wood-multiplicative-crit-damage': '草木亞特瑪乘算致命傷害',
    };
    if (atma) return atmaNames[atma.id] ?? `亞特瑪來源待確認（${atma.id}）`;
    if (sourceId.startsWith('weapon-growth')) return `武器成長：${String(state.values[localCell(data.growth.selectorCell)] ?? '')}`;
    if (sourceId.startsWith('weapon-appraisal:')) {
      const cell = sourceId.slice('weapon-appraisal:'.length);
      const group = Object.values(data.weaponAppraisals.groups).find(entry => localCell(entry.selectorCell) === cell);
      return `武器鑑定${group ? `：${String(state.values[cell] ?? '')}` : ''}`;
    }
    if (sourceId.startsWith('giant-stone:')) {
      const cell = sourceId.slice('giant-stone:'.length);
      return `巨型魔力石：${String(state.values[cell] ?? '')}`;
    }
    if (sourceId.startsWith('weapon-grade:')) return '武器等級效果';
    if (sourceId.startsWith('weapon-transform:')) {
      const cell = sourceId.slice('weapon-transform:'.length);
      return `武器變換：${String(state.values[cell] ?? '')}`;
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
    if (sourceId.startsWith('title:')) return `稱號：${String(state.values.B2 ?? '')}`;
    if (sourceId.startsWith('consumable:')) return `消耗品：${String(state.values.B4 ?? '')}`;
    if (sourceId.startsWith('environment:')) return `場地：${String(state.values.B5 ?? '')}`;
    if (sourceId.startsWith('peak-option:')) return `巔峰選項：${String(state.values.S2 ?? '')}`;
    if (sourceId.startsWith('pet:')) return `寵物：${String(state.values.S23 ?? '')}`;
    const binaryEffect = data.otherEffects.binaryEffects.find(entry => entry.name === sourceId);
    if (binaryEffect) return `${binaryEffect.name}：${String(state.values[localCell(binaryEffect.selectorCell)] ?? '')}`;
    if (sourceId.startsWith('guild-fountain-')) {
      const stage = data.otherEffects.guildFountain.find(entry => sourceId === `guild-fountain-${entry.stage}`);
      return `公會噴泉（${stage ? String(state.values[localCell(stage.selectorCell)] ?? '') : sourceId.slice('guild-fountain-'.length)}）`;
    }
    return `來源名稱待確認（${sourceId}）`;
  }
  const sourceRows = (sources: readonly { sourceId: string; valuePct: number }[], isPercent: boolean) =>
    sources.length
      ? sources.map(source => `<p class="stat-source-row"><span>${h(sourceLabel(source.sourceId))}</span><strong>${fmt(source.valuePct)}${isPercent ? '%' : ''}</strong></p>`).join('')
      : '<p class="stat-source-empty">無來源</p>';
  const field = (parent: HTMLElement, label: string, cell: string, choices: readonly PickerOption[], redraw = false) => {
    parent.append(createPicker(label, choices, val(cell), value => {
      state.values[localCell(cell)] = value; update(); renderRightIceSetSelectors();
      if (redraw) {
        const opened = [...document.querySelectorAll<HTMLDetailsElement>('#inspector details[open]')].map(node => node.querySelector('summary')!.textContent);
        renderInspector();
        document.querySelectorAll<HTMLDetailsElement>('#inspector details').forEach(node => { node.open = opened.includes(node.querySelector('summary')!.textContent); });
      }
    }));
  };
  function renderRightIceSetSelectors() {
    const root = document.querySelector<HTMLElement>('#right-ice-set-selectors');
    if (!root) return;
    const cells = data.rightIceSets.selectionCells;
    const allowedNames = [...new Set(validationChoices(cells[0]).map(option => option.value))];
    const equipped = data.mapping.selections
      .filter(entry => entry.catalogFile.endsWith('right-ice.json'))
      .map(entry => val(entry.selectionCell));
    const selectedNames = cells.map(val);
    root.replaceChildren();
    cells.forEach((cell, index) => {
      const usedElsewhere = new Set(selectedNames.filter((name, other) => other !== index && name !== ''));
      const choices = allowedNames
        .filter(name => !usedElsewhere.has(name) || name === selectedNames[index])
        .map(name => ({ value: name, label: name, detail: `目前裝備 ${equipped.filter(item => item === name).length} 件` }));
      root.append(createPicker(`套效選擇 ${index + 1}`, choices, selectedNames[index], value => {
        state.values[localCell(cell)] = value;
        update();
        renderRightIceSetSelectors();
      }));
    });
    if (new Set(selectedNames.filter(Boolean)).size !== selectedNames.filter(Boolean).length) {
      const warning = document.createElement('p');
      warning.className = 'input-warning right-ice-selection-warning';
      warning.textContent = '同一套裝不可重複選擇；請清除重複項目。';
      root.append(warning);
    }
  }
  const numeric = (parent: HTMLElement, label: string, cell: string, percentage = true, constraints?: { min: number; max: number; step: number }) => {
    const wrapper = document.createElement('label'); wrapper.className = 'field'; wrapper.textContent = label;
    const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.placeholder = '請填寫數值';
    if (constraints) { input.min = String(constraints.min); input.max = String(constraints.max); input.step = String(constraints.step); }
    input.value = val(cell) === '' ? '' : String(Number(val(cell)) * (percentage ? 100 : 1));
    input.addEventListener('input', () => { if (!input.validity.valid) return; state.values[localCell(cell)] = input.value === '' ? '' : Number(input.value) / (percentage ? 100 : 1); update(); });
    wrapper.append(input); parent.append(wrapper);
  };
  const section = (parent: HTMLElement, label: string, open = false) => {
    const details = document.createElement('details'); details.className = 'editor-section'; details.open = open;
    const title = document.createElement('summary'); title.textContent = label; details.append(title); parent.append(details); return details;
  };
  function renderGlobalInputs() {
    const root = document.querySelector<HTMLElement>('#global-source-fields')!;
    root.replaceChildren();
    const group = (label: string) => {
      const container = document.createElement('section'); container.className = 'global-input-group';
      const heading = document.createElement('h3'); heading.textContent = label; container.append(heading);
      const grid = document.createElement('div'); grid.className = 'global-input-grid'; container.append(grid); root.append(container); return grid;
    };
    const pick = (container: HTMLElement, label: string, cell: string, entries: readonly { name: string }[]) =>
      field(container, label, cell, options([...new Set(entries.map(entry => entry.name))]));
    const general = group('增益與環境');
    pick(general, '消耗品', 'B4', data.otherEffects.consumables);
    pick(general, '場地', 'B5', data.otherEffects.environments);
    pick(general, '巔峰選項', 'S2', data.otherEffects.peakOptions);
    pick(general, '寵物', 'S23', data.pets.options);
    const petSkillToggle = document.createElement('label');
    petSkillToggle.className = 'pet-skill-toggle';
    const petSkillCheckbox = document.createElement('input');
    petSkillCheckbox.type = 'checkbox';
    petSkillCheckbox.checked = state.petSkillAttackEnabled;
    petSkillCheckbox.addEventListener('change', () => { state.petSkillAttackEnabled = petSkillCheckbox.checked; update(); });
    const petSkillLabel = document.createElement('span');
    petSkillLabel.textContent = '寵物具有 2% 技能類雙攻';
    petSkillToggle.append(petSkillCheckbox, petSkillLabel);
    general.append(petSkillToggle);
    for (const effect of data.otherEffects.binaryEffects) pick(general, effect.name, localCell(effect.selectorCell), effect.options);
    field(general, '百億套效', data.colorSetEffects.selectorCell, options(data.colorSetEffects.options.map(option => option.name)));
    const atma = group('亞特瑪');
    field(atma, '亞特瑪屬性', 'L9', options(['火焰', '流水', '草木']));
    field(atma, '亞特瑪顏色', 'N9', options(['藍色', '綠色', '紫色', '米色']));
    const resonance = group('共鳴輸入');
    for (const effect of data.resonance.effects) numeric(resonance, effect.name, localCell(effect.inputCell), false);
    const spirit = group('賦靈錄');
    const spiritClassOptions = options(data.spiritRecord.classSelectors.classes.map(entry => entry.classCode));
    data.spiritRecord.classSelectors.selectorCells.forEach((cell, index) => field(spirit, `職業 ${index + 1}`, cell, spiritClassOptions));
    const fountain = group('公會噴泉');
    for (const stage of data.otherEffects.guildFountain) pick(fountain, `${stage.stage}階`, localCell(stage.selectorCell), stage.options);
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
    field(inputs, '聖獸潛力', 'S25', options(data.masterBeast.options.filter(option => option.category === 'overall').map(option => option.name)));
    const potential = data.masterBeast.options.find(option => option.category === 'overall' && option.name === val('S25'));
    const potentialText = potential
      ? Object.entries(potential.stats).map(([key, value]) => `${data.attributes.attributes.find(entry => entry.key === key)?.name ?? key} +${fmt(value)}`).join('、')
      : '尚未選擇潛力效果';
    root.insertAdjacentHTML('beforeend', `<div class="master-beast-source-notes"><p><strong>固定效果：</strong>技能類雙攻 +3%（轉職後固定擁有）。</p><p><strong>精靈石效果：</strong>選黃時，致命一擊與極大化各乘算 +${fmt(data.parameters.yellowBeastSpiritStoneRatePct)}%；選綠時不套用。</p><p><strong>潛力效果：</strong>${h(potentialText)}</p></div>`);
  }
  function renderTitleInput() {
    field(document.querySelector<HTMLElement>('#title-input')!, '稱號', 'B2', options([...new Set(data.otherEffects.titles.map(entry => entry.name))]));
  }
  function renderBeastAccessories() {
    const root = document.querySelector<HTMLElement>('#beast-accessory-fields')!;
    root.replaceChildren();
    for (const slot of beastAccessorySlots) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'beast-accessory-slot';
      const cells = [...(slot.fixedCells ?? []), ...(slot.stoneCells ?? []), ...slot.mirrorRows.flatMap(row => [`O${row}`, `P${row}`])];
      const hasValue = cells.some(cell => val(cell) !== '');
      button.classList.toggle('configured', hasValue);
      button.classList.toggle('selected', selectedBeastSlotId === slot.id);
      button.setAttribute('aria-label', `${slot.label}${hasValue ? '（已設定）' : ''}`);
      button.setAttribute('aria-pressed', String(selectedBeastSlotId === slot.id));
      button.innerHTML = `${icon(slot.icon)}<span>${h(slot.label)}</span>${hasValue ? '<i></i>' : ''}`;
      button.addEventListener('click', () => {
        selectedBeastSlotId = slot.id;
        renderBeastAccessories(); renderInspector();
      });
      root.append(button);
    }
  }
  function renderBeastInspector(panel: HTMLElement) {
    const slot = beastAccessorySlots.find(candidate => candidate.id === selectedBeastSlotId)!;
    panel.innerHTML = `<div class="inspector-title beast-inspector-title"><span class="beast-inspector-icon">${icon(slot.icon)}</span><div><small>聖獸飾品</small><h2>${h(slot.label)}</h2></div></div>`;
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
      field(stone, '精靈石屬性', attributeCell, options(data.masterBeast.customAttributeOptions[slot.stoneCategory]));
      field(stone, '精靈石數值（%）', valueCell, validationChoices(valueCell, true));
    } else {
      stone.insertAdjacentHTML('beforeend', `<p class="panel-note beast-mapping-note">盔甲精靈石的個別屬性不影響傷害，無需設定。精靈石套裝增幅 ${fmt(data.masterBeast.armorSpiritStoneSetEffect.multiplicativeDamagePct)}% 已預設套用。</p>`);
    }

    const mirrorArea = section(panel, '迷鏡效果', true);
    mirrorArea.classList.add('beast-mirror-section');
    const mirrorGrid = document.createElement('div'); mirrorGrid.className = 'beast-mirror-grid'; mirrorArea.append(mirrorGrid);
    slot.mirrorRows.forEach((row, index) => {
      const attributeCell = `O${row}`;
      field(mirrorGrid, `迷鏡效果 ${index + 1} 屬性`, attributeCell, options(data.masterBeast.customAttributeOptions.mirror), true);
      const valueRule = data.masterBeast.mirrorValueRules.byAttribute[val(attributeCell)] ?? data.masterBeast.mirrorValueRules.default;
      numeric(
        mirrorGrid,
        `迷鏡效果 ${index + 1} 數值（%）`,
        `P${row}`,
        true,
        { min: valueRule.minPct, max: valueRule.maxPct, step: valueRule.stepPct },
      );
    });
  }
  function renderSlots() {
    const container = document.querySelector('#slots')!; container.replaceChildren();
    for (const slot of data.layout.slots) {
      const group = data.layout.groups.find(group => group.id === slot.group)!;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'gear-slot';
      button.style.cssText = `left:${slot.x}%;top:${slot.y}%;--group-color:${group.color}`;
      const configured = slot.selectionCell ? val(slot.selectionCell) : slot.weapon ? val('B32') : slot.innerwearId ? val(data.innerwear.slots.find(s => s.id === slot.innerwearId)!.enhancementCell) : '';
      button.classList.toggle('configured', !!configured); button.classList.toggle('selected', selected.id === slot.id);
      button.classList.toggle('inactive', !!slot.enabledBy && !state.lowerwearAlternativeEnabled);
      button.setAttribute('aria-label', `${group.name} ${slot.label}：${configured || '未設定'}`); button.setAttribute('aria-pressed', String(selected.id === slot.id));
      button.title = `${group.name} ${slot.label}${configured ? '\n' + configured : ''}`;
      button.innerHTML = `<span>${h(slot.label)}</span>${configured ? '<i></i>' : ''}`;
      button.addEventListener('click', () => { selected = slot; selectedBeastSlotId = null; renderSlots(); renderBeastAccessories(); renderInspector(); }); container.append(button);
    }
  }
  function renderInspector() {
    const panel = document.querySelector<HTMLElement>('#inspector')!;
    if (selectedBeastSlotId) { renderBeastInspector(panel); return; }
    const group = data.layout.groups.find(group => group.id === selected.group)!;
    panel.innerHTML = `<div class="inspector-title" style="--group-color:${group.color}">${icon(selected.icon)}<div><small>${h(group.name)}</small><h2>${h(selected.label)}</h2></div></div>`;
    if (selected.enabledBy && !state.lowerwearAlternativeEnabled) { panel.insertAdjacentHTML('beforeend', '<p class="panel-note">請先啟用上方「強/排褲切換」。設定會保留於裝置，停用時不參與計算。</p>'); return; }
    if (selected.selectionCell) {
      const selectionCell = selected.selectionCell;
      const mapping = data.mapping.selections.find(entry => entry.selectionCell === selectionCell)!;
      const items = data.catalogs[mapping.catalogFile].items.filter(item => item.active && item.slotId === mapping.slotId);
      const isAccessory = mapping.catalogFile === 'equipment/accessories.json';
      field(panel, selected.sharedSelection ? '左冰套裝（五部位共用）' : '選擇裝備', selectionCell, items.map(item => ({ value: item.name, label: item.name, detail: summary(item.stats ?? {}) })), isAccessory);
      if (isAccessory) {
        const appraisalGroup = data.accessoryEffects.groups.find(entry => entry.selectionCell === selectionCell);
        const selectedItem = items.find(item => item.name === val(selectionCell));
        if (selectedItem && !appraisalGroup) {
          panel.insertAdjacentHTML('beforeend', '<p class="panel-note">目前沒有設定此飾品部位的鑑定效果欄位；即使資料目錄填入可鑑定狀態，這裡仍不會顯示或計算鑑定效果。</p>');
        }
        if (appraisalGroup && selectedItem) {
          const appraisal = selectedItem.appraisal;
          if (!appraisal || appraisal.canAppraise === null || appraisal.effectCount === null) {
            panel.insertAdjacentHTML('beforeend', '<p class="panel-note">此飾品的「是否可鑑定」與「鑑定效果條數」尚未設定；未確認前不會套用鑑定效果。更新 <code>data/equipment/accessories.json</code> 後即可啟用。</p>');
          } else if (!appraisal.canAppraise) {
            panel.insertAdjacentHTML('beforeend', '<p class="panel-note">此飾品不可鑑定。</p>');
          } else if (Number.isInteger(appraisal.effectCount) && appraisal.effectCount > 0 && appraisal.effectCount <= appraisalGroup.inputCells.length) {
            const appraisalArea = section(panel, '飾品鑑定', true);
            appraisalGroup.inputCells.slice(0, appraisal.effectCount).forEach((cell, index) => field(appraisalArea, `鑑定效果 ${index + 1}`, cell, validationChoices(cell)));
          } else {
            panel.insertAdjacentHTML('beforeend', '<p class="input-warning">此飾品的鑑定效果條數資料不正確，請檢查裝備 JSON。</p>');
          }
        }
      }
    }
    if (selected.innerwearId) {
      const slot = data.innerwear.slots.find(slot => slot.id === selected.innerwearId)!;
      field(panel, '強化', slot.enhancementCell, options(Object.keys(data.innerwear.enhancementStats).map(level => `Lv.${level}`)));
      field(panel, '鍛造', slot.forgingCell, options(Object.keys(data.innerwear.forgingAttack)));
      panel.insertAdjacentHTML('beforeend', '<p class="panel-note">鍛造達到門檻才套用對應效果，未達門檻為 0。</p>');
    }
    if (selected.weapon) {
      field(panel, '武器等級', data.weaponGrades.selectorCell, data.weaponGrades.options.map(option => ({ value: option.name, label: option.name })));
      field(panel, '武器強化', 'B32', options(Object.keys(data.attack.weaponEnhancementFactors).map(level => `Lv.${level}`)));
      field(panel, '武器成長', data.growth.selectorCell, data.growth.levels.map(level => ({ value: level.name, label: level.name, detail: summary(level.stats) })));
    }
    if (selected.stoneCells?.length) {
      const area = section(panel, '魔法石', true);
      for (const [index, cell] of selected.stoneCells.entries()) {
        const mapping = data.mapping.magicStoneSelections.inputGroups.find(entry => entry.selectionCell === cell)!;
        const items = data.catalogs[data.mapping.magicStoneSelections.catalogFile].items.filter(item => item.active);
        field(area, `魔法石 ${index + 1}`, cell, items.map(item => ({ value: getEquipmentOptionName(item, mapping.application), label: getEquipmentOptionName(item, mapping.application), detail: summary(item.targetApplications?.[mapping.application]?.stats ?? item.stats ?? {}) })));
      }
    }
    if (selected.innerwearId) {
      const appraisal = data.appraisals.slots.find(slot => slot.id === selected.innerwearId)!;
      const area = section(panel, '鑑定'); appraisal.inputCells.forEach((cell, i) => field(area, `鑑定 ${i + 1}`, cell, data.appraisals.options.map(option => ({ value: option.name, label: option.name }))));
      const circuit = data.circuits.inputs.find(slot => slot.slot === selected.innerwearId)!;
      const board = section(panel, '電路板'); field(board, '電路板項目', circuit.attributeCell, options([...Object.keys(data.circuits.statKeyBySheetName), '無關傷害'])); numeric(board, '電路板數值（%）', circuit.valueCell);
      const chip = data.chipSlots.slots.find(slot => slot.id === selected.innerwearId)!;
      const chipArea = section(panel, '芯片與芯片調校');
      field(chipArea, '芯片屬性', chip.attributeCell, options(data.chips.chips.map(entry => entry.name)), true);
      const chosen = data.chips.chips.find(entry => entry.name === val(chip.attributeCell));
      field(chipArea, '芯片調校等級', chip.tuningCell, options(chosen?.tuningLevels.map(level => level.level) ?? []));
    }
    if (selected.weapon) {
      const appraisal = section(panel, '武器鑑定'); Object.values(data.weaponAppraisals.groups).forEach((group, i) => field(appraisal, `鑑定 ${i + 1}`, group.selectorCell, group.options.map(option => ({ value: option.name, label: option.name }))));
      const giant = section(panel, '巨型魔力石'); data.giantStones.selectorCells.forEach((cell, i) => field(giant, `巨型魔力石 ${i + 1}`, cell, data.giantStones.options.map(option => ({ value: option.name, label: option.name }))));
      const transform = section(panel, '武器變換'); data.transformations.slots.forEach((slot, i) => {
        field(transform, `變換 ${i + 1}`, slot.choiceCell, options(data.transformations.options), true);
        const percentage = data.transformations.rules.find(rule => rule.choice === val(slot.choiceCell))?.valueMultiplier !== 1;
        numeric(transform, `變換 ${i + 1} 數值${percentage ? '（%）' : '（等級）'}`, slot.valueCell, percentage);
      });
    }
  }
  function renderSheetParity(result: ReturnType<typeof projectDamage>['result']) {
    if (!sheetReference) return;
    const rows = compareSheetParity(result, sheetReference);
    const mismatches = rows.filter(row => !row.matches);
    const precise = (value: number) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 10 }).format(value);
    const activeAttackType = data.classes.classes.find(entry => entry.id === state.classId)?.attackType;
    const relevantAttackCell = activeAttackType === 'physical' ? 'C1' : 'D1';
    const relevantWeaponBaseCell = activeAttackType === 'physical' ? 'C53' : 'D53';
    const table = (items: typeof rows) => `<div class="sheet-parity-scroll"><table><thead><tr><th>項目</th><th>原配置</th><th>新配置</th><th>差異</th></tr></thead><tbody>${items.filter(row => !['C1', 'D1'].includes(row.cell) || row.cell === relevantAttackCell).filter(row => !['C53', 'D53'].includes(row.cell) || row.cell === relevantWeaponBaseCell).map(row => {
      const label = ['C1', 'D1'].includes(row.cell) ? '攻擊力' : ['C53', 'D53'].includes(row.cell) ? '武器基礎攻擊力' : row.label;
      const rowClass = row.matches ? '' : `sheet-parity-difference ${row.delta > 0 ? 'sheet-parity-positive' : row.delta < 0 ? 'sheet-parity-negative' : ''}`;
      return `<tr class="${rowClass}"><th scope="row">${h(label)}</th><td>${precise(row.expected)}</td><td>${precise(row.actual)}</td><td class="${row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : ''}">${row.delta > 0 ? '+' : ''}${precise(row.delta)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    const bleed = rows.find(row => row.cell === 'M1');
    const damage = rows.find(row => row.cell === 'B163');
    const damageWithoutBleedDifference = bleed && damage
      ? damage.actual * (1 + bleed.expected / 100) / (1 + bleed.actual / 100)
      : NaN;
    const knownRightIceDifference = mismatches.length === 2
      && bleed?.matches === false && Math.abs(bleed.delta - 5) < 1e-9
      && damage?.matches === false
      && Math.abs(damageWithoutBleedDifference - damage.expected) < 1e-6;
    document.querySelector('#sheet-parity')!.innerHTML = `<h3>計算結果驗算</h3><p>依未格式化數值比對 ${rows.length} 項：${rows.length - mismatches.length} 項相同、${mismatches.length} 項不同。最終傷害參考值依來源公式與原始數值重算，避免顯示精度影響比較。</p>${mismatches.length ? table(mismatches) : ''}${knownRightIceDifference ? '<p>目前差異可由流血 +5% 解釋。網站依選中的套裝及右冰實際件數計算套效；請核對所選套裝與參考配置。</p>' : ''}<details><summary>本次比對採用的固定數值假設</summary><p>部分固定數值沒有啟用條件公式。網站暫依參考配置計入以重現此配置，不能據此認定它們對所有配裝都有效。</p></details><details><summary>查看適用的比較值（${rows.length} 項已驗算）</summary>${table(rows)}</details>`;
  }
  function renderResults() {
    if (sheetReference) document.querySelector('#sheet-parity')!.replaceChildren();
    const target = document.querySelector('#results')!;
    try {
      const current = projectAttributes(data, state); let before: ReturnType<typeof projectAttributes> | null = null;
      try { if (baseline) before = projectAttributes(data, baseline); } catch { /* Old data cannot hide current results. */ }
    document.querySelector('#comparison-label')!.textContent = before ? '與已儲存配置比較' : baseline ? '比較基準已不適用目前資料，請重新設定' : '可儲存目前配置作為比較基準';
      let currentDamage: ReturnType<typeof projectDamage> | null = null;
      let damageCalculationError: unknown;
      try { currentDamage = projectDamage(data, state); } catch (error) { damageCalculationError = error; }
    const currentClass = data.classes.classes.find(entry => entry.id === state.classId);
    const baselineClass = baseline ? data.classes.classes.find(entry => entry.id === baseline?.classId) : undefined;
    const attackKey = currentClass?.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    const baselineAttackKey = baselineClass?.attackType === 'physical' ? 'physicalAttack' : 'magicalAttack';
    const visibleStats = Object.entries(current.stats)
      .filter(([key, stat]) => !['physicalAttack', 'magicalAttack'].includes(key) && (stat.finalTotal !== 0 || (before?.stats[key]?.finalTotal ?? 0) !== 0))
      .map(([key, stat]) => ({ key, stat, previousStat: before?.stats[key] }));
    const attackStat = current.stats[attackKey];
    if (attackStat && (attackStat.finalTotal !== 0 || (before?.stats[baselineAttackKey]?.finalTotal ?? 0) !== 0)) {
      visibleStats.unshift({ key: 'attackPower', stat: attackStat, previousStat: before?.stats[baselineAttackKey] });
    }
    const percentFormat = (value: number) => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 }).format(value);
    const combatRateCards = currentDamage ? `<div class="stat"><p>實戰致命一擊機率</p><strong>${fmt(currentDamage.result.combatRates.critRate.finalRate * 100)}%</strong></div><div class="stat"><p>實戰極大化機率</p><strong>${fmt(currentDamage.result.combatRates.extremization.finalRate * 100)}%</strong></div>` : '';
    target.innerHTML = `<div class="stat-list">${visibleStats.map(({ key, stat, previousStat }) => {
      const meta = data.attributes.attributes.find(entry => entry.key === key);
      const isPercent = meta?.unit === 'percent';
      const previous = previousStat?.finalTotal ?? 0;
      const delta = before ? stat.finalTotal - previous : null;
      const comparison = delta === null ? '' : `<p>基準 ${fmt(previous)}${isPercent ? '%' : ''} → 目前 ${fmt(stat.finalTotal)}${isPercent ? '%' : ''}；相對變化 ${previous === 0 ? '—（基準為 0）' : `${percentFormat(delta / previous * 100)}%`}</p>`;
      const deltaText = delta === null ? '' : `${delta > 0 ? '+' : ''}${isPercent ? percentFormat(delta) : fmt(delta)}${isPercent ? '%' : ''}`;
      const shownName = key === 'attackPower' ? '攻擊力' : meta?.name ?? key;
      const lowerwearAverageLabel = state.lowerwearAlternativeEnabled ? '下衣+強/排褲平均' : '下衣配置';
      return `<details class="stat"><summary><span>${h(shownName)}</span>${stat.cap === undefined ? '' : `<small class="stat-cap">上限 ${fmt(stat.cap)}%</small>`}<strong>${fmt(stat.finalTotal)}${isPercent ? '%' : ''}</strong>${delta === null ? '' : `<small class="${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}">${deltaText}</small>`}</summary><div class="stat-details"><p class="stat-detail-heading">共同來源</p>${sourceRows(stat.sharedSources, isPercent)}<p class="stat-lowerwear-total">下衣 ${fmt(stat.lowerwearA)} ／ 強/排褲 ${fmt(stat.lowerwearB)}</p><p class="stat-detail-heading">下衣來源</p>${sourceRows(stat.lowerwearASources, isPercent)}${state.lowerwearAlternativeEnabled ? `<p class="stat-detail-heading">強/排褲來源</p>${sourceRows(stat.lowerwearBSources, isPercent)}` : ''}<p class="stat-average">${lowerwearAverageLabel} ${fmt(stat.lowerwearAverage)}${isPercent ? '%' : ''}</p>${stat.cap === undefined ? '' : `<p>套用角色上限 ${fmt(stat.cap)}%</p>`}${comparison}</div></details>`;
    }).join('')}${combatRateCards}<div class="stat"><p>強者（Boss 體力 &gt; 50%）</p><strong>${fmt(current.conditionalDamage.strongerPct)}%</strong></div><div class="stat"><p>排熱（Boss 體力 ≤ 50%）</p><strong>${fmt(current.conditionalDamage.heatPct)}%</strong></div></div>`;
      const damageTarget = document.querySelector('#damage-result')!;
      try {
        if (!currentDamage) throw damageCalculationError;
        const { result } = currentDamage;
        renderSheetParity(result);
        let comparisonHtml = '';
        if (baseline && before) {
          try {
            const previous = projectDamage(data, baseline).result;
            const rows = compareDamageResults(result, previous);
            comparisonHtml = `<section class="damage-comparison"><h3>與比較基準</h3><div class="damage-comparison-scroll"><table><thead><tr><th>項目</th><th>基準</th><th>目前</th><th>差異</th><th>變化率</th></tr></thead><tbody>${rows.map(row => {
              const unit = row.unit === 'percent' ? '%' : '';
              const deltaUnit = row.unit === 'percent' ? '%' : '';
              const deltaClass = row.delta > 0 ? 'positive' : row.delta < 0 ? 'negative' : '';
              const sign = row.delta > 0 ? '+' : '';
              const relative = row.relativeChangePct === null ? '—' : `${row.relativeChangePct > 0 ? '+' : ''}${percentFormat(row.relativeChangePct)}%`;
              return `<tr><th scope="row">${h(row.label)}</th><td>${percentFormat(row.baseline)}${unit}</td><td>${percentFormat(row.current)}${unit}</td><td class="${deltaClass}">${sign}${percentFormat(row.delta)}${deltaUnit}</td><td class="${deltaClass}">${relative}</td></tr>`;
            }).join('')}</tbody></table></div></section>`;
          } catch (error) {
            comparisonHtml = `<p class="damage-comparison-note">比較基準無法計算傷害：${h(error instanceof Error ? error.message : error)}。請重新設定比較基準。</p>`;
          }
        }
        const rateSources = (effects: typeof result.combatRates.critRate.multipliers) => effects.map(effect => `${effect.sourceId} ×${fmt(effect.factor)}`).join(' · ') || '無';
        const critDamageSources = result.multiplicativeCritDamage.factors.map(effect => `${sourceLabel(effect.sourceId)} ${fmt(effect.valuePct)}%`).join('、') || '無';
        damageTarget.innerHTML = `<div class="damage-summary"><div><span>最小攻擊力</span><strong>${fmt(result.attack.lowerDamage)}</strong></div><div><span>最大攻擊力</span><strong>${fmt(result.attack.upperDamage)}</strong></div><div class="final-damage"><span>最終傷害</span><strong>${fmt(result.finalDamage.finalDamage)}</strong></div></div>${comparisonHtml}<details class="formula-detail"><summary>展開傷害計算明細</summary><p>致命傷害被動：${fmt(result.classCritDamagePassivePct)}%　乘算暴傷：${fmt(result.multiplicativeCritDamage.value)}%</p><p>乘算暴傷來源：${h(critDamageSources)}</p><p>爆擊乘算來源：${h(rateSources(result.combatRates.critRate.multipliers))}</p><p>極大乘算來源：${h(rateSources(result.combatRates.extremization.multipliers))}</p><p>乘算傷害：${fmt(result.generalMultiplicativeDamage.value)} 倍　強者／排熱因子：${fmt(result.finalDamage.conditionalFactor)}</p><p>適應力因子：${fmt(result.finalDamage.adaptationFactor)}　防禦因子：${fmt(result.finalDamage.defenseFactor)}</p></details>`;
      } catch (error) {
        damageTarget.innerHTML = `<p class="input-warning">尚未計算：${h(error instanceof Error ? error.message : error)}　請完成該部位的必要輸入。</p>`;
      }
    } catch (error) {
      const message = h(error instanceof Error ? error.message : error);
      target.innerHTML = `<p class="input-warning" role="status">${message}</p>`;
      document.querySelector('#damage-result')!.innerHTML = `<p class="input-warning">尚未計算：${message}</p>`;
    }
  }
  document.querySelector('#class-picker')!.append(createPicker('職業', data.classes.classes.filter(entry => entry.active).map(entry => ({ value: entry.id, label: entry.name })), state.classId, value => { state.classId = value; update(); }));
  const toggle = document.querySelector<HTMLInputElement>('#alternate')!; toggle.checked = state.lowerwearAlternativeEnabled;
  const battle = document.querySelector<HTMLElement>('#battle-settings')!;
  for (const [cell, label] of [['D1','關卡適應力'],['D2','關卡扣致命'],['D3','Boss防禦']] as const) {
    const input = data.simulatorInputs.inputs.find(entry => entry.simulatorCells === cell);
    const catalog = input && data.simulatorInputs.catalogs.find(entry => entry.id === input.catalogId);
    field(battle, label, cell, options((catalog?.options ?? []).map(option => String(option.value))));
  }
  toggle.addEventListener('change', () => { state.lowerwearAlternativeEnabled = toggle.checked; update(); renderInspector(); });
  document.querySelector('#baseline')!.addEventListener('click', () => { try { projectAttributes(data, state); baseline = structuredClone(state); const stored = sampleMode ? false : saveState(baseline, true); renderResults(); document.querySelector('#save-status')!.textContent = stored ? '比較基準已儲存' : '比較基準僅保留至關閉頁面'; } catch { renderResults(); } });
  renderSlots(); renderInspector(); renderTitleInput(); renderBeastAccessories(); renderMasterBeastColorSelector(); renderGlobalInputs(); renderRightIceSetSelectors(); renderResults();
}
start().catch(error => { document.querySelector('#app')!.innerHTML = `<section class="error-card"><h1>無法載入工具</h1><p>${h(error instanceof Error ? error.message : error)}</p></section>`; });
