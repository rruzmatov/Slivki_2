"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateBasedResaleValuationPolicy = exports.RateBasedMaintenancePricingPolicy = exports.RateBasedRepairPricingPolicy = void 0;
exports.validatePolicyVersion = validatePolicyVersion;
exports.validatePricingBreakdown = validatePricingBreakdown;
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
class RateBasedRepairPricingPolicy {
    minimumAmount;
    version;
    constructor(version, minimumAmount = 0) {
        this.minimumAmount = minimumAmount;
        this.version = validatePolicyVersion(version);
        (0, transport_domain_validation_1.assertSafeInteger)(minimumAmount, "minimumAmount", "TRANSPORT_PRICING_CONTEXT_INVALID");
    }
    quote(context) {
        validatePricingContext(context);
        (0, transport_domain_validation_1.assertSafeInteger)(context.maximumHealth, "maximumHealth", "TRANSPORT_PRICING_CONTEXT_INVALID", 1);
        (0, transport_domain_validation_1.assertSafeInteger)(context.missingHealthUnits, "missingHealthUnits", "TRANSPORT_PRICING_CONTEXT_INVALID", 1, context.maximumHealth);
        (0, transport_domain_validation_1.assertSafeInteger)(context.restoreHealthUnits, "restoreHealthUnits", "TRANSPORT_PRICING_CONTEXT_INVALID", 1, context.missingHealthUnits);
        const proportionalAmount = Math.max(this.minimumAmount, ratioAmount(context.baseAmount, context.restoreHealthUnits, context.maximumHealth));
        return buildPricingBreakdown(proportionalAmount, context, this.version);
    }
}
exports.RateBasedRepairPricingPolicy = RateBasedRepairPricingPolicy;
class RateBasedMaintenancePricingPolicy {
    version;
    constructor(version) {
        this.version = validatePolicyVersion(version);
    }
    quote(context) {
        validatePricingContext(context);
        (0, transport_domain_validation_1.assertSafeInteger)(context.taskCount, "taskCount", "TRANSPORT_PRICING_CONTEXT_INVALID", 1, 1_000);
        assertFactor(context.overdueMultiplierBps, "overdueMultiplierBps");
        const tasksAmount = (0, transport_domain_validation_1.safeIntegerFromBigInt)(BigInt(context.baseAmount) * BigInt(context.taskCount), "TRANSPORT_PRICING_OVERFLOW", "maintenanceBaseAmount");
        return buildPricingBreakdown(tasksAmount, context, this.version, [
            { code: "overdue", factorBps: context.overdueMultiplierBps }
        ]);
    }
}
exports.RateBasedMaintenancePricingPolicy = RateBasedMaintenancePricingPolicy;
class RateBasedResaleValuationPolicy {
    version;
    constructor(version) {
        this.version = validatePolicyVersion(version);
    }
    valuate(context) {
        validatePricingContext(context);
        assertFactor(context.conditionFactorBps, "conditionFactorBps");
        assertFactor(context.mileageFactorBps, "mileageFactorBps");
        return buildPricingBreakdown(context.baseAmount, context, this.version, [
            { code: "condition", factorBps: context.conditionFactorBps },
            { code: "mileage", factorBps: context.mileageFactorBps }
        ]);
    }
}
exports.RateBasedResaleValuationPolicy = RateBasedResaleValuationPolicy;
function validatePolicyVersion(version) {
    if (!/^[1-9][0-9]*\.[0-9]+(?:\.[0-9]+)?(?:-[a-z0-9.-]+)?$/.test(version)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_POLICY_VERSION_INVALID", { version });
    }
    return version;
}
function validatePricingBreakdown(breakdown, expectedVersion) {
    validatePolicyVersion(breakdown.policyVersion);
    if (breakdown.policyVersion !== expectedVersion) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", {
            expectedVersion,
            actualVersion: breakdown.policyVersion
        });
    }
    (0, transport_domain_validation_1.assertTransportIdentifier)(breakdown.currency, "currency");
    (0, transport_domain_validation_1.assertSafeInteger)(breakdown.baseAmount, "baseAmount", "TRANSPORT_PRICING_BREAKDOWN_INVALID");
    (0, transport_domain_validation_1.assertSafeInteger)(breakdown.totalAmount, "totalAmount", "TRANSPORT_PRICING_BREAKDOWN_INVALID");
    let amount = breakdown.baseAmount;
    for (const adjustment of breakdown.adjustments) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(adjustment.code, "adjustment.code");
        assertFactor(adjustment.factorBps, "adjustment.factorBps");
        if (adjustment.amountBefore !== amount || adjustment.amountAfter - adjustment.amountBefore !== adjustment.deltaAmount) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", { code: adjustment.code });
        }
        amount = applyFactor(amount, adjustment.factorBps);
        if (adjustment.amountAfter !== amount) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", { code: adjustment.code });
        }
    }
    if (amount !== breakdown.totalAmount) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", { totalAmount: breakdown.totalAmount });
    }
}
function buildPricingBreakdown(baseAmount, context, policyVersion, additionalFactors = []) {
    const factors = [
        { code: "rarity", factorBps: context.rarityFactorBps },
        { code: "age", factorBps: context.ageFactorBps },
        { code: "asset_type", factorBps: context.assetTypeFactorBps },
        { code: "category", factorBps: context.categoryFactorBps },
        { code: "economic_balance", factorBps: context.economicBalanceFactorBps },
        ...additionalFactors
    ];
    const adjustments = [];
    let amount = baseAmount;
    for (const factor of factors) {
        assertFactor(factor.factorBps, factor.code);
        const amountAfter = applyFactor(amount, factor.factorBps);
        adjustments.push(Object.freeze({
            code: factor.code,
            factorBps: factor.factorBps,
            amountBefore: amount,
            amountAfter,
            deltaAmount: amountAfter - amount
        }));
        amount = amountAfter;
    }
    const breakdown = Object.freeze({
        currency: context.currency,
        baseAmount,
        adjustments: Object.freeze(adjustments),
        totalAmount: amount,
        policyVersion
    });
    validatePricingBreakdown(breakdown, policyVersion);
    return breakdown;
}
function validatePricingContext(context) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(context.currency, "currency");
    (0, transport_domain_validation_1.assertSafeInteger)(context.baseAmount, "baseAmount", "TRANSPORT_PRICING_CONTEXT_INVALID");
    assertFactor(context.rarityFactorBps, "rarityFactorBps");
    assertFactor(context.ageFactorBps, "ageFactorBps");
    assertFactor(context.assetTypeFactorBps, "assetTypeFactorBps");
    assertFactor(context.categoryFactorBps, "categoryFactorBps");
    assertFactor(context.economicBalanceFactorBps, "economicBalanceFactorBps");
}
function assertFactor(value, field) {
    (0, transport_domain_validation_1.assertSafeInteger)(value, field, "TRANSPORT_PRICING_CONTEXT_INVALID", 0, 1_000_000);
}
function ratioAmount(amount, numerator, denominator) {
    const value = BigInt(amount) * BigInt(numerator);
    return (0, transport_domain_validation_1.safeIntegerFromBigInt)((value + BigInt(denominator) - 1n) / BigInt(denominator), "TRANSPORT_PRICING_OVERFLOW", "ratioAmount");
}
function applyFactor(amount, factorBps) {
    const value = BigInt(amount) * BigInt(factorBps);
    return (0, transport_domain_validation_1.safeIntegerFromBigInt)((value + 5000n) / 10000n, "TRANSPORT_PRICING_OVERFLOW", "adjustedAmount");
}
