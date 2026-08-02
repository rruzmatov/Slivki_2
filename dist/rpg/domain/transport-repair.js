"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepairPolicy = void 0;
exports.validateRepairQuote = validateRepairQuote;
const transport_condition_1 = require("./transport-condition");
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
const transport_pricing_1 = require("./transport-pricing");
class RepairPolicy {
    pricing;
    requirements = Object.freeze({
        permission: "repair",
        requiresReason: true,
        minimumMissingHealthUnits: 1
    });
    constructor(pricing) {
        this.pricing = pricing;
    }
    createQuote(input) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.quoteId, "quoteId");
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.vehicleId, "vehicleId");
        const reasonCode = (0, transport_domain_validation_1.assertNonEmptyReason)(input.reasonCode, "TRANSPORT_REPAIR_REASON_REQUIRED");
        if (input.condition.missingHealth < this.requirements.minimumMissingHealthUnits) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_NOT_REQUIRED", { vehicleId: input.vehicleId });
        }
        const restoreHealthUnits = input.restoreHealthUnits ?? input.condition.missingHealth;
        (0, transport_domain_validation_1.assertSafeInteger)(restoreHealthUnits, "restoreHealthUnits", "TRANSPORT_REPAIR_QUOTE_INVALID", this.requirements.minimumMissingHealthUnits, input.condition.missingHealth);
        const createdAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(input.createdAt, "createdAt");
        const expiresAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(input.expiresAt, "expiresAt");
        if (expiresAtMs <= createdAtMs) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { field: "expiresAt" });
        }
        const breakdown = this.pricing.quote({
            ...input.pricingContext,
            maximumHealth: input.condition.maximumHealth,
            missingHealthUnits: input.condition.missingHealth,
            restoreHealthUnits
        });
        (0, transport_pricing_1.validatePricingBreakdown)(breakdown, this.pricing.version);
        return freezeRepairQuote({
            quoteId: input.quoteId,
            vehicleId: input.vehicleId,
            reasonCode,
            conditionAtQuote: input.condition.snapshot(),
            restoreHealthUnits,
            cost: {
                amount: breakdown.totalAmount,
                currency: breakdown.currency,
                breakdown
            },
            policyVersion: this.pricing.version,
            createdAt: input.createdAt,
            expiresAt: input.expiresAt
        });
    }
    complete(condition, quote, completedAt) {
        validateRepairQuote(quote);
        if (quote.policyVersion !== this.pricing.version) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
        }
        const completionMs = (0, transport_domain_validation_1.timestampMilliseconds)(completedAt, "completedAt");
        if (completionMs < (0, transport_domain_validation_1.timestampMilliseconds)(quote.createdAt, "createdAt") ||
            completionMs > (0, transport_domain_validation_1.timestampMilliseconds)(quote.expiresAt, "expiresAt")) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
        }
        if (!sameCondition(condition.snapshot(), quote.conditionAtQuote)) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", {
                quoteId: quote.quoteId,
                field: "conditionAtQuote"
            });
        }
        const after = condition.restoreHealth(quote.restoreHealthUnits);
        return Object.freeze({
            quoteId: quote.quoteId,
            vehicleId: quote.vehicleId,
            before: condition.snapshot(),
            after: after.snapshot(),
            restoredHealthUnits: quote.restoreHealthUnits,
            cost: quote.cost,
            completedAt
        });
    }
}
exports.RepairPolicy = RepairPolicy;
function validateRepairQuote(quote) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(quote.quoteId, "quoteId");
    (0, transport_domain_validation_1.assertTransportIdentifier)(quote.vehicleId, "vehicleId");
    (0, transport_domain_validation_1.assertNonEmptyReason)(quote.reasonCode, "TRANSPORT_REPAIR_REASON_REQUIRED");
    transport_condition_1.StructuralCondition.restore(quote.conditionAtQuote);
    (0, transport_domain_validation_1.assertSafeInteger)(quote.restoreHealthUnits, "restoreHealthUnits", "TRANSPORT_REPAIR_QUOTE_INVALID", 1, quote.conditionAtQuote.maximumHealth - quote.conditionAtQuote.currentHealth);
    const createdAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(quote.createdAt, "createdAt");
    const expiresAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(quote.expiresAt, "expiresAt");
    if (expiresAtMs <= createdAtMs) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    (0, transport_pricing_1.validatePricingBreakdown)(quote.cost.breakdown, quote.policyVersion);
    if (quote.cost.amount !== quote.cost.breakdown.totalAmount || quote.cost.currency !== quote.cost.breakdown.currency) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
}
function sameCondition(left, right) {
    return left.maximumHealth === right.maximumHealth &&
        left.currentHealth === right.currentHealth &&
        left.accumulatedWear === right.accumulatedWear;
}
function freezeRepairQuote(quote) {
    return Object.freeze({
        ...quote,
        conditionAtQuote: Object.freeze({ ...quote.conditionAtQuote }),
        cost: Object.freeze({ ...quote.cost })
    });
}
