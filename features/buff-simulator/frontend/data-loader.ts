import type {
  CalculationParameters,
  ControlTimeCategory,
  ClassModeProfile,
  ClassRecord,
  EffectKey,
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

export interface GameCatalog {
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
  skillReference: SkillReferenceCatalog;
}

export interface CatalogPayloads {
  classes: unknown;
  classEffects: unknown;
  effectTypes: unknown;
  loadoutOptions: unknown;
  calculationParameters: unknown;
  skillReference: unknown;
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

export function parseGameCatalog(payloads: CatalogPayloads): GameCatalog {
  const classes = requireArray<ClassRecord>(payloads.classes, "classes");
  const classEffects = requireArray<ClassModeProfile>(payloads.classEffects, "classEffects");
  const effectTypes = requireArray<EffectTypeDefinition>(payloads.effectTypes, "effectTypes");
  const loadoutOptions = requireArray<LoadoutOptionDefinition>(payloads.loadoutOptions, "loadoutOptions");
  if (!isRecord(payloads.skillReference)) throw new TypeError("skillReference must be an object");
  const skillReference = payloads.skillReference as unknown as SkillReferenceCatalog;
  if (!Array.isArray(skillReference.roles)) throw new TypeError("skillReference.roles must be a JSON array");
  const skillRoles = skillReference.roles;
  if (!isRecord(payloads.calculationParameters)) throw new TypeError("calculationParameters must be an object");
  const raw = payloads.calculationParameters as unknown as RawCalculationParameters;

  assertUnique(classes.map((item) => item.id), "classes");
  assertUnique(effectTypes.map((item) => item.key), "effectTypes");
  assertUnique(loadoutOptions.map((item) => item.id), "loadoutOptions");
  assertUnique(skillRoles.map((item) => item.code), "skillReference.roles");
  const classCodes = new Set(classes.map((item) => item.code));
  for (const role of skillRoles) {
    if (!classCodes.has(role.code)) throw new TypeError(`Unknown skill-reference class ${role.code}`);
    if (!Array.isArray(role.skills)) {
      throw new TypeError(`Invalid skill-reference entry ${role.code}`);
    }
  }
  if (skillRoles.length !== classCodes.size) throw new TypeError("skillReference must include every class");

  const classIds = new Set(classes.map((item) => item.id));
  const effectKeys = new Set(effectTypes.map((item) => item.key));
  const seenProfiles = new Set<string>();
  for (const profile of classEffects) {
    if (!classIds.has(profile.classId)) throw new TypeError(`Unknown class ${profile.classId}`);
    if (profile.mode !== "single" && profile.mode !== "challenge") {
      throw new TypeError(`Invalid mode for ${profile.classId}`);
    }
    const profileKey = `${profile.classId}:${profile.mode}`;
    if (seenProfiles.has(profileKey)) throw new TypeError(`Duplicate profile ${profileKey}`);
    seenProfiles.add(profileKey);
    for (const [key, value] of Object.entries(profile.effects)) {
      if (!effectKeys.has(key as EffectKey)) throw new TypeError(`Unknown effect key ${key}`);
      requireFinite(value, `${profileKey}.${key}`);
    }
    requireFinite(profile.estimatedDamageScore, `${profileKey}.estimatedDamageScore`);
  }

  for (const option of loadoutOptions) {
    if (option.presentation !== undefined && option.presentation !== "background") {
      throw new Error(`Invalid presentation for loadout option ${option.id}`);
    }
    if (option.scope !== "per-team" || typeof option.defaultSelected !== "boolean") {
      throw new TypeError(`Invalid selection metadata for ${option.id}`);
    }
    if (option.userInput && (
      option.userInput.kind !== "percentage" ||
      !["movementSpeedShoePercent", "skillDamageGlovePercent"].includes(option.userInput.parameter) ||
      typeof option.userInput.helpText !== "string"
    )) {
      throw new TypeError(`Invalid user input metadata for ${option.id}`);
    }
    for (const spec of Object.values(option.effects)) {
      if (spec?.kind === "fixed") requireFinite(spec.value, `${option.id}.value`);
      else if (spec?.kind === "relative-parameter-increase") requireFinite(spec.additiveIncrease, `${option.id}.additiveIncrease`);
      else if (spec?.kind === "scaled-parameter") requireFinite(spec.factor, `${option.id}.factor`);
      else throw new TypeError(`Invalid option effect for ${option.id}`);
    }
  }

  const parameters: GameCatalog["parameters"] = {
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

  return { classes, classEffects, effectTypes, loadoutOptions, parameters, skillReference };
}

async function fetchJson(baseUrl: URL, path: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(new URL(path, baseUrl), { cache: "no-cache" });
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

/** Load version-controlled JSON from the site's same-origin data directory. */
export async function loadGameCatalog(baseUrl: URL, fetcher: typeof fetch = fetch): Promise<GameCatalog> {
  const [classes, classEffects, effectTypes, loadoutOptions, calculationParameters, skillReference] = await Promise.all([
    fetchJson(baseUrl, "classes.json", fetcher),
    fetchJson(baseUrl, "class-effects.json", fetcher),
    fetchJson(baseUrl, "effect-types.json", fetcher),
    fetchJson(baseUrl, "loadout-options.json", fetcher),
    fetchJson(baseUrl, "calculation-parameters.json", fetcher),
    fetchJson(baseUrl, "skill-reference.json", fetcher),
  ]);
  return parseGameCatalog({ classes, classEffects, effectTypes, loadoutOptions, calculationParameters, skillReference });
}
