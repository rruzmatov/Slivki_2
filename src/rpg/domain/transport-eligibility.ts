import type { StructuralConditionSnapshot } from "./transport-condition";
import { StructuralCondition } from "./transport-condition";
import { assertSafeInteger, assertTransportIdentifier, timestampMilliseconds } from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";
import type { VehicleCapability, VehicleCapabilityCode } from "./transport";
import type { VehicleCapabilityRegistry } from "./transport-registry";
import type { VehicleOperationalState } from "./transport-state-machine";

export interface RequirementEvaluationDecision {
  readonly passed: boolean;
  readonly failedRequirementCodes: readonly string[];
}

export interface PermissionEvaluationDecision {
  readonly permission: string;
  readonly allowed: boolean;
}

export interface TransportEligibilityCriteria {
  readonly requiredCapabilities: readonly VehicleCapabilityCode[];
  readonly allowedStates: readonly VehicleOperationalState[];
  readonly minimumHealthPercent: number;
}

export interface TransportEligibilityInput {
  readonly vehicleId: string;
  readonly capabilities: readonly VehicleCapability[];
  readonly operationalState: VehicleOperationalState;
  readonly condition: StructuralConditionSnapshot;
  readonly requirements: RequirementEvaluationDecision;
  readonly permission: PermissionEvaluationDecision;
  readonly criteria: TransportEligibilityCriteria;
}

export type TransportEligibilityFailureCode =
  | "capability_missing"
  | "requirement_failed"
  | "permission_denied"
  | "operational_state_forbidden"
  | "vehicle_broken"
  | "condition_insufficient";

export interface TransportEligibilityDecision {
  readonly eligible: boolean;
  readonly failureCodes: readonly TransportEligibilityFailureCode[];
  readonly missingCapabilities: readonly VehicleCapabilityCode[];
  readonly failedRequirementCodes: readonly string[];
  readonly requiredPermission: string;
}

export interface WorkEligibilityInput extends TransportEligibilityInput {
  readonly workCode: string;
}

export interface TravelEligibilityInput extends TransportEligibilityInput {
  readonly routeCode: string;
}

export class TransportEligibilityPolicy {
  constructor(private readonly capabilityRegistry: VehicleCapabilityRegistry) {}

  evaluate(input: TransportEligibilityInput): TransportEligibilityDecision {
    validateEligibilityInput(input);
    const missingCapabilities = this.capabilityRegistry.missingCapabilities(
      input.capabilities,
      input.criteria.requiredCapabilities
    );
    const condition = StructuralCondition.restore(input.condition);
    const healthPercent = Math.floor((condition.currentHealth * 100) / condition.maximumHealth);
    const failureCodes = new Set<TransportEligibilityFailureCode>();
    if (missingCapabilities.length > 0) failureCodes.add("capability_missing");
    if (!input.requirements.passed) failureCodes.add("requirement_failed");
    if (!input.permission.allowed) failureCodes.add("permission_denied");
    if (!input.criteria.allowedStates.includes(input.operationalState)) failureCodes.add("operational_state_forbidden");
    if (condition.broken) failureCodes.add("vehicle_broken");
    if (healthPercent < input.criteria.minimumHealthPercent) failureCodes.add("condition_insufficient");
    return Object.freeze({
      eligible: failureCodes.size === 0,
      failureCodes: Object.freeze([...failureCodes]),
      missingCapabilities: Object.freeze(missingCapabilities),
      failedRequirementCodes: Object.freeze([...input.requirements.failedRequirementCodes]),
      requiredPermission: input.permission.permission
    });
  }

  assertEligible(decision: TransportEligibilityDecision): void {
    if (!decision.eligible) {
      throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_DENIED", {
        failures: decision.failureCodes.join(","),
        permission: decision.requiredPermission
      });
    }
  }
}

export class WorkEligibilityPolicy {
  constructor(private readonly transportEligibility: TransportEligibilityPolicy) {}

  evaluate(input: WorkEligibilityInput): TransportEligibilityDecision {
    assertTransportIdentifier(input.workCode, "workCode");
    return this.transportEligibility.evaluate(input);
  }
}

export class TravelEligibilityPolicy {
  constructor(private readonly transportEligibility: TransportEligibilityPolicy) {}

  evaluate(input: TravelEligibilityInput): TransportEligibilityDecision {
    assertTransportIdentifier(input.routeCode, "routeCode");
    return this.transportEligibility.evaluate(input);
  }
}

export interface ActiveVehicle {
  readonly vehicleId: string;
  readonly activatedAt: string;
  readonly selectionVersion: number;
}

export class ActiveVehiclePolicy {
  select(
    current: ActiveVehicle | undefined,
    candidateVehicleId: string,
    decision: TransportEligibilityDecision,
    activatedAt: string
  ): ActiveVehicle {
    assertTransportIdentifier(candidateVehicleId, "candidateVehicleId");
    timestampMilliseconds(activatedAt, "activatedAt");
    if (!decision.eligible) {
      throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_DENIED", {
        vehicleId: candidateVehicleId,
        failures: decision.failureCodes.join(",")
      });
    }
    if (current) {
      assertTransportIdentifier(current.vehicleId, "activeVehicle.vehicleId");
      timestampMilliseconds(current.activatedAt, "activeVehicle.activatedAt");
      assertSafeInteger(current.selectionVersion, "selectionVersion", "TRANSPORT_ACTIVE_VEHICLE_INVALID", 1);
    }
    return Object.freeze({
      vehicleId: candidateVehicleId,
      activatedAt,
      selectionVersion: (current?.selectionVersion ?? 0) + 1
    });
  }
}

function validateEligibilityInput(input: TransportEligibilityInput): void {
  assertTransportIdentifier(input.vehicleId, "vehicleId");
  assertTransportIdentifier(input.permission.permission, "permission");
  assertSafeInteger(
    input.criteria.minimumHealthPercent,
    "minimumHealthPercent",
    "TRANSPORT_ELIGIBILITY_INVALID",
    0,
    100
  );
  if (input.criteria.allowedStates.length === 0 || new Set(input.criteria.allowedStates).size !== input.criteria.allowedStates.length) {
    throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "allowedStates" });
  }
  const operationalStates: readonly VehicleOperationalState[] = [
    "available", "in_use", "under_maintenance", "under_repair", "out_of_service", "retired"
  ];
  if (input.criteria.allowedStates.some((state) => !operationalStates.includes(state))) {
    throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "allowedStates" });
  }
  for (const code of input.criteria.requiredCapabilities) assertTransportIdentifier(code, "requiredCapability");
  if (new Set(input.criteria.requiredCapabilities).size !== input.criteria.requiredCapabilities.length) {
    throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "requiredCapabilities" });
  }
  for (const code of input.requirements.failedRequirementCodes) assertTransportIdentifier(code, "failedRequirementCode");
  if (input.requirements.passed && input.requirements.failedRequirementCodes.length > 0) {
    throw TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_INVALID", { field: "requirements" });
  }
}
