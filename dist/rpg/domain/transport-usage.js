"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VehicleUsage = void 0;
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
class VehicleUsage {
    value;
    constructor(value) {
        this.value = value;
        Object.freeze(this.value.purpose);
        Object.freeze(this.value);
        Object.freeze(this);
    }
    static plan(input) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.usageId, "usageId");
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.vehicleId, "vehicleId");
        validatePurpose(input.purpose);
        (0, transport_domain_validation_1.assertSafeInteger)(input.plannedDistanceMeters, "plannedDistanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID", 1);
        (0, transport_domain_validation_1.timestampMilliseconds)(input.plannedAt, "plannedAt");
        return new VehicleUsage({ ...input, purpose: { ...input.purpose }, lifecycle: "planned", version: 1 });
    }
    static restore(snapshot) {
        const usage = VehicleUsage.plan({
            usageId: snapshot.usageId,
            vehicleId: snapshot.vehicleId,
            purpose: snapshot.purpose,
            plannedDistanceMeters: snapshot.plannedDistanceMeters,
            plannedAt: snapshot.plannedAt
        });
        validateUsageSnapshot(snapshot);
        return snapshot.lifecycle === "planned" ? usage : new VehicleUsage(cloneSnapshot(snapshot));
    }
    get lifecycle() {
        return this.value.lifecycle;
    }
    get usageId() {
        return this.value.usageId;
    }
    get vehicleId() {
        return this.value.vehicleId;
    }
    start(startedAt) {
        this.assertLifecycle("planned");
        (0, transport_domain_validation_1.assertTimestampOrder)(this.value.plannedAt, startedAt, "startedAt");
        return new VehicleUsage({ ...this.value, lifecycle: "active", startedAt, version: this.value.version + 1 });
    }
    complete(actualDistanceMeters, completedAt) {
        this.assertLifecycle("active");
        (0, transport_domain_validation_1.assertSafeInteger)(actualDistanceMeters, "actualDistanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID");
        (0, transport_domain_validation_1.assertTimestampOrder)(this.value.startedAt, completedAt, "completedAt");
        return new VehicleUsage({
            ...this.value,
            lifecycle: "completed",
            actualDistanceMeters,
            completedAt,
            version: this.value.version + 1
        });
    }
    cancel(reasonCode, cancelledAt) {
        if (this.lifecycle !== "planned" && this.lifecycle !== "active") {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_USAGE_TRANSITION_FORBIDDEN", {
                from: this.lifecycle,
                to: "cancelled"
            });
        }
        const normalizedReason = (0, transport_domain_validation_1.assertNonEmptyReason)(reasonCode, "TRANSPORT_USAGE_REASON_REQUIRED");
        (0, transport_domain_validation_1.assertTimestampOrder)(this.value.startedAt ?? this.value.plannedAt, cancelledAt, "cancelledAt");
        return new VehicleUsage({
            ...this.value,
            lifecycle: "cancelled",
            cancellationReasonCode: normalizedReason,
            cancelledAt,
            version: this.value.version + 1
        });
    }
    snapshot() {
        return cloneSnapshot(this.value);
    }
    assertLifecycle(expected) {
        if (this.lifecycle !== expected) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_USAGE_TRANSITION_FORBIDDEN", {
                from: this.lifecycle,
                to: expected
            });
        }
    }
}
exports.VehicleUsage = VehicleUsage;
function validatePurpose(purpose) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(purpose.code, "purpose.code");
    if (purpose.targetId !== undefined)
        (0, transport_domain_validation_1.assertTransportIdentifier)(purpose.targetId, "purpose.targetId");
}
function validateUsageSnapshot(snapshot) {
    (0, transport_domain_validation_1.assertSafeInteger)(snapshot.version, "usage.version", "TRANSPORT_USAGE_INVALID", 1);
    if (snapshot.lifecycle === "planned") {
        if (snapshot.startedAt || snapshot.completedAt || snapshot.cancelledAt)
            usageInvariant(snapshot.lifecycle);
        return;
    }
    if (snapshot.lifecycle === "active") {
        if (!snapshot.startedAt || snapshot.completedAt || snapshot.cancelledAt)
            usageInvariant(snapshot.lifecycle);
        (0, transport_domain_validation_1.assertTimestampOrder)(snapshot.plannedAt, snapshot.startedAt, "startedAt");
        return;
    }
    if (snapshot.lifecycle === "completed") {
        if (!snapshot.startedAt || !snapshot.completedAt || snapshot.actualDistanceMeters === undefined || snapshot.cancelledAt) {
            usageInvariant(snapshot.lifecycle);
        }
        (0, transport_domain_validation_1.assertSafeInteger)(snapshot.actualDistanceMeters, "actualDistanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID");
        (0, transport_domain_validation_1.assertTimestampOrder)(snapshot.plannedAt, snapshot.startedAt, "startedAt");
        (0, transport_domain_validation_1.assertTimestampOrder)(snapshot.startedAt, snapshot.completedAt, "completedAt");
        return;
    }
    if (!snapshot.cancelledAt || !snapshot.cancellationReasonCode || snapshot.completedAt)
        usageInvariant(snapshot.lifecycle);
    (0, transport_domain_validation_1.assertNonEmptyReason)(snapshot.cancellationReasonCode, "TRANSPORT_USAGE_REASON_REQUIRED");
    if (snapshot.startedAt)
        (0, transport_domain_validation_1.assertTimestampOrder)(snapshot.plannedAt, snapshot.startedAt, "startedAt");
    (0, transport_domain_validation_1.assertTimestampOrder)(snapshot.startedAt ?? snapshot.plannedAt, snapshot.cancelledAt, "cancelledAt");
}
function usageInvariant(lifecycle) {
    throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_USAGE_INVALID", { lifecycle });
}
function cloneSnapshot(snapshot) {
    return Object.freeze({ ...snapshot, purpose: Object.freeze({ ...snapshot.purpose }) });
}
