import type {
  AttackParametersDocument,
  AttackCalculationInput,
  AttackCalculationResult,
  ClassAttackCoefficients,
  ResolvedAttackParameters,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate attack coefficients and enhancement multipliers loaded from JSON. */
export function parseAttackParameters(value: unknown): AttackParametersDocument {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError("Unsupported attack parameters document.");
  }
  if (typeof value.source !== "string" || !value.source.trim()) {
    throw new TypeError("Attack parameter source must be a non-empty string.");
  }
  if (!isRecord(value.classes) || Object.keys(value.classes).length === 0) {
    throw new TypeError("Attack parameters must include class coefficients.");
  }
  const classes: Record<string, ClassAttackCoefficients> = {};
  for (const [classId, raw] of Object.entries(value.classes)) {
    if (!classId.trim() || !isRecord(raw)) {
      throw new TypeError("Class attack coefficient entries must be keyed objects.");
    }
    const { physical, magical } = raw;
    if (
      typeof physical !== "number" || !Number.isFinite(physical) ||
      typeof magical !== "number" || !Number.isFinite(magical)
    ) {
      throw new TypeError(`Class ${classId} must have finite physical and magical coefficients.`);
    }
    classes[classId] = { physical, magical };
  }

  if (!isRecord(value.weaponEnhancementFactors)) {
    throw new TypeError("weaponEnhancementFactors must be an object.");
  }
  const weaponEnhancementFactors: Record<string, number> = {};
  for (const [level, factor] of Object.entries(value.weaponEnhancementFactors)) {
    if (!/^\d+$/.test(level) || typeof factor !== "number" || !Number.isFinite(factor)) {
      throw new TypeError("Weapon enhancement entries must map integer levels to finite factors.");
    }
    weaponEnhancementFactors[level] = factor;
  }

  return { schemaVersion: 1, source: value.source, classes, weaponEnhancementFactors };
}

/** Resolve C53/D53 class coefficients and B32 weapon enhancement factor from JSON. */
export function resolveAttackParameters(
  document: AttackParametersDocument,
  classId: string,
  weaponEnhancementLevel: number,
): ResolvedAttackParameters {
  const profile = document.classes[classId];
  if (!profile) {
    throw new Error(`No attack coefficient profile is configured for ${classId}.`);
  }
  if (!Number.isInteger(weaponEnhancementLevel)) {
    throw new TypeError("weaponEnhancementLevel must be an integer.");
  }
  const weaponEnhancementFactor = document.weaponEnhancementFactors[String(weaponEnhancementLevel)];
  if (weaponEnhancementFactor === undefined) {
    throw new Error(`No weapon enhancement factor is configured for Lv.${weaponEnhancementLevel}.`);
  }
  return {
    physicalClassCoefficient: profile.physical,
    magicalClassCoefficient: profile.magical,
    weaponEnhancementFactor,
  };
}

function requireFiniteInputs(input: AttackCalculationInput): void {
  for (const [key, value] of Object.entries(input)) {
    if (key === "attackType") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`Attack calculation input ${key} must be a finite number.`);
    }
  }
  if (input.attackType !== "physical" && input.attackType !== "magical") {
    throw new TypeError("attackType must be physical or magical.");
  }
}

function floorMath(value: number): number {
  return Math.floor(value);
}

export type WeaponBaseAttackInput = Pick<AttackCalculationInput,
  "attackLevel" | "physicalClassCoefficient" | "magicalClassCoefficient" | "weaponEnhancementFactor"
>;

/** C53/D53 weapon contributions, evaluated after all attack-level sources (U1). */
export function calculateWeaponBaseAttack(input: WeaponBaseAttackInput): {
  physicalAttack: number;
  magicalAttack: number;
} {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isFinite(value)) throw new TypeError(`Weapon base ${key} must be finite.`);
  }
  const calculate = (classCoefficient: number): number => {
    const classBase =
      0.85 * classCoefficient - 0.7775 * 400 +
      (0.15 * classCoefficient - 0.0225 * 400) * (99 + input.attackLevel + 50) + 0.5;
    const value = floorMath(classBase) * input.weaponEnhancementFactor;
    if (!Number.isFinite(value)) throw new RangeError("Weapon base attack must be finite.");
    return value;
  };
  return {
    physicalAttack: calculate(input.physicalClassCoefficient),
    magicalAttack: calculate(input.magicalClassCoefficient),
  };
}

/** Implements 計算機!C53:D53 and B156:B158 using JSON-resolved inputs. */
export function calculateAttack(
  input: AttackCalculationInput,
): AttackCalculationResult {
  requireFiniteInputs(input);

  const selectedAttack =
    input.attackType === "physical" ? input.physicalAttack : input.magicalAttack;
  const doubleAttackFactor = 1 + input.doubleAttackPct / 100;
  const skillTypeAttackFactor = 1 + input.skillTypeAttackPct / 100;

  // C53 uses lookup column 2 (physical); D53 uses column 3 (magical).
  // Weapon enhancement is applied after FLOOR.MATH in each formula.
  const weaponBase = calculateWeaponBaseAttack({
    attackLevel: input.attackLevel,
    physicalClassCoefficient: input.physicalClassCoefficient,
    magicalClassCoefficient: input.magicalClassCoefficient,
    weaponEnhancementFactor: input.weaponEnhancementFactor,
  });
  const c53 = weaponBase.physicalAttack;
  const d53 = weaponBase.magicalAttack;
  // The attack range follows the active attack type: physical uses C53 and
  // magical uses D53. Using D53 for physical classes understates the upper
  // bound (and overstates the lower bound) for classes with a stronger
  // physical coefficient.
  const selectedAttackCoefficient = input.attackType === "physical" ? c53 : d53;

  const attackPower = floorMath(
    selectedAttack * doubleAttackFactor * skillTypeAttackFactor,
  );
  const lowerDamage = floorMath(
    (selectedAttack * skillTypeAttackFactor - 0.55 * selectedAttackCoefficient) *
      doubleAttackFactor,
  );
  const upperDamage = floorMath(
    (selectedAttack * skillTypeAttackFactor + 0.55 * selectedAttackCoefficient) *
      doubleAttackFactor,
  );

  for (const [key, value] of Object.entries({
    selectedAttack,
    c53,
    d53,
    attackPower,
    lowerDamage,
    upperDamage,
  })) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Attack calculation produced non-finite ${key}.`);
    }
  }

  return {
    attackType: input.attackType,
    selectedAttack,
    attackPower,
    c53,
    d53,
    lowerDamage,
    upperDamage,
  };
}
