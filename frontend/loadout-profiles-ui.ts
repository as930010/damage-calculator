import { LoadoutProfiles, isProfileDirty, exportProfileBackup, exportNamedProfile, readProfileArchive, profileBackupLimit, profilesKey,
  type ProfileResult, type SavedLoadoutProfile } from './loadout-profiles.ts';
import { parseArchiveJson } from './loadout-archive.ts';
import { ProfileDraft, draftAssociationKey } from './profile-draft.ts';
import type { LoadoutState } from './state.ts';

type Working = {loadout: LoadoutState; baseline: LoadoutState | null};
type Options = {root: HTMLElement; draft: ProfileDraft; readOnly: boolean; working: () => Working;
  validate: (profile: Pick<SavedLoadoutProfile, 'loadout' | 'baseline'>) => void | Promise<void>; apply: (profile: SavedLoadoutProfile) => void};
function unwrap<T>(result: ProfileResult<T>): T { if (!result.ok) throw result.error; return result.value; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
}

function download(json: string, prefix: string) {
  const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
  const link = element('a');
  link.href = url; link.download = prefix + '-' + new Date().toISOString().slice(0,10) + '.json';
  link.click(); URL.revokeObjectURL(url);
}

export function mountProfileManager(options: Options) {
  const {root, draft, readOnly, working} = options;
  const library = new LoadoutProfiles(undefined, readOnly);
  const panel = element('details', undefined, 'profile-panel'); panel.id = 'profile-manager';
  panel.setAttribute('aria-label', '我的角色與配裝');
  panel.dataset.disclosureKey = 'loadout-profiles'; panel.open = true;
  const heading = element('summary', undefined, 'profile-heading');
  const title = element('h2', '我的角色與配裝');
  const current = element('span', undefined, 'profile-current'); current.id = 'profile-current';
  heading.append(title, current);
  const actions = element('div', undefined, 'profile-actions');
  const message = element('p', undefined, 'profile-message'); message.setAttribute('role','status'); message.id = 'profile-message';
  const content = element('div', undefined, 'profile-content');
  const accordion = element('div', undefined, 'profile-management');
  const manageToggle = element('button', '管理已儲存配置', 'profile-manage-toggle');
  manageToggle.type = 'button';
  manageToggle.id = 'profile-manage';
  manageToggle.setAttribute('aria-expanded', 'false');
  manageToggle.setAttribute('aria-controls', 'profile-management');
  const arrow = element('span', undefined, 'profile-manage-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  manageToggle.append(arrow);
  const chips = element('div', undefined, 'profile-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', '切換已儲存配置');
  const empty = element('p', '尚無已儲存配置。', 'profile-empty');
  const controls = element('div', undefined, 'profile-management-body');
  controls.id = 'profile-management';
  controls.setAttribute('role', 'region');
  controls.setAttribute('aria-labelledby', manageToggle.id);
  controls.hidden = true;
  accordion.append(manageToggle, controls);
  const targets = element('div', undefined, 'profile-chips');
  targets.setAttribute('role', 'group');
  const targetHeading = element('h4', '選擇要管理的配置');
  targetHeading.id = 'profile-management-heading';
  targets.setAttribute('aria-labelledby', targetHeading.id);
  const management = element('div', undefined, 'profile-management-actions');
  controls.append(targetHeading, targets, management);
  const savedProfiles = element('div');
  savedProfiles.append(chips, empty);
  content.append(actions, savedProfiles, accordion, message);
  panel.append(heading, content);
  root.before(panel);
  const notify = (text: string) => { message.textContent = text; };
  let loaded = false;
  let busy = false;
  let listKey = '';
  let managedId = '';
  const targetActions: HTMLButtonElement[] = [];
  function updateControls(activeId: string) {
    const disabled = busy || readOnly || !loaded;
    panel.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
    for (const button of targetActions) button.disabled = disabled || !managedId;
    for (const button of chips.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.profileId === activeId));
    }
    for (const button of targets.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.manageId === managedId));
    }
  }

  function findChip(list: HTMLElement, key: 'profileId' | 'manageId', id: string | undefined) {
    return Array.from(list.querySelectorAll('button')).find(button => button.dataset[key] === id);
  }

  function makeChip(profile: SavedLoadoutProfile) {
    const chip = element('button', undefined, 'profile-chip');
    chip.type = 'button';
    chip.title = profile.name;
    chip.append(element('span', profile.name, 'profile-chip-label'));
    return chip;
  }
  // Cache only the listing between library operations; equipment keystrokes must not
  // deep-clone every character's loadout merely to refresh the current dirty badge.
  let listed: SavedLoadoutProfile[] = [];
  const syncList = () => { listed = unwrap(library.getStore()).profiles; };
  const active = () => {
    if (!draft.profileId) return undefined;
    const result = library.getProfile(draft.profileId);
    return result.ok ? result.value : undefined;
  };
  // Legacy JSON may store numbers while Pickers return strings. Compare equivalent display
  // values without rewriting the formal snapshot or the user's editing representation.
  const comparable = (state: LoadoutState): LoadoutState => ({...state,
    values: Object.fromEntries(Object.entries(state.values).map(([key,value]) => [key,typeof value === 'number' ? String(value) : value]))});
  const dirty = (p = active()) => {
    const w=working();
    return !p || isProfileDirty({...p,loadout:comparable(p.loadout),baseline:p.baseline?comparable(p.baseline):null},
      comparable(w.loadout), w.baseline?comparable(w.baseline):null);
  };
  function refresh() {
    if (!loaded) return;
    const p = active(), changed = dirty(p);
    const text = `${p?.name ?? '未命名配置'}${p ? ' · ' + (changed ? '未儲存' : '已儲存') : ''}`;
    if (current.textContent !== text) current.textContent = text;
    current.dataset.status = p ? changed ? 'dirty' : 'saved' : 'unnamed';
    const key = JSON.stringify(listed.map(({id, name}) => [id, name]));
    const focused = document.activeElement as HTMLElement | null;
    if (key !== listKey) {
      chips.replaceChildren();
      targets.replaceChildren();
      for (const entry of listed) {
        const chip = makeChip(entry);
        chip.dataset.profileId = entry.id;
        chip.addEventListener('click', run(() => switchTo(entry.id)));
        chips.append(chip);

        const target = makeChip(entry);
        target.dataset.manageId = entry.id;
        target.addEventListener('click', () => {
          managedId = entry.id;
          updateControls(draft.profileId ?? '');
        });
        targets.append(target);
      }
      listKey = key;
    }
    if (!listed.some(entry => entry.id === managedId)) managedId = p?.id ?? listed[0]?.id ?? '';
    empty.hidden = listed.length > 0;
    targetHeading.hidden = !listed.length;
    updateControls(p?.id ?? '');
    if (focused && !focused.isConnected) restoreFocus(focused);
    if (draft.error) notify(draft.error);
  }

  function restoreFocus(previous: HTMLElement) {
    const replacement = previous.isConnected ? previous
      : findChip(chips, 'profileId', previous.dataset.profileId) ?? findChip(targets, 'manageId', previous.dataset.manageId);
    if (!panel.open && replacement && panel.contains(replacement)) {
      heading.focus();
    } else if (replacement && !replacement.matches(':disabled') && !replacement.closest('[hidden]')) {
      replacement.focus();
    } else {
      (panel.open ? manageToggle : heading).focus();
    }
  }

  const run = (action: () => void | Promise<void>) => async (event: Event) => {
    if (busy || readOnly || !loaded) return;
    const focus = event.currentTarget instanceof HTMLElement && event.currentTarget.tagName === 'BUTTON'
      ? event.currentTarget : document.activeElement as HTMLElement | null;
    busy = true; panel.setAttribute('aria-busy','true');
    updateControls(draft.profileId ?? '');
    try { await action(); } catch (error) { notify(error instanceof Error ? error.message : '操作失敗；目前草稿仍保留。'); }
    finally {
      busy = false; panel.setAttribute('aria-busy','false');
      syncList();
      refresh();
      if (focus) restoreFocus(focus);
    }
  };
  const button = (parent: HTMLElement, text: string, id: string, action: () => void | Promise<void>) => {
    const node = element('button',text); node.type='button'; node.id=id; node.disabled=readOnly;
    node.addEventListener('click',run(action)); parent.append(node); return node;
  };
  // One native modal, with validation errors kept beside the same input.
  async function ask(title: string, description: string, choices: string[], initial?: string,
    perform?: (choice: string, name: string) => void): Promise<string | null> {
    const dialog = element('dialog',undefined,'profile-dialog'); dialog.setAttribute('aria-labelledby','profile-dialog-title');
    const h = element('h2',title); h.id='profile-dialog-title';
    const form = element('form'); const error = element('p',undefined,'input-warning'); error.setAttribute('role','alert');
    const name = element('input'); name.id='profile-name'; name.setAttribute('aria-label','配置名稱'); name.value=initial??''; name.autocomplete='off';
    const buttons = element('div',undefined,'profile-dialog-actions');
    form.append(h,element('p',description)); if (initial !== undefined) form.append(name); form.append(error,buttons); dialog.append(form); document.body.append(dialog);
    return new Promise(resolve => {
      const finish = (value: string | null) => { dialog.remove(); resolve(value); };
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
      form.addEventListener('submit',event=>{event.preventDefault(); execute(choices[0]);});
      const execute = (choice: string) => {
        try { perform?.(choice,name.value); finish(choice); } catch (e) { error.textContent=e instanceof Error?e.message:'操作失敗。'; }
      };
      for (const choice of choices) { const b=element('button',choice); b.type='button'; b.addEventListener('click',()=>execute(choice));buttons.append(b); }
      const cancel=element('button','取消'); cancel.type='button';cancel.addEventListener('click',()=>finish(null));buttons.append(cancel);
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open','');
      if (initial !== undefined) {name.focus();name.select();} else buttons.querySelector('button')?.focus();
    });
  }
  function checkDraftForSave() {
    if (draft.error || draft.conflicted) throw Error(draft.error || '其他分頁已更新工作草稿。請先匯出本頁配裝，再重新整理。');
  }
  async function save(asNew = false): Promise<boolean> {
    const w = structuredClone(working()), p = active();
    await options.validate(w);
    checkDraftForSave();
    if (p && !asNew) { unwrap(library.saveProfile(p.id,w.loadout,w.baseline));notify('配置已儲存。');return true; }
    let created: SavedLoadoutProfile | undefined;
    const done=await ask(asNew?'另存為新配置':'儲存命名配置','保存目前草稿與比較基準。名稱最多 40 字元。',['儲存'], '', (_choice,name)=>{
      checkDraftForSave();
      created=unwrap(library.createProfile(name,w.loadout,w.baseline));
    });
    if (!done || !created) return false;
    if (!draft.write(w.loadout,w.baseline,created.id)) throw Error(`新配置已保存，但草稿關聯未更新：${draft.error}`);
    notify('已將目前草稿另存為新配置。');return true;
  }
  async function switchTo(id: string) {
    if (!id || id === draft.profileId) {refresh();return;}
    // Refresh is explicit after conflicts; never silently load a stale cached target.
    unwrap(library.checkCurrent());
    const target=unwrap(library.getProfile(id));await options.validate(target);
    if (dirty()) {
      const choice=await ask('切換角色與配裝','目前有未儲存的草稿或比較基準；放棄後將載入目標的正式存檔。',['儲存並切換','放棄修改並切換']);
      if (!choice) {refresh();return;}
      if (choice==='儲存並切換' && !await save()) {refresh();return;}
    }
    // A dialog can stay open while another tab changes the library.
    const latest=new LoadoutProfiles();const fresh=unwrap(latest.reload()).profiles.find(p=>p.id===id);
    if (!fresh || JSON.stringify(fresh)!==JSON.stringify(target)) throw Error('切換目標已變更。請先匯出本頁配裝，再重新整理。');
    if (!draft.write(target.loadout,target.baseline??null,target.id)) throw Error(draft.error);
    options.apply(target);notify(`已載入「${target.name}」；復原歷史已從此配置重新開始。`);
  }
  manageToggle.addEventListener('click', () => {
    if (!controls.hidden && controls.contains(document.activeElement)) manageToggle.focus();
    controls.hidden = !controls.hidden;
    manageToggle.setAttribute('aria-expanded', String(!controls.hidden));
    if (!controls.hidden) {
      managedId = draft.profileId ?? managedId;
      updateControls(draft.profileId ?? '');
      (findChip(targets, 'manageId', managedId) ?? management.querySelector<HTMLButtonElement>('#profile-backup'))?.focus();
    }
  });
  controls.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || busy) return;
    event.preventDefault();
    manageToggle.click();
  });
  button(actions,'儲存','profile-save',async()=>{await save();});
  button(actions,'另存為新配置','profile-save-as',async()=>{await save(true);});
  const selected = () => unwrap(library.getProfile(managedId));
  targetActions.push(button(management,'重新命名','profile-rename',async()=>{
    const p=selected();await ask('重新命名配置','名稱不影響配裝、比較基準及復原歷史。',['確認'],p.name,(_c,name)=>{unwrap(library.renameProfile(p.id,name));notify('配置已重新命名。');});
  }));
  targetActions.push(button(management,'複製','profile-duplicate',()=>{const p=unwrap(library.duplicateProfile(selected().id));notify(`已複製正式存檔為「${p.name}」，目前草稿保持不變。`);}));
  targetActions.push(button(management,'刪除','profile-delete',async()=>{
    const p=selected();await ask('刪除已保存配置',`確定刪除「${p.name}」？無法直接復原。目前畫布與比較基準會保留。`,['確認刪除'],undefined,()=>{
      unwrap(library.deleteProfile(p.id));
      if (draft.profileId===p.id) {
        const w=working();if (!draft.write(w.loadout,w.baseline,null)) {draft.profileId=null;throw Error('配置已刪除；草稿仍保留，但解除關聯尚未保存：'+draft.error);}
      }
      notify('已刪除正式配置；目前草稿與比較基準保持不變。');
    });
  }));
  targetActions.push(button(management,'匯出所選配置','profile-export',()=>{
    unwrap(library.checkCurrent());
    download(exportNamedProfile(selected()), 'damage-calculator-profile');
  }));
  button(management,'備份全部配置','profile-backup',async()=>{
    if(dirty() && !await ask('備份正式配置庫','目前未儲存的草稿不包含在備份中。',['繼續備份']))return;
    unwrap(library.checkCurrent());
    const json=exportProfileBackup(unwrap(library.getStore()));
    download(json, 'damage-calculator-profiles');
    notify('已備份全部正式配置；不包含工作草稿、全域戰鬥破防及隊伍設定。');
  });
  const file=element('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.id='profile-backup-file';panel.append(file);
  button(actions,'上傳配置備份','profile-restore',()=>file.click());
  file.addEventListener('change',run(async()=>{
    try {
      const input=file.files?.[0];if(!input)return;if(input.size>profileBackupLimit)throw Error('備份檔案上限為 5 MB。');
      const archive = parseArchiveJson(await input.text());
      const singleProfile = archive.format === 'damage-calculator-profile';
      const store = readProfileArchive(archive);
      for (const profile of store.profiles) {
        try { await options.validate(profile); }
        catch (error) { throw Error('「' + profile.name + '」' + (error instanceof Error ? error.message : '遊戲資料無效。') + ' 尚未匯入任何配置。'); }
      }
      const existing = unwrap(library.getStore()).profiles;
      const conflicts = store.profiles.filter(p => existing.some(e => e.id === p.id || e.name === p.name)).length;
      await ask('上傳配置備份',`共 ${store.profiles.length} 筆：${store.profiles.map(p=>p.name).join('、')}。${conflicts} 筆名稱或 ID 衝突。合併時會處理名稱與 ID 衝突。${singleProfile ? '' : '完整取代會刪除原正式配置庫。'}目前草稿將保留。`,singleProfile ? ['合併匯入'] : ['合併匯入','完整取代'],undefined,choice=>{
        if (choice === '完整取代') draft.replaceLibrary(() => unwrap(library.restoreProfiles(store,'replace')));
        else unwrap(library.restoreProfiles(store,'merge'));
        notify('配置庫已還原；目前畫布與比較基準保持不變。');
      });
    } finally {file.value='';}
  }));
  const initial=library.reload();
  if(initial.ok){loaded=true;syncList();
    if(draft.profileId&&!active()){const w=working();draft.write(w.loadout,w.baseline,null);draft.profileId=null;notify('原關聯配置已不存在；已保留草稿，顯示為未命名配置。');}
    else notify(readOnly?'驗算範例模式：配置管理僅供查看，不會保存。':draft.notice||'草稿自動保存；命名配置需手動儲存。');
    refresh();
  } else {
    updateControls('');
    empty.hidden = true;
    notify(initial.error.message);
  }
  window.addEventListener('storage',event=>{
    if(event.key===profilesKey || event.key===null) {
      const latest = new LoadoutProfiles().reload();
      const nextActive = latest.ok && latest.value.profiles.find(p => p.id === draft.profileId);
      if (!busy && latest.ok && JSON.stringify(nextActive) === JSON.stringify(active())) {
        const result = library.reload();
        if (result.ok) { loaded=true; syncList(); refresh(); notify('已更新其他分頁保存的配置清單。'); }
        else notify(result.error.message);
      } else notify('配置庫已在其他分頁更新。請先匯出本頁配裝，再重新整理。');
    }
    if(['dab-loadout-v1','dab-baseline-v1',draftAssociationKey].includes(event.key??'')||event.key===null)notify('其他分頁已更新共用草稿。請先匯出本頁配裝，再重新整理。');
  });
  async function importDestination(loadout: LoadoutState, baseline: LoadoutState | null | undefined, name: string | undefined, warning: string, isCurrent: () => boolean) {
    const choices = readOnly ? ['套用至畫布'] : ['套用至畫布', '新增為正式配置'];
    const choice = await ask('匯入配裝', '選擇匯入位置。新增配置會保留目前畫布。' + warning, choices);
    if (!isCurrent()) return null;
    if (choice !== '新增為正式配置') return choice;
    await options.validate({loadout, baseline});
    const result = await ask('新增為正式配置', '輸入配置名稱，留空會自動命名。', ['新增'], name ?? '', (_choice, entered) => {
      if (!isCurrent()) throw Error('已選取另一個檔案，請取消此對話框。');
      unwrap(library.createProfile(entered, loadout, baseline));
      syncList(); refresh();
    });
    return result ? choice : null;
  }
  return {refresh, importDestination};
}
