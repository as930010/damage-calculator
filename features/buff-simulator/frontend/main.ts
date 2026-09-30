import { calculateChallenge, calculateTeam } from "../calculation/engine.ts";
import { calculateControlTimes } from "../calculation/control-time.ts";
import type { EffectKey, SelectedMember, SelectedOption, TeamMode } from "../calculation/types.ts";
import { resolveLoadoutOption } from "../calculation/options.ts";
import { supportRankLabel } from "./formatters.ts";
import { loadGameCatalog, type GameCatalog } from "./data-loader.ts";

function getAppRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("App root is missing");
  return root;
}
const app = getAppRoot();

let catalog: GameCatalog;
let mode: TeamMode = "single";
let membersByTeam: Record<string, string[]> = { single: [], first: [], second: [] };
let optionsByTeam: Record<string, Record<string, boolean | number>> = { single: {}, first: {}, second: {} };
let bossReductions: Partial<Record<TeamMode, number>> = {};

type TeamKey = "single" | "first" | "second";
interface SavedSimulatorState {
  version: 1;
  mode: TeamMode;
  membersByTeam: Partial<Record<TeamKey, string[]>>;
  optionsByTeam: Partial<Record<TeamKey, Record<string, boolean | number>>>;
  bossReductions: Partial<Record<TeamMode, number>>;
}

const STORAGE_KEY = "buff-team-simulator.state.v1";

function restoreSavedState(): void {
  try {
    const savedText = window.localStorage.getItem(STORAGE_KEY);
    if (!savedText) return;
    const saved = JSON.parse(savedText) as Partial<SavedSimulatorState>;
    if (!saved || saved.version !== 1) return;

    if (saved.mode === "single" || saved.mode === "challenge") mode = saved.mode;

    for (const team of ["single", "first", "second"] as const) {
      const memberCount = team === "single" ? 6 : 4;
      const savedMembers = saved.membersByTeam?.[team];
      if (Array.isArray(savedMembers)) {
        membersByTeam[team] = Array.from({ length: memberCount }, (_, index) =>
          typeof savedMembers[index] === "string" ? savedMembers[index].slice(0, 120) : membersByTeam[team]?.[index] ?? "");
      }

      const savedOptions = saved.optionsByTeam?.[team];
      if (!savedOptions || typeof savedOptions !== "object") continue;
      for (const option of catalog.loadoutOptions) {
        const value = savedOptions[option.id];
        if (option.userInput?.kind === "percentage") {
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) optionsByTeam[team][option.id] = value;
        } else if (option.presentation !== "background" && typeof value === "boolean") {
          optionsByTeam[team][option.id] = value;
        }
      }
    }

    for (const savedMode of ["single", "challenge"] as const) {
      const value = saved.bossReductions?.[savedMode];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
        bossReductions[savedMode] = value;
      }
    }
  } catch {
    // Storage may be disabled or contain invalid JSON; keep the default simulator state.
  }
}

function persistSavedState(): void {
  const saved: SavedSimulatorState = { version: 1, mode, membersByTeam, optionsByTeam, bossReductions };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // The simulator remains usable when browser storage is unavailable or full.
  }
}

function uniqueSupportCodes(): string[] {
  return catalog.classes.filter((record) => record.uniquenessGroup === "green-control").map((record) => record.code);
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[char] ?? char));

const asPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;
const asMultiplier = (value: number): string => `${value.toFixed(4)}×`;
function optionsFor(team: string): SelectedOption[] {
  return catalog.loadoutOptions.map((definition) => {
    const parameterName = definition.userInput?.kind === "percentage" ? definition.userInput.parameter : undefined;
    if (parameterName) {
      const input = document.querySelector<HTMLInputElement>(`[data-option-value="${definition.id}"][data-team="${team}"]`);
      const savedValue = optionsByTeam[team]?.[definition.id];
      const valuePercent = Number(input?.value ?? savedValue ?? catalog.parameters[parameterName] * 100);
      const parameters = { ...catalog.parameters, [parameterName]: (Number.isFinite(valuePercent) ? valuePercent : 0) / 100 };
      return resolveLoadoutOption(definition, parameters, true);
    }
    if (definition.presentation === "background") return resolveLoadoutOption(definition, catalog.parameters, true);
    const selector = document.querySelector<HTMLInputElement>(`[data-option="${definition.id}"][data-team="${team}"]`);
    const savedSelection = optionsByTeam[team]?.[definition.id];
    return resolveLoadoutOption(definition, catalog.parameters,
      selector?.checked ?? (typeof savedSelection === "boolean" ? savedSelection : definition.defaultSelected));
  });
}

function membersFor(team: string): SelectedMember[] {
  return [...document.querySelectorAll<HTMLInputElement>(`[data-member][data-team="${team}"]`)]
    .map((input) => catalog.classes.find((record) => record.enabled &&
      (record.code.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase() ||
       record.name.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase())))
    .filter((record) => record !== undefined)
    .map((record) => {
      const profile = catalog.classEffects.find((item) => item.classId === record.id && item.mode === mode);
      return {
        classId: record.id,
        classCode: record.code,
        effects: profile?.effects ?? {},
        uniquenessGroup: record.uniquenessGroup,
      };
    });
}

function invalidMemberEntries(): string[] {
  const teams = mode === "single" ? ["single"] : ["first", "second"];
  return teams.flatMap((team) => [...app.querySelectorAll<HTMLInputElement>(`[data-member][data-team="${team}"]`)]
    .filter((input) => {
      const value = input.value.trim().toLocaleLowerCase();
      return value.length > 0 && !catalog.classes.some((record) => record.enabled &&
        (record.code.toLocaleLowerCase() === value || record.name.toLocaleLowerCase() === value));
    })
    .map((input) => `${input.getAttribute("aria-label")}: ${input.value.trim()}`));
}

function invalidMemberNote(): string {
  const invalid = invalidMemberEntries();
  return invalid.length
    ? `<p class="validation-note" role="status">尚未辨識，暫不計入：${invalid.map(escapeHtml).join("、")}</p>`
    : "";
}

function emptyRosterNote(): string {
  const teams = mode === "single" ? ["single"] : ["first", "second"];
  return teams.every((team) => membersFor(team).length === 0)
    ? '<p class="roster-note" role="status">尚未選擇職業；以下結果仍包含目前啟用的配置效果。</p>'
    : "";
}
function bossControl(): string {
  const defaultValue = mode === "single"
    ? catalog.parameters.bossDamageReduction
    : catalog.parameters.challengeBreakCoefficient;
  const value = bossReductions[mode] ?? defaultValue;
  return '<label class="boss-control"><span>Boss 減傷率</span><span class="percent-input"><input id="boss-reduction" type="number" min="0" max="99.99" step="0.01" value="' + (value * 100).toFixed(2) + '" inputmode="decimal" aria-label="Boss 減傷率"><span>%</span></span></label>';
}
function optionPanel(team: string): string {
  const valueOptions = catalog.loadoutOptions.filter((option) => option.userInput?.kind === "percentage");
  const toggleOptions = catalog.loadoutOptions.filter((option) => !option.userInput && option.presentation !== "background");
  const backgroundOptions = catalog.loadoutOptions.filter((option) => option.presentation === "background");
  const valueEditors = valueOptions.map((option) => {
    const parameterName = option.userInput!.parameter;
    const value = optionsByTeam[team]?.[option.id] ?? catalog.parameters[parameterName] * 100;
    return `<label class="option-editor"><span class="option-editor-heading"><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.userInput!.helpText)}</small></span><span class="option-editor-input"><input type="number" min="0" step="0.1" inputmode="decimal" data-option-value="${escapeHtml(option.id)}" data-team="${team}" value="${Number(value)}" aria-label="${escapeHtml(option.label)}百分比"><span>%</span></span></label>`;
  }).join("");
  const toggles = toggleOptions.map((option) => {
    const checked = optionsByTeam[team]?.[option.id] ?? option.defaultSelected;
    return `<label class="option-chip"><input type="checkbox" data-option="${escapeHtml(option.id)}" data-team="${team}" ${checked ? "checked" : ""}><span>${escapeHtml(option.label)}</span></label>`;
  }).join("");
  const backgroundNote = backgroundOptions.length
    ? `<p class="background-option-note"><strong>已預設納入：</strong>${backgroundOptions.map((option) => escapeHtml(option.label)).join("、")}。這些常見來源會直接計入隊伍結果，不需另外勾選。</p>`
    : "";
  return `<div class="loadout-controls">${valueEditors ? `<div class="option-editors">${valueEditors}</div>` : ""}${backgroundNote}${toggles ? `<div class="option-list">${toggles}</div>` : ""}</div>`;
}

function skillReferencePanel(): string {
  return `<details class="panel skill-reference">
    <summary><strong>技能效果參照</strong></summary>
    <div class="skill-search-controls">
      <label><span class="sr-only">搜尋已選職業的技能</span><input data-skill-query type="search" placeholder="搜尋技能或效果"></label>
    </div>
    <div data-skill-results class="skill-results" aria-live="polite"></div>
  </details>`;
}

function updateSkillReference(): void {
  const results = app.querySelector<HTMLElement>("[data-skill-results]");
  if (!results) return;
  const query = app.querySelector<HTMLInputElement>("[data-skill-query]")?.value.trim().toLocaleLowerCase() ?? "";
  const teams = mode === "single" ? ["single"] : ["first", "second"];
  const selectedCodes = new Set(teams.flatMap((team) => membersFor(team).map((member) => member.classCode)));
  const hasSelection = selectedCodes.size > 0;
  const matches = catalog.skillReference.roles.map((role) => {
    const className = catalog.classes.find((record) => record.code === role.code)?.name ?? role.code;
    const skills = role.skills.filter((skill) => (!hasSelection || selectedCodes.has(role.code)) &&
      (!query || `${role.code} ${className} ${skill.name} ${skill.category} ${skill.description}`.toLocaleLowerCase().includes(query)));
    const roleLabel = className === role.code ? role.code : `${role.code} · ${className}`;
    return { role, roleLabel, skills };
  }).filter(({ skills }) => skills.length > 0);
  results.innerHTML = matches.length
    ? matches.map(({ roleLabel, skills }) => `<article class="skill-result">
      <header class="skill-role-heading"><strong>${escapeHtml(roleLabel)}</strong><span>${skills.length} 項技能</span></header>
      <div class="skill-role-skills">${skills.map((skill) => {
        const icon = skill.icon ? new URL(`data/${skill.icon}`, document.baseURI).href : "";
        return `<section class="skill-entry">${icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy">` : `<span class="skill-icon-placeholder" aria-hidden="true"></span>`}<div class="skill-result-copy"><header><strong>${escapeHtml(skill.name)}</strong><span>${escapeHtml(skill.category || "未標示類型")}</span></header><p>${skill.description.split(/\r?\n/).map(escapeHtml).join("<br>")}</p></div></section>`;
      }).join("")}</div>
    </article>`).join("")
    : `<p class="skill-empty">沒有符合的技能。</p>`;
}

function teamPanel(team: string, title: string, memberCount: number): string {
  const routeLabel = team === "single" ? "" : `<span class="eyebrow">ROUTE ${team === "first" ? "01" : "02"}</span>`;
  const bossControlMarkup = team === "single" ? bossControl() : "";
  return `<section class="panel team-panel">
    <div class="panel-heading"><div>${routeLabel}<h2>${title}</h2></div>${bossControlMarkup}</div>
    <div class="member-grid">${Array.from({ length: memberCount }, (_, index) => `<label class="member-slot"><span class="slot-index">${String(index + 1).padStart(2, "0")}</span><input data-member data-team="${team}" list="class-list" autocomplete="off" value="${escapeHtml(membersByTeam[team]?.[index] ?? "")}" placeholder="輸入代碼" aria-label="${title}隊員 ${index + 1}"></label>`).join("")}</div>
    <details class="option-disclosure"><summary>配置效果</summary>${optionPanel(team)}</details>
  </section>`;
}

function shell(): void {
  app.innerHTML = `<section class="hero">
    <div class="hero-console">
      <div class="mode-switch" role="tablist" aria-label="隊伍模式">
        <button data-mode="single" role="tab" aria-selected="${mode === "single"}">單隊 <small>6 人</small></button>
        <button data-mode="challenge" role="tab" aria-selected="${mode === "challenge"}">挑戰雙隊 <small>4 + 4</small></button>
      </div>
    </div>
  </section>
  <div class="section-label configuration-heading"><strong>隊伍配置</strong>${mode === "challenge" ? bossControl() : ""}</div>
  ${mode === "single" ? `<div class="workspace single-workspace">${teamPanel("single", "單隊配置", 6)}</div>` : `<div class="workspace challenge-workspace">${teamPanel("first", "第一隊", 4)}${teamPanel("second", "第二隊", 4)}</div>`}
  <datalist id="class-list">${catalog.classes.filter((record) => record.enabled).map((record) => `<option value="${escapeHtml(record.code)}">${escapeHtml(record.name)}</option>`).join("")}</datalist>
  <section id="results" aria-live="polite"></section>
  ${skillReferencePanel()}`;
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    saveCurrentInputs();
    mode = button.dataset.mode as TeamMode;
    persistSavedState();
    shell();
    updateResults();
  }));
  const syncInputs = () => {
    saveCurrentInputs();
    persistSavedState();
    updateResults();
    updateSkillReference();
  };
  app.oninput = syncInputs;
  app.onchange = syncInputs;
  updateResults();
  updateSkillReference();
}

function saveCurrentInputs(): void {
  const teams = mode === "single" ? ["single"] : ["first", "second"];
  for (const team of teams) {
    membersByTeam[team] = [...app.querySelectorAll<HTMLInputElement>(`[data-member][data-team="${team}"]`)].map((input) => input.value);
    optionsByTeam[team] = {
      ...Object.fromEntries([...app.querySelectorAll<HTMLInputElement>(`[data-option][data-team="${team}"]`)].map((input) => [input.dataset.option ?? "", input.checked])),
      ...Object.fromEntries([...app.querySelectorAll<HTMLInputElement>(`[data-option-value][data-team="${team}"]`)].map((input) => [input.dataset.optionValue ?? "", Number(input.value)])),
    };
  }
  const bossInput = app.querySelector<HTMLInputElement>("#boss-reduction");
  const value = Number(bossInput?.value) / 100;
  if (bossInput && Number.isFinite(value) && value >= 0 && value < 1) bossReductions[mode] = value;
}

function metric(label: string, value: string, emphasis = false): string {
  return `<div class="metric ${emphasis ? "metric-emphasis" : ""}"><span>${label}</span><strong>${value}</strong></div>`;
}

function formatEffectValue(key: EffectKey, value: number, definitions: Map<EffectKey, GameCatalog["effectTypes"][number]>): string {
  const unit = definitions.get(key)?.unit;
  if (unit === "extra-seconds-per-second") return `${value.toFixed(2)} 秒／秒`;
  if (unit === "seconds") return `${value.toFixed(2)} 秒`;
  if (unit === "resistance-points") return `${value.toFixed(2)} 點`;
  if (unit === "count") return `${value} 次`;
  return asPercent(value);
}

function formatResultValue(key: EffectKey, value: number | string, definitions: Map<EffectKey, GameCatalog["effectTypes"][number]>): string {
  if (typeof value === "string") return supportRankLabel(value, key, catalog.parameters.superArmorRankLabels);
  if (key === "buff" || key === "debuff") return asMultiplier(value);
  return formatEffectValue(key, value, definitions);
}

function detailList(result: ReturnType<typeof calculateTeam>): string {
  const definitions = new Map(catalog.effectTypes.map((definition) => [definition.key, definition]));
  return `<details class="calculation-details"><summary>展開計算明細</summary><div class="detail-grid">${result.breakdown.map((entry) => {
    const inputs = entry.values.filter((value) => value !== 0);
    let expression = "無來源";
    if (inputs.length && entry.aggregation === "sum") {
      expression = inputs.map((value) => formatEffectValue(entry.key, value, definitions)).join(" + ");
    } else if (inputs.length && entry.aggregation === "remaining-product") {
      expression = `1 − (${inputs.map((value) => asPercent(1 - value)).join(" × ")})`;
    } else if (inputs.length && entry.aggregation === "rank") {
      expression = inputs.map((value) => formatEffectValue(entry.key, value, definitions)).join(" + ");
    } else if (inputs.length) {
      const factors = inputs.map((value) => `(1 + ${formatEffectValue(entry.key, value, definitions)})`).join(" × ");
      expression = entry.aggregation === "capped-multiply"
        ? `MIN(${asPercent(catalog.parameters.actionSpeedCap)}, ${factors} − 1)`
        : factors;
    }
    return `<div class="detail-row"><span>${escapeHtml(definitions.get(entry.key)?.label ?? entry.key)}</span><code>${escapeHtml(expression)}</code><b>${escapeHtml(formatResultValue(entry.key, entry.result, definitions))}</b></div>`;
  }).join("")}</div></details>`;
}

function damagePanel(title: string, team: string, result: ReturnType<typeof calculateTeam>): string {
  const controlTimes = calculateControlTimes(result.resistanceReduction, catalog.parameters.controlTime);
  const netIncrease = result.totalDamageMultiplier - 1;
  return `<article class="result-card">
    <div class="result-heading"><div class="result-title"><span class="eyebrow">${team}</span><h3>${title}</h3></div><div class="total-multiplier"><span>基礎輸出</span><strong>${asPercent(result.totalDamageMultiplier)}</strong><small>傷害是原本的 ${result.totalDamageMultiplier.toFixed(2)} 倍</small></div></div>
    <section class="metric-section damage-section"><div class="metric-section-heading"><span>01</span><div><strong>傷害增幅</strong></div></div><div class="metric-grid primary-grid">
      ${metric("Buff 增幅", asPercent(result.buffIncrease))}
      ${metric("Debuff 增幅", asPercent(result.debuffIncrease))}
      ${metric("破防", asPercent(result.defenseBreak))}
      ${metric("破防增幅", asPercent(result.defenseBreakDamageIncrease))}
    </div></section>
    <section class="metric-section support-section"><div class="metric-section-heading"><span>02</span><div><strong>隊伍支援</strong></div></div><div class="support-grid">
      ${metric("護盾", asPercent(result.shield))}
      ${metric("降攻", asPercent(result.attackReduction))}
      ${metric("冷卻加速", `${(1 + result.cooldownAcceleration).toFixed(2)} 倍`)}
      ${metric("減少冷卻", `${result.cooldownReductionSeconds.toFixed(2)} 秒`)}
      ${metric("降抗", result.resistanceReduction.toFixed(2))}
      ${metric("每秒回魔", asPercent(result.mpRecoveryPerSecond))}
      ${metric("乘算動速", asPercent(result.actionSpeedMultiplicative))}
      ${metric("遞減動速", asPercent(result.actionSpeedDiminishing))}
      ${metric("扛吼／擋傷", supportRankLabel(result.roarBlock))}
      ${metric("消火／解Debuff", supportRankLabel(result.debuffCleanse))}
      ${metric("霸體", supportRankLabel(result.superArmor, "superArmor", catalog.parameters.superArmorRankLabels))}
    </div></section><details class="control-times"><summary><span>控場時間預估</span><small>查看各類控場秒數</small></summary>
      <div class="control-time-grid">${controlTimes.map((entry) => `<div><span>${escapeHtml(entry.label)}</span><strong>${entry.seconds.toFixed(2)} 秒</strong></div>`).join("")}</div>
      <p>各類控場時間 = MIN(${catalog.parameters.controlTime.capSeconds} 秒, ${result.resistanceReduction.toFixed(2)} 點 × ${catalog.parameters.controlTime.secondsPerResistancePoint} × 類別係數)。</p>
    </details>${detailList(result)}
  </article>`;
}
function updateResults(): void {
  const results = app.querySelector<HTMLElement>("#results");
  if (!results || !catalog) return;
  if (mode === "single") {
    const bossInput = app.querySelector<HTMLInputElement>("#boss-reduction");
    const bossDamageReduction = Number(bossInput?.value ?? catalog.parameters.bossDamageReduction * 100) / 100;
    if (!(bossDamageReduction >= 0 && bossDamageReduction < 1)) {
      results.innerHTML = `<p class="validation-note">Boss 減傷率請輸入 0%（含）至 100%（不含）。</p>`;
      return;
    }
    const result = calculateTeam({
      mode: "single",
      members: membersFor("single"),
      options: optionsFor("single"),
      defense: { bossDamageReduction },
      uniqueClassCodes: uniqueSupportCodes(),
      actionSpeedCap: catalog.parameters.actionSpeedCap,
    });
    results.innerHTML = `${invalidMemberNote()}${emptyRosterNote()}<div class="results-heading"><div class="section-label"><strong>隊伍效益</strong></div></div>${damagePanel("單隊結果", "單隊", result)}`;
    return;
  }

  const bossInput = app.querySelector<HTMLInputElement>("#boss-reduction");
  const bossDamageReduction = Number(bossInput?.value ?? catalog.parameters.challengeBreakCoefficient * 100) / 100;
  if (!(bossDamageReduction >= 0 && bossDamageReduction < 1)) {
    results.innerHTML = '<p class="validation-note">Boss 減傷率請輸入 0%（含）至 100%（不含）。</p>';
    return;
  }
  const challenge = calculateChallenge({
    firstTeam: { members: membersFor("first"), options: optionsFor("first") },
    secondTeam: { members: membersFor("second"), options: optionsFor("second") },
    defense: { challengeBreakCoefficient: bossDamageReduction },
    uniqueClassCodes: uniqueSupportCodes(),
    actionSpeedCap: catalog.parameters.actionSpeedCap,
  });
  results.innerHTML = `${invalidMemberNote()}${emptyRosterNote()}<div class="results-heading"><div class="section-label"><strong>分路與八人同場</strong></div><span class="result-context">同場重複效果只計一次</span></div><div class="result-stack">${damagePanel("第一隊・分路", "ROUTE 01", challenge.firstTeam)}${damagePanel("第二隊・分路", "ROUTE 02", challenge.secondTeam)}${damagePanel("八人同場", "SHARED ARENA", challenge.sharedArena)}</div>`;
}

async function start(): Promise<void> {
  catalog = await loadGameCatalog(new URL("data/", document.baseURI));
  for (const team of ["single", "first", "second"]) {
    optionsByTeam[team] = Object.fromEntries(catalog.loadoutOptions.map((option) => {
      if (option.userInput?.kind === "percentage") return [option.id, catalog.parameters[option.userInput.parameter] * 100];
      return [option.id, option.defaultSelected];
    }));
    membersByTeam[team] = Array(team === "single" ? 6 : 4).fill("");
  }
  restoreSavedState();
  shell();
}

start().catch((error: unknown) => {
  console.error("Unable to start Buff simulator", error);
  app.innerHTML = `<section class="error-card"><h1>無法載入試算資料</h1><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section>`;
});

