import {
  StructuralCondition,
  type StructuralDamagePolicy,
  type StructuralConditionSnapshot,
  type StructuralDamageResult,
  type StructuralWearProfile
} from "./transport-condition";
import {
  assertNonEmptyReason,
  assertSafeInteger,
  assertTimestampOrder,
  assertTransportIdentifier,
  timestampMilliseconds
} from "./transport-domain-validation";
import type { TransportEligibilityDecision } from "./transport-eligibility";
import { TransportErrorFactory } from "./transport-errors";
import {
  type MaintenancePolicy,
  MaintenanceSchedule,
  type MaintenanceQuote,
  type MaintenanceResult,
  type MaintenanceScheduleSnapshot,
  validateMaintenanceQuote
} from "./transport-maintenance";
import { Mileage, type MileageSnapshot } from "./transport-mileage";
import { type RepairPolicy, type RepairQuote, type RepairResult, validateRepairQuote } from "./transport-repair";
import { VehicleStateMachine, type VehicleOperationalState } from "./transport-state-machine";
import { VehicleUsage, type UsagePurpose, type VehicleUsageSnapshot } from "./transport-usage";

export interface ActiveMaintenance {
  readonly quoteId: string;
  readonly taskCodes: readonly string[];
  readonly startedAt: string;
}

export interface ActiveRepair {
  readonly quoteId: string;
  readonly reasonCode: string;
  readonly startedAt: string;
}

export interface VehicleState {
  readonly vehicleId: string;
  readonly productId: string;
  readonly operationalState: VehicleOperationalState;
  readonly mileage: MileageSnapshot;
  readonly condition: StructuralConditionSnapshot;
  readonly maintenanceSchedule: MaintenanceScheduleSnapshot;
  readonly activeUsage?: VehicleUsageSnapshot;
  readonly activeMaintenance?: ActiveMaintenance;
  readonly activeRepair?: ActiveRepair;
  readonly usageCount: number;
  readonly outOfServiceReasonCode?: string;
  readonly retiredAt?: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface CreateVehicleInput {
  readonly vehicleId: string;
  readonly productId: string;
  readonly maximumStructuralHealth: number;
  readonly maintenanceSchedule: MaintenanceSchedule;
  readonly createdAt: string;
}

export interface VehicleMutationContext {
  readonly expectedVersion: number;
  readonly at: string;
}

export interface StartVehicleUsageInput {
  readonly usageId: string;
  readonly purpose: UsagePurpose;
  readonly plannedDistanceMeters: number;
}

export interface CompleteVehicleUsageResult {
  readonly usage: VehicleUsageSnapshot;
  readonly damage: StructuralDamageResult;
  readonly vehicle: VehicleState;
}

export interface CancelVehicleUsageResult {
  readonly usage: VehicleUsageSnapshot;
  readonly vehicle: VehicleState;
}

export interface CompleteVehicleMaintenanceResult {
  readonly maintenance: MaintenanceResult;
  readonly vehicle: VehicleState;
}

export interface CompleteVehicleRepairResult {
  readonly repair: RepairResult;
  readonly vehicle: VehicleState;
}

export class VehicleAggregate {
  private constructor(private state: VehicleState, private readonly stateMachine = new VehicleStateMachine()) {
    validateVehicleState(state);
  }

  static create(input: CreateVehicleInput): VehicleAggregate {
    assertTransportIdentifier(input.vehicleId, "vehicleId");
    assertTransportIdentifier(input.productId, "productId");
    timestampMilliseconds(input.createdAt, "createdAt");
    const condition = StructuralCondition.pristine(input.maximumStructuralHealth);
    return new VehicleAggregate({
      vehicleId: input.vehicleId,
      productId: input.productId,
      operationalState: "available",
      mileage: Mileage.zero().serialize(),
      condition: condition.snapshot(),
      maintenanceSchedule: input.maintenanceSchedule.snapshot(),
      usageCount: 0,
      version: 1,
      updatedAt: input.createdAt
    });
  }

  static restore(state: VehicleState): VehicleAggregate {
    return new VehicleAggregate(cloneVehicleState(state));
  }

  snapshot(): VehicleState {
    return cloneVehicleState(this.state);
  }

  assertExpectedVersion(expectedVersion: number): void {
    assertSafeInteger(expectedVersion, "expectedVersion", "TRANSPORT_VEHICLE_VERSION_INVALID", 1);
    if (expectedVersion !== this.state.version) {
      throw TransportErrorFactory.create("TRANSPORT_VEHICLE_VERSION_CONFLICT", {
        expectedVersion,
        actualVersion: this.state.version
      });
    }
  }

  startUsage(
    input: StartVehicleUsageInput,
    eligibility: TransportEligibilityDecision,
    context: VehicleMutationContext
  ): VehicleUsageSnapshot {
    this.assertMutationContext(context);
    if (this.state.activeUsage) {
      throw TransportErrorFactory.create("TRANSPORT_USAGE_ALREADY_ACTIVE", { vehicleId: this.state.vehicleId });
    }
    this.assertAvailableForUse();
    assertEligibility(eligibility);
    const usage = VehicleUsage.plan({
      usageId: input.usageId,
      vehicleId: this.state.vehicleId,
      purpose: input.purpose,
      plannedDistanceMeters: input.plannedDistanceMeters,
      plannedAt: context.at
    }).start(context.at);
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "in_use"),
      activeUsage: usage.snapshot(),
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return usage.snapshot();
  }

  completeUsage(
    actualDistanceMeters: number,
    damagePolicy: StructuralDamagePolicy,
    wearProfile: StructuralWearProfile,
    context: VehicleMutationContext
  ): CompleteVehicleUsageResult {
    this.assertMutationContext(context);
    const activeUsage = this.getActiveUsage();
    const completedUsage = activeUsage.complete(actualDistanceMeters, context.at);
    const mileage = Mileage.restore(this.state.mileage).advance(actualDistanceMeters);
    const condition = StructuralCondition.restore(this.state.condition);
    const damage = damagePolicy.applyUsage(condition, actualDistanceMeters, wearProfile);
    const nextOperationalState = damage.broken ? "out_of_service" : "available";
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, nextOperationalState),
      mileage: mileage.serialize(),
      condition: damage.after,
      activeUsage: undefined,
      usageCount: this.state.usageCount + 1,
      outOfServiceReasonCode: damage.broken ? "structural_failure" : undefined,
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return Object.freeze({ usage: completedUsage.snapshot(), damage, vehicle: this.snapshot() });
  }

  cancelUsage(reasonCode: string, context: VehicleMutationContext): CancelVehicleUsageResult {
    this.assertMutationContext(context);
    const cancelledUsage = this.getActiveUsage().cancel(reasonCode, context.at);
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "available"),
      activeUsage: undefined,
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return Object.freeze({ usage: cancelledUsage.snapshot(), vehicle: this.snapshot() });
  }

  beginMaintenance(quote: MaintenanceQuote, context: VehicleMutationContext): VehicleState {
    this.assertMutationContext(context);
    this.assertAvailableForService();
    validateMaintenanceQuote(quote);
    const startedAtMs = timestampMilliseconds(context.at, "startedAt");
    if (quote.vehicleId !== this.state.vehicleId || quote.scheduleVersion !== this.state.maintenanceSchedule.version ||
      startedAtMs < timestampMilliseconds(quote.createdAt, "createdAt") ||
      startedAtMs > timestampMilliseconds(quote.expiresAt, "expiresAt")) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "under_maintenance"),
      activeMaintenance: { quoteId: quote.quoteId, taskCodes: quote.taskCodes, startedAt: context.at },
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return this.snapshot();
  }

  completeMaintenance(
    quote: MaintenanceQuote,
    policy: MaintenancePolicy,
    context: VehicleMutationContext
  ): CompleteVehicleMaintenanceResult {
    this.assertMutationContext(context);
    if (this.state.operationalState !== "under_maintenance" || this.state.activeMaintenance?.quoteId !== quote.quoteId) {
      throw TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
        from: this.state.operationalState,
        to: "available"
      });
    }
    const schedule = MaintenanceSchedule.restore(this.state.maintenanceSchedule);
    const maintenance = policy.complete(schedule, quote, {
      at: context.at,
      mileageMeters: this.state.mileage.meters,
      usageCount: this.state.usageCount
    });
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "available"),
      maintenanceSchedule: maintenance.scheduleAfter,
      activeMaintenance: undefined,
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return Object.freeze({ maintenance, vehicle: this.snapshot() });
  }

  beginRepair(quote: RepairQuote, context: VehicleMutationContext): VehicleState {
    this.assertMutationContext(context);
    this.assertAvailableForService();
    validateRepairQuote(quote);
    const startedAtMs = timestampMilliseconds(context.at, "startedAt");
    if (quote.vehicleId !== this.state.vehicleId || !sameCondition(this.state.condition, quote.conditionAtQuote) ||
      startedAtMs < timestampMilliseconds(quote.createdAt, "createdAt") ||
      startedAtMs > timestampMilliseconds(quote.expiresAt, "expiresAt")) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "under_repair"),
      activeRepair: { quoteId: quote.quoteId, reasonCode: quote.reasonCode, startedAt: context.at },
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return this.snapshot();
  }

  completeRepair(
    quote: RepairQuote,
    policy: RepairPolicy,
    context: VehicleMutationContext
  ): CompleteVehicleRepairResult {
    this.assertMutationContext(context);
    if (this.state.operationalState !== "under_repair" || this.state.activeRepair?.quoteId !== quote.quoteId) {
      throw TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
        from: this.state.operationalState,
        to: "available"
      });
    }
    const repair = policy.complete(StructuralCondition.restore(this.state.condition), quote, context.at);
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "available"),
      condition: repair.after,
      activeRepair: undefined,
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return Object.freeze({ repair, vehicle: this.snapshot() });
  }

  markOutOfService(reasonCode: string, context: VehicleMutationContext): VehicleState {
    this.assertMutationContext(context);
    const reason = assertNonEmptyReason(reasonCode, "TRANSPORT_STATE_INVALID");
    if (this.state.activeUsage || this.state.activeMaintenance || this.state.activeRepair) {
      throw TransportErrorFactory.create("TRANSPORT_STATE_INVARIANT_VIOLATION", { vehicleId: this.state.vehicleId });
    }
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "out_of_service"),
      outOfServiceReasonCode: reason,
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return this.snapshot();
  }

  retire(reasonCode: string, context: VehicleMutationContext): VehicleState {
    this.assertMutationContext(context);
    const reason = assertNonEmptyReason(reasonCode, "TRANSPORT_STATE_INVALID");
    const nextState: VehicleState = {
      ...this.state,
      operationalState: this.stateMachine.transition(this.state.operationalState, "retired"),
      outOfServiceReasonCode: reason,
      retiredAt: context.at,
      version: this.state.version + 1,
      updatedAt: context.at
    };
    this.replaceState(nextState);
    return this.snapshot();
  }

  private assertMutationContext(context: VehicleMutationContext): void {
    this.assertExpectedVersion(context.expectedVersion);
    assertTimestampOrder(this.state.updatedAt, context.at, "mutation.at");
  }

  private assertAvailableForUse(): void {
    const condition = StructuralCondition.restore(this.state.condition);
    if (condition.broken) throw TransportErrorFactory.create("TRANSPORT_VEHICLE_BROKEN", { vehicleId: this.state.vehicleId });
    if (this.state.operationalState !== "available") {
      throw TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
        from: this.state.operationalState,
        to: "in_use"
      });
    }
  }

  private assertAvailableForService(): void {
    if (this.state.operationalState !== "available") {
      throw TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
        from: this.state.operationalState,
        to: "under_repair"
      });
    }
  }

  private getActiveUsage(): VehicleUsage {
    if (this.state.operationalState !== "in_use" || !this.state.activeUsage) {
      throw TransportErrorFactory.create("TRANSPORT_USAGE_NOT_ACTIVE", { vehicleId: this.state.vehicleId });
    }
    return VehicleUsage.restore(this.state.activeUsage);
  }

  private replaceState(nextState: VehicleState): void {
    validateVehicleState(nextState);
    this.state = cloneVehicleState(nextState);
  }
}

export function validateVehicleState(state: VehicleState): void {
  assertTransportIdentifier(state.vehicleId, "vehicleId");
  assertTransportIdentifier(state.productId, "productId");
  assertOperationalState(state.operationalState);
  const mileage = Mileage.restore(state.mileage);
  const condition = StructuralCondition.restore(state.condition);
  MaintenanceSchedule.restore(state.maintenanceSchedule);
  assertSafeInteger(state.usageCount, "usageCount", "TRANSPORT_STATE_INVALID");
  assertSafeInteger(state.version, "vehicle.version", "TRANSPORT_VEHICLE_VERSION_INVALID", 1);
  timestampMilliseconds(state.updatedAt, "updatedAt");
  if (mileage.meters < 0) stateInvariant(state, "mileage");

  const activeUsage = state.activeUsage ? VehicleUsage.restore(state.activeUsage) : undefined;
  if ((state.operationalState === "in_use") !== Boolean(activeUsage) ||
    (activeUsage !== undefined && activeUsage.lifecycle !== "active")) {
    stateInvariant(state, "activeUsage");
  }
  if (activeUsage?.vehicleId !== undefined && activeUsage.vehicleId !== state.vehicleId) stateInvariant(state, "usageVehicleId");
  if (activeUsage?.snapshot().startedAt) {
    assertTimestampOrder(activeUsage.snapshot().startedAt as string, state.updatedAt, "updatedAt");
  }
  if ((state.operationalState === "under_maintenance") !== Boolean(state.activeMaintenance)) {
    stateInvariant(state, "activeMaintenance");
  }
  if ((state.operationalState === "under_repair") !== Boolean(state.activeRepair)) stateInvariant(state, "activeRepair");
  if (state.activeMaintenance) validateActiveMaintenance(state.activeMaintenance, state.updatedAt);
  if (state.activeRepair) validateActiveRepair(state.activeRepair, state.updatedAt);
  if (condition.broken && state.operationalState !== "out_of_service" && state.operationalState !== "retired") {
    stateInvariant(state, "brokenOperationalState");
  }
  if ((state.operationalState === "out_of_service" || state.operationalState === "retired") !==
    Boolean(state.outOfServiceReasonCode)) {
    stateInvariant(state, "outOfServiceReasonCode");
  }
  if (state.outOfServiceReasonCode) {
    assertNonEmptyReason(state.outOfServiceReasonCode, "TRANSPORT_STATE_INVALID", "outOfServiceReasonCode");
  }
  if ((state.operationalState === "retired") !== Boolean(state.retiredAt)) stateInvariant(state, "retiredAt");
  if (state.retiredAt && state.retiredAt !== state.updatedAt) stateInvariant(state, "retiredAt");
}

function validateActiveMaintenance(active: ActiveMaintenance, updatedAt: string): void {
  assertTransportIdentifier(active.quoteId, "activeMaintenance.quoteId");
  if (active.taskCodes.length === 0 || new Set(active.taskCodes).size !== active.taskCodes.length) {
    throw TransportErrorFactory.create("TRANSPORT_STATE_INVARIANT_VIOLATION", { field: "activeMaintenance.taskCodes" });
  }
  for (const code of active.taskCodes) assertTransportIdentifier(code, "activeMaintenance.taskCode");
  assertTimestampOrder(active.startedAt, updatedAt, "updatedAt");
}

function validateActiveRepair(active: ActiveRepair, updatedAt: string): void {
  assertTransportIdentifier(active.quoteId, "activeRepair.quoteId");
  assertNonEmptyReason(active.reasonCode, "TRANSPORT_REPAIR_REASON_REQUIRED");
  assertTimestampOrder(active.startedAt, updatedAt, "updatedAt");
}

function assertOperationalState(value: VehicleOperationalState): void {
  if (!["available", "in_use", "under_maintenance", "under_repair", "out_of_service", "retired"].includes(value)) {
    throw TransportErrorFactory.create("TRANSPORT_STATE_INVALID", { operationalState: value });
  }
}

function assertEligibility(decision: TransportEligibilityDecision): void {
  if (!decision.eligible) {
    throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_DENIED", {
      failures: decision.failureCodes.join(",")
    });
  }
}

function stateInvariant(state: VehicleState, field: string): never {
  throw TransportErrorFactory.create("TRANSPORT_STATE_INVARIANT_VIOLATION", {
    vehicleId: state.vehicleId,
    field
  });
}

function sameCondition(left: StructuralConditionSnapshot, right: StructuralConditionSnapshot): boolean {
  return left.maximumHealth === right.maximumHealth &&
    left.currentHealth === right.currentHealth &&
    left.accumulatedWear === right.accumulatedWear;
}

function cloneVehicleState(state: VehicleState): VehicleState {
  return Object.freeze({
    ...state,
    mileage: Object.freeze({ ...state.mileage }),
    condition: Object.freeze({ ...state.condition }),
    maintenanceSchedule: Object.freeze({
      version: state.maintenanceSchedule.version,
      checkpoints: Object.freeze(state.maintenanceSchedule.checkpoints.map((checkpoint) => Object.freeze({ ...checkpoint })))
    }),
    activeUsage: state.activeUsage ? VehicleUsage.restore(state.activeUsage).snapshot() : undefined,
    activeMaintenance: state.activeMaintenance
      ? Object.freeze({ ...state.activeMaintenance, taskCodes: Object.freeze([...state.activeMaintenance.taskCodes]) })
      : undefined,
    activeRepair: state.activeRepair ? Object.freeze({ ...state.activeRepair }) : undefined
  });
}
