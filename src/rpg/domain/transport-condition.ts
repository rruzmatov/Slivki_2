import { assertSafeInteger, safeIntegerFromBigInt } from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";

export type VehicleConditionCompatibility = "new" | "good" | "worn" | "broken";

export interface StructuralConditionSnapshot {
  readonly maximumHealth: number;
  readonly currentHealth: number;
  readonly accumulatedWear: number;
}

export interface StructuralDamageInput {
  readonly damageUnits: number;
  readonly wearUnits: number;
}

export interface StructuralWearProfile {
  readonly damageUnitsPerKilometer: number;
  readonly wearUnitsPerKilometer: number;
  readonly minimumWearUnitsPerUsage: number;
}

export interface StructuralCompatibilityProjection {
  readonly condition: VehicleConditionCompatibility;
  readonly wearLevel: number;
  readonly healthPercent: number;
}

export interface StructuralDamageResult {
  readonly before: StructuralConditionSnapshot;
  readonly after: StructuralConditionSnapshot;
  readonly appliedDamageUnits: number;
  readonly addedWearUnits: number;
  readonly broken: boolean;
  readonly compatibility: StructuralCompatibilityProjection;
}

export class StructuralCondition {
  private constructor(private readonly value: StructuralConditionSnapshot) {
    Object.freeze(this.value);
    Object.freeze(this);
  }

  static pristine(maximumHealth: number): StructuralCondition {
    assertSafeInteger(maximumHealth, "maximumHealth", "TRANSPORT_STRUCTURAL_HEALTH_INVALID", 1);
    return new StructuralCondition({ maximumHealth, currentHealth: maximumHealth, accumulatedWear: 0 });
  }

  static restore(snapshot: StructuralConditionSnapshot): StructuralCondition {
    assertSafeInteger(snapshot.maximumHealth, "maximumHealth", "TRANSPORT_STRUCTURAL_HEALTH_INVALID", 1);
    assertSafeInteger(
      snapshot.currentHealth,
      "currentHealth",
      "TRANSPORT_STRUCTURAL_HEALTH_INVALID",
      0,
      snapshot.maximumHealth
    );
    assertSafeInteger(snapshot.accumulatedWear, "accumulatedWear", "TRANSPORT_STRUCTURAL_HEALTH_INVALID");
    return new StructuralCondition({ ...snapshot });
  }

  get maximumHealth(): number {
    return this.value.maximumHealth;
  }

  get currentHealth(): number {
    return this.value.currentHealth;
  }

  get accumulatedWear(): number {
    return this.value.accumulatedWear;
  }

  get missingHealth(): number {
    return this.maximumHealth - this.currentHealth;
  }

  get broken(): boolean {
    return this.currentHealth === 0;
  }

  restoreHealth(units: number): StructuralCondition {
    assertSafeInteger(units, "restoreUnits", "TRANSPORT_REPAIR_RESULT_INVALID", 1);
    if (units > this.missingHealth) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_RESULT_INVALID", {
        restoreUnits: units,
        missingHealth: this.missingHealth
      });
    }
    return StructuralCondition.restore({
      maximumHealth: this.maximumHealth,
      currentHealth: this.currentHealth + units,
      accumulatedWear: this.accumulatedWear
    });
  }

  snapshot(): StructuralConditionSnapshot {
    return Object.freeze({ ...this.value });
  }
}

export class StructuralDamagePolicy {
  constructor(private readonly wearToDamageFactorBps = 10_000) {
    assertSafeInteger(
      wearToDamageFactorBps,
      "wearToDamageFactorBps",
      "TRANSPORT_DAMAGE_INVALID",
      0,
      1_000_000
    );
  }

  apply(condition: StructuralCondition, input: StructuralDamageInput): StructuralDamageResult {
    assertSafeInteger(input.damageUnits, "damageUnits", "TRANSPORT_DAMAGE_INVALID");
    assertSafeInteger(input.wearUnits, "wearUnits", "TRANSPORT_DAMAGE_INVALID");
    if (input.damageUnits === 0 && input.wearUnits === 0) return unchangedDamageResult(condition);

    const wearDamage = scaledInteger(input.wearUnits, this.wearToDamageFactorBps);
    const requestedDamage = safeIntegerFromBigInt(
      BigInt(input.damageUnits) + BigInt(wearDamage),
      "TRANSPORT_DAMAGE_INVALID",
      "requestedDamage"
    );
    const appliedDamageUnits = Math.min(condition.currentHealth, requestedDamage);
    const accumulatedWear = safeIntegerFromBigInt(
      BigInt(condition.accumulatedWear) + BigInt(input.wearUnits),
      "TRANSPORT_DAMAGE_INVALID",
      "accumulatedWear"
    );
    const after = StructuralCondition.restore({
      maximumHealth: condition.maximumHealth,
      currentHealth: condition.currentHealth - appliedDamageUnits,
      accumulatedWear
    });
    return Object.freeze({
      before: condition.snapshot(),
      after: after.snapshot(),
      appliedDamageUnits,
      addedWearUnits: input.wearUnits,
      broken: after.broken,
      compatibility: compatibilityProjection(after)
    });
  }

  applyUsage(
    condition: StructuralCondition,
    distanceMeters: number,
    profile: StructuralWearProfile
  ): StructuralDamageResult {
    assertSafeInteger(distanceMeters, "distanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID");
    validateWearProfile(profile);
    const damageUnits = perKilometerUnits(distanceMeters, profile.damageUnitsPerKilometer);
    const distanceWear = perKilometerUnits(distanceMeters, profile.wearUnitsPerKilometer);
    const wearUnits = distanceMeters === 0 ? 0 : Math.max(profile.minimumWearUnitsPerUsage, distanceWear);
    return this.apply(condition, { damageUnits, wearUnits });
  }
}

export function compatibilityProjection(condition: StructuralCondition): StructuralCompatibilityProjection {
  const healthPercent = Math.floor((condition.currentHealth * 100) / condition.maximumHealth);
  const compatibilityCondition: VehicleConditionCompatibility = condition.broken
    ? "broken"
    : healthPercent >= 90
      ? "new"
      : healthPercent >= 60
        ? "good"
        : "worn";
  return Object.freeze({
    condition: compatibilityCondition,
    wearLevel: Math.min(100, 100 - healthPercent),
    healthPercent
  });
}

function unchangedDamageResult(condition: StructuralCondition): StructuralDamageResult {
  return Object.freeze({
    before: condition.snapshot(),
    after: condition.snapshot(),
    appliedDamageUnits: 0,
    addedWearUnits: 0,
    broken: condition.broken,
    compatibility: compatibilityProjection(condition)
  });
}

function validateWearProfile(profile: StructuralWearProfile): void {
  assertSafeInteger(profile.damageUnitsPerKilometer, "damageUnitsPerKilometer", "TRANSPORT_DAMAGE_INVALID");
  assertSafeInteger(profile.wearUnitsPerKilometer, "wearUnitsPerKilometer", "TRANSPORT_DAMAGE_INVALID");
  assertSafeInteger(profile.minimumWearUnitsPerUsage, "minimumWearUnitsPerUsage", "TRANSPORT_DAMAGE_INVALID");
}

function perKilometerUnits(distanceMeters: number, rate: number): number {
  if (distanceMeters === 0 || rate === 0) return 0;
  const numerator = BigInt(distanceMeters) * BigInt(rate);
  return safeIntegerFromBigInt((numerator + 999n) / 1_000n, "TRANSPORT_DAMAGE_INVALID", "usageWear");
}

function scaledInteger(value: number, factorBps: number): number {
  const numerator = BigInt(value) * BigInt(factorBps);
  return safeIntegerFromBigInt((numerator + 9_999n) / 10_000n, "TRANSPORT_DAMAGE_INVALID", "wearDamage");
}
