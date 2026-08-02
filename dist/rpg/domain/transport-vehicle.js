"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VehicleAggregate = void 0;
exports.validateVehicleState = validateVehicleState;
const transport_condition_1 = require("./transport-condition");
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
const transport_maintenance_1 = require("./transport-maintenance");
const transport_mileage_1 = require("./transport-mileage");
const transport_repair_1 = require("./transport-repair");
const transport_state_machine_1 = require("./transport-state-machine");
const transport_usage_1 = require("./transport-usage");
class VehicleAggregate {
    state;
    stateMachine;
    constructor(state, stateMachine = new transport_state_machine_1.VehicleStateMachine()) {
        this.state = state;
        this.stateMachine = stateMachine;
        validateVehicleState(state);
    }
    static create(input) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.vehicleId, "vehicleId");
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.productId, "productId");
        (0, transport_domain_validation_1.timestampMilliseconds)(input.createdAt, "createdAt");
        const condition = transport_condition_1.StructuralCondition.pristine(input.maximumStructuralHealth);
        return new VehicleAggregate({
            vehicleId: input.vehicleId,
            productId: input.productId,
            operationalState: "available",
            mileage: transport_mileage_1.Mileage.zero().serialize(),
            condition: condition.snapshot(),
            maintenanceSchedule: input.maintenanceSchedule.snapshot(),
            usageCount: 0,
            version: 1,
            updatedAt: input.createdAt
        });
    }
    static restore(state) {
        return new VehicleAggregate(cloneVehicleState(state));
    }
    snapshot() {
        return cloneVehicleState(this.state);
    }
    assertExpectedVersion(expectedVersion) {
        (0, transport_domain_validation_1.assertSafeInteger)(expectedVersion, "expectedVersion", "TRANSPORT_VEHICLE_VERSION_INVALID", 1);
        if (expectedVersion !== this.state.version) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_VEHICLE_VERSION_CONFLICT", {
                expectedVersion,
                actualVersion: this.state.version
            });
        }
    }
    startUsage(input, eligibility, context) {
        this.assertMutationContext(context);
        if (this.state.activeUsage) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_USAGE_ALREADY_ACTIVE", { vehicleId: this.state.vehicleId });
        }
        this.assertAvailableForUse();
        assertEligibility(eligibility);
        const usage = transport_usage_1.VehicleUsage.plan({
            usageId: input.usageId,
            vehicleId: this.state.vehicleId,
            purpose: input.purpose,
            plannedDistanceMeters: input.plannedDistanceMeters,
            plannedAt: context.at
        }).start(context.at);
        const nextState = {
            ...this.state,
            operationalState: this.stateMachine.transition(this.state.operationalState, "in_use"),
            activeUsage: usage.snapshot(),
            version: this.state.version + 1,
            updatedAt: context.at
        };
        this.replaceState(nextState);
        return usage.snapshot();
    }
    completeUsage(actualDistanceMeters, damagePolicy, wearProfile, context) {
        this.assertMutationContext(context);
        const activeUsage = this.getActiveUsage();
        const completedUsage = activeUsage.complete(actualDistanceMeters, context.at);
        const mileage = transport_mileage_1.Mileage.restore(this.state.mileage).advance(actualDistanceMeters);
        const condition = transport_condition_1.StructuralCondition.restore(this.state.condition);
        const damage = damagePolicy.applyUsage(condition, actualDistanceMeters, wearProfile);
        const nextOperationalState = damage.broken ? "out_of_service" : "available";
        const nextState = {
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
    cancelUsage(reasonCode, context) {
        this.assertMutationContext(context);
        const cancelledUsage = this.getActiveUsage().cancel(reasonCode, context.at);
        const nextState = {
            ...this.state,
            operationalState: this.stateMachine.transition(this.state.operationalState, "available"),
            activeUsage: undefined,
            version: this.state.version + 1,
            updatedAt: context.at
        };
        this.replaceState(nextState);
        return Object.freeze({ usage: cancelledUsage.snapshot(), vehicle: this.snapshot() });
    }
    beginMaintenance(quote, context) {
        this.assertMutationContext(context);
        this.assertAvailableForService();
        (0, transport_maintenance_1.validateMaintenanceQuote)(quote);
        const startedAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(context.at, "startedAt");
        if (quote.vehicleId !== this.state.vehicleId || quote.scheduleVersion !== this.state.maintenanceSchedule.version ||
            startedAtMs < (0, transport_domain_validation_1.timestampMilliseconds)(quote.createdAt, "createdAt") ||
            startedAtMs > (0, transport_domain_validation_1.timestampMilliseconds)(quote.expiresAt, "expiresAt")) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
        }
        const nextState = {
            ...this.state,
            operationalState: this.stateMachine.transition(this.state.operationalState, "under_maintenance"),
            activeMaintenance: { quoteId: quote.quoteId, taskCodes: quote.taskCodes, startedAt: context.at },
            version: this.state.version + 1,
            updatedAt: context.at
        };
        this.replaceState(nextState);
        return this.snapshot();
    }
    completeMaintenance(quote, policy, context) {
        this.assertMutationContext(context);
        if (this.state.operationalState !== "under_maintenance" || this.state.activeMaintenance?.quoteId !== quote.quoteId) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
                from: this.state.operationalState,
                to: "available"
            });
        }
        const schedule = transport_maintenance_1.MaintenanceSchedule.restore(this.state.maintenanceSchedule);
        const maintenance = policy.complete(schedule, quote, {
            at: context.at,
            mileageMeters: this.state.mileage.meters,
            usageCount: this.state.usageCount
        });
        const nextState = {
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
    beginRepair(quote, context) {
        this.assertMutationContext(context);
        this.assertAvailableForService();
        (0, transport_repair_1.validateRepairQuote)(quote);
        const startedAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(context.at, "startedAt");
        if (quote.vehicleId !== this.state.vehicleId || !sameCondition(this.state.condition, quote.conditionAtQuote) ||
            startedAtMs < (0, transport_domain_validation_1.timestampMilliseconds)(quote.createdAt, "createdAt") ||
            startedAtMs > (0, transport_domain_validation_1.timestampMilliseconds)(quote.expiresAt, "expiresAt")) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
        }
        const nextState = {
            ...this.state,
            operationalState: this.stateMachine.transition(this.state.operationalState, "under_repair"),
            activeRepair: { quoteId: quote.quoteId, reasonCode: quote.reasonCode, startedAt: context.at },
            version: this.state.version + 1,
            updatedAt: context.at
        };
        this.replaceState(nextState);
        return this.snapshot();
    }
    completeRepair(quote, policy, context) {
        this.assertMutationContext(context);
        if (this.state.operationalState !== "under_repair" || this.state.activeRepair?.quoteId !== quote.quoteId) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
                from: this.state.operationalState,
                to: "available"
            });
        }
        const repair = policy.complete(transport_condition_1.StructuralCondition.restore(this.state.condition), quote, context.at);
        const nextState = {
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
    markOutOfService(reasonCode, context) {
        this.assertMutationContext(context);
        const reason = (0, transport_domain_validation_1.assertNonEmptyReason)(reasonCode, "TRANSPORT_STATE_INVALID");
        if (this.state.activeUsage || this.state.activeMaintenance || this.state.activeRepair) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_INVARIANT_VIOLATION", { vehicleId: this.state.vehicleId });
        }
        const nextState = {
            ...this.state,
            operationalState: this.stateMachine.transition(this.state.operationalState, "out_of_service"),
            outOfServiceReasonCode: reason,
            version: this.state.version + 1,
            updatedAt: context.at
        };
        this.replaceState(nextState);
        return this.snapshot();
    }
    retire(reasonCode, context) {
        this.assertMutationContext(context);
        const reason = (0, transport_domain_validation_1.assertNonEmptyReason)(reasonCode, "TRANSPORT_STATE_INVALID");
        const nextState = {
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
    assertMutationContext(context) {
        this.assertExpectedVersion(context.expectedVersion);
        (0, transport_domain_validation_1.assertTimestampOrder)(this.state.updatedAt, context.at, "mutation.at");
    }
    assertAvailableForUse() {
        const condition = transport_condition_1.StructuralCondition.restore(this.state.condition);
        if (condition.broken)
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_VEHICLE_BROKEN", { vehicleId: this.state.vehicleId });
        if (this.state.operationalState !== "available") {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
                from: this.state.operationalState,
                to: "in_use"
            });
        }
    }
    assertAvailableForService() {
        if (this.state.operationalState !== "available") {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", {
                from: this.state.operationalState,
                to: "under_repair"
            });
        }
    }
    getActiveUsage() {
        if (this.state.operationalState !== "in_use" || !this.state.activeUsage) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_USAGE_NOT_ACTIVE", { vehicleId: this.state.vehicleId });
        }
        return transport_usage_1.VehicleUsage.restore(this.state.activeUsage);
    }
    replaceState(nextState) {
        validateVehicleState(nextState);
        this.state = cloneVehicleState(nextState);
    }
}
exports.VehicleAggregate = VehicleAggregate;
function validateVehicleState(state) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(state.vehicleId, "vehicleId");
    (0, transport_domain_validation_1.assertTransportIdentifier)(state.productId, "productId");
    assertOperationalState(state.operationalState);
    const mileage = transport_mileage_1.Mileage.restore(state.mileage);
    const condition = transport_condition_1.StructuralCondition.restore(state.condition);
    transport_maintenance_1.MaintenanceSchedule.restore(state.maintenanceSchedule);
    (0, transport_domain_validation_1.assertSafeInteger)(state.usageCount, "usageCount", "TRANSPORT_STATE_INVALID");
    (0, transport_domain_validation_1.assertSafeInteger)(state.version, "vehicle.version", "TRANSPORT_VEHICLE_VERSION_INVALID", 1);
    (0, transport_domain_validation_1.timestampMilliseconds)(state.updatedAt, "updatedAt");
    if (mileage.meters < 0)
        stateInvariant(state, "mileage");
    const activeUsage = state.activeUsage ? transport_usage_1.VehicleUsage.restore(state.activeUsage) : undefined;
    if ((state.operationalState === "in_use") !== Boolean(activeUsage) ||
        (activeUsage !== undefined && activeUsage.lifecycle !== "active")) {
        stateInvariant(state, "activeUsage");
    }
    if (activeUsage?.vehicleId !== undefined && activeUsage.vehicleId !== state.vehicleId)
        stateInvariant(state, "usageVehicleId");
    if (activeUsage?.snapshot().startedAt) {
        (0, transport_domain_validation_1.assertTimestampOrder)(activeUsage.snapshot().startedAt, state.updatedAt, "updatedAt");
    }
    if ((state.operationalState === "under_maintenance") !== Boolean(state.activeMaintenance)) {
        stateInvariant(state, "activeMaintenance");
    }
    if ((state.operationalState === "under_repair") !== Boolean(state.activeRepair))
        stateInvariant(state, "activeRepair");
    if (state.activeMaintenance)
        validateActiveMaintenance(state.activeMaintenance, state.updatedAt);
    if (state.activeRepair)
        validateActiveRepair(state.activeRepair, state.updatedAt);
    if (condition.broken && state.operationalState !== "out_of_service" && state.operationalState !== "retired") {
        stateInvariant(state, "brokenOperationalState");
    }
    if ((state.operationalState === "out_of_service" || state.operationalState === "retired") !==
        Boolean(state.outOfServiceReasonCode)) {
        stateInvariant(state, "outOfServiceReasonCode");
    }
    if (state.outOfServiceReasonCode) {
        (0, transport_domain_validation_1.assertNonEmptyReason)(state.outOfServiceReasonCode, "TRANSPORT_STATE_INVALID", "outOfServiceReasonCode");
    }
    if ((state.operationalState === "retired") !== Boolean(state.retiredAt))
        stateInvariant(state, "retiredAt");
    if (state.retiredAt && state.retiredAt !== state.updatedAt)
        stateInvariant(state, "retiredAt");
}
function validateActiveMaintenance(active, updatedAt) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(active.quoteId, "activeMaintenance.quoteId");
    if (active.taskCodes.length === 0 || new Set(active.taskCodes).size !== active.taskCodes.length) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_INVARIANT_VIOLATION", { field: "activeMaintenance.taskCodes" });
    }
    for (const code of active.taskCodes)
        (0, transport_domain_validation_1.assertTransportIdentifier)(code, "activeMaintenance.taskCode");
    (0, transport_domain_validation_1.assertTimestampOrder)(active.startedAt, updatedAt, "updatedAt");
}
function validateActiveRepair(active, updatedAt) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(active.quoteId, "activeRepair.quoteId");
    (0, transport_domain_validation_1.assertNonEmptyReason)(active.reasonCode, "TRANSPORT_REPAIR_REASON_REQUIRED");
    (0, transport_domain_validation_1.assertTimestampOrder)(active.startedAt, updatedAt, "updatedAt");
}
function assertOperationalState(value) {
    if (!["available", "in_use", "under_maintenance", "under_repair", "out_of_service", "retired"].includes(value)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_INVALID", { operationalState: value });
    }
}
function assertEligibility(decision) {
    if (!decision.eligible) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ELIGIBILITY_DENIED", {
            failures: decision.failureCodes.join(",")
        });
    }
}
function stateInvariant(state, field) {
    throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_INVARIANT_VIOLATION", {
        vehicleId: state.vehicleId,
        field
    });
}
function sameCondition(left, right) {
    return left.maximumHealth === right.maximumHealth &&
        left.currentHealth === right.currentHealth &&
        left.accumulatedWear === right.accumulatedWear;
}
function cloneVehicleState(state) {
    return Object.freeze({
        ...state,
        mileage: Object.freeze({ ...state.mileage }),
        condition: Object.freeze({ ...state.condition }),
        maintenanceSchedule: Object.freeze({
            version: state.maintenanceSchedule.version,
            checkpoints: Object.freeze(state.maintenanceSchedule.checkpoints.map((checkpoint) => Object.freeze({ ...checkpoint })))
        }),
        activeUsage: state.activeUsage ? transport_usage_1.VehicleUsage.restore(state.activeUsage).snapshot() : undefined,
        activeMaintenance: state.activeMaintenance
            ? Object.freeze({ ...state.activeMaintenance, taskCodes: Object.freeze([...state.activeMaintenance.taskCodes]) })
            : undefined,
        activeRepair: state.activeRepair ? Object.freeze({ ...state.activeRepair }) : undefined
    });
}
