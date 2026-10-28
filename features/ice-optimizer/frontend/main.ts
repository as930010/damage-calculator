import { loadGameData, formatNumber } from '../../../frontend/data.ts';
import { readState } from '../../../frontend/state.ts';
import { projectDamage } from '../../../frontend/projection.ts';
import { stageIceOptimizerHandoff } from '../../../frontend/ice-optimizer-handoff.ts';
import type { GameData } from '../../../frontend/data.ts';
import type { LoadoutState } from '../../../frontend/state.ts';
import { attributeDifferences } from './attribute-differences.ts';
import { describeIceSearchStatus, generateThreeSetStructures, isThreeSetIceCandidate, sameDamage } from './search.ts';
import type { IceProgress, IceResultAlternative, IceSearchResult } from './search.ts';
import { iceSeriesOrder, requiredIceSetNames, snapshotIceSearchConstraints } from './search-policy.ts';
import type { IceSearchConstraints } from './search-policy.ts';

const savedStateKey = 'dab-loadout-v1';
const savedSearchKey = 'dab-ice-optimizer-result-v1';
const conditionsKey = 'dab-ice-optimizer-conditions-v1';
const status = document.querySelector<HTMLElement>('#optimizer-status')!;
const progress = document.querySelector<HTMLElement>('#optimizer-progress')!;
const results = document.querySelector<HTMLElement>('#optimizer-results')!;
const startButton = document.querySelector<HTMLButtonElement>('#optimizer-start')!;
const cancelButton = document.querySelector<HTMLButtonElement>('#optimizer-cancel')!;
const clearButton = document.querySelector<HTMLButtonElement>('#optimizer-clear')!;
const fixedSlot = document.querySelector<HTMLSelectElement>('#fixed-slot')!;
const fixedItem = document.querySelector<HTMLSelectElement>('#fixed-item')!;
const fixedAdd = document.querySelector<HTMLButtonElement>('#fixed-add')!;
const setSelect = document.querySelector<HTMLSelectElement>('#required-set')!;
const setAdd = document.querySelector<HTMLButtonElement>('#set-add')!;
const fixedList = document.querySelector<HTMLElement>('#fixed-list')!;
const setList = document.querySelector<HTMLElement>('#set-list')!;
const conditionStatus = document.querySelector<HTMLElement>('#constraint-status')!;
const conditionClear = document.querySelector<HTMLButtonElement>('#constraint-clear')!;
const seriesOptions = document.querySelector<HTMLElement>('#series-options')!;
const rangeClear = document.querySelector<HTMLButtonElement>('#range-clear')!;
const rangeCount = document.querySelector<HTMLElement>('#range-count')!;
let conditions: IceSearchConstraints = { requiredItemIds: {}, requiredSetEffectIds: [] };
let conditionsValid = false;
let worker: Worker | null = null;
let gameData: GameData | null = null;
let searchBaseRaw: string | null = null;
let searchBaseState: LoadoutState | null = null;
let resultValid = false;
let searchSequence = 0;

const readSavedRaw = () => {
  try { return localStorage.getItem(savedStateKey); }
  catch { return null; }
};
const dataRevision = () => {
  const path = document.querySelector<HTMLMetaElement>('meta[name="game-data-url"]')?.content ?? '';
  return path.split('/').pop() ?? '';
};
const workerUrl = () => document.querySelector<HTMLMetaElement>('meta[name="optimizer-worker-url"]')?.content ?? '';
const searchRevision = () => `${dataRevision()}|${workerUrl()}`;
const setRunning = (running: boolean) => {
  startButton.disabled = running || !gameData || !conditionsValid;
  cancelButton.disabled = !running;
  clearButton.disabled = running || !results.childElementCount;
};
const stopWorker = () => {
  worker?.terminate();
  worker = null;
  setRunning(false);
};
const relativeGain = (value: number, baseline: number) => baseline > 0
  ? ((value / baseline - 1) * 100).toFixed(3) + '%' : '—';

const conditionKey = (value: IceSearchConstraints) => JSON.stringify(snapshotIceSearchConstraints(value));
function refreshConditionOptions() {
  if (!gameData) return;
  const data = gameData;
  const selections = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const labels = new Map(data.layout.slots.filter(slot => slot.selectionField).map(slot => [slot.selectionField!, slot.label]));
  const fixed = conditions.requiredItemIds ?? {};
  const addOption = (select: HTMLSelectElement, label: string, value: string) => {
    const option = document.createElement('option'); option.textContent = label; option.value = value; select.add(option);
  };
  let order: string[] = [];
  try { order = iceSeriesOrder(data); } catch { /* Validation reports invalid data. */ }
  const available = order.filter(name => data.rightIceSets.effects.some(effect => effect.active && effect.setName === name)).reverse();
  const defaults = available.filter(name => name !== '騎士團');
  const checked = conditions.allowedSeries ?? defaults;
  seriesOptions.replaceChildren();
  for (const name of available) {
    const label = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = name; input.checked = checked.includes(name);
    input.addEventListener('change', () => {
      const next = new Set(conditions.allowedSeries ?? defaults);
      if (input.checked) next.add(name); else next.delete(name);
      conditions = { ...conditions, allowedSeries: available.filter(item => next.has(item)) }; conditionsChanged();
    });
    label.append(input, document.createTextNode(name)); seriesOptions.append(label);
  }
  const allSelected = available.length > 0 && available.every(name => checked.includes(name));
  rangeClear.disabled = !available.length;
  rangeClear.textContent = allSelected ? '取消全選' : '全選';
  rangeCount.textContent = `（已選 ${checked.length} 組）`;
  const previousSlot = fixedSlot.value;
  fixedSlot.replaceChildren();
  for (const entry of selections.filter(entry => !(entry.selectionField in fixed))) {
    addOption(fixedSlot, labels.get(entry.selectionField) ?? entry.selectionField, entry.selectionField);
  }
  if ([...fixedSlot.options].some(option => option.value === previousSlot)) fixedSlot.value = previousSlot;
  refreshFixedItems();
  document.querySelector<HTMLElement>('#fixed-count')!.textContent = `${Object.keys(fixed).length}／11`;
  fixedList.replaceChildren();
  for (const [field, id] of Object.entries(fixed)) {
    const entry = selections.find(item => item.selectionField === field);
    const item = entry && data.catalogs[entry.catalogFile]?.items.find(item => item.id === id && item.slotId === entry.slotId && item.active);
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${labels.get(field) ?? field}：${item?.name ?? '無效裝備 ' + id}`;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => { const next = { ...conditions.requiredItemIds }; delete next[field]; conditions = { ...conditions, requiredItemIds: next }; conditionsChanged(); });
    row.append(label, remove); fixedList.append(row);
  }
  const selected = conditions.requiredSetEffectIds ?? [];
  const autoSets = selected.map(id => data.rightIceSets.effects.find(effect => effect.active && effect.id === id)?.setName).filter((name): name is string => Boolean(name) && !checked.includes(name!));
  const notice = document.querySelector<HTMLElement>('#required-series-notice')!;
  notice.textContent = autoSets.length ? `必選套效納入：${autoSets.join('、')}` : '';
  const chosenNames = new Set(selected.map(id => data.rightIceSets.effects.find(effect => effect.id === id)?.setName).filter(Boolean));
  const series = new Map<string, string>();
  for (const effect of data.rightIceSets.effects) if (effect.active && !series.has(effect.setName)) series.set(effect.setName, effect.id);
  const previousSet = setSelect.value;
  setSelect.replaceChildren();
  for (const [name, id] of series) if (!chosenNames.has(name)) addOption(setSelect, name, id);
  if ([...setSelect.options].some(option => option.value === previousSet)) setSelect.value = previousSet;
  setAdd.disabled = selected.length >= 3 || !setSelect.value;
  document.querySelector<HTMLElement>('#set-count')!.textContent = `${selected.length}／3`;
  setList.replaceChildren();
  for (const id of selected) {
    const name = data.rightIceSets.effects.find(effect => effect.id === id && effect.active)?.setName;
    const row = document.createElement('li');
    const label = document.createElement('span'); label.textContent = name ?? `無效套效 ${id}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除';
    remove.addEventListener('click', () => { conditions = { ...conditions, requiredSetEffectIds: selected.filter(item => item !== id) }; conditionsChanged(); });
    row.append(label, remove); setList.append(row);
  }
  conditionClear.disabled = !Object.keys(fixed).length && !selected.length && (conditions.allowedSeries === undefined || (conditions.allowedSeries.length === defaults.length && defaults.every(name => conditions.allowedSeries!.includes(name))));
}

function refreshFixedItems() {
  if (!gameData) return;
  const selection = gameData.mapping.selections.find(entry => entry.selectionField === fixedSlot.value);
  fixedItem.replaceChildren();
  if (selection) for (const item of gameData.catalogs[selection.catalogFile].items) {
    if (item.active && item.slotId === selection.slotId) {
      const option = document.createElement('option');
      option.textContent = item.name; option.value = item.id; fixedItem.add(option);
    }
  }
  fixedAdd.disabled = Object.keys(conditions.requiredItemIds ?? {}).length >= 11 || !fixedItem.value;
}

function validateConditions() {
  if (!gameData) return;
  try {
    requiredIceSetNames(gameData, conditions);
    const state = readState(gameData.classes.classes.find(entry => entry.active)?.id ?? 'DaB');
    const choices = Object.fromEntries(gameData.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json')
      .map(entry => [entry.selectionField, String(state.values[entry.selectionField] ?? '')]));
    if (!generateThreeSetStructures(gameData, choices, conditions, 1).seeds.length) {
      throw new RangeError('目前勾選系列、固定裝備與必選套效無法同時達成三組至少 3set，請調整搜尋條件。');
    }
    conditionsValid = true;
    conditionStatus.textContent = '條件可成立';
  } catch (error) {
    conditionsValid = false;
    conditionStatus.textContent = error instanceof Error ? error.message : '搜尋條件無法成立。';
  }
  conditionStatus.dataset.invalid = String(!conditionsValid);
  setRunning(Boolean(worker));
}

function conditionsChanged() {
  if (worker) stopWorker();
  resultValid = false;
  results.querySelectorAll<HTMLButtonElement>('.optimizer-apply').forEach(button => { button.disabled = true; });
  try { sessionStorage.setItem(conditionsKey, JSON.stringify(conditions)); sessionStorage.removeItem(savedSearchKey); } catch { /* Storage is optional. */ }
  refreshConditionOptions(); validateConditions();
  status.textContent = '搜尋條件已變更；原結果僅供檢視，請重新搜尋後再套用。';
}
fixedSlot.addEventListener('change', refreshFixedItems);
rangeClear.addEventListener('click', () => {
  if (!gameData) return;
  const available = iceSeriesOrder(gameData).filter(name => gameData!.rightIceSets.effects.some(effect => effect.active && effect.setName === name));
  const checked = conditions.allowedSeries ?? available.filter(name => name !== '騎士團');
  conditions = { ...conditions, allowedSeries: available.every(name => checked.includes(name)) ? [] : available }; conditionsChanged();
});
fixedAdd.addEventListener('click', () => {
  if (fixedAdd.disabled) return;
  conditions = { ...conditions, requiredItemIds: { ...conditions.requiredItemIds, [fixedSlot.value]: fixedItem.value } };
  conditionsChanged();
});
setAdd.addEventListener('click', () => {
  if (setAdd.disabled) return;
  conditions = { ...conditions, requiredSetEffectIds: [...(conditions.requiredSetEffectIds ?? []), setSelect.value] };
  conditionsChanged();
});
conditionClear.addEventListener('click', () => {
  conditions = { requiredItemIds: {}, requiredSetEffectIds: [], allowedSeries: gameData ? iceSeriesOrder(gameData).filter(name => name !== '騎士團' && gameData!.rightIceSets.effects.some(effect => effect.active && effect.setName === name)).reverse() : undefined }; conditionsChanged();
});

interface AlternativeDisplayGroup {
  alternatives: IceResultAlternative[];
  differingField: string | null;
}

function groupSameSlotAlternatives(
  alternatives: IceResultAlternative[],
  fields: string[],
): AlternativeDisplayGroup[] {
  const remaining = new Set(alternatives);
  const groups: AlternativeDisplayGroup[] = [];
  for (const field of fields) {
    const buckets = new Map<string, IceResultAlternative[]>();
    for (const alternative of remaining) {
      const sharedChoices: [string, string][] = fields.filter(candidate => candidate !== field)
        .map(candidate => [candidate, alternative.choices[candidate] ?? '']);
      const key = JSON.stringify([alternative.setNames, sharedChoices]);
      const bucket = buckets.get(key) ?? [];
      bucket.push(alternative);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      const variants = new Set(bucket.map(alternative => alternative.choices[field] ?? ''));
      if (bucket.length < 2 || variants.size < 2) continue;
      groups.push({ alternatives: bucket, differingField: field });
      bucket.forEach(alternative => remaining.delete(alternative));
    }
  }
  for (const alternative of remaining) groups.push({ alternatives: [alternative], differingField: null });
  return groups;
}

function renderResults(data: GameData,
  search: Pick<IceSearchResult, 'baselineDamage' | 'baselineInScope' | 'results'>,
  base: LoadoutState, running = false) {
  results.replaceChildren();
  const ice = data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json');
  const labels = new Map(data.layout.slots
    .filter(slot => slot.selectionField)
    .map(slot => [slot.selectionField!, slot.label]));
  const baseline = document.createElement('p');
  baseline.className = 'optimizer-caveat optimizer-baseline';
  baseline.textContent = `目前配裝基準傷害：${formatNumber(search.baselineDamage)}`;
  results.append(baseline);
  const baselineProjection = running ? null : projectDamage(data, base);
  for (const [index, item] of search.results.entries()) {
    const alternatives = item.alternatives?.length ? item.alternatives : [item];
    const card = document.createElement('article');
    card.className = 'optimizer-result site-card';
    const header = document.createElement('div');
    header.className = 'optimizer-result-header';
    const title = document.createElement('h2');
    title.textContent = `第 ${index + 1} 名${alternatives.length > 1 ? `（並列 ${alternatives.length} 組）` : ''} · ${formatNumber(item.damage)}`;
    const baselineBest = index === 0 && search.baselineInScope
      && alternatives.some(alternative => alternative.isBaseline)
      && !search.results.some(candidate => candidate.damage > search.baselineDamage
        && !sameDamage(candidate.damage, search.baselineDamage));
    const gain = document.createElement('span');
    if (baselineBest) {
      const state = document.createElement('div');
      state.className = 'optimizer-result-state';
      gain.textContent = running
        ? '當前配裝為目前已知最佳解，搜尋仍在進行中…'
        : '當前配裝是目前已知最佳解';
      const detail = document.createElement('small');
      detail.textContent = running ? '尚未找到更高傷害配置' : '未找到更高傷害配置';
      state.append(gain, detail);
      header.append(title, state);
    } else {
      gain.textContent = `相對目前配裝 ${relativeGain(item.damage, search.baselineDamage)}`;
      if (index === 0) {
        const state = document.createElement('div');
        state.className = 'optimizer-result-state';
        const detail = document.createElement('small');
        detail.textContent = '當前已知最佳解';
        state.append(gain, detail);
        header.append(title, state);
      } else header.append(title, gain);
    }
    if (alternatives.length > 1) {
      const note = document.createElement('p');
      note.className = 'optimizer-caveat';
      note.textContent = '這些穿搭在完整傷害比較容差內為並列解，皆可使用。';
      card.append(header, note);
    } else card.append(header);

    const createApplyButton = (alternative: IceResultAlternative, text: string) => {
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'site-button optimizer-apply';
      apply.textContent = text;
      apply.addEventListener('click', () => {
        if (!resultValid || !searchBaseRaw || readSavedRaw() !== searchBaseRaw) {
          status.textContent = '主頁配裝已變更；請重新搜尋後再套用。';
          return;
        }
        if (!searchBaseState || !isThreeSetIceCandidate(data, alternative.choices, alternative.setNames,
          conditions, searchBaseState.values)) {
          status.textContent = '此穿搭不符合目前搜尋條件，請重新搜尋。';
          return;
        }
        try {
          if (worker) stopWorker();
          stageIceOptimizerHandoff({
            format: 'ice-optimizer-selection', version: 1,
            baseRaw: searchBaseRaw, dataRevision: dataRevision(),
            choices: alternative.choices, setNames: alternative.setNames, expectedDamage: alternative.damage,
          });
          location.assign('../');
        } catch {
          status.textContent = '瀏覽器無法保留本次套用要求；原配裝未變更。';
        }
      });
      return apply;
    };
    const displayGroups = groupSameSlotAlternatives(alternatives, ice.map(entry => entry.selectionField));
    for (const group of displayGroups) {
      const grouped = group.alternatives;
      const alternative = grouped[0];
      const detail = document.createElement('details');
      const summary = document.createElement('summary');
      const list = document.createElement('dl');
      const add = (label: string, value: string) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value || '未裝備';
        list.append(term, description);
      };
      if (group.differingField) {
        const changedLabel = labels.get(group.differingField) ?? group.differingField;
        summary.textContent = `查看穿搭（${changedLabel}有 ${grouped.length} 種等傷害替代）`;
        for (const entry of ice) {
          const value = entry.selectionField === group.differingField
            ? grouped.map(item => `${item.choices[entry.selectionField] || '未裝備'}${item.isBaseline ? '（目前配裝）' : ''}`).join(' / ')
            : alternative.choices[entry.selectionField];
          add(labels.get(entry.selectionField) ?? entry.selectionField, value);
        }
        add('啟用右冰套效', alternative.setNames.length ? alternative.setNames.join('、') : '無');
        detail.append(summary, list);

        const differenceRows = baselineProjection
          ? grouped.filter(item => !item.isBaseline).map(item => {
            const values = { ...base.values, ...item.choices };
            data.rightIceSets.selectionFields.forEach((field, setIndex) => {
              values[field] = item.setNames[setIndex] ?? '';
            });
            return {
              item,
              changes: attributeDifferences(data, base.Job, baselineProjection,
                projectDamage(data, { ...base, values })),
            };
          }).filter(row => row.changes.length) : [];
        if (differenceRows.length) {
          const heading = document.createElement('h3');
          heading.textContent = '與比較基準的屬性差異';
          detail.append(heading);
          const uniqueChanges = new Set(differenceRows.map(row => row.changes.join('、')));
          if (uniqueChanges.size === 1) {
            const differenceText = document.createElement('p');
            differenceText.className = 'optimizer-caveat';
            differenceText.textContent = differenceRows[0].changes.join('、');
            detail.append(differenceText);
          } else {
            const differences = document.createElement('ul');
            differences.className = 'optimizer-variant-differences';
            for (const row of differenceRows) {
              const item = document.createElement('li');
              item.textContent = `${row.item.choices[group.differingField] || '未裝備'}：${row.changes.join('、')}`;
              differences.append(item);
            }
            detail.append(differences);
          }
        }
        const applicable = grouped.filter(item => !item.isBaseline);
        if (applicable.length) {
          const actions = document.createElement('div');
          actions.className = 'optimizer-alternative-actions';
          for (const item of applicable) {
            const label = applicable.length > 1
              ? `套用「${item.choices[group.differingField] || '未裝備'}」` : '套用此穿搭';
            actions.append(createApplyButton(item, label));
          }
          detail.append(actions);
        }
        card.append(detail);
        continue;
      }

      const alternativeIndex = alternatives.indexOf(alternative);
      summary.textContent = alternatives.length > 1
        ? `方案 ${alternativeIndex + 1}${alternative.isBaseline ? '（目前配裝）' : ''} · 查看完整穿搭`
        : alternative.isBaseline ? '查看目前配裝' : '查看完整穿搭';
      for (const entry of ice) add(labels.get(entry.selectionField) ?? entry.selectionField,
        alternative.choices[entry.selectionField]);
      add('啟用右冰套效', alternative.setNames.length ? alternative.setNames.join('、') : '無');
      detail.append(summary, list);
      const values = { ...base.values, ...alternative.choices };
      data.rightIceSets.selectionFields.forEach((field, setIndex) => {
        values[field] = alternative.setNames[setIndex] ?? '';
      });
      const changes = baselineProjection && !alternative.isBaseline
        ? attributeDifferences(data, base.Job, baselineProjection,
          projectDamage(data, { ...base, values })) : [];
      if (changes.length) {
        const heading = document.createElement('h3');
        heading.textContent = '與比較基準的屬性差異';
        const differenceText = document.createElement('p');
        differenceText.className = 'optimizer-caveat';
        differenceText.textContent = changes.join('、');
        detail.append(heading, differenceText);
      }
      if (!alternative.isBaseline && alternatives.length === 1) {
        card.append(detail, createApplyButton(alternative, '套用此穿搭'));
      } else {
        if (!alternative.isBaseline) detail.append(createApplyButton(alternative, '套用此穿搭'));
        card.append(detail);
      }
    }
    results.append(card);
  }
  if (!search.results.length && !search.baselineInScope) {
    const note = document.createElement('p');
    note.className = 'optimizer-caveat';
    note.textContent = running
      ? '尚無優於目前配裝的合法推薦，搜尋仍在進行中…'
      : '尚無優於目前配裝的合法推薦；搜尋尚未窮舉。';
    results.append(note);
  }
  setRunning(Boolean(worker));
}

function startSearch() {
  if (!gameData || worker) return;
  validateConditions();
  if (!conditionsValid) return;
  const searchConditions = snapshotIceSearchConstraints(conditions);
  const raw = readSavedRaw();
  if (!raw) {
    status.textContent = '尚無已保存配裝。請先返回傷害計算機完成配置，並確認頁面顯示「已儲存於此裝置」。';
    return;
  }
  const source = workerUrl();
  if (!source || !dataRevision()) {
    status.textContent = '正式搜尋資源尚未準備完成。';
    return;
  }
  const state = readState(gameData.classes.classes.find(entry => entry.active)?.id ?? 'DaB');
  if (readSavedRaw() !== raw) {
    status.textContent = '讀取配裝期間資料已變更，請重新開始搜尋。';
    return;
  }
  searchBaseRaw = raw;
  searchBaseState = state;
  resultValid = true;
  results.replaceChildren();
  try { sessionStorage.removeItem(savedSearchKey); } catch { /* Search remains usable without persistence. */ }
  progress.textContent = '';
  setRunning(false);
  status.textContent = '正在搜尋；計算會在背景執行，主頁配裝不會被修改。';
  try {
    const searchId = `${++searchSequence}:${searchRevision()}`;
    const current = new Worker(new URL(source, location.href), { type: 'module' });
    worker = current;
    setRunning(true);
    current.addEventListener('message', (event: MessageEvent<{
      type: 'progress' | 'complete' | 'error';
      searchId: string; progress?: IceProgress; result?: IceSearchResult; message?: string;
    }>) => {
      if (worker !== current || event.data.searchId !== searchId) return;
      if (readSavedRaw() !== searchBaseRaw || searchRevision() !== searchId.slice(searchId.indexOf(':') + 1)) {
        stopWorker();
        resultValid = false;
        status.textContent = '搜尋期間配裝或資料版本已變更；請重新搜尋後再套用。';
        results.querySelectorAll<HTMLButtonElement>('.optimizer-apply').forEach(button => { button.disabled = true; });
        return;
      }
      const message = event.data;
      if (message.type === 'progress' && message.progress) {
        const item = message.progress;
        progress.textContent = `完整傷害計算 ${formatNumber(item.evaluated + (item.completedEvaluated ?? 0))} 次；已搜尋次數 ${formatNumber(item.budgetUsed + (item.completedBudget ?? 0))} / 100,000；${item.strategy ?? 'A'}：${item.phase}；目前最佳傷害 ${formatNumber(item.bestDamage)}。`;
        if (item.results && searchBaseState) {
          renderResults(gameData!, { baselineDamage: item.baselineDamage,
            baselineInScope: item.baselineInScope, results: item.results }, searchBaseState, true);
          status.textContent = '搜尋中；以下為目前已知的合法候選排名，尚未窮舉。';
        }
      } else if (message.type === 'complete' && message.result) {
        stopWorker();
        renderResults(gameData!, message.result, searchBaseState!);
        try {
          sessionStorage.setItem(savedSearchKey, JSON.stringify({ revision: searchRevision(),
            baseRaw: searchBaseRaw, baseState: searchBaseState, result: message.result }));
        } catch { /* Keep the visible result even when session storage is unavailable. */ }
        status.textContent = describeIceSearchStatus(message.result);
        progress.textContent = `完整傷害計算 ${formatNumber(message.result.evaluated)} 次；已搜尋次數 ${formatNumber(message.result.budgetUsed)} / 100,000；比較基準傷害 ${formatNumber(message.result.baselineDamage)}。`;
      } else if (message.type === 'error') {
        stopWorker();
        status.textContent = message.message ?? '搜尋失敗。';
      }
    });
    current.addEventListener('error', () => {
      if (worker !== current) return;
      stopWorker();
      status.textContent = '搜尋背景程式無法載入或執行，請重新整理後重試。';
    });
    current.postMessage({ type: 'start', searchId, data: gameData, state, constraints: searchConditions });
  } catch {
    stopWorker();
    status.textContent = '無法啟動背景搜尋；原配裝未變更。';
  }
}

startButton.addEventListener('click', startSearch);
cancelButton.addEventListener('click', () => {
  if (!worker) return;
  stopWorker();
  resultValid = false;
  results.replaceChildren();
  progress.textContent = '';
  setRunning(false);
  status.textContent = '搜尋已取消；原配裝未變更。';
});
clearButton.addEventListener('click', () => {
  if (clearButton.disabled) return;
  results.replaceChildren();
  progress.textContent = '';
  searchBaseRaw = null;
  searchBaseState = null;
  resultValid = false;
  try { sessionStorage.removeItem(savedSearchKey); } catch { /* Storage may be unavailable. */ }
  status.textContent = '試算已清空；原配裝未變更。';
  setRunning(false);
});
window.addEventListener('storage', event => {
  if (event.key !== savedStateKey) return;
  if (worker) stopWorker();
  resultValid = false;
  results.querySelectorAll<HTMLButtonElement>('.optimizer-apply').forEach(button => { button.disabled = true; });
  status.textContent = '偵測到另一個分頁更新配裝。原試算仍可檢視，但需重新搜尋後才能套用。';
  validateConditions();
});

loadGameData().then(data => {
  gameData = data;
  try {
    const savedConditions = JSON.parse(sessionStorage.getItem(conditionsKey) ?? 'null') as IceSearchConstraints | null;
    if (savedConditions && savedConditions.requiredItemIds && typeof savedConditions.requiredItemIds === 'object'
      && !Array.isArray(savedConditions.requiredItemIds)
      && Object.values(savedConditions.requiredItemIds).every(value => typeof value === 'string')
      && Array.isArray(savedConditions.requiredSetEffectIds)
      && savedConditions.requiredSetEffectIds.every(value => typeof value === 'string')) {
      conditions = { requiredItemIds: savedConditions.requiredItemIds, requiredSetEffectIds: savedConditions.requiredSetEffectIds,
        allowedSeries: Array.isArray(savedConditions.allowedSeries)
          ? savedConditions.allowedSeries.filter(name => typeof name === 'string' && data.rightIceSets.effects.some(effect => effect.active && effect.setName === name))
          : undefined };
    }
  } catch { /* 無效的搜尋條件使用預設值。 */ }
  if (conditions.allowedSeries === undefined) conditions = { ...conditions, allowedSeries: iceSeriesOrder(data).filter(name => name !== '騎士團' && data.rightIceSets.effects.some(effect => effect.active && effect.setName === name)).reverse() };
  refreshConditionOptions(); validateConditions();
  setRunning(false);
  const raw = readSavedRaw();
  status.textContent = raw
    ? '已讀取目前儲存在此裝置的配裝；左冰維持目前設定。'
    : '尚無已保存配裝。請先在傷害計算機完成配置並儲存。';
  try {
    const saved = JSON.parse(sessionStorage.getItem(savedSearchKey) ?? 'null') as {
      revision?: string; baseRaw?: string; baseState?: LoadoutState; result?: IceSearchResult;
    } | null;
    if (saved?.revision === searchRevision() && typeof saved.baseRaw === 'string'
      && saved.baseState?.values
      && saved.result?.scope === 'three-set-3x3-bounded'
      && Number.isFinite(saved.result.baselineDamage)
      && saved.result.baseline && Number.isFinite(saved.result.baseline.damage)
      && typeof saved.result.baselineInScope === 'boolean'
      && saved.result.globallyOptimalProven === false
      && conditionKey(saved.result.candidatePolicy ?? {}) === conditionKey(conditions)
      && Array.isArray(saved.result.results)
      && saved.result.results.every(item => Number.isFinite(item.damage)
        && Array.isArray(item.alternatives) && item.alternatives.length > 0
        && item.alternatives.every(alternative => Number.isFinite(alternative.damage)
          && alternative.damage >= saved.result!.baselineDamage - Math.max(1e-6, Math.abs(saved.result!.baselineDamage) * 1e-12)
          && alternative.choices
          && Object.keys(alternative.choices).length === data.mapping.selections
            .filter(entry => entry.catalogFile === 'equipment/right-ice.json').length
          && data.mapping.selections.filter(entry => entry.catalogFile === 'equipment/right-ice.json')
            .every(entry => typeof alternative.choices[entry.selectionField] === 'string'
              && data.catalogs[entry.catalogFile]?.items.some(item => item.active
                && item.slotId === entry.slotId && item.name === alternative.choices[entry.selectionField]) === true)
          && Array.isArray(alternative.setNames)
          && isThreeSetIceCandidate(data, alternative.choices, alternative.setNames,
            saved.result!.candidatePolicy, saved.baseState!.values)))) {
      searchBaseRaw = saved.baseRaw;
      searchBaseState = saved.baseState;
      resultValid = raw === saved.baseRaw;
      renderResults(data, saved.result, saved.baseState);
      progress.textContent = `完整傷害計算 ${formatNumber(saved.result.evaluated)} 次；已搜尋次數 ${formatNumber(saved.result.budgetUsed ?? 0)} / ${saved.result.hybrid ? '100,000' : '50,000'}；比較基準傷害 ${formatNumber(saved.result.baselineDamage)}。`;
      status.textContent = resultValid
        ? `已還原本次分頁的試算結果；${describeIceSearchStatus(saved.result)}`
        : '已還原先前試算供檢視；配裝已變更，請重新搜尋後再套用。';
    } else if (saved) {
      sessionStorage.removeItem(savedSearchKey);
    }
  } catch { /* Ignore an unavailable or invalid saved search. */ }
}).catch(error => {
  status.textContent = '無法讀取正式遊戲資料：' + (error instanceof Error ? error.message : '請重新整理後重試。');
});
