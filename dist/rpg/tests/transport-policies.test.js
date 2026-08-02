"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const transport_foundation_1 = require("../data/transport-foundation");
const transport_condition_1 = require("../domain/transport-condition");
const transport_eligibility_1 = require("../domain/transport-eligibility");
const errors_1 = require("../domain/errors");
const transport_maintenance_1 = require("../domain/transport-maintenance");
const transport_pricing_1 = require("../domain/transport-pricing");
const transport_registry_1 = require("../domain/transport-registry");
const transport_repair_1 = require("../domain/transport-repair");
const transport_vehicle_1 = require("../domain/transport-vehicle");
const epoch = "2026-08-02T10:00:00.000Z";
const day = 24 * 60 * 60 * 1_000;
const neutralPricing = {
    currency: "SUM",
    rarityFactorBps: 10_000,
    ageFactorBps: 10_000,
    assetTypeFactorBps: 10_000,
    categoryFactorBps: 10_000,
    economicBalanceFactorBps: 10_000
};
(0, node_test_1.default)("Maintenance supports distance, time, usage, early and critical-overdue intervals", () => {
    const policy = giantMaintenancePolicy();
    const schedule = policy.createSchedule({ at: epoch, mileageMeters: 0, usageCount: 0 });
    strict_1.default.equal(policy.assess(schedule, context(100_000, 10, 10 * day), "chain").status, "not_due");
    strict_1.default.equal(policy.assess(schedule, context(225_000, 20, 20 * day), "chain").status, "eligible");
    strict_1.default.equal(policy.assess(schedule, context(250_000, 50, 30 * day), "chain").status, "due");
    const critical = policy.assess(schedule, context(350_000, 70, 37 * day), "chain");
    strict_1.default.equal(critical.status, "critical_overdue");
    strict_1.default.equal(critical.overdueMultiplierBps, 17_500);
    const overdue = policy.assess(schedule, context(300_000, 60, 31 * day), "chain");
    strict_1.default.equal(overdue.status, "overdue");
    strict_1.default.equal(overdue.overdueMultiplierBps, 12_500);
    strict_1.default.throws(() => policy.createQuote({
        quoteId: "maintenance_early",
        vehicleId: "vehicle_giant_1",
        taskCodes: ["chain"],
        schedule,
        context: context(100_000, 10, 10 * day),
        pricingContext: { ...neutralPricing, baseAmount: 375 },
        createdAt: at(10 * day),
        expiresAt: at(10 * day + 60_000)
    }), domainError("TRANSPORT_MAINTENANCE_NOT_ELIGIBLE"));
    const quote = policy.createQuote({
        quoteId: "maintenance_chain",
        vehicleId: "vehicle_giant_1",
        taskCodes: ["chain"],
        schedule,
        context: context(225_000, 20, 20 * day),
        pricingContext: { ...neutralPricing, baseAmount: 375 },
        createdAt: at(20 * day),
        expiresAt: at(20 * day + 60_000)
    });
    strict_1.default.equal(quote.policyVersion, "1.0.0");
    strict_1.default.equal(quote.cost.amount, 375);
    strict_1.default.throws(() => policy.complete(schedule, {
        ...quote,
        assessments: [{ ...quote.assessments[0], status: "not_due" }]
    }, context(225_000, 20, 20 * day)), domainError("TRANSPORT_MAINTENANCE_QUOTE_INVALID"));
    const result = policy.complete(schedule, quote, context(225_000, 20, 20 * day));
    strict_1.default.equal(result.scheduleAfter.version, 2);
    strict_1.default.equal(result.scheduleAfter.checkpoints[0].mileageMeters, 225_000);
});
(0, node_test_1.default)("Repair requires a reason, preserves policy version and rejects stale condition", () => {
    const damage = new transport_condition_1.StructuralDamagePolicy(0).apply(transport_condition_1.StructuralCondition.pristine(10_000), { damageUnits: 2_000, wearUnits: 0 });
    const repairPolicy = new transport_repair_1.RepairPolicy(new transport_pricing_1.RateBasedRepairPricingPolicy("1.2.0", 1));
    strict_1.default.throws(() => repairPolicy.createQuote({
        quoteId: "repair_invalid",
        vehicleId: "vehicle_giant_1",
        reasonCode: "",
        condition: transport_condition_1.StructuralCondition.restore(damage.after),
        pricingContext: { ...neutralPricing, baseAmount: 2_000 },
        createdAt: epoch,
        expiresAt: at(60_000)
    }), domainError("TRANSPORT_REPAIR_REASON_REQUIRED"));
    const quote = repairPolicy.createQuote({
        quoteId: "repair_frame",
        vehicleId: "vehicle_giant_1",
        reasonCode: "structural_wear",
        condition: transport_condition_1.StructuralCondition.restore(damage.after),
        restoreHealthUnits: 1_000,
        pricingContext: { ...neutralPricing, baseAmount: 2_000 },
        createdAt: epoch,
        expiresAt: at(60_000)
    });
    strict_1.default.equal(quote.policyVersion, "1.2.0");
    strict_1.default.equal(quote.cost.amount, 200);
    const result = repairPolicy.complete(transport_condition_1.StructuralCondition.restore(damage.after), quote, at(30_000));
    strict_1.default.equal(result.after.currentHealth, 9_000);
    strict_1.default.throws(() => repairPolicy.complete(transport_condition_1.StructuralCondition.pristine(10_000), quote, at(30_000)), domainError("TRANSPORT_REPAIR_QUOTE_INVALID"));
});
(0, node_test_1.default)("Pricing strategies use supplied factors without Economy dependencies", () => {
    const resale = new transport_pricing_1.RateBasedResaleValuationPolicy("2.0.0").valuate({
        ...neutralPricing,
        baseAmount: 15_000,
        rarityFactorBps: 11_000,
        conditionFactorBps: 8_000,
        mileageFactorBps: 9_000
    });
    strict_1.default.equal(resale.policyVersion, "2.0.0");
    strict_1.default.equal(resale.totalAmount, 11_880);
    strict_1.default.equal(resale.adjustments.some((adjustment) => adjustment.code === "condition"), true);
    strict_1.default.throws(() => new transport_pricing_1.RateBasedResaleValuationPolicy("current"), domainError("TRANSPORT_POLICY_VERSION_INVALID"));
});
(0, node_test_1.default)("Eligibility uses Capability Registry plus requirement and permission decisions", () => {
    const registry = new transport_registry_1.VehicleCapabilityRegistry(transport_foundation_1.vehicleCapabilityDefinitions);
    const basePolicy = new transport_eligibility_1.TransportEligibilityPolicy(registry);
    const workPolicy = new transport_eligibility_1.WorkEligibilityPolicy(basePolicy);
    const travelPolicy = new transport_eligibility_1.TravelEligibilityPolicy(basePolicy);
    const condition = transport_condition_1.StructuralCondition.pristine(10_000).snapshot();
    const common = {
        vehicleId: "vehicle_giant_1",
        capabilities: transport_foundation_1.giantEscape3Foundation.capabilities,
        operationalState: "available",
        condition,
        requirements: { passed: true, failedRequirementCodes: [] },
        permission: { permission: "use", allowed: true },
        criteria: { requiredCapabilities: ["delivery"], allowedStates: ["available"], minimumHealthPercent: 20 }
    };
    strict_1.default.equal(workPolicy.evaluate({ ...common, workCode: "job_courier" }).eligible, true);
    strict_1.default.equal(travelPolicy.evaluate({ ...common, routeCode: "route_urban" }).eligible, true);
    const denied = workPolicy.evaluate({
        ...common,
        workCode: "job_air_delivery",
        permission: { permission: "use", allowed: false },
        requirements: { passed: false, failedRequirementCodes: ["license_required"] },
        criteria: { ...common.criteria, requiredCapabilities: ["fly"] }
    });
    strict_1.default.equal(denied.eligible, false);
    strict_1.default.deepEqual(denied.failureCodes, ["capability_missing", "requirement_failed", "permission_denied"]);
    strict_1.default.deepEqual(denied.missingCapabilities, ["fly"]);
});
(0, node_test_1.default)("Active Vehicle selection is owner-neutral and versioned", () => {
    const policy = new transport_eligibility_1.ActiveVehiclePolicy();
    const decision = {
        eligible: true,
        failureCodes: [],
        missingCapabilities: [],
        failedRequirementCodes: [],
        requiredPermission: "use"
    };
    const first = policy.select(undefined, "vehicle_giant_1", decision, epoch);
    const second = policy.select(first, "vehicle_giant_2", decision, at(1_000));
    strict_1.default.equal(first.selectionVersion, 1);
    strict_1.default.equal(second.selectionVersion, 2);
    strict_1.default.equal("owner" in second, false);
});
(0, node_test_1.default)("Giant Escape 3 reference configuration completes usage, maintenance and repair flows", () => {
    const giant = Object.freeze({
        productId: "bike_giant_escape_3",
        weightKg: 12.3,
        maximumSpeedKmh: 32,
        maximumStructuralHealth: 10_000,
        maintenanceBaseAmount: 375,
        repairBaseAmount: 2_000,
        resaleBaseAmount: 15_000
    });
    const maintenancePolicy = giantMaintenancePolicy();
    const vehicle = transport_vehicle_1.VehicleAggregate.create({
        vehicleId: "vehicle_giant_reference",
        productId: giant.productId,
        maximumStructuralHealth: giant.maximumStructuralHealth,
        maintenanceSchedule: maintenancePolicy.createSchedule({ at: epoch, mileageMeters: 0, usageCount: 0 }),
        createdAt: epoch
    });
    const eligible = {
        eligible: true,
        failureCodes: [],
        missingCapabilities: [],
        failedRequirementCodes: [],
        requiredPermission: "use"
    };
    vehicle.startUsage({
        usageId: "usage_giant_reference",
        purpose: { code: "delivery", targetId: "job_courier" },
        plannedDistanceMeters: 225_000
    }, eligible, { expectedVersion: 1, at: epoch });
    const used = vehicle.completeUsage(225_000, new transport_condition_1.StructuralDamagePolicy(), {
        damageUnitsPerKilometer: 1,
        wearUnitsPerKilometer: 1,
        minimumWearUnitsPerUsage: 1
    }, { expectedVersion: 2, at: at(day) });
    strict_1.default.equal(used.vehicle.mileage.meters, 225_000);
    strict_1.default.equal(giant.weightKg, 12.3);
    strict_1.default.equal(giant.maximumSpeedKmh, 32);
    const maintenanceQuote = maintenancePolicy.createQuote({
        quoteId: "maintenance_giant_reference",
        vehicleId: used.vehicle.vehicleId,
        taskCodes: ["chain"],
        schedule: maintenancePolicy.createSchedule({ at: epoch, mileageMeters: 0, usageCount: 0 }),
        context: context(225_000, 1, day),
        pricingContext: { ...neutralPricing, baseAmount: giant.maintenanceBaseAmount },
        createdAt: at(day),
        expiresAt: at(day + 60_000)
    });
    vehicle.beginMaintenance(maintenanceQuote, { expectedVersion: 3, at: at(day) });
    strict_1.default.throws(() => vehicle.startUsage({
        usageId: "usage_during_maintenance",
        purpose: { code: "urban" },
        plannedDistanceMeters: 1_000
    }, eligible, { expectedVersion: 4, at: at(day + 1_000) }), domainError("TRANSPORT_STATE_TRANSITION_FORBIDDEN"));
    const maintained = vehicle.completeMaintenance(maintenanceQuote, maintenancePolicy, { expectedVersion: 4, at: at(day + 30_000) });
    strict_1.default.equal(maintained.vehicle.operationalState, "available");
    const repairPolicy = new transport_repair_1.RepairPolicy(new transport_pricing_1.RateBasedRepairPricingPolicy("1.0.0", 1));
    const repairQuote = repairPolicy.createQuote({
        quoteId: "repair_giant_reference",
        vehicleId: maintained.vehicle.vehicleId,
        reasonCode: "structural_wear",
        condition: transport_condition_1.StructuralCondition.restore(maintained.vehicle.condition),
        pricingContext: { ...neutralPricing, baseAmount: giant.repairBaseAmount },
        createdAt: at(day + 31_000),
        expiresAt: at(day + 91_000)
    });
    vehicle.beginRepair(repairQuote, { expectedVersion: 5, at: at(day + 31_000) });
    strict_1.default.throws(() => vehicle.startUsage({
        usageId: "usage_during_repair",
        purpose: { code: "urban" },
        plannedDistanceMeters: 1_000
    }, eligible, { expectedVersion: 6, at: at(day + 32_000) }), domainError("TRANSPORT_STATE_TRANSITION_FORBIDDEN"));
    const repaired = vehicle.completeRepair(repairQuote, repairPolicy, {
        expectedVersion: 6,
        at: at(day + 61_000)
    });
    strict_1.default.equal(repaired.vehicle.condition.currentHealth, giant.maximumStructuralHealth);
    strict_1.default.equal(giant.resaleBaseAmount, 15_000);
});
function giantMaintenancePolicy() {
    return new transport_maintenance_1.MaintenancePolicy([{
            code: "chain",
            localizationKey: "transport.maintenance.chain",
            interval: new transport_maintenance_1.ServiceInterval({
                distanceMeters: 250_000,
                timeMilliseconds: 30 * day,
                usageCount: 50,
                earlyWindow: { distanceMeters: 25_000, timeMilliseconds: 3 * day, usageCount: 5 },
                criticalOverdue: { distanceMeters: 100_000, timeMilliseconds: 7 * day, usageCount: 20 }
            }),
            overdueMultiplierBps: 12_500,
            criticalOverdueMultiplierBps: 17_500,
            version: 1
        }], new transport_pricing_1.RateBasedMaintenancePricingPolicy("1.0.0"));
}
function context(mileageMeters, usageCount, offsetMilliseconds) {
    return { at: at(offsetMilliseconds), mileageMeters, usageCount };
}
function at(offsetMilliseconds) {
    return new Date(Date.parse(epoch) + offsetMilliseconds).toISOString();
}
function domainError(code) {
    return (error) => error instanceof errors_1.DomainError && error.code === code;
}
