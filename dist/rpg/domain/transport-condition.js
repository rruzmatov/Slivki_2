"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StructuralDamagePolicy = exports.StructuralCondition = void 0;
exports.compatibilityProjection = compatibilityProjection;
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
class StructuralCondition {
    value;
    constructor(value) {
        this.value = value;
        Object.freeze(this.value);
        Object.freeze(this);
    }
    static pristine(maximumHealth) {
        (0, transport_domain_validation_1.assertSafeInteger)(maximumHealth, "maximumHealth", "TRANSPORT_STRUCTURAL_HEALTH_INVALID", 1);
        return new StructuralCondition({ maximumHealth, currentHealth: maximumHealth, accumulatedWear: 0 });
    }
    static restore(snapshot) {
        (0, transport_domain_validation_1.assertSafeInteger)(snapshot.maximumHealth, "maximumHealth", "TRANSPORT_STRUCTURAL_HEALTH_INVALID", 1);
        (0, transport_domain_validation_1.assertSafeInteger)(snapshot.currentHealth, "currentHealth", "TRANSPORT_STRUCTURAL_HEALTH_INVALID", 0, snapshot.maximumHealth);
        (0, transport_domain_validation_1.assertSafeInteger)(snapshot.accumulatedWear, "accumulatedWear", "TRANSPORT_STRUCTURAL_HEALTH_INVALID");
        return new StructuralCondition({ ...snapshot });
    }
    get maximumHealth() {
        return this.value.maximumHealth;
    }
    get currentHealth() {
        return this.value.currentHealth;
    }
    get accumulatedWear() {
        return this.value.accumulatedWear;
    }
    get missingHealth() {
        return this.maximumHealth - this.currentHealth;
    }
    get broken() {
        return this.currentHealth === 0;
    }
    restoreHealth(units) {
        (0, transport_domain_validation_1.assertSafeInteger)(units, "restoreUnits", "TRANSPORT_REPAIR_RESULT_INVALID", 1);
        if (units > this.missingHealth) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_RESULT_INVALID", {
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
    snapshot() {
        return Object.freeze({ ...this.value });
    }
}
exports.StructuralCondition = StructuralCondition;
class StructuralDamagePolicy {
    wearToDamageFactorBps;
    constructor(wearToDamageFactorBps = 10_000) {
        this.wearToDamageFactorBps = wearToDamageFactorBps;
        (0, transport_domain_validation_1.assertSafeInteger)(wearToDamageFactorBps, "wearToDamageFactorBps", "TRANSPORT_DAMAGE_INVALID", 0, 1_000_000);
    }
    apply(condition, input) {
        (0, transport_domain_validation_1.assertSafeInteger)(input.damageUnits, "damageUnits", "TRANSPORT_DAMAGE_INVALID");
        (0, transport_domain_validation_1.assertSafeInteger)(input.wearUnits, "wearUnits", "TRANSPORT_DAMAGE_INVALID");
        if (input.damageUnits === 0 && input.wearUnits === 0)
            return unchangedDamageResult(condition);
        const wearDamage = scaledInteger(input.wearUnits, this.wearToDamageFactorBps);
        const requestedDamage = (0, transport_domain_validation_1.safeIntegerFromBigInt)(BigInt(input.damageUnits) + BigInt(wearDamage), "TRANSPORT_DAMAGE_INVALID", "requestedDamage");
        const appliedDamageUnits = Math.min(condition.currentHealth, requestedDamage);
        const accumulatedWear = (0, transport_domain_validation_1.safeIntegerFromBigInt)(BigInt(condition.accumulatedWear) + BigInt(input.wearUnits), "TRANSPORT_DAMAGE_INVALID", "accumulatedWear");
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
    applyUsage(condition, distanceMeters, profile) {
        (0, transport_domain_validation_1.assertSafeInteger)(distanceMeters, "distanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID");
        validateWearProfile(profile);
        const damageUnits = perKilometerUnits(distanceMeters, profile.damageUnitsPerKilometer);
        const distanceWear = perKilometerUnits(distanceMeters, profile.wearUnitsPerKilometer);
        const wearUnits = distanceMeters === 0 ? 0 : Math.max(profile.minimumWearUnitsPerUsage, distanceWear);
        return this.apply(condition, { damageUnits, wearUnits });
    }
}
exports.StructuralDamagePolicy = StructuralDamagePolicy;
function compatibilityProjection(condition) {
    const healthPercent = Math.floor((condition.currentHealth * 100) / condition.maximumHealth);
    const compatibilityCondition = condition.broken
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
function unchangedDamageResult(condition) {
    return Object.freeze({
        before: condition.snapshot(),
        after: condition.snapshot(),
        appliedDamageUnits: 0,
        addedWearUnits: 0,
        broken: condition.broken,
        compatibility: compatibilityProjection(condition)
    });
}
function validateWearProfile(profile) {
    (0, transport_domain_validation_1.assertSafeInteger)(profile.damageUnitsPerKilometer, "damageUnitsPerKilometer", "TRANSPORT_DAMAGE_INVALID");
    (0, transport_domain_validation_1.assertSafeInteger)(profile.wearUnitsPerKilometer, "wearUnitsPerKilometer", "TRANSPORT_DAMAGE_INVALID");
    (0, transport_domain_validation_1.assertSafeInteger)(profile.minimumWearUnitsPerUsage, "minimumWearUnitsPerUsage", "TRANSPORT_DAMAGE_INVALID");
}
function perKilometerUnits(distanceMeters, rate) {
    if (distanceMeters === 0 || rate === 0)
        return 0;
    const numerator = BigInt(distanceMeters) * BigInt(rate);
    return (0, transport_domain_validation_1.safeIntegerFromBigInt)((numerator + 999n) / 1000n, "TRANSPORT_DAMAGE_INVALID", "usageWear");
}
function scaledInteger(value, factorBps) {
    const numerator = BigInt(value) * BigInt(factorBps);
    return (0, transport_domain_validation_1.safeIntegerFromBigInt)((numerator + 9999n) / 10000n, "TRANSPORT_DAMAGE_INVALID", "wearDamage");
}
