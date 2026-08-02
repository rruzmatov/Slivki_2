import {
  assertNonEmptyReason,
  assertSafeInteger,
  assertTimestampOrder,
  assertTransportIdentifier,
  timestampMilliseconds
} from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";

export type UsageLifecycle = "planned" | "active" | "completed" | "cancelled";

export interface UsagePurpose {
  readonly code: string;
  readonly targetId?: string;
}

export interface VehicleUsageSnapshot {
  readonly usageId: string;
  readonly vehicleId: string;
  readonly purpose: UsagePurpose;
  readonly lifecycle: UsageLifecycle;
  readonly plannedDistanceMeters: number;
  readonly actualDistanceMeters?: number;
  readonly plannedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
  readonly cancellationReasonCode?: string;
  readonly version: number;
}

export interface PlanVehicleUsageInput {
  readonly usageId: string;
  readonly vehicleId: string;
  readonly purpose: UsagePurpose;
  readonly plannedDistanceMeters: number;
  readonly plannedAt: string;
}

export class VehicleUsage {
  private constructor(private readonly value: VehicleUsageSnapshot) {
    Object.freeze(this.value.purpose);
    Object.freeze(this.value);
    Object.freeze(this);
  }

  static plan(input: PlanVehicleUsageInput): VehicleUsage {
    assertTransportIdentifier(input.usageId, "usageId");
    assertTransportIdentifier(input.vehicleId, "vehicleId");
    validatePurpose(input.purpose);
    assertSafeInteger(input.plannedDistanceMeters, "plannedDistanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID", 1);
    timestampMilliseconds(input.plannedAt, "plannedAt");
    return new VehicleUsage({ ...input, purpose: { ...input.purpose }, lifecycle: "planned", version: 1 });
  }

  static restore(snapshot: VehicleUsageSnapshot): VehicleUsage {
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

  get lifecycle(): UsageLifecycle {
    return this.value.lifecycle;
  }

  get usageId(): string {
    return this.value.usageId;
  }

  get vehicleId(): string {
    return this.value.vehicleId;
  }

  start(startedAt: string): VehicleUsage {
    this.assertLifecycle("planned");
    assertTimestampOrder(this.value.plannedAt, startedAt, "startedAt");
    return new VehicleUsage({ ...this.value, lifecycle: "active", startedAt, version: this.value.version + 1 });
  }

  complete(actualDistanceMeters: number, completedAt: string): VehicleUsage {
    this.assertLifecycle("active");
    assertSafeInteger(actualDistanceMeters, "actualDistanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID");
    assertTimestampOrder(this.value.startedAt as string, completedAt, "completedAt");
    return new VehicleUsage({
      ...this.value,
      lifecycle: "completed",
      actualDistanceMeters,
      completedAt,
      version: this.value.version + 1
    });
  }

  cancel(reasonCode: string, cancelledAt: string): VehicleUsage {
    if (this.lifecycle !== "planned" && this.lifecycle !== "active") {
      throw TransportErrorFactory.create("TRANSPORT_USAGE_TRANSITION_FORBIDDEN", {
        from: this.lifecycle,
        to: "cancelled"
      });
    }
    const normalizedReason = assertNonEmptyReason(reasonCode, "TRANSPORT_USAGE_REASON_REQUIRED");
    assertTimestampOrder(this.value.startedAt ?? this.value.plannedAt, cancelledAt, "cancelledAt");
    return new VehicleUsage({
      ...this.value,
      lifecycle: "cancelled",
      cancellationReasonCode: normalizedReason,
      cancelledAt,
      version: this.value.version + 1
    });
  }

  snapshot(): VehicleUsageSnapshot {
    return cloneSnapshot(this.value);
  }

  private assertLifecycle(expected: UsageLifecycle): void {
    if (this.lifecycle !== expected) {
      throw TransportErrorFactory.create("TRANSPORT_USAGE_TRANSITION_FORBIDDEN", {
        from: this.lifecycle,
        to: expected
      });
    }
  }
}

function validatePurpose(purpose: UsagePurpose): void {
  assertTransportIdentifier(purpose.code, "purpose.code");
  if (purpose.targetId !== undefined) assertTransportIdentifier(purpose.targetId, "purpose.targetId");
}

function validateUsageSnapshot(snapshot: VehicleUsageSnapshot): void {
  assertSafeInteger(snapshot.version, "usage.version", "TRANSPORT_USAGE_INVALID", 1);
  if (snapshot.lifecycle === "planned") {
    if (snapshot.startedAt || snapshot.completedAt || snapshot.cancelledAt) usageInvariant(snapshot.lifecycle);
    return;
  }
  if (snapshot.lifecycle === "active") {
    if (!snapshot.startedAt || snapshot.completedAt || snapshot.cancelledAt) usageInvariant(snapshot.lifecycle);
    assertTimestampOrder(snapshot.plannedAt, snapshot.startedAt, "startedAt");
    return;
  }
  if (snapshot.lifecycle === "completed") {
    if (!snapshot.startedAt || !snapshot.completedAt || snapshot.actualDistanceMeters === undefined || snapshot.cancelledAt) {
      usageInvariant(snapshot.lifecycle);
    }
    assertSafeInteger(snapshot.actualDistanceMeters, "actualDistanceMeters", "TRANSPORT_USAGE_DISTANCE_INVALID");
    assertTimestampOrder(snapshot.plannedAt, snapshot.startedAt, "startedAt");
    assertTimestampOrder(snapshot.startedAt, snapshot.completedAt, "completedAt");
    return;
  }
  if (!snapshot.cancelledAt || !snapshot.cancellationReasonCode || snapshot.completedAt) usageInvariant(snapshot.lifecycle);
  assertNonEmptyReason(snapshot.cancellationReasonCode, "TRANSPORT_USAGE_REASON_REQUIRED");
  if (snapshot.startedAt) assertTimestampOrder(snapshot.plannedAt, snapshot.startedAt, "startedAt");
  assertTimestampOrder(snapshot.startedAt ?? snapshot.plannedAt, snapshot.cancelledAt, "cancelledAt");
}

function usageInvariant(lifecycle: UsageLifecycle): never {
  throw TransportErrorFactory.create("TRANSPORT_USAGE_INVALID", { lifecycle });
}

function cloneSnapshot(snapshot: VehicleUsageSnapshot): VehicleUsageSnapshot {
  return Object.freeze({ ...snapshot, purpose: Object.freeze({ ...snapshot.purpose }) });
}
