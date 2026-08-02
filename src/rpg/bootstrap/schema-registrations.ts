import { z } from "zod";
import { SchemaRegistry } from "../application/schema-registry";
import { assetCategories, assetTypes } from "../data/asset-catalog";

const recordPayload = z.record(z.string(), z.unknown());
const identifier = z.string().regex(/^[a-z][a-z0-9_.:-]{1,127}$/);
const owner = z.object({ kind: z.string(), id: z.union([z.string(), z.number()]) }).strict();
const actor = z.object({
  kind: z.union([z.literal("player"), z.literal("admin"), z.literal("service"), z.literal("scheduler")]),
  id: z.union([z.string(), z.number()])
}).strict();
const money = z.object({ amount: z.number().int().nonnegative(), currency: z.string().min(1).max(16) }).strict();

const capability = z.object({
  code: identifier,
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
}).strict();

const vehicleFoundation = z.object({
  schemaVersion: z.literal("1.0.0"),
  catalogRevision: z.number().int().positive(),
  capabilities: z.array(capability),
  energy: z.object({
    type: identifier,
    carriers: z.array(z.string()),
    storageCapacity: z.number().nonnegative(),
    consumptionMetric: z.union([z.literal("none"), z.literal("per_100_km"), z.literal("per_hour")])
  }).strict(),
  presentation: z.object({
    mediaKey: identifier,
    emoji: z.string().min(1).max(16),
    nameLocalizationKey: identifier
  }).strict()
}).strict();

const legacyTransport = z.object({
  brand: z.string(), model: z.string(), country: z.string(), year: z.number().int(), horsepower: z.number(),
  topSpeedKmh: z.number().nonnegative(), fuelType: z.string(), maintenanceCost: z.number().int().nonnegative(),
  insuranceCost: z.number().int().nonnegative(), canWork: z.boolean(), unlockedJobs: z.array(z.string()),
  resalePrice: z.number().int().nonnegative(), repairCost: z.number().int().nonnegative(), requiredLicense: z.string(),
  upgradeSupport: z.boolean(), weightKg: z.number().positive().optional(), description: z.string().optional(),
  defaultCondition: z.string().optional(), canSell: z.boolean().optional(), canRepair: z.boolean().optional(),
  passengerCapacity: z.number().int().nonnegative().optional(), rangeKm: z.number().nonnegative().optional(),
  dockRequirement: z.string().optional(), airportRequirement: z.string().optional(),
  businessUsage: z.array(z.string()).optional()
}).strict();

const transportAttributes = z.object({
  transport: legacyTransport,
  vehicle: vehicleFoundation.optional(),
  legacyCategory: z.string(),
  legacyTransportKind: z.string(),
  minimumLevel: z.number().int().positive()
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
] as const;

const vehicleId = z.string().min(1).max(128);
const usagePurpose = z.object({ code: identifier, targetId: z.string().min(1).max(128).optional() }).strict();
const taskCodes = z.array(identifier).min(1).max(32);
const milestone = z.object({
  vehicleId,
  owner,
  metricCode: identifier,
  threshold: z.number().int().nonnegative(),
  actualValue: z.number().int().nonnegative(),
  milestoneRevision: z.number().int().positive()
}).strict();

const transportEventSchemas: Readonly<Record<string, z.ZodType>> = {
  "transport.vehicle.registered": z.object({ vehicleId, productId: z.string(), inventoryVersion: z.number().int().positive() }).strict(),
  "transport.vehicle.activated": z.object({ vehicleId, actor, owner, previousVehicleId: vehicleId.optional() }).strict(),
  "transport.usage.started": z.object({
    vehicleId, usageId: z.string(), actor, owner, purpose: usagePurpose,
    plannedDistanceMeters: z.number().int().positive(), reservationId: z.string()
  }).strict(),
  "transport.usage.completed": z.object({
    vehicleId, usageId: z.string(), actor, owner, purpose: usagePurpose,
    actualDistanceMeters: z.number().int().nonnegative(), odometerMetersAfter: z.number().int().nonnegative(),
    structuralHealthAfter: z.number().int().nonnegative()
  }).strict(),
  "transport.usage.cancelled": z.object({ vehicleId, usageId: z.string(), actor, owner, reasonCode: identifier }).strict(),
  "transport.repair.quoted": z.object({
    vehicleId, quoteId: z.string(), actor, owner, amount: money, expiresAt: z.string(), pricingPolicyVersion: z.string()
  }).strict(),
  "transport.repair.completed": z.object({
    vehicleId, serviceOrderId: z.string(), actor, owner, amount: money,
    structuralHealthBefore: z.number().int().nonnegative(), structuralHealthAfter: z.number().int().nonnegative()
  }).strict(),
  "transport.maintenance.quoted": z.object({
    vehicleId, quoteId: z.string(), actor, owner, amount: money, taskCodes, expiresAt: z.string(), pricingPolicyVersion: z.string()
  }).strict(),
  "transport.maintenance.completed": z.object({
    vehicleId, serviceOrderId: z.string(), actor, owner, amount: money, taskCodes,
    nextServiceAt: z.string(), nextServiceOdometerMeters: z.number().int().nonnegative()
  }).strict(),
  "transport.maintenance.due": z.object({ vehicleId, owner, taskCodes }).strict(),
  "transport.maintenance.due_soon": z.object({ vehicleId, owner, taskCodes, dueAt: z.string() }).strict(),
  "transport.maintenance.overdue": z.object({ vehicleId, owner, taskCodes, overdueSince: z.string() }).strict(),
  "transport.vehicle.broken": z.object({ vehicleId, owner, causeCode: identifier, structuralHealth: z.literal(0) }).strict(),
  "transport.vehicle.retired": z.object({ vehicleId, owner, reasonCode: identifier }).strict(),
  "transport.component.replacement_due": z.object({ vehicleId, owner, componentCode: identifier, dueAt: z.string() }).strict(),
  "transport.mileage.milestone_reached": milestone,
  "transport.repair.milestone_reached": milestone,
  "transport.maintenance.milestone_reached": milestone,
  "transport.ownership.milestone_reached": milestone,
  "transport.travel.milestone_reached": milestone,
  "vehicle.listed": z.object({ vehicleId, owner, listingId: z.string(), marketplaceId: z.string() }).strict(),
  "vehicle.unlisted": z.object({ vehicleId, owner, listingId: z.string(), reasonCode: identifier }).strict(),
  "vehicle.sold": z.object({ vehicleId, fromOwner: owner, toOwner: owner, orderId: z.string(), amount: money }).strict(),
  "vehicle.rented": z.object({ vehicleId, owner, tenant: owner, leaseId: z.string(), startsAt: z.string(), endsAt: z.string() }).strict()
};

const existingSchedulerTypes = [
  "inventory.reservation.expire", "inventory.action_session.expire", "inventory.lease.expire",
  "ownership.permission.expire", "ownership.owner_access.expire", "shop.checkout.expire", "inventory.asset.expire",
  "runtime.outbox.dispatch", "runtime.retention.run"
] as const;

const transportSchedulerSchemas: Readonly<Record<string, z.ZodType>> = {
  "transport.service_quote.expire": z.object({ quoteId: z.string() }).strict(),
  "transport.usage.expire": z.object({ usageId: z.string() }).strict(),
  "transport.maintenance.remind": z.object({ vehicleId, expectedVehicleVersion: z.number().int().positive() }).strict()
};

export function createDefaultSchemaRegistry(): SchemaRegistry {
  const registry = new SchemaRegistry();
  for (const assetType of assetTypes) {
    registry.register({ namespace: "attributes", schemaId: assetType.attributeSchemaId, version: assetType.attributeSchemaVersion, schema: recordPayload });
  }
  for (const category of assetCategories) {
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
    schema: z.object({
      callbackQueryId: z.string().min(1).max(256),
      data: z.string().min(1).max(64),
      actorId: z.number().int().positive()
    }).strict()
  });
  return registry;
}
