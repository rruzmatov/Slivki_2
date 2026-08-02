import assert from "node:assert/strict";
import test from "node:test";
import { StructuralCondition, StructuralDamagePolicy } from "../domain/transport-condition";
import type { TransportEligibilityDecision } from "../domain/transport-eligibility";
import { DomainError } from "../domain/errors";
import { MaintenancePolicy, ServiceInterval } from "../domain/transport-maintenance";
import { Mileage } from "../domain/transport-mileage";
import { RateBasedMaintenancePricingPolicy } from "../domain/transport-pricing";
import { VehicleStateMachine } from "../domain/transport-state-machine";
import { VehicleUsage } from "../domain/transport-usage";
import { VehicleAggregate } from "../domain/transport-vehicle";

const epoch = "2026-08-02T10:00:00.000Z";
const eligible: TransportEligibilityDecision = Object.freeze({
  eligible: true,
  failureCodes: [],
  missingCapabilities: [],
  failedRequirementCodes: [],
  requiredPermission: "use"
});

test("Mileage is serializable, monotonic and protected from overflow", () => {
  const mileage = Mileage.zero().advance(1_500);
  assert.equal(mileage.meters, 1_500);
  assert.equal(mileage.kilometers, 1.5);
  assert.deepEqual(Mileage.restore(mileage.serialize()).serialize(), { meters: 1_500 });
  assert.throws(() => mileage.update(1_499), domainError("TRANSPORT_MILEAGE_DECREASE"));
  assert.throws(
    () => Mileage.fromMeters(Number.MAX_SAFE_INTEGER).advance(1),
    domainError("TRANSPORT_MILEAGE_OVERFLOW")
  );
});

test("Usage lifecycle validates distance, chronology and terminal transitions", () => {
  const planned = VehicleUsage.plan({
    usageId: "usage_1",
    vehicleId: "vehicle_1",
    purpose: { code: "delivery", targetId: "job_courier" },
    plannedDistanceMeters: 5_000,
    plannedAt: epoch
  });
  const active = planned.start(at(1_000));
  const completed = active.complete(4_800, at(2_000));
  assert.equal(completed.snapshot().actualDistanceMeters, 4_800);
  assert.throws(() => active.complete(-1, at(2_000)), domainError("TRANSPORT_USAGE_DISTANCE_INVALID"));
  assert.throws(
    () => completed.cancel("changed_mind", at(3_000)),
    domainError("TRANSPORT_USAGE_TRANSITION_FORBIDDEN")
  );
  assert.throws(() => planned.cancel("", at(1_000)), domainError("TRANSPORT_USAGE_REASON_REQUIRED"));
});

test("Vehicle state machine permits only approved transitions", () => {
  const machine = new VehicleStateMachine();
  assert.equal(machine.transition("available", "in_use"), "in_use");
  assert.equal(machine.transition("in_use", "available"), "available");
  assert.equal(machine.transition("available", "under_maintenance"), "under_maintenance");
  assert.equal(machine.transition("under_maintenance", "available"), "available");
  assert.equal(machine.transition("available", "under_repair"), "under_repair");
  assert.equal(machine.transition("under_repair", "available"), "available");
  assert.equal(machine.transition("available", "out_of_service"), "out_of_service");
  assert.equal(machine.transition("out_of_service", "retired"), "retired");
  assert.throws(
    () => machine.transition("retired", "available"),
    domainError("TRANSPORT_STATE_TRANSITION_FORBIDDEN")
  );
});

test("Vehicle aggregate enforces one active usage and monotonic odometer", () => {
  const vehicle = createVehicle(10_000);
  const damagePolicy = new StructuralDamagePolicy();
  const usage = vehicle.startUsage({
    usageId: "usage_primary",
    purpose: { code: "delivery", targetId: "job_courier" },
    plannedDistanceMeters: 5_000
  }, eligible, mutation(1, 0));
  assert.equal(usage.lifecycle, "active");
  assert.throws(
    () => vehicle.startUsage({
      usageId: "usage_parallel",
      purpose: { code: "delivery" },
      plannedDistanceMeters: 1_000
    }, eligible, mutation(2, 1_000)),
    domainError("TRANSPORT_USAGE_ALREADY_ACTIVE")
  );

  const completed = vehicle.completeUsage(5_000, damagePolicy, {
    damageUnitsPerKilometer: 0,
    wearUnitsPerKilometer: 1,
    minimumWearUnitsPerUsage: 1
  }, mutation(2, 2_000));
  assert.equal(completed.vehicle.operationalState, "available");
  assert.equal(completed.vehicle.mileage.meters, 5_000);
  assert.equal(completed.vehicle.usageCount, 1);
  assert.equal(completed.vehicle.activeUsage, undefined);
  assert.throws(
    () => vehicle.cancelUsage("duplicate", mutation(2, 3_000)),
    domainError("TRANSPORT_VEHICLE_VERSION_CONFLICT")
  );

  vehicle.startUsage({
    usageId: "usage_cancelled",
    purpose: { code: "urban" },
    plannedDistanceMeters: 1_000
  }, eligible, mutation(3, 3_000));
  const cancelled = vehicle.cancelUsage("route_closed", mutation(4, 4_000));
  assert.equal(cancelled.usage.lifecycle, "cancelled");
  assert.equal(cancelled.vehicle.mileage.meters, 5_000);
});

test("Broken and retired vehicles cannot be used", () => {
  const brokenVehicle = createVehicle(10);
  brokenVehicle.startUsage({
    usageId: "usage_break",
    purpose: { code: "urban" },
    plannedDistanceMeters: 1_000
  }, eligible, mutation(1, 0));
  const broken = brokenVehicle.completeUsage(1_000, new StructuralDamagePolicy(0), {
    damageUnitsPerKilometer: 10,
    wearUnitsPerKilometer: 0,
    minimumWearUnitsPerUsage: 0
  }, mutation(2, 1_000));
  assert.equal(broken.vehicle.condition.currentHealth, 0);
  assert.equal(broken.vehicle.operationalState, "out_of_service");
  assert.throws(
    () => brokenVehicle.startUsage({
      usageId: "usage_after_break",
      purpose: { code: "urban" },
      plannedDistanceMeters: 1_000
    }, eligible, mutation(3, 2_000)),
    domainError("TRANSPORT_VEHICLE_BROKEN")
  );

  const retiredVehicle = createVehicle(10_000);
  retiredVehicle.markOutOfService("lifecycle_end", mutation(1, 0));
  retiredVehicle.retire("lifecycle_end", mutation(2, 1_000));
  assert.throws(
    () => retiredVehicle.startUsage({
      usageId: "usage_retired",
      purpose: { code: "urban" },
      plannedDistanceMeters: 1_000
    }, eligible, mutation(3, 2_000)),
    domainError("TRANSPORT_STATE_TRANSITION_FORBIDDEN")
  );
});

test("Structural damage returns an Inventory-compatible condition projection", () => {
  const policy = new StructuralDamagePolicy(5_000);
  const result = policy.apply(StructuralCondition.pristine(10_000), { damageUnits: 2_000, wearUnits: 2_000 });
  assert.equal(result.after.currentHealth, 7_000);
  assert.equal(result.compatibility.condition, "good");
  assert.equal(result.compatibility.wearLevel, 30);
  assert.equal(result.broken, false);
});

function createVehicle(maximumStructuralHealth: number): VehicleAggregate {
  const policy = new MaintenancePolicy([{
    code: "chain",
    localizationKey: "transport.maintenance.chain",
    interval: new ServiceInterval({ distanceMeters: 250_000 }),
    overdueMultiplierBps: 12_500,
    criticalOverdueMultiplierBps: 17_500,
    version: 1
  }], new RateBasedMaintenancePricingPolicy("1.0.0"));
  return VehicleAggregate.create({
    vehicleId: "vehicle_giant_1",
    productId: "bike_giant_escape_3",
    maximumStructuralHealth,
    maintenanceSchedule: policy.createSchedule({ at: epoch, mileageMeters: 0, usageCount: 0 }),
    createdAt: epoch
  });
}

function mutation(expectedVersion: number, offsetMilliseconds: number) {
  return { expectedVersion, at: at(offsetMilliseconds) };
}

function at(offsetMilliseconds: number): string {
  return new Date(Date.parse(epoch) + offsetMilliseconds).toISOString();
}

function domainError(code: string): (error: unknown) => boolean {
  return (error) => error instanceof DomainError && error.code === code;
}
