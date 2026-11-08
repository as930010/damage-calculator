import { GREEN_CONTROL_BUFF_COMPONENTS } from '../calculation/support-magazines.ts';
import type {
  CalculationParameters,
  ControlTimeCategory,
  ClassModeProfile,
  ClassRecord,
  EffectKey,
  EffectValues,
  EffectTypeDefinition,
  LoadoutOptionDefinition,
  ControlTimeParameters,
  SkillReferenceCatalog,
} from "../calculation/types.ts";

interface RawCalculationParameters {
  challenge: { defenseBreakCoefficient: number };
  criticalDamage: { defaultPercent: number };
  loadoutDefaults: {
    movementSpeedShoePercent: number;
    skillDamageGlovePercent: number;
  };
  single: { bossDamageReductionDefault: number };
  actionSpeed: { multiplicativeCap: number };
  controlTime: ControlTimeParameters;
  supportRank: { labels: { superArmor: Record<string, string> } };
}

export interface CoreCatalog {
  classes: ClassRecord[];
  classEffects: ClassModeProfile[];
  effectTypes: EffectTypeDefinition[];
  loadoutOptions: LoadoutOptionDefinition[];
  parameters: CalculationParameters & {
    bossDamageReduction: number;
    challengeBreakCoefficient: number;
    actionSpeedCap: number;
    controlTime: ControlTimeParameters;
    superArmorRankLabels: Record<string, string>;
  };
}

export interface CoreCatalogPayloads {
  classes: unknown;
  classEffects: unknown;
  effectTypes: unknown;
  loadoutOptions: unknown;
  calculationParameters: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requireArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a JSON array`);
  return value as T[];
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicate IDs`);
}

export function parseCoreCatalog(payloads: CoreCatalogPayloads): CoreCatalog {
  const classes = requireArray<ClassRecord>(payloads.classes, "classes");
  if (!isRecord(payloads.classEffects) || payloads.classEffects.schemaVersion !== 2) {
    throw new TypeError("classEffects requires schemaVersion 2");
  }
  const entries = requireArray<unknown>(payloads.classEffects.classes, "classEffects.classes");
  const effectTypes = requireArray<EffectTypeDefinition>(payloads.effectTypes, "effectTypes");
  const loadoutOptions = requireArray<LoadoutOptionDefinition>(payloads.loadoutOptions, "loadoutOptions");
  if (!isRecord(payloads.calculationParameters)) throw new TypeError("calculationParameters must be an object");
  const raw = payloads.calculationParameters as unknown as RawCalculationParameters;

  for (const item of classes) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()
      || typeof item.code !== "string" || !item.code.trim()) throw new TypeError("Invalid class identity");
  }
  assertUnique(classes.map((item) => item.id), "classes");
  assertUnique(classes.map((item) => item.code), "class codes");
  assertUnique(effectTypes.map((item) => item.key), "effectTypes");
  assertUnique(loadoutOptions.map((item) => item.id), "loadoutOptions");

  const classById = new Map(classes.map((item) => [item.id, item]));
  const effectKeys = new Set(effectTypes.map((item) => item.key));
  const parseEffects = (value: unknown, label: string): EffectValues => {
    if (!isRecord(value)) throw new TypeError(`${label} must be an effects object`);
    const effects: EffectValues = {};
    for (const [key, rawValue] of Object.entries(value)) {
      if (!effectKeys.has(key as EffectKey)) throw new TypeError(`Unknown effect key ${key}`);
      const number = requireFinite(rawValue, `${label}.${key}`);
      if ((key === "defenseBreak" || key === "shield" || key === "defenseIgnoreAdditive") && (number < 0 || number > 1)) {
        throw new TypeError(`${label}.${key} must be a ratio between 0 and 1`);
      }
      if (effectTypes.find(effect => effect.key === key)?.unit === "count" && (!Number.isInteger(number) || number < 0)) {
        throw new TypeError(`${label}.${key} must be a nonnegative count`);
      }
      effects[key as EffectKey] = number;
    }
    return effects;
  };
  const profiles = new Map<string, { code: string; effects: EffectValues; challengeEffects?: EffectValues }>();
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.classId !== "string" || !classById.has(entry.classId)) {
      throw new TypeError("Unknown class in classEffects");
    }
    if (entry.code !== classById.get(entry.classId)!.code) throw new TypeError(`Invalid code for ${entry.classId}`);
    if (profiles.has(entry.classId)) throw new TypeError(`Duplicate class ${entry.classId}`);
    if (Object.keys(entry).some(key => !["classId", "code", "effects", "challengeEffects"].includes(key))) {
      throw new TypeError(`Unknown class-effects field for ${entry.classId}`);
    }
    profiles.set(entry.classId, {
      code: entry.code as string,
      effects: parseEffects(entry.effects, entry.classId),
      ...(Object.hasOwn(entry, "challengeEffects") ? { challengeEffects: parseEffects(entry.challengeEffects, `${entry.classId}.challenge`) } : {}),
    });
  }
  if (profiles.size !== classes.length) throw new TypeError("classEffects must include every class");
  // A challenge override replaces the entire effect object; it never adds to the common base.
  const classEffects: ClassModeProfile[] = (["single", "challenge"] as const).flatMap(mode =>
    [...profiles].map(([classId, profile]) => ({ classId, code: profile.code, mode,
      effects: { ...(mode === "challenge" ? profile.challengeEffects ?? profile.effects : profile.effects) } })),
  );

  for (const option of loadoutOptions) {
    if (option.presentation !== undefined && option.presentation !== "background") {
      throw new Error(`Invalid presentation for loadout option ${option.id}`);
    }
    if (option.scope !== "per-team" || typeof option.defaultSelected !== "boolean") {
      throw new TypeError(`Invalid selection metadata for ${option.id}`);
    }
    if (option.userInput) {
      const input = option.userInput;
      if (input.kind === 'support-magazine') {
        if (!Object.hasOwn(GREEN_CONTROL_BUFF_COMPONENTS, input.target) || Object.keys(option.effects).length) throw new TypeError(`Invalid support magazine metadata for ${option.id}`);
      } else if (input.kind !== 'percentage' || !["movementSpeedShoePercent", "skillDamageGlovePercent"].includes(input.parameter) || typeof input.helpText !== 'string') {
        throw new TypeError(`Invalid user input metadata for ${option.id}`);
      }
    }
    for (const spec of Object.values(option.effects)) {
      if (spec?.kind === "fixed") requireFinite(spec.value, `${option.id}.value`);
      else if (spec?.kind === "relative-parameter-increase") requireFinite(spec.additiveIncrease, `${option.id}.additiveIncrease`);
      else if (spec?.kind === "scaled-parameter") requireFinite(spec.factor, `${option.id}.factor`);
      else throw new TypeError(`Invalid option effect for ${option.id}`);
    }
  }

  assertUnique(loadoutOptions.flatMap(option => option.userInput?.kind === 'support-magazine' ? [option.userInput.target] : []), 'support magazine targets');

  const parameters: CoreCatalog["parameters"] = {
    criticalDamagePercent: requireFinite(raw.criticalDamage.defaultPercent, "criticalDamage.defaultPercent") / 100,
    movementSpeedShoePercent: requireFinite(raw.loadoutDefaults.movementSpeedShoePercent, "movementSpeedShoePercent"),
    skillDamageGlovePercent: requireFinite(raw.loadoutDefaults.skillDamageGlovePercent, "skillDamageGlovePercent"),
    bossDamageReduction: requireFinite(raw.single.bossDamageReductionDefault, "single.bossDamageReductionDefault"),
    challengeBreakCoefficient: requireFinite(raw.challenge.defenseBreakCoefficient, "challenge.defenseBreakCoefficient"),
    actionSpeedCap: requireFinite(raw.actionSpeed.multiplicativeCap, "actionSpeed.multiplicativeCap"),
    superArmorRankLabels: raw.supportRank.labels.superArmor,
    controlTime: {
      ...raw.controlTime,
      capSeconds: requireFinite(raw.controlTime.capSeconds, "controlTime.capSeconds"),
      secondsPerResistancePoint: requireFinite(raw.controlTime.secondsPerResistancePoint, "controlTime.secondsPerResistancePoint"),
      categories: requireArray<ControlTimeCategory>(raw.controlTime.categories, "controlTime.categories").map((category) => ({
        ...category,
        coefficient: requireFinite(category.coefficient, `controlTime.${category.id}.coefficient`),
      })),
    },
  };

  return { classes, classEffects, effectTypes, loadoutOptions, parameters };
}

export function parseSkillReferenceCatalog(payload: unknown, classes: readonly ClassRecord[]): SkillReferenceCatalog {
  if (!isRecord(payload)) throw new TypeError("skillReference must be an object");
  const skillReference = payload as unknown as SkillReferenceCatalog;
  if (!Array.isArray(skillReference.roles)) throw new TypeError("skillReference.roles must be a JSON array");
  const skillRoles = skillReference.roles;
  assertUnique(skillRoles.map((item) => item.code), "skillReference.roles");
  const classCodes = new Set(classes.map((item) => item.code));
  for (const role of skillRoles) {
    if (!classCodes.has(role.code)) throw new TypeError(`Unknown skill-reference class ${role.code}`);
    if (!Array.isArray(role.skills)) throw new TypeError(`Invalid skill-reference entry ${role.code}`);
  }
  if (skillRoles.length !== classCodes.size) throw new TypeError("skillReference must include every class");
  return skillReference;
}

// Production substitutes only versioned URL strings; data remains external and skills stay lazy.
declare const __BUFF_ASSET_PATHS__: Readonly<Record<string, string>>;
async function fetchJson(baseUrl: URL, path: string, fetcher: typeof fetch): Promise<unknown> {
  const versioned = typeof __BUFF_ASSET_PATHS__ === "undefined" ? undefined : __BUFF_ASSET_PATHS__[path];
  const response = await fetcher(new URL(versioned ?? path, baseUrl), { cache: versioned ? "force-cache" : "no-cache" });
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

/** Load version-controlled JSON from the site's same-origin data directory. */
export async function loadCoreCatalog(baseUrl: URL, fetcher: typeof fetch = fetch): Promise<CoreCatalog> {
  const [classes, classEffects, effectTypes, loadoutOptions, calculationParameters] = await Promise.all([
    fetchJson(baseUrl, "classes.json", fetcher),
    fetchJson(baseUrl, "class-effects.json", fetcher),
    fetchJson(baseUrl, "effect-types.json", fetcher),
    fetchJson(baseUrl, "loadout-options.json", fetcher),
    fetchJson(baseUrl, "calculation-parameters.json", fetcher),
  ]);
  return parseCoreCatalog({ classes, classEffects, effectTypes, loadoutOptions, calculationParameters });
}

export async function loadSkillReferenceCatalog(baseUrl: URL, classes: readonly ClassRecord[], fetcher: typeof fetch = fetch): Promise<SkillReferenceCatalog> {
  return parseSkillReferenceCatalog(await fetchJson(baseUrl, "skill-reference.json", fetcher), classes);
}
