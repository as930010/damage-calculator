import { combineDefenseRates, isDefensePercentageDraft } from '../calculation/battle-defense.ts';
import type { LoadoutCalculationResult } from '../calculation/loadout-engine.ts';
import { teamRevision, teamSnapshotUpdateReason, type BattleDefenseStore } from './battle-defense-state.ts';
import { TEAM_STATE_KEY } from '../features/buff-simulator/frontend/saved-state.ts';

// One lazy module boundary serves both freshness checks and explicit imports.
const loadTeamReferenceModule = () => import('./team-defense-reference.ts');

const shown = (value: number | null) => value === null ? '—' : (value * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '%';
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
        <button type="button" role="tab" data-defense-mode="team">隊伍引用</button>
      </div>
      <div data-defense-panel="manual" role="tabpanel"><label>裝備以外來源總破防率（%）<input type="text" inputmode="decimal" data-defense-manual aria-label="裝備以外來源總破防率（%）" autocomplete="off" spellcheck="false"></label><p class="defense-note">不包含裝備提供的無視防禦。</p></div>
      <div data-defense-panel="sources" role="tabpanel" hidden><div class="defense-sources"></div><button type="button" class="site-button" data-defense-add>＋ 新增破防來源</button><p class="defense-note">請只填入可以同時生效的獨立破防來源；相同來源或互相覆蓋的技能請勿重複計入。</p><p class="defense-note">技能特性若只適用特定技能，計算結果僅適用相同條件，不代表所有技能均享有該破防。</p></div>
      <div data-defense-panel="team" role="tabpanel" hidden><p>從已保存的隊伍配置引用破防率快照；隊伍變更不會自動覆寫目前快照。</p><div class="mode-switch" role="tablist" aria-label="準備引用的隊伍模式"><button type="button" role="tab" data-reference-mode="single" id="battle-defense-reference-single" aria-controls="battle-defense-reference-options">單隊配置</button><button type="button" role="tab" data-reference-mode="challenge" id="battle-defense-reference-challenge" aria-controls="battle-defense-reference-options">挑戰雙隊配置</button></div><div id="battle-defense-reference-options" role="tabpanel"><p class="defense-reference-status" role="status"></p><label class="defense-target" hidden>引用目標<select aria-label="引用隊伍目標"><option value="">請選擇引用目標</option><option value="firstTeam">第一隊</option><option value="secondTeam">第二隊</option><option value="sharedArena">雙隊共用場地</option></select></label><button type="button" class="site-button" data-defense-import>引用隊伍增益破防量</button></div><p class="defense-team-info"></p><p class="defense-import-status defense-snapshot-status" role="status"></p><p class="defense-import-status" role="status"></p></div>
      <p class="defense-error" role="status"></p><dl class="defense-totals"></dl><p class="defense-note defense-additive-info"></p><p class="defense-note">此區塊獨立保存，不包含在匯入匯出設定中且不受復原、重做按鈕影響</p>
    </div>`;
  const manual = root.querySelector<HTMLInputElement>('[data-defense-manual]')!;
  const sourceArea = root.querySelector<HTMLElement>('.defense-sources')!;
  const error = root.querySelector<HTMLElement>('.defense-error')!;
  const importStatus = root.querySelector<HTMLElement>('.defense-import-status:not(.defense-snapshot-status)')!;
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
  let referenceMode: ReferenceMode = store.value.teamSnapshot?.mode ?? (savedReference()?.mode === 'challenge' ? 'challenge' : 'single');
  const referenceTargets: Record<ReferenceMode, string> = { single: 'single', challenge: store.value.teamSnapshot?.mode === 'challenge' ? store.value.teamSnapshot.target : '' };
  let selectionSnapshot = JSON.stringify(store.value.teamSnapshot), importRequest = 0;
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
  const isPercentageInput = (target: EventTarget | null): target is HTMLInputElement => target instanceof HTMLInputElement && target.matches('[data-defense-manual], [data-source-percentage]');
  const rejectedPercentage = () => { error.textContent = '請只輸入 0～100 的數字與小數點，最多八位小數，不需輸入 %；未接受的內容不會變更原值。'; };
  const canInsertPercentage = (input: HTMLInputElement, text: string) => isDefensePercentageDraft(
    input.value.slice(0, input.selectionStart ?? 0) + text + input.value.slice(input.selectionEnd ?? input.value.length));
  root.addEventListener('beforeinput', event => {
    if (!isPercentageInput(event.target)) return;
    const input = event as InputEvent;
    rememberPercentage(event.target);
    if (input.inputType.startsWith('insert') && input.data !== null && !canInsertPercentage(event.target, input.data)) {
      event.preventDefault(); rejectedPercentage();
    }
  });
  root.addEventListener('paste', event => {
    if (!isPercentageInput(event.target)) return;
    const text = (event as ClipboardEvent).clipboardData?.getData('text/plain');
    rememberPercentage(event.target);
    if (text !== undefined && !canInsertPercentage(event.target, text)) { event.preventDefault(); rejectedPercentage(); }
  });
  const titles = ['裝備無視防禦', '裝備以外的破防來源', '最終有效破防率'];
  const summary = root.querySelector<HTMLElement>('.defense-summary-values')!;
  const totals = root.querySelector<HTMLElement>('.defense-totals')!;
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
    root.querySelector<HTMLElement>('.defense-additive-info')!.textContent = additive && equipment.length
      ? `原始裝備 ${displayRates(equipment)} + 隊伍無視防禦加算 ${shown(additive)} = 加算後 ${displayRates(equipment.map(value => value + additive))}` : '';
    const values = [displayRates(equipment), shown(rate), effective];
    values.forEach((value, i) => { summary.children[i].querySelector('strong')!.textContent = value; totals.children[i].querySelector('dd')!.textContent = value; });
  };

  const snapshotStatus = root.querySelector<HTMLElement>('.defense-snapshot-status')!;
  let currentDataRevision: string | undefined, checkedSnapshotRevision: string | undefined;
  let versionRequest: Promise<void> | undefined, disposed = false, versionCheckFailed = false;
  const updateSnapshotNotice = () => {
    const snapshot = store.value.teamSnapshot;
    if (!snapshot) { snapshotStatus.textContent = ''; return; }
    let sourceRevision = snapshot.sourceRevision;
    try { sourceRevision = teamRevision(localStorage.getItem(TEAM_STATE_KEY)); } catch { /* Keep the snapshot when storage is unavailable. */ }
    const reason = teamSnapshotUpdateReason(snapshot, sourceRevision, currentDataRevision);
    snapshotStatus.textContent = reason === 'data' ? '隊伍效果資料已有更新，請重新引用破防量。目前仍使用原快照。'
      : reason === 'team' ? '隊伍配置已有更新，可重新引用破防量。目前仍使用原快照。'
      : versionCheckFailed ? '目前無法確認隊伍效果資料版本，仍使用原快照；可稍後重新引用。' : '';
  };
  const checkSnapshotVersion = (force = false) => {
    const snapshot = store.value.teamSnapshot;
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
    for (const [id, row] of rows) if (!value.sources.some(s => s.id === id)) { row.remove(); rows.delete(id); }
    value.sources.forEach((source, i) => {
      let row = rows.get(source.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'defense-source-row'; row.dataset.sourceId = source.id;
        const name = document.createElement('input'), percentage = document.createElement('input'), remove = document.createElement('button');
        name.type = percentage.type = 'text'; name.dataset.sourceName = ''; name.placeholder = '破防來源名稱（選填）'; percentage.dataset.sourcePercentage = ''; percentage.inputMode = 'decimal'; percentage.placeholder = '破防率（%）';
        remove.type = 'button'; remove.dataset.sourceRemove = ''; remove.textContent = '×';
        row.append(name, percentage, remove); rows.set(source.id, row); sourceArea.append(row);
      }
      const name = row.querySelector<HTMLInputElement>('[data-source-name]')!, percentage = row.querySelector<HTMLInputElement>('[data-source-percentage]')!;
      name.setAttribute('aria-label', `破防來源 ${i + 1} 名稱（選填）`); percentage.setAttribute('aria-label', `破防來源 ${i + 1} 破防率（%）`);
      row.querySelector('button')!.setAttribute('aria-label', `刪除破防來源 ${i + 1}`);
      if (name.value !== source.name) name.value = source.name;
      if (percentage.value !== source.percentage) percentage.value = source.percentage;
      rememberPercentage(percentage);
    });
    error.textContent = store.error;
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-defense-manual], [data-source-percentage]')) input.setAttribute('aria-invalid', String(store.rate === null && !input.closest('[hidden]')));
    const snapshot = value.teamSnapshot;
    if (selectionSnapshot !== JSON.stringify(snapshot)) {
      selectionSnapshot = JSON.stringify(snapshot);
      if (snapshot) { referenceMode = snapshot.mode; referenceTargets[snapshot.mode] = snapshot.target; }
    }
    renderReferenceSelection();
    root.querySelector<HTMLElement>('.defense-team-info')!.textContent = snapshot
      ? `已引用：${snapshot.mode === 'single' ? '單隊配置' : '挑戰雙隊配置'} · ${{ single: '單隊', firstTeam: '第一隊', secondTeam: '第二隊', sharedArena: '雙隊共用場地' }[snapshot.target]} · 外部破防 ${shown(snapshot.rate)} · ${snapshot.sources.join('、') || '無額外破防來源'} · 引用時間 ${snapshot.importedAt}` : '尚未引用隊伍，目前以 0% 計算。';
    updateSnapshotNotice(); checkSnapshotVersion();
    importButton.textContent = snapshot ? '重新引用' : '引用隊伍增益破防量';
    renderTotals();

  };
  const set = (patch: Partial<typeof store.value>) => store.set({ ...store.value, ...patch });
  root.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (isPercentageInput(input) && !isDefensePercentageDraft(input.value)) {
      const previous = percentages.get(input);
      input.value = previous?.value ?? '';
      input.setSelectionRange(previous?.start ?? input.value.length, previous?.end ?? input.value.length);
      rejectedPercentage(); return;
    }
    if (input === manual) set({ manualPercentage: input.value });
    else {
      const id = input.closest<HTMLElement>('[data-source-id]')?.dataset.sourceId;
      if (id) set({ sources: store.value.sources.map(s => s.id === id ? { ...s, ...(input.hasAttribute('data-source-name') ? { name: input.value } : { percentage: input.value }) } : s) });
    }
  });
  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.referenceMode) {
      importRequest++; importButton.disabled = false; importStatus.textContent = '';
      referenceMode = button.dataset.referenceMode as ReferenceMode;
      renderReferenceSelection();
    }
    if (button.dataset.defenseMode) set({ mode: button.dataset.defenseMode as typeof store.value.mode });
    if (button.hasAttribute('data-defense-add')) {
      const id = window.crypto.randomUUID(); set({ sources: [...store.value.sources, { id, name: '', percentage: '' }] }); rows.get(id)?.querySelector('input')?.focus();
    }
    if (button.hasAttribute('data-source-remove')) {
      const id = button.closest<HTMLElement>('[data-source-id]')!.dataset.sourceId;
      const index = store.value.sources.findIndex(s => s.id === id); set({ sources: store.value.sources.filter(s => s.id !== id) });
      const next = store.value.sources[Math.min(index, store.value.sources.length - 1)];
      if (next) rows.get(next.id)?.querySelector('input')?.focus(); else root.querySelector<HTMLButtonElement>('[data-defense-add]')!.focus();
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
    importRequest++; importButton.disabled = false; importStatus.textContent = '';
    referenceTargets.challenge = target.value; renderReferenceSelection();
  });
  importButton.addEventListener('click', async () => {
    const mode = referenceMode, selectedTarget = referenceTargets[mode];
    if (mode === 'challenge' && !selectedTarget) { importStatus.textContent = '請明確選擇第一隊、第二隊或雙隊共用場地，再按引用。'; target.focus(); return; }
    const request = ++importRequest; importButton.disabled = true; importStatus.textContent = '正在讀取隊伍…';
    try {
      const { loadTeamDefenseReferences } = await loadTeamReferenceModule();
      const refs = await loadTeamDefenseReferences(localStorage.getItem(TEAM_STATE_KEY), teamUrl, mode);
      if (request !== importRequest || disposed) return;
      const ref = refs.refs.find(ref => ref.target === selectedTarget);
      if (!ref) { importStatus.textContent = `目前尚無已保存的${targetLabels[selectedTarget] ?? '隊伍'}配置。`; target.focus(); return; }
      versionCheckFailed = false; currentDataRevision = checkedSnapshotRevision = refs.dataRevision;
      set({ teamSnapshot: { mode: refs.mode, target: ref.target, rate: ref.rate, sources: ref.sources, sourceIds: ref.sourceIds,
        sourceRevision: refs.sourceRevision, dataRevision: refs.dataRevision, defenseIgnoreAdditive: ref.defenseIgnoreAdditive ?? 0, defenseIgnoreSources: ref.defenseIgnoreSources ?? [], importedAt: new Date().toISOString() } });
      importStatus.textContent = '已引用破防率快照。隊伍變更後可按「重新引用」。';
    } catch (error) {
      if (request !== importRequest || disposed) return;
      importStatus.textContent = error instanceof Error && error.message.startsWith('目前') ? error.message : '目前沒有可引用的有效隊伍配置。請先至隊伍增益模擬完成設定。';
    } finally { if (request === importRequest && !disposed) importButton.disabled = false; }
  });
  const stale = (event: StorageEvent) => {
    if (event.key !== TEAM_STATE_KEY && event.key !== null) return;
    updateSnapshotNotice(); checkSnapshotVersion(true); renderReferenceSelection();
  };
  const refreshSnapshotVersion = () => { updateSnapshotNotice(); checkSnapshotVersion(true); renderReferenceSelection(); };
  const onToggle = () => { if (root.open) refreshSnapshotVersion(); };
  window.addEventListener('storage', stale);
  window.addEventListener('pageshow', refreshSnapshotVersion);
  window.addEventListener('focus', refreshSnapshotVersion);
  root.addEventListener('toggle', onToggle);
  const unsubscribe = store.subscribe(render); render();
  return { root, setEquipment(values: number[]) { equipment = values; renderTotals(); },
    dispose() { disposed = true; importRequest++; unsubscribe(); window.removeEventListener('storage', stale); window.removeEventListener('pageshow', refreshSnapshotVersion); window.removeEventListener('focus', refreshSnapshotVersion); root.removeEventListener('toggle', onToggle); } };
}
