import { escapeHtml, loadGameData } from '../../frontend/data.ts';
import type { GameData } from '../../frontend/data.ts';
import { parseState, stateKey, type LoadoutState } from '../../frontend/state.ts';
import { readRatingLoadout, readArmorRatingLoadout } from './loadout.ts';
import { scoreConfiguration, type Selection } from './scoring.ts';
import { normalizeTransformationSelections, UNRELATED_TRANSFORMATION } from '../../calculation/transformation-selections.ts';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = byId('loadout-status');
const workspace = byId('score-workspace');
const editor = byId('transform-lines');
const output = byId('score-output');
const reload = byId<HTMLButtonElement>('reload-loadout');
const formatter = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
const pct = (gain: number | null) => gain === null ? '無法計算' : (gain * 100).toFixed(2) + '%';
const message = (err: unknown) => err instanceof Error ? err.message : '無法讀取目前配裝。';
type Context = ReturnType<typeof readRatingLoadout> | ReturnType<typeof readArmorRatingLoadout>;
let mode: 'weapon' | 'armor' = 'weapon';
let part = 'upper';
let state: LoadoutState | undefined;
const drafts = new Map<string, Selection[]>();
const draftKey = () => mode === 'weapon' ? mode : 'armor:' + part;
let data: GameData | undefined;
let context: Context | undefined;
let simulation: Selection[] = [];
let savedRaw: string | null | undefined;

function evaluate(lines: Selection[]) {
  if (!context) throw new Error('尚未取得配裝。');
  return scoreConfiguration(context, lines);
}
function showScore() {
  const normalized = normalizeTransformationSelections(simulation);
  const changed = normalized.some((line, i) => line.choice !== simulation[i].choice || line.roll !== simulation[i].roll);
  simulation = normalized;
  if (changed) {
    status.textContent += ' 重複或無關詞條的相依數值已清空。';
    syncSimulation();
  }
  try {
    const score = evaluate(simulation);
    output.innerHTML = `<div class="score-verdict"><span>變換分數</span><strong>${score.pr.toFixed(2)}</strong></div>
      <dl class="score-metrics"><dt>目前提升幅度</dt><dd>${pct(score.gain)}</dd></dl>
      <p class="score-grade">${escapeHtml(score.grade)}</p>`;
  } catch (error) { output.textContent = message(error); }
}
function rollLabel(rule: Context['rules'][number], value: number) {
  const digits = String(rule.step).split('.')[1]?.length ?? 0;
  const text = value.toFixed(digits);
  return text + (rule.valueMultiplier === 1 ? '' : '%');
}
function valueOptions(line: Selection) {
  const rule = context?.rules.find(item => item.choice === line.choice);
  if (!rule) return '<option value="">—</option>';
  const found = rule.rolls.find(value => Math.abs(value - (line.roll ?? NaN)) < 1e-8);
  return (found === undefined ? '<option value="">請選有效數值</option>' : '') +
    [...rule.rolls].reverse().map(value => `<option value="${value}"${value === found ? ' selected' : ''}>${rollLabel(rule, value)}</option>`).join('');
}
function syncSimulation() {
  if (!context) return;
  simulation.forEach((line, i) => {
    const select = editor.querySelector<HTMLSelectElement>(`select[data-choice="${i}"]`)!;
    const occupied = new Set(simulation.filter((_, j) => i !== j).map(item => item.choice));
    select.replaceChildren(new Option('未設定', ''), ...context!.rules
      .filter(rule => !occupied.has(rule.choice))
      .map(rule => new Option(rule.label, rule.choice)), new Option(UNRELATED_TRANSFORMATION, UNRELATED_TRANSFORMATION));
    select.value = line.choice;
    const roll = editor.querySelector<HTMLSelectElement>(`select[data-roll="${i}"]`)!;
    roll.innerHTML = valueOptions(line);
    roll.disabled = !context!.rules.some(rule => rule.choice === line.choice);
  });
}
function referenceGroup(title: string, lines: readonly Selection[], gain: number | null) {
  const rows = lines.map(line => {
    const rule = context?.rules.find(item => item.choice === line.choice);
    return `<div><dt>${escapeHtml(rule?.label ?? line.choice)}</dt><dd>${rule && line.roll !== null ? rollLabel(rule, line.roll) : '—'}</dd></div>`;
  }).join('');
  return `<section><h3>${title}</h3><dl>${rows}</dl><p>參考提升幅度：${pct(gain)}</p></section>`;
}
function showLoadout(next: Context) {
  context = next;
  simulation = (drafts.get(draftKey()) ?? next.actual).map(line => ({ ...line }));
  const { job, rules } = next;
  status.textContent = `${job.name} · ${'targetLabel' in next ? next.targetLabel + ' 內布隆' : '武器'} +${next.enhancement} · ${mode === 'weapon' ? '不含武器變換' : '不含目標防具變換'}攻擊力等級 ${formatter.format(next.attackLevel)} · 強烈 ${next.weighting.strongSharePct}%／超越 ${next.weighting.transcendenceSharePct}% · Boss 防禦 ${next.bossDefense}%`;
  if (next.warnings.length) status.textContent += ' ' + next.warnings.join(' ');
  const fields = editor.querySelectorAll('fieldset');
  fields.forEach((field, i) => { (field as HTMLFieldSetElement).hidden = i >= simulation.length; });
  simulation.forEach((line, index) => {
    const field = fields[index];
    const choice = field.querySelector<HTMLSelectElement>('[data-choice]')!;
    const value = field.querySelector<HTMLSelectElement>('[data-roll]')!;
    const selected = rules.find(rule => rule.choice === line.choice);
    choice.replaceChildren(new Option('未設定', ''), ...rules.map(rule => new Option(rule.label, rule.choice)));
    if (line.choice && !selected) choice.add(new Option(line.choice));
    choice.value = line.choice;
    value.innerHTML = valueOptions(line);
    value.disabled = !selected;
    const actual = next.actual[index];
    const actualRule = rules.find(rule => rule.choice === actual.choice);
    const original = actual.choice ? (actualRule?.label ?? actual.choice) + ' ' + (actualRule && actual.roll !== null ? rollLabel(actualRule, actual.roll) : '未填') : '未設定';
    field.querySelector('small')!.textContent = '目前配裝 · ' + original;
    field.disabled = false;
  });
  syncSimulation();
  byId('score-bounds').innerHTML = referenceGroup(mode === 'weapon' ? '四有效詞條下最低收益提升參考組合' : '三有效詞條下最低收益提升參考組合', next.lowerSelection, next.lower) + referenceGroup('最高增幅配置參考組合', next.upperSelection, next.upper);
  byId('roll-comparisons').innerHTML = next.comparisons.map(({ rule, gains }) => {
    const rows = rule.rolls.map((roll, i) => `<tr><td>${rollLabel(rule, roll)}</td><td>${pct(gains[i])}</td></tr>`).reverse();
    return `<div class="roll-card"><table><caption>${escapeHtml(rule.label)}</caption><thead><tr><th scope="col">數值</th><th scope="col">提升幅度</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }).join('');
  workspace.hidden = false;
  showScore();
}
editor.addEventListener('change', event => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement) || !context) return;
  if (select.dataset.choice !== undefined) {
    const index = Number(select.dataset.choice);
    const choice = select.value;
    const rule = context.rules.find(item => item.choice === choice);
    const previous = simulation[index].roll;
    simulation[index] = { choice, roll: rule?.rolls.find(roll => roll === previous) ?? null };
    const value = editor.querySelector<HTMLSelectElement>(`select[data-roll="${index}"]`)!;
    value.innerHTML = valueOptions(simulation[index]);
    value.disabled = !rule;
  } else if (select.dataset.roll !== undefined) {
    simulation[Number(select.dataset.roll)].roll = select.value === '' ? null : Number(select.value);
  }
  syncSimulation();
  drafts.set(draftKey(), simulation.map(line => ({ ...line })));
  showScore();
});

function refresh(force: boolean) {
  if (!data) return;
  try {
    const raw = localStorage.getItem(stateKey);
    if (!force && savedRaw === raw) return;
    savedRaw = raw;
    state = parseState(raw) ?? undefined;
    if (!state) throw new Error('尚未取得有效的已保存配裝。請先到傷害計算機設定職業、武器與屬性。');
    drafts.clear();
    activate();
  } catch (error) {
    context = undefined;
    simulation = [];
    workspace.hidden = true;
    status.textContent = error instanceof SyntaxError ? '已保存的配裝無法解析，請回首頁確認。' : message(error);
  }
}
function activate() {
  byId('armor-part-field').hidden = mode !== 'armor';
  try {
    if (!data || !state) throw new Error('尚未取得有效配裝。');
    byId('target-status').textContent = '';
    showLoadout(mode === 'weapon' ? readRatingLoadout(data, state) : readArmorRatingLoadout(data, state, part));
    editor.hidden = false;
    byId('roll-disclosure').hidden = false;
  } catch (error) {
    context = undefined;
    editor.hidden = true;
    output.textContent = '';
    byId('score-bounds').textContent = '';
    byId('roll-disclosure').hidden = true;
    byId('target-status').textContent = message(error);
    status.textContent = state ? `${state.Job} · ${mode === 'armor' ? '防具' : '武器'}屬性變換` : message(error);
    workspace.hidden = !state;
  }
}
const modes = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
modes.forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode as typeof mode;
  modes.forEach(item => { item.setAttribute('aria-selected', String(item === button)); item.tabIndex = item === button ? 0 : -1; });
  activate();
}));
document.querySelector('.mode-switch')!.addEventListener('keydown', event => {
  const key = (event as KeyboardEvent).key;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
  event.preventDefault();
  const current = modes.findIndex(button => button.getAttribute('aria-selected') === 'true');
  const next = key === 'Home' ? 0 : key === 'End' ? 1 : 1 - current;
  modes[next].click(); modes[next].focus();
});
byId<HTMLSelectElement>('armor-part').addEventListener('change', event => {
  part = (event.target as HTMLSelectElement).value;
  activate();
});
async function load() {
  reload.disabled = true;
  try {
    data ??= await loadGameData();
    refresh(true);
  } catch { workspace.hidden = true; status.textContent = '遊戲資料載入失敗，請重新讀取。'; }
  finally { reload.disabled = false; }
}
reload.addEventListener('click', () => void load());
window.addEventListener('storage', event => { if (event.key === stateKey || event.key === null) refresh(false); });
window.addEventListener('pageshow', () => refresh(false));
void load();
