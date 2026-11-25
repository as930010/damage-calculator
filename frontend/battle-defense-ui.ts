import { combineDefenseRates, isDefensePercentageDraft, parseDefensePercentage } from '../calculation/battle-defense.ts';
import type { LoadoutCalculationResult } from '../calculation/loadout-engine.ts';
import { findTeamDefenseSource, replaceTeamDefenseSource, teamRevision, teamSnapshotUpdateReason, type BattleDefenseStore } from './battle-defense-state.ts';
import { TEAM_STATE_KEY } from '../features/buff-simulator/frontend/saved-state.ts';

// One lazy module boundary serves both freshness checks and explicit imports.
const loadTeamReferenceModule = () => import('./team-defense-reference.ts');

const percentageText = (value: number, places: number) => (value * 100).toFixed(places).replace(/0+$/, '').replace(/\.$/, '');
const setText = (node: Element, text: string) => {
  if (node.textContent !== text) node.textContent = text;
};
const shown = (value: number | null, places = 4) => value === null ? '—' : percentageText(value, places) + '%';
export function equipmentDefenseRates(result: LoadoutCalculationResult | undefined, fallback?: number): number[] {
  return result ? (result.lowerwearConfigurations?.map(c => (c.result.attributes.stats.defenseIgnorePct?.finalTotal ?? 0) / 100)
    ?? [(result.attributes.stats.defenseIgnorePct?.finalTotal ?? 0) / 100]) : fallback === undefined ? [] : [fallback / 100];
}

/** Mounted once. Input and source-row nodes survive recalculation and cross-page updates. */
export function createBattleDefenseEditor(store: BattleDefenseStore, teamUrl: URL) {
  const root = document.createElement('details');
  root.className = 'global-source-panel battle-defense';
  root.dataset.disclosureKey = 'battle-defense-context';
  root.innerHTML = `<summary><span class="defense-title">戰鬥破防設定</span><span class="defense-summary-values"></span></summary>
    <div class="defense-body"><p>設定裝備以外的破防來源，並與目前配裝的無視防禦合併計算。</p>
      <div class="mode-switch" role="tablist" aria-label="破防輸入模式">
        <button type="button" role="tab" data-defense-mode="manual">直接輸入</button>
        <button type="button" role="tab" data-defense-mode="sources">逐項設定</button>
      </div>
      <div data-defense-panel="manual" role="tabpanel"><label>裝備以外來源總破防率（%）<input type="text" inputmode="decimal" data-defense-manual aria-label="裝備以外來源總破防率（%）" autocomplete="off" spellcheck="false"></label><p class="defense-note">不包含裝備提供的無視防禦。</p></div>
      <div data-defense-panel="sources" role="tabpanel" hidden>
        <div class="defense-sources"></div>
        <button type="button" class="site-button" data-defense-add>＋ 新增破防來源</button>
        <div data-defense-legacy hidden><p class="defense-note"></p><button type="button" class="site-button" data-defense-restore>加入舊版保留的手動來源</button></div>
        <details class="defense-reference"><summary>從隊伍配置引用</summary><p>從已保存的隊伍配置引用破防率快照；隊伍變更不會自動覆寫目前快照。</p><div class="mode-switch" role="tablist" aria-label="準備引用的隊伍模式"><button type="button" role="tab" data-reference-mode="single" id="battle-defense-reference-single" aria-controls="battle-defense-reference-options">單隊配置</button><button type="button" role="tab" data-reference-mode="challenge" id="battle-defense-reference-challenge" aria-controls="battle-defense-reference-options">挑戰雙隊配置</button></div><div id="battle-defense-reference-options" role="tabpanel"><p class="defense-reference-status" role="status"></p><label class="defense-target" hidden>引用目標<select aria-label="引用隊伍目標"><option value="">請選擇引用目標</option><option value="firstTeam">第一隊</option><option value="secondTeam">第二隊</option><option value="sharedArena">雙隊共用場地</option></select></label><button type="button" class="site-button" data-defense-import>引用隊伍增益破防量</button></div><p class="defense-import-status" role="status"></p></details>
        <p class="defense-note">請只填入可以同時生效的獨立破防來源，並避免重複計入已包含於隊伍引用內的相同破防效果。</p>
        <p class="defense-note">技能特性若只適用特定技能，計算結果僅適用相同條件，不代表所有技能均享有該破防。</p>
      </div>
      <p id="battle-defense-error" class="defense-error" role="status"></p><dl class="defense-totals"></dl><p class="defense-note defense-additive-info"></p><p class="defense-note">此區塊獨立保存，不包含在匯入匯出設定中且不受復原、重做按鈕影響</p>
    </div>`;
  const manual = root.querySelector<HTMLInputElement>('[data-defense-manual]')!;
  const sourceArea = root.querySelector<HTMLElement>('.defense-sources')!;
  const error = root.querySelector<HTMLElement>('.defense-error')!;
  let describedInput: HTMLInputElement | undefined;
  const showError = (message: string, input?: HTMLInputElement) => {
    if (input !== describedInput) {
      describedInput?.removeAttribute('aria-describedby');
      input?.setAttribute('aria-describedby', error.id);
      describedInput = input;
    }
    setText(error, message);
  };
  const importStatus = root.querySelector<HTMLElement>('.defense-reference .defense-import-status')!;
  const target = root.querySelector<HTMLSelectElement>('.defense-target select')!;
  const importButton = root.querySelector<HTMLButtonElement>('[data-defense-import]')!;
  type ReferenceMode = 'single' | 'challenge';
  const referenceTabs = [...root.querySelectorAll<HTMLButtonElement>('[data-reference-mode]')];
  const referenceStatus = root.querySelector<HTMLElement>('.defense-reference-status')!;
  // Only a preselection hint; actual imports use the simulator's validated parser.
  const savedReference = () => {
    try { return JSON.parse(localStorage.getItem(TEAM_STATE_KEY) ?? 'null') as { version?: number; mode?: string; membersByTeam?: Record<string, unknown> } | null; }
    catch { return null; }
  };
  const currentTeam = () => findTeamDefenseSource(store.value.sources);
  const initialSnapshot = currentTeam()?.snapshot;
  let referenceMode: ReferenceMode = initialSnapshot?.mode ?? (savedReference()?.mode === 'challenge' ? 'challenge' : 'single');
  const referenceTargets: Record<ReferenceMode, string> = { single: 'single', challenge: initialSnapshot?.mode === 'challenge' ? initialSnapshot.target : '' };
  let selectionSnapshot = JSON.stringify(initialSnapshot), renderedMode: typeof store.value.mode | undefined;
  let importRequest = 0;
  const cancelImport = () => { importRequest++; importButton.disabled = false; importStatus.textContent = ''; };
  const targetLabels: Record<string, string> = { single: '單隊', firstTeam: '第一隊', secondTeam: '第二隊', sharedArena: '雙隊共用場地' };
  const renderReferenceSelection = () => {
    referenceTabs.forEach(button => {
      const selected = button.dataset.referenceMode === referenceMode;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    root.querySelector('#battle-defense-reference-options')!.setAttribute('aria-labelledby', 'battle-defense-reference-' + referenceMode);
    target.parentElement!.hidden = referenceMode === 'single';
    target.value = referenceMode === 'challenge' ? referenceTargets.challenge : '';
    const label = referenceMode === 'single' ? '單隊配置' : '挑戰雙隊配置';
    const saved = savedReference();
    const keys = referenceMode === 'single' ? ['single'] : ['first', 'second'];
    const hasMembers = keys.some(key => Array.isArray(saved?.membersByTeam?.[key]) && (saved!.membersByTeam![key] as unknown[]).some(name => typeof name === 'string' && name.trim()));
    referenceStatus.textContent = !saved || saved.version !== 1
      ? '目前沒有可引用的有效隊伍配置。請先至隊伍增益模擬完成設定。'
      : !hasMembers ? `目前尚無已保存的${label}。`
      : `準備引用：${label}${referenceMode === 'challenge' ? ' · ' + (targetLabels[referenceTargets.challenge] ?? '請選擇引用目標') : ''}。按下引用後才生效。`;
  };
  let equipment: number[] = [];
  const rows = new Map<string, HTMLElement>();
  const percentages = new WeakMap<HTMLInputElement, { value: string; start: number | null; end: number | null }>();
  const rememberPercentage = (input: HTMLInputElement) => percentages.set(input, { value: input.value, start: input.selectionStart, end: input.selectionEnd });
  const isPercentageInput = (target: EventTarget | null): target is HTMLInputElement => target instanceof HTMLInputElement && !target.readOnly && target.matches('[data-defense-manual], [data-source-percentage]');
  const rejectedPercentage = (input: HTMLInputElement) => showError('請只輸入 0～100 的數字與小數點，最多八位小數，不需輸入 %；未接受的內容不會變更原值。', input);
  const canInsertPercentage = (input: HTMLInputElement, text: string) => isDefensePercentageDraft(
    input.value.slice(0, input.selectionStart ?? 0) + text + input.value.slice(input.selectionEnd ?? input.value.length));
  root.addEventListener('beforeinput', event => {
    if (!isPercentageInput(event.target)) return;
    const input = event as InputEvent;
    rememberPercentage(event.target);
    if (input.inputType.startsWith('insert') && input.data !== null && !canInsertPercentage(event.target, input.data)) {
      event.preventDefault(); rejectedPercentage(event.target);
    }
  });
  root.addEventListener('paste', event => {
    if (!isPercentageInput(event.target)) return;
    const text = (event as ClipboardEvent).clipboardData?.getData('text/plain');
    rememberPercentage(event.target);
    if (text !== undefined && !canInsertPercentage(event.target, text)) { event.preventDefault(); rejectedPercentage(event.target); }
  });
  const titles = ['裝備無視防禦', '裝備以外的破防來源', '最終有效破防率'];
  const summary = root.querySelector<HTMLElement>('.defense-summary-values')!;
  const totals = root.querySelector<HTMLElement>('.defense-totals')!;
  const additiveInfo = root.querySelector<HTMLElement>('.defense-additive-info')!;
  for (const title of titles) {
    const item = document.createElement('span'); const label = document.createElement('span'); label.textContent = title;
    const value = document.createElement('strong'); item.append(label, value); summary.append(item);
    const group = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = title; group.append(dt, dd); totals.append(group);
  }
  const renderTotals = () => {
    const rate = store.rate, additive = store.defenseIgnoreAdditive;
    const displayRates = (values: number[]) => !values.length ? '—' : values.every(v => v === values[0]) ? shown(values[0]) : values.map((v, i) => `${i === 0 ? '下衣' : '強/排褲'} ${shown(v)}`).join('／');
    let effective = '—';
    try { if (rate !== null && additive !== null) effective = displayRates(equipment.map(value => combineDefenseRates(value, rate, additive))); } catch { effective = '無法計算'; }
    setText(additiveInfo, additive && equipment.length
      ? `原始裝備 ${displayRates(equipment)} + 隊伍無視防禦加算 ${shown(additive)} = 加算後 ${displayRates(equipment.map(value => value + additive))}` : '');
    const values = [displayRates(equipment), shown(rate), effective];
    values.forEach((value, i) => {
      setText(summary.children[i].querySelector('strong')!, value);
      setText(totals.children[i].querySelector('dd')!, value);
    });
  };

  let currentDataRevision: string | undefined, checkedSnapshotRevision: string | undefined;
  let versionRequest: Promise<void> | undefined, disposed = false, versionCheckFailed = false;
  const updateSnapshotNotice = () => {
    const team = currentTeam();
    if (!team) return;
    const snapshotStatus = rows.get(team.id)?.querySelector<HTMLElement>('.defense-snapshot-status');
    if (!snapshotStatus) return;
    const { snapshot } = team;
    let sourceRevision = snapshot.sourceRevision;
    try { sourceRevision = teamRevision(localStorage.getItem(TEAM_STATE_KEY)); } catch { /* Keep the snapshot when storage is unavailable. */ }
    const reason = teamSnapshotUpdateReason(snapshot, sourceRevision, currentDataRevision);
    snapshotStatus.textContent = reason === 'data' ? '隊伍效果資料已有更新，請重新引用破防量。目前仍使用原快照。'
      : reason === 'team' ? '隊伍配置已有更新，可重新引用破防量。目前仍使用原快照。'
      : versionCheckFailed ? '目前無法確認隊伍效果資料版本，仍使用原快照；可稍後重新引用。' : '';
  };
  const checkSnapshotVersion = (force = false) => {
    const snapshot = currentTeam()?.snapshot;
    if (!snapshot || disposed || versionRequest || (!force && checkedSnapshotRevision === snapshot.dataRevision)) return;
    checkedSnapshotRevision = snapshot.dataRevision;
    versionRequest = (async () => {
      try {
        const { loadTeamDefenseDataRevision } = await loadTeamReferenceModule();
        const revision = await loadTeamDefenseDataRevision(teamUrl);
        if (!disposed) { currentDataRevision = revision; versionCheckFailed = false; updateSnapshotNotice(); }
      } catch {
        if (!disposed) {
          versionCheckFailed = true; updateSnapshotNotice();
        }
      } finally { versionRequest = undefined; }
    })();
  };

  const render = () => {
    const value = store.value;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-defense-mode]')) {
      const active = button.dataset.defenseMode === value.mode;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    }
    for (const panel of root.querySelectorAll<HTMLElement>('[data-defense-panel]')) panel.hidden = panel.dataset.defensePanel !== value.mode;
    if (manual.value !== value.manualPercentage) manual.value = value.manualPercentage;
    rememberPercentage(manual);
    // Keep the saved input order for calculation; only the view puts the team last.
    const team = findTeamDefenseSource(value.sources);
    const sources = value.sources.filter(source => source.kind === 'manual');
    const visibleSources = team ? [...sources, team] : sources;
    const sourceIds = new Set(visibleSources.map(source => source.id));
    for (const [id, row] of rows) if (!sourceIds.has(id)) { row.remove(); rows.delete(id); }
    visibleSources.forEach((source, i) => {
      let row = rows.get(source.id);
      if (row && row.dataset.sourceKind !== source.kind) { row.remove(); row = undefined; }
      if (!row) {
        row = document.createElement('div'); row.className = 'defense-source-row';
        row.dataset.sourceId = source.id; row.dataset.sourceKind = source.kind;
        row.innerHTML = '<input type="text" data-source-name placeholder="破防來源名稱（選填）"><input type="text" inputmode="decimal" data-source-percentage placeholder="破防率（%）"><button type="button" data-source-remove>×</button>';
        if (source.kind === 'team') {
          row.querySelector<HTMLInputElement>('[data-source-percentage]')!.readOnly = true;
          row.insertAdjacentHTML('beforeend', '<div class="defense-team-info defense-note"><p class="defense-team-classes"></p><p class="defense-team-options"></p><p class="defense-team-additive"></p><p class="defense-team-sources"></p><p class="defense-import-status defense-snapshot-status" role="status"></p></div>');
        }
        rows.set(source.id, row);
      }
      if (sourceArea.children[i] !== row) sourceArea.insertBefore(row, sourceArea.children[i] ?? null);
      const name = row.querySelector<HTMLInputElement>('[data-source-name]')!;
      const percentage = row.querySelector<HTMLInputElement>('[data-source-percentage]')!;
      const remove = row.querySelector('button')!;
      if (source.kind === 'team') {
        const { snapshot } = source;
        const label = snapshot.mode === 'single' ? '單隊配置' : '挑戰雙隊 · ' + targetLabels[snapshot.target];
        const defaultName = '隊伍引用 · ' + label;
        name.placeholder = defaultName;
        name.setAttribute('aria-label', '隊伍引用的顯示名稱 · ' + label);
        percentage.setAttribute('aria-label', '隊伍快照破防率（%，唯讀）');
        remove.setAttribute('aria-label', '刪除隊伍引用');
        const displayName = source.name ?? defaultName;
        if (name.value !== displayName) name.value = displayName;
        const formattedRate = percentageText(snapshot.rate, 12);
        if (percentage.value !== formattedRate) percentage.value = formattedRate;
        const contributions = snapshot.contributions;
        const groups = [
          ['class', '.defense-team-classes', '職業'],
          ['loadout', '.defense-team-options', '配置效果'],
          ['defense-ignore', '.defense-team-additive', '裝備無視防禦加算'],
        ] as const;
        for (const [category, selector, heading] of groups) {
          const items = contributions?.filter(item => item.category === category).map(item => item.label + ' ' + shown(item.rate, 12)) ?? [];
          if (!contributions && category === 'defense-ignore') items.push(...(snapshot.defenseIgnoreSources ?? []));
          setText(row.querySelector(selector)!, items.length ? heading + '：' + items.join('、') : '');
        }
        const legacy = snapshot.sources?.join('、');
        setText(row.querySelector('.defense-team-sources')!, contributions
          ? contributions.some(item => item.category !== 'defense-ignore') ? '' : '無額外破防來源'
          : (legacy ? '引用來源：' + legacy + '。' : '') + '舊快照未保存個別百分比，重新引用後可查看。');
        return;
      }
      name.setAttribute('aria-label', '破防來源 ' + (i + 1) + ' 名稱（選填）');
      percentage.setAttribute('aria-label', '破防來源 ' + (i + 1) + ' 破防率（%）');
      remove.setAttribute('aria-label', '刪除破防來源 ' + (i + 1));
      if (name.value !== source.name) name.value = source.name;
      if (percentage.value !== source.percentage) percentage.value = source.percentage;
      rememberPercentage(percentage);
    });
    const legacy = root.querySelector<HTMLElement>('[data-defense-legacy]')!;
    const legacyCount = value.legacyManualSources?.length ?? 0;
    legacy.hidden = !legacyCount;
    if (legacyCount) legacy.querySelector('p')!.textContent = '已保留舊版隊伍模式中未生效的 ' + legacyCount + ' 筆手動來源。按下加入後才納入計算。';
    // The store's calculation message identifies the first invalid source.
    let firstInvalid: HTMLInputElement | undefined;
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-defense-manual], [data-source-percentage]:not([readonly])')) {
      const invalid = !store.hasReadError && !input.closest('[hidden]')
        && input.value.trim() !== '' && parseDefensePercentage(input.value) === null;
      if (invalid) {
        input.setAttribute('aria-invalid', 'true');
        firstInvalid ??= input;
      } else input.removeAttribute('aria-invalid');
    }
    showError(store.error, firstInvalid);
    const snapshot = currentTeam()?.snapshot;
    const snapshotKey = JSON.stringify(snapshot);
    if (selectionSnapshot !== snapshotKey || renderedMode !== value.mode) {
      if (renderedMode !== undefined) cancelImport();
      if (selectionSnapshot !== snapshotKey && snapshot) { referenceMode = snapshot.mode; referenceTargets[snapshot.mode] = snapshot.target; }
      selectionSnapshot = snapshotKey; renderedMode = value.mode;
      updateSnapshotNotice();
      if (value.mode === 'sources') { renderReferenceSelection(); checkSnapshotVersion(); }
    }
    setText(importButton, snapshot ? '重新引用' : '引用隊伍增益破防量');
    renderTotals();

  };
  const set = (patch: Partial<typeof store.value>) => store.set({ ...store.value, ...patch });
  root.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.readOnly) return;
    if (isPercentageInput(input) && !isDefensePercentageDraft(input.value)) {
      const previous = percentages.get(input);
      input.value = previous?.value ?? '';
      input.setSelectionRange(previous?.start ?? input.value.length, previous?.end ?? input.value.length);
      rejectedPercentage(input); return;
    }
    if (input === manual) set({ manualPercentage: input.value });
    else {
      const id = input.closest<HTMLElement>('[data-source-id]')?.dataset.sourceId;
      const isName = input.hasAttribute('data-source-name');
      if (!id) return;
      if (isName) set({ sources: store.value.sources.map(source => source.id === id ? { ...source, name: input.value } : source) });
      else set({ sources: store.value.sources.map(source => source.kind === 'manual' && source.id === id ? { ...source, percentage: input.value } : source) });
    }
  });
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.referenceMode) {
      cancelImport();
      referenceMode = button.dataset.referenceMode as ReferenceMode;
      renderReferenceSelection();
    }
    if (button.dataset.defenseMode) set({ mode: button.dataset.defenseMode as typeof store.value.mode });
    if (button.hasAttribute('data-defense-add')) {
      const id = window.crypto.randomUUID(); set({ sources: [...store.value.sources, { kind: 'manual', id, name: '', percentage: '' }] }); rows.get(id)?.querySelector('input')?.focus();
    }
    if (button.hasAttribute('data-defense-restore')) {
      const restored = store.value.legacyManualSources ?? [];
      set({ sources: [...store.value.sources, ...restored], legacyManualSources: undefined });
      if (restored.length) rows.get(restored[0].id)?.querySelector('input')?.focus();
    }
    if (button.hasAttribute('data-source-remove')) {
      const row = button.closest<HTMLElement>('[data-source-id]')!;
      const neighbor = row.nextElementSibling ?? row.previousElementSibling;
      set({ sources: store.value.sources.filter(source => source.id !== row.dataset.sourceId) });
      const next = neighbor?.querySelector<HTMLElement>('[data-source-name]') ?? root.querySelector<HTMLButtonElement>('[data-defense-add]')!;
      next.focus();
    }
  });
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-defense-mode]')];
  tabs.forEach(button => {
    const mode = button.dataset.defenseMode!; button.id = 'battle-defense-tab-' + mode; button.setAttribute('aria-controls', 'battle-defense-panel-' + mode);
    const panel = root.querySelector<HTMLElement>(`[data-defense-panel="${mode}"]`)!; panel.id = 'battle-defense-panel-' + mode; panel.setAttribute('aria-labelledby', button.id);
  });
  for (const buttons of [tabs, referenceTabs]) buttons[0].parentElement!.addEventListener('keydown', event => {
    const key = (event as KeyboardEvent).key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault(); const current = buttons.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const index = key === 'Home' ? 0 : key === 'End' ? buttons.length - 1 : (current + (key === 'ArrowLeft' ? buttons.length - 1 : 1)) % buttons.length;
    buttons[index].click(); buttons[index].focus();
  });
  target.addEventListener('change', () => {
    cancelImport();
    referenceTargets.challenge = target.value; renderReferenceSelection();
  });
  importButton.addEventListener('click', async () => {
    if (store.value.mode !== 'sources') return;
    const mode = referenceMode, selectedTarget = referenceTargets[mode];
    if (mode === 'challenge' && !selectedTarget) { importStatus.textContent = '請明確選擇第一隊、第二隊或雙隊共用場地，再按引用。'; target.focus(); return; }
    const restoreFocus = document.activeElement === importButton;
    const request = ++importRequest; importButton.disabled = true; importStatus.textContent = '正在讀取隊伍…';
    let imported = false;
    try {
      const { loadTeamDefenseReferences } = await loadTeamReferenceModule();
      const refs = await loadTeamDefenseReferences(localStorage.getItem(TEAM_STATE_KEY), teamUrl, mode);
      if (request !== importRequest || disposed) return;
      const ref = refs.refs.find(ref => ref.target === selectedTarget);
      if (!ref) { importStatus.textContent = `目前尚無已保存的${targetLabels[selectedTarget] ?? '隊伍'}配置。`; target.focus(); return; }
      versionCheckFailed = false; currentDataRevision = checkedSnapshotRevision = refs.dataRevision;
      set({ sources: replaceTeamDefenseSource(store.value, { mode: refs.mode, target: ref.target, rate: ref.rate, contributions: ref.contributions,
        sourceRevision: refs.sourceRevision, dataRevision: refs.dataRevision, defenseIgnoreAdditive: ref.defenseIgnoreAdditive ?? 0, importedAt: new Date().toISOString() }) });
      imported = true;
      importStatus.textContent = '已引用破防率快照。隊伍變更後可按「重新引用」。';
    } catch (error) {
      if (request !== importRequest || disposed) return;
      importStatus.textContent = error instanceof Error && error.message.startsWith('目前') ? error.message : '目前沒有可引用的有效隊伍配置。請先至隊伍增益模擬完成設定。';
    } finally {
      if (request === importRequest && !disposed) importButton.disabled = false;
      if (!disposed && (imported || request === importRequest) && restoreFocus && document.activeElement === document.body) {
        importButton.focus({ preventScroll: true });
      }
    }
  });
  const stale = (event: StorageEvent) => {
    if (event.key !== TEAM_STATE_KEY && event.key !== null) return;
    refreshSnapshotVersion();
  };
  const refreshSnapshotVersion = () => {
    if (store.value.mode !== 'sources') return;
    updateSnapshotNotice(); checkSnapshotVersion(true); renderReferenceSelection();
  };
  const onToggle = () => { if (root.open) refreshSnapshotVersion(); };
  window.addEventListener('storage', stale);
  window.addEventListener('pageshow', refreshSnapshotVersion);
  window.addEventListener('focus', refreshSnapshotVersion);
  root.addEventListener('toggle', onToggle);
  const unsubscribe = store.subscribe(render); render();
  return { root, setEquipment(values: number[]) { equipment = values; renderTotals(); },
    dispose() { disposed = true; importRequest++; unsubscribe(); window.removeEventListener('storage', stale); window.removeEventListener('pageshow', refreshSnapshotVersion); window.removeEventListener('focus', refreshSnapshotVersion); root.removeEventListener('toggle', onToggle); } };
}
