"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultSchemaRegistry = createDefaultSchemaRegistry;
const zod_1 = require("zod");
const schema_registry_1 = require("../application/schema-registry");
const asset_catalog_1 = require("../data/asset-catalog");
const recordPayload = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown());
const identifier = zod_1.z.string().regex(/^[a-z][a-z0-9_.:-]{1,127}$/);
const owner = zod_1.z.object({ kind: zod_1.z.string(), id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]) }).strict();
const actor = zod_1.z.object({
    kind: zod_1.z.union([zod_1.z.literal("player"), zod_1.z.literal("admin"), zod_1.z.literal("service"), zod_1.z.literal("scheduler")]),
    id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()])
}).strict();
const money = zod_1.z.object({ amount: zod_1.z.number().int().nonnegative(), currency: zod_1.z.string().min(1).max(16) }).strict();
const capability = zod_1.z.object({
    code: identifier,
    parameters: zod_1.z.record(zod_1.z.string(), zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean()]))
}).strict();
const vehicleFoundation = zod_1.z.object({
    schemaVersion: zod_1.z.literal("1.0.0"),
    catalogRevision: zod_1.z.number().int().positive(),
    capabilities: zod_1.z.array(capability),
    energy: zod_1.z.object({
        type: identifier,
        carriers: zod_1.z.array(zod_1.z.string()),
        storageCapacity: zod_1.z.number().nonnegative(),
        consumptionMetric: zod_1.z.union([zod_1.z.literal("none"), zod_1.z.literal("per_100_km"), zod_1.z.literal("per_hour")])
    }).strict(),
    presentation: zod_1.z.object({
        mediaKey: identifier,
        emoji: zod_1.z.string().min(1).max(16),
        nameLocalizationKey: identifier
    }).strict()
}).strict();
const legacyTransport = zod_1.z.object({
    brand: zod_1.z.string(), model: zod_1.z.string(), country: zod_1.z.string(), year: zod_1.z.number().int(), horsepower: zod_1.z.number(),
    topSpeedKmh: zod_1.z.number().nonnegative(), fuelType: zod_1.z.string(), maintenanceCost: zod_1.z.number().int().nonnegative(),
    insuranceCost: zod_1.z.number().int().nonnegative(), canWork: zod_1.z.boolean(), unlockedJobs: zod_1.z.array(zod_1.z.string()),
    resalePrice: zod_1.z.number().int().nonnegative(), repairCost: zod_1.z.number().int().nonnegative(), requiredLicense: zod_1.z.string(),
    upgradeSupport: zod_1.z.boolean(), weightKg: zod_1.z.number().positive().optional(), description: zod_1.z.string().optional(),
    defaultCondition: zod_1.z.string().optional(), canSell: zod_1.z.boolean().optional(), canRepair: zod_1.z.boolean().optional(),
    passengerCapacity: zod_1.z.number().int().nonnegative().optional(), rangeKm: zod_1.z.number().nonnegative().optional(),
    dockRequirement: zod_1.z.string().optional(), airportRequirement: zod_1.z.string().optional(),
    businessUsage: zod_1.z.array(zod_1.z.string()).optional()
}).strict();
const transportAttributes = zod_1.z.object({
    transport: legacyTransport,
    vehicle: vehicleFoundation.optional(),
    legacyCategory: zod_1.z.string(),
    legacyTransportKind: zod_1.z.string(),
    minimumLevel: zod_1.z.number().int().positive()
}).strict();
const existingEventTypes = [
    "inventory.granted", "inventory.removed", "inventory.consumed", "inventory.transferred", "inventory.gifted",
    "inventory.reserved", "inventory.reservation.released", "inventory.exchange.completed", "inventory.equipped",
    "inventory.unequipped", "inventory.leased", "inventory.returned", "inventory.destroyed", "inventory.recovered",
    "inventory.confiscated", "inventory.split", "inventory.merged", "inventory.moved", "inventory.repaired",
    "inventory.maintained", "inventory.upgraded", "inventory.expired", "ownership.assigned", "ownership.transferred",
    "ownership.custody.changed", "ownership.permission.granted", "ownership.permission.revoked",
    "ownership.owner_access.granted", "ownership.owner_access.revoked", "ownership.confiscated",
    "ownership.recovered", "ownership.archived", "shop.order.completed", "unlock.granted", "unlock.revoked"
];
const vehicleId = zod_1.z.string().min(1).max(128);
const usagePurpose = zod_1.z.object({ code: identifier, targetId: zod_1.z.string().min(1).max(128).optional() }).strict();
const taskCodes = zod_1.z.array(identifier).min(1).max(32);
const milestone = zod_1.z.object({
    vehicleId,
    owner,
    metricCode: identifier,
    threshold: zod_1.z.number().int().nonnegative(),
    actualValue: zod_1.z.number().int().nonnegative(),
    milestoneRevision: zod_1.z.number().int().positive()
}).strict();
const transportEventSchemas = {
    "transport.vehicle.registered": zod_1.z.object({ vehicleId, productId: zod_1.z.string(), inventoryVersion: zod_1.z.number().int().positive() }).strict(),
    "transport.vehicle.activated": zod_1.z.object({ vehicleId, actor, owner, previousVehicleId: vehicleId.optional() }).strict(),
    "transport.usage.started": zod_1.z.object({
        vehicleId, usageId: zod_1.z.string(), actor, owner, purpose: usagePurpose,
        plannedDistanceMeters: zod_1.z.number().int().positive(), reservationId: zod_1.z.string()
    }).strict(),
    "transport.usage.completed": zod_1.z.object({
        vehicleId, usageId: zod_1.z.string(), actor, owner, purpose: usagePurpose,
        actualDistanceMeters: zod_1.z.number().int().nonnegative(), odometerMetersAfter: zod_1.z.number().int().nonnegative(),
        structuralHealthAfter: zod_1.z.number().int().nonnegative()
    }).strict(),
    "transport.usage.cancelled": zod_1.z.object({ vehicleId, usageId: zod_1.z.string(), actor, owner, reasonCode: identifier }).strict(),
    "transport.repair.quoted": zod_1.z.object({
        vehicleId, quoteId: zod_1.z.string(), actor, owner, amount: money, expiresAt: zod_1.z.string(), pricingPolicyVersion: zod_1.z.string()
    }).strict(),
    "transport.repair.completed": zod_1.z.object({
        vehicleId, serviceOrderId: zod_1.z.string(), actor, owner, amount: money,
        structuralHealthBefore: zod_1.z.number().int().nonnegative(), structuralHealthAfter: zod_1.z.number().int().nonnegative()
    }).strict(),
    "transport.maintenance.quoted": zod_1.z.object({
        vehicleId, quoteId: zod_1.z.string(), actor, owner, amount: money, taskCodes, expiresAt: zod_1.z.string(), pricingPolicyVersion: zod_1.z.string()
    }).strict(),
    "transport.maintenance.completed": zod_1.z.object({
        vehicleId, serviceOrderId: zod_1.z.string(), actor, owner, amount: money, taskCodes,
        nextServiceAt: zod_1.z.string(), nextServiceOdometerMeters: zod_1.z.number().int().nonnegative()
    }).strict(),
    "transport.maintenance.due": zod_1.z.object({ vehicleId, owner, taskCodes }).strict(),
    "transport.maintenance.due_soon": zod_1.z.object({ vehicleId, owner, taskCodes, dueAt: zod_1.z.string() }).strict(),
    "transport.maintenance.overdue": zod_1.z.object({ vehicleId, owner, taskCodes, overdueSince: zod_1.z.string() }).strict(),
    "transport.vehicle.broken": zod_1.z.object({ vehicleId, owner, causeCode: identifier, structuralHealth: zod_1.z.literal(0) }).strict(),
    "transport.vehicle.retired": zod_1.z.object({ vehicleId, owner, reasonCode: identifier }).strict(),
    "transport.component.replacement_due": zod_1.z.object({ vehicleId, owner, componentCode: identifier, dueAt: zod_1.z.string() }).strict(),
    "transport.mileage.milestone_reached": milestone,
    "transport.repair.milestone_reached": milestone,
    "transport.maintenance.milestone_reached": milestone,
    "transport.ownership.milestone_reached": milestone,
    "transport.travel.milestone_reached": milestone,
    "vehicle.listed": zod_1.z.object({ vehicleId, owner, listingId: zod_1.z.string(), marketplaceId: zod_1.z.string() }).strict(),
    "vehicle.unlisted": zod_1.z.object({ vehicleId, owner, listingId: zod_1.z.string(), reasonCode: identifier }).strict(),
    "vehicle.sold": zod_1.z.object({ vehicleId, fromOwner: owner, toOwner: owner, orderId: zod_1.z.string(), amount: money }).strict(),
    "vehicle.rented": zod_1.z.object({ vehicleId, owner, tenant: owner, leaseId: zod_1.z.string(), startsAt: zod_1.z.string(), endsAt: zod_1.z.string() }).strict()
};
const existingSchedulerTypes = [
    "inventory.reservation.expire", "inventory.action_session.expire", "inventory.lease.expire",
    "ownership.permission.expire", "ownership.owner_access.expire", "shop.checkout.expire", "inventory.asset.expire",
    "runtime.outbox.dispatch", "runtime.retention.run"
];
const transportSchedulerSchemas = {
    "transport.service_quote.expire": zod_1.z.object({ quoteId: zod_1.z.string() }).strict(),
    "transport.usage.expire": zod_1.z.object({ usageId: zod_1.z.string() }).strict(),
    "transport.maintenance.remind": zod_1.z.object({ vehicleId, expectedVehicleVersion: zod_1.z.number().int().positive() }).strict()
};
function createDefaultSchemaRegistry() {
    const registry = new schema_registry_1.SchemaRegistry();
    for (const assetType of asset_catalog_1.assetTypes) {
        registry.register({ namespace: "attributes", schemaId: assetType.attributeSchemaId, version: assetType.attributeSchemaVersion, schema: recordPayload });
    }
    for (const category of asset_catalog_1.assetCategories) {
        if (!registry.has("attributes", category.attributeSchemaId, category.attributeSchemaVersion)) {
            registry.register({
                namespace: "attributes",
                schemaId: category.attributeSchemaId,
                version: category.attributeSchemaVersion,
                schema: category.assetTypeId === "transport" ? transportAttributes : recordPayload
            });
        }
    }
    registry.register({ namespace: "metadata", schemaId: "catalog-item.metadata", version: 1, schema: recordPayload });
    registry.register({ namespace: "metadata", schemaId: "inventory-entry.metadata", version: 1, schema: recordPayload });
    registry.register({ namespace: "metadata", schemaId: "inventory-entry.state", version: 1, schema: recordPayload });
    for (const eventType of existingEventTypes) {
        registry.register({ namespace: "event", schemaId: eventType, version: 1, schema: recordPayload });
    }
    for (const [eventType, schema] of Object.entries(transportEventSchemas)) {
        registry.register({ namespace: "event", schemaId: eventType, version: 1, schema });
    }
    for (const taskType of existingSchedulerTypes) {
        registry.register({ namespace: "scheduler", schemaId: taskType, version: 1, schema: recordPayload });
    }
    for (const [taskType, schema] of Object.entries(transportSchedulerSchemas)) {
        registry.register({ namespace: "scheduler", schemaId: taskType, version: 1, schema });
    }
    registry.register({
        namespace: "integration",
        schemaId: "telegram.callback",
        version: 1,
        schema: zod_1.z.object({
            callbackQueryId: zod_1.z.string().min(1).max(256),
            data: zod_1.z.string().min(1).max(64),
            actorId: zod_1.z.number().int().positive()
        }).strict()
    });
    return registry;
}
