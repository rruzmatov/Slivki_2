"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveVehiclePolicy = exports.TravelEligibilityPolicy = exports.WorkEligibilityPolicy = exports.TransportEligibilityPolicy = void 0;
const transport_condition_1 = require("./transport-condition");
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
class TransportEligibilityPolicy {
    capabilityRegistry;
    constructor(capabilityRegistry) {
        this.capabilityRegistry = capabilityRegistry;
    }
    evaluate(input) {
        validateEligibilityInput(input);
        const missingCapabilities = this.capabilityRegistry.missingCapabilities(input.capabilities, input.criteria.requiredCapabilities);
        const condition = transport_condition_1.StructuralCondition.restore(input.condition);
        const healthPercent = Math.floor((condition.currentHealth * 100) / condition.maximumHealth);
        const failureCodes = new Set();
        if (missingCapabilities.length > 0)
            failureCodes.add("capability_missing");
        if (!input.requirements.passed)
            failureCodes.add("requirement_failed");
        if (!input.permission.allowed)
            failureCodes.add("permission_denied");
        if (!input.criteria.allowedStates.includes(input.operationalState))
            failureCodes.add("operational_state_forbidden");
        if (condition.broken)
            failureCodes.add("vehicle_broken");
        if (healthPercent < input.criteria.minimumHealthPercent)
            failureCodes.add("condition_insufficient");
        return Object.freeze({
            eligible: failureCodes.size === 0,
            failureCodes: Object.freeze([...failureCodes]),
            missingCapabilities: Object.freeze(missingCapabilities),
            failedRequirementCodes: Object.freeze([...input.requirements.failedRequirementCodes]),
            requiredPermission: input.permission.permission
        });
    }
    assertEligible(decision) {
        if (!decision.eligible) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_DENIED", {
                failures: decision.failureCodes.join(","),
                permission: decision.requiredPermission
            });
        }
    }
}
exports.TransportEligibilityPolicy = TransportEligibilityPolicy;
class WorkEligibilityPolicy {
    transportEligibility;
    constructor(transportEligibility) {
        this.transportEligibility = transportEligibility;
    }
    evaluate(input) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.workCode, "workCode");
        return this.transportEligibility.evaluate(input);
    }
}
exports.WorkEligibilityPolicy = WorkEligibilityPolicy;
class TravelEligibilityPolicy {
    transportEligibility;
    constructor(transportEligibility) {
        this.transportEligibility = transportEligibility;
    }
    evaluate(input) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.routeCode, "routeCode");
        return this.transportEligibility.evaluate(input);
    }
}
exports.TravelEligibilityPolicy = TravelEligibilityPolicy;
class ActiveVehiclePolicy {
    select(current, candidateVehicleId, decision, activatedAt) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(candidateVehicleId, "candidateVehicleId");
        (0, transport_domain_validation_1.timestampMilliseconds)(activatedAt, "activatedAt");
        if (!decision.eligible) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_DENIED", {
                vehicleId: candidateVehicleId,
                failures: decision.failureCodes.join(",")
            });
        }
        if (current) {
            (0, transport_domain_validation_1.assertTransportIdentifier)(current.vehicleId, "activeVehicle.vehicleId");
            (0, transport_domain_validation_1.timestampMilliseconds)(current.activatedAt, "activeVehicle.activatedAt");
            (0, transport_domain_validation_1.assertSafeInteger)(current.selectionVersion, "selectionVersion", "TRANSPORT_ACTIVE_VEHICLE_INVALID", 1);
        }
        return Object.freeze({
            vehicleId: candidateVehicleId,
            activatedAt,
            selectionVersion: (current?.selectionVersion ?? 0) + 1
        });
    }
}
exports.ActiveVehiclePolicy = ActiveVehiclePolicy;
function validateEligibilityInput(input) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(input.vehicleId, "vehicleId");
    (0, transport_domain_validation_1.assertTransportIdentifier)(input.permission.permission, "permission");
    (0, transport_domain_validation_1.assertSafeInteger)(input.criteria.minimumHealthPercent, "minimumHealthPercent", "TRANSPORT_ELIGIBILITY_INVALID", 0, 100);
    if (input.criteria.allowedStates.length === 0 || new Set(input.criteria.allowedStates).size !== input.criteria.allowedStates.length) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "allowedStates" });
    }
    const operationalStates = [
        "available", "in_use", "under_maintenance", "under_repair", "out_of_service", "retired"
    ];
    if (input.criteria.allowedStates.some((state) => !operationalStates.includes(state))) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "allowedStates" });
    }
    for (const code of input.criteria.requiredCapabilities)
        (0, transport_domain_validation_1.assertTransportIdentifier)(code, "requiredCapability");
    if (new Set(input.criteria.requiredCapabilities).size !== input.criteria.requiredCapabilities.length) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "requiredCapabilities" });
    }
    for (const code of input.requirements.failedRequirementCodes)
        (0, transport_domain_validation_1.assertTransportIdentifier)(code, "failedRequirementCode");
    if (input.requirements.passed && input.requirements.failedRequirementCodes.length > 0) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "requirements" });
    }
}
