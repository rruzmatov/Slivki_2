"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const transport_condition_1 = require("../domain/transport-condition");
const errors_1 = require("../domain/errors");
const transport_maintenance_1 = require("../domain/transport-maintenance");
const transport_mileage_1 = require("../domain/transport-mileage");
const transport_pricing_1 = require("../domain/transport-pricing");
const transport_state_machine_1 = require("../domain/transport-state-machine");
const transport_usage_1 = require("../domain/transport-usage");
const transport_vehicle_1 = require("../domain/transport-vehicle");
const epoch = "2026-08-02T10:00:00.000Z";
const eligible = Object.freeze({
    eligible: true,
    failureCodes: [],
    missingCapabilities: [],
    failedRequirementCodes: [],
    requiredPermission: "use"
});
(0, node_test_1.default)("Mileage is serializable, monotonic and protected from overflow", () => {
    const mileage = transport_mileage_1.Mileage.zero().advance(1_500);
    strict_1.default.equal(mileage.meters, 1_500);
    strict_1.default.equal(mileage.kilometers, 1.5);
    strict_1.default.deepEqual(transport_mileage_1.Mileage.restore(mileage.serialize()).serialize(), { meters: 1_500 });
    strict_1.default.throws(() => mileage.update(1_499), domainError("TRANSPORT_MILEAGE_DECREASE"));
    strict_1.default.throws(() => transport_mileage_1.Mileage.fromMeters(Number.MAX_SAFE_INTEGER).advance(1), domainError("TRANSPORT_MILEAGE_OVERFLOW"));
});
(0, node_test_1.default)("Usage lifecycle validates distance, chronology and terminal transitions", () => {
    const planned = transport_usage_1.VehicleUsage.plan({
        usageId: "usage_1",
        vehicleId: "vehicle_1",
        purpose: { code: "delivery", targetId: "job_courier" },
        plannedDistanceMeters: 5_000,
        plannedAt: epoch
    });
    const active = planned.start(at(1_000));
    const completed = active.complete(4_800, at(2_000));
    strict_1.default.equal(completed.snapshot().actualDistanceMeters, 4_800);
    strict_1.default.throws(() => active.complete(-1, at(2_000)), domainError("TRANSPORT_USAGE_DISTANCE_INVALID"));
    strict_1.default.throws(() => completed.cancel("changed_mind", at(3_000)), domainError("TRANSPORT_USAGE_TRANSITION_FORBIDDEN"));
    strict_1.default.throws(() => planned.cancel("", at(1_000)), domainError("TRANSPORT_USAGE_REASON_REQUIRED"));
});
(0, node_test_1.default)("Vehicle state machine permits only approved transitions", () => {
    const machine = new transport_state_machine_1.VehicleStateMachine();
    strict_1.default.equal(machine.transition("available", "in_use"), "in_use");
    strict_1.default.equal(machine.transition("in_use", "available"), "available");
    strict_1.default.equal(machine.transition("available", "under_maintenance"), "under_maintenance");
    strict_1.default.equal(machine.transition("under_maintenance", "available"), "available");
    strict_1.default.equal(machine.transition("available", "under_repair"), "under_repair");
    strict_1.default.equal(machine.transition("under_repair", "available"), "available");
    strict_1.default.equal(machine.transition("available", "out_of_service"), "out_of_service");
    strict_1.default.equal(machine.transition("out_of_service", "retired"), "retired");
    strict_1.default.throws(() => machine.transition("retired", "available"), domainError("TRANSPORT_STATE_TRANSITION_FORBIDDEN"));
});
(0, node_test_1.default)("Vehicle aggregate enforces one active usage and monotonic odometer", () => {
    const vehicle = createVehicle(10_000);
    const damagePolicy = new transport_condition_1.StructuralDamagePolicy();
    const usage = vehicle.startUsage({
        usageId: "usage_primary",
        purpose: { code: "delivery", targetId: "job_courier" },
        plannedDistanceMeters: 5_000
    }, eligible, mutation(1, 0));
    strict_1.default.equal(usage.lifecycle, "active");
    strict_1.default.throws(() => vehicle.startUsage({
        usageId: "usage_parallel",
        purpose: { code: "delivery" },
        plannedDistanceMeters: 1_000
    }, eligible, mutation(2, 1_000)), domainError("TRANSPORT_USAGE_ALREADY_ACTIVE"));
    const completed = vehicle.completeUsage(5_000, damagePolicy, {
        damageUnitsPerKilometer: 0,
        wearUnitsPerKilometer: 1,
        minimumWearUnitsPerUsage: 1
    }, mutation(2, 2_000));
    strict_1.default.equal(completed.vehicle.operationalState, "available");
    strict_1.default.equal(completed.vehicle.mileage.meters, 5_000);
    strict_1.default.equal(completed.vehicle.usageCount, 1);
    strict_1.default.equal(completed.vehicle.activeUsage, undefined);
    strict_1.default.throws(() => vehicle.cancelUsage("duplicate", mutation(2, 3_000)), domainError("TRANSPORT_VEHICLE_VERSION_CONFLICT"));
    vehicle.startUsage({
        usageId: "usage_cancelled",
        purpose: { code: "urban" },
        plannedDistanceMeters: 1_000
    }, eligible, mutation(3, 3_000));
    const cancelled = vehicle.cancelUsage("route_closed", mutation(4, 4_000));
    strict_1.default.equal(cancelled.usage.lifecycle, "cancelled");
    strict_1.default.equal(cancelled.vehicle.mileage.meters, 5_000);
});
(0, node_test_1.default)("Broken and retired vehicles cannot be used", () => {
    const brokenVehicle = createVehicle(10);
    brokenVehicle.startUsage({
        usageId: "usage_break",
        purpose: { code: "urban" },
        plannedDistanceMeters: 1_000
    }, eligible, mutation(1, 0));
    const broken = brokenVehicle.completeUsage(1_000, new transport_condition_1.StructuralDamagePolicy(0), {
        damageUnitsPerKilometer: 10,
        wearUnitsPerKilometer: 0,
        minimumWearUnitsPerUsage: 0
    }, mutation(2, 1_000));
    strict_1.default.equal(broken.vehicle.condition.currentHealth, 0);
    strict_1.default.equal(broken.vehicle.operationalState, "out_of_service");
    strict_1.default.throws(() => brokenVehicle.startUsage({
        usageId: "usage_after_break",
        purpose: { code: "urban" },
        plannedDistanceMeters: 1_000
    }, eligible, mutation(3, 2_000)), domainError("TRANSPORT_VEHICLE_BROKEN"));
    const retiredVehicle = createVehicle(10_000);
    retiredVehicle.markOutOfService("lifecycle_end", mutation(1, 0));
    retiredVehicle.retire("lifecycle_end", mutation(2, 1_000));
    strict_1.default.throws(() => retiredVehicle.startUsage({
        usageId: "usage_retired",
        purpose: { code: "urban" },
        plannedDistanceMeters: 1_000
    }, eligible, mutation(3, 2_000)), domainError("TRANSPORT_STATE_TRANSITION_FORBIDDEN"));
});
(0, node_test_1.default)("Structural damage returns an Inventory-compatible condition projection", () => {
    const policy = new transport_condition_1.StructuralDamagePolicy(5_000);
    const result = policy.apply(transport_condition_1.StructuralCondition.pristine(10_000), { damageUnits: 2_000, wearUnits: 2_000 });
    strict_1.default.equal(result.after.currentHealth, 7_000);
    strict_1.default.equal(result.compatibility.condition, "good");
    strict_1.default.equal(result.compatibility.wearLevel, 30);
    strict_1.default.equal(result.broken, false);
});
function createVehicle(maximumStructuralHealth) {
    const policy = new transport_maintenance_1.MaintenancePolicy([{
            code: "chain",
            localizationKey: "transport.maintenance.chain",
            interval: new transport_maintenance_1.ServiceInterval({ distanceMeters: 250_000 }),
            overdueMultiplierBps: 12_500,
            criticalOverdueMultiplierBps: 17_500,
            version: 1
        }], new transport_pricing_1.RateBasedMaintenancePricingPolicy("1.0.0"));
    return transport_vehicle_1.VehicleAggregate.create({
        vehicleId: "vehicle_giant_1",
        productId: "bike_giant_escape_3",
        maximumStructuralHealth,
        maintenanceSchedule: policy.createSchedule({ at: epoch, mileageMeters: 0, usageCount: 0 }),
        createdAt: epoch
    });
}
function mutation(expectedVersion, offsetMilliseconds) {
    return { expectedVersion, at: at(offsetMilliseconds) };
}
function at(offsetMilliseconds) {
    return new Date(Date.parse(epoch) + offsetMilliseconds).toISOString();
}
function domainError(code) {
    return (error) => error instanceof errors_1.DomainError && error.code === code;
}
