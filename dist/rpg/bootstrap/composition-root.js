"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCompositionRoot = createCompositionRoot;
const node_path_1 = __importDefault(require("node:path"));
const catalog_service_1 = require("../application/catalog-service");
const economy_service_1 = require("../application/economy-service");
const event_bus_1 = require("../application/event-bus");
const game_services_1 = require("../application/game-services");
const admin_service_1 = require("../application/admin-service");
const inventory_service_1 = require("../application/inventory-service");
const inventory_query_service_1 = require("../application/inventory-query-service");
const ownership_service_1 = require("../application/ownership-service");
const player_service_1 = require("../application/player-service");
const requirement_evaluator_1 = require("../application/requirement-evaluator");
const shop_service_1 = require("../application/shop-service");
const unlock_service_1 = require("../application/unlock-service");
const transaction_scheduler_service_1 = require("../application/transaction-scheduler-service");
const outbox_dispatcher_1 = require("../application/outbox-dispatcher");
const retention_service_1 = require("../application/retention-service");
const scheduler_service_1 = require("../application/scheduler-service");
const static_catalog_repository_1 = require("../infrastructure/repositories/static-catalog-repository");
const json_game_database_1 = require("../infrastructure/storage/json-game-database");
const json_unit_of_work_manager_1 = require("../infrastructure/unit-of-work/json-unit-of-work-manager");
const system_clock_1 = require("../infrastructure/system-clock");
const schema_registrations_1 = require("./schema-registrations");
const ownership_permissions_1 = require("../domain/ownership-permissions");
const transport_registry_1 = require("../domain/transport-registry");
const ownership_permissions_2 = require("../data/ownership-permissions");
const transport_foundation_1 = require("../data/transport-foundation");
const structured_logger_1 = require("../infrastructure/structured-logger");
class CompositionRootServiceScopeFactory {
    catalog;
    schemas;
    permissions;
    constructor(catalog, schemas, permissions) {
        this.catalog = catalog;
        this.schemas = schemas;
        this.permissions = permissions;
    }
    create(scope) {
        const transactionScheduler = new transaction_scheduler_service_1.TransactionSchedulerService(scope.scheduler, this.schemas);
        const ownershipService = new ownership_service_1.OwnershipService(scope.ownership, scope.ownerDirectory, this.permissions, scope.eventCollector, transactionScheduler);
        const economyService = new economy_service_1.EconomyService(scope.economy);
        const playerService = new player_service_1.PlayerService(scope.players);
        const unlockService = new unlock_service_1.UnlockService(this.catalog, scope.unlocks, scope.eventCollector);
        const inventoryQueryService = new inventory_query_service_1.InventoryQueryService(this.catalog, scope.inventory, ownershipService, scope.events, this.schemas);
        const inventoryService = new inventory_service_1.InventoryService(this.catalog, scope.inventory, ownershipService, scope.legacyInventory, inventoryQueryService, scope.eventCollector, this.schemas, transactionScheduler);
        const requirementEvaluator = new requirement_evaluator_1.RequirementEvaluator(inventoryQueryService, unlockService);
        const shopService = new shop_service_1.ShopService(this.catalog, inventoryService, economyService, requirementEvaluator, scope.shop, ownershipService, scope.players, scope.families, scope.eventCollector, transactionScheduler);
        return {
            playerService,
            economyService,
            ownershipService,
            inventoryService,
            inventoryQueryService,
            unlockService,
            requirementEvaluator,
            shopService,
            transactionScheduler
        };
    }
}
async function createCompositionRoot(options = {}) {
    const schemaRegistry = (0, schema_registrations_1.createDefaultSchemaRegistry)();
    const permissionRegistry = new ownership_permissions_1.OwnershipPermissionRegistry(ownership_permissions_2.ownershipPermissionDefinitions);
    const capabilityRegistry = new transport_registry_1.VehicleCapabilityRegistry(transport_foundation_1.vehicleCapabilityDefinitions);
    const energyTypeRegistry = new transport_registry_1.VehicleEnergyTypeRegistry(transport_foundation_1.vehicleEnergyTypeDefinitions);
    const catalogService = await catalog_service_1.CatalogService.create(new static_catalog_repository_1.StaticCatalogRepository(), schemaRegistry, capabilityRegistry, energyTypeRegistry);
    const eventBus = new event_bus_1.EventBus();
    const database = new json_game_database_1.JsonGameDatabase(options.storagePath ?? node_path_1.default.join(process.cwd(), "src", "rpg-game-state.json"));
    const clock = new system_clock_1.SystemClock();
    const unitOfWork = new json_unit_of_work_manager_1.JsonUnitOfWorkManager(database, schemaRegistry, eventBus, clock);
    const logger = new structured_logger_1.StructuredLogger();
    const serviceScopes = new CompositionRootServiceScopeFactory(catalogService, schemaRegistry, permissionRegistry);
    const gameServices = new game_services_1.GameServices(unitOfWork, serviceScopes, catalogService);
    const adminService = new admin_service_1.AdminService(options.ownerIds ?? [], unitOfWork, serviceScopes, catalogService);
    const outboxDispatcher = new outbox_dispatcher_1.OutboxDispatcher(unitOfWork, eventBus, schemaRegistry, clock);
    const retentionService = new retention_service_1.RetentionService(unitOfWork, clock);
    const schedulerHandlers = new scheduler_service_1.SchedulerHandlerRegistry();
    const schedulerService = new scheduler_service_1.SchedulerService(unitOfWork, schemaRegistry, schedulerHandlers, clock);
    registerEventConsumers(eventBus, unitOfWork, serviceScopes, gameServices, clock);
    registerSchedulerHandlers(schedulerHandlers, schedulerService, outboxDispatcher, retentionService, unitOfWork, serviceScopes, clock);
    await ensureRuntimeTasks(schedulerService, clock);
    if (options.startScheduler)
        schedulerService.start(options.schedulerPollIntervalMs);
    return {
        gameServices,
        adminService,
        schedulerService,
        retentionService,
        outboxDispatcher,
        eventBus,
        unitOfWork,
        catalogService,
        schemaRegistry,
        permissionRegistry,
        capabilityRegistry,
        energyTypeRegistry,
        logger,
        execute: (work) => unitOfWork.execute((scope) => work(Object.assign(scope, serviceScopes.create(scope)))),
        stop: () => schedulerService.stop()
    };
}
function registerEventConsumers(eventBus, unitOfWork, serviceScopes, gameServices, clock) {
    subscribeIdempotent(eventBus, unitOfWork, "inventory.granted", "unlocks.inventory-granted.v1", async (event) => {
        await unitOfWork.execute(async (scope) => {
            await serviceScopes.create(scope).unlockService.handleInventoryGranted(event.payload, eventOperation(event));
        });
    }, clock);
    subscribeIdempotent(eventBus, unitOfWork, "inventory.removed", "unlocks.inventory-removed.v1", async (event) => {
        await unitOfWork.execute(async (scope) => {
            await serviceScopes.create(scope).unlockService.handleInventoryRemoved(event.payload, eventOperation(event));
        });
    }, clock);
    subscribeIdempotent(eventBus, unitOfWork, "shop.order.completed", "game.shop-order-projection.v1", async (event) => {
        await gameServices.handleCompletedShopOrder(event.payload.order, event.occurredAt);
    }, clock);
}
function subscribeIdempotent(eventBus, unitOfWork, eventType, consumer, handler, clock) {
    eventBus.subscribe(eventType, async (event) => {
        const shouldProcess = await unitOfWork.execute(async (scope) => {
            const existing = await scope.events.findInbox(event.eventId, consumer);
            const now = clock.nowIso();
            if (existing?.status === "processed" ||
                (existing?.status === "processing" && existing.lockedUntil && existing.lockedUntil > now))
                return false;
            const record = {
                messageId: event.eventId, consumer, payloadSchemaId: event.eventType, payloadSchemaVersion: event.eventVersion,
                payload: event.payload, status: "processing", attempts: (existing?.attempts ?? 0) + 1,
                receivedAt: existing?.receivedAt ?? now, updatedAt: now,
                lockedUntil: new Date(clock.now().getTime() + INBOX_LOCK_MS).toISOString()
            };
            await scope.events.saveInbox(record);
            return true;
        }, { publishEvents: false });
        if (!shouldProcess)
            return;
        try {
            await handler(event);
            await updateInbox(unitOfWork, event, consumer, "processed", clock);
        }
        catch (error) {
            await updateInbox(unitOfWork, event, consumer, "failed", clock, error);
            throw error;
        }
    });
}
async function updateInbox(unitOfWork, event, consumer, status, clock, error) {
    await unitOfWork.execute(async (scope) => {
        const record = await scope.events.findInbox(event.eventId, consumer);
        if (!record)
            return;
        record.status = status;
        record.updatedAt = clock.nowIso();
        record.lockedUntil = undefined;
        if (status === "processed")
            record.processedAt = clock.nowIso();
        else
            record.lastError = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
        await scope.events.saveInbox(record);
    }, { publishEvents: false });
}
function registerSchedulerHandlers(handlers, scheduler, outbox, retention, unitOfWork, serviceScopes, clock) {
    handlers.register("runtime.outbox.dispatch", async (task) => {
        await outbox.dispatch();
        await scheduleNextRuntimeTask(scheduler, task, "runtime.outbox.dispatch", 60_000, clock);
    });
    handlers.register("runtime.retention.run", async (task) => {
        await retention.run();
        await scheduleNextRuntimeTask(scheduler, task, "runtime.retention.run", 24 * 60 * 60 * 1_000, clock);
    });
    handlers.register("inventory.action_session.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.inventoryService.expireActionSession(stringPayload(task, "sessionId"), clock.nowIso());
    }));
    handlers.register("shop.checkout.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.shopService.expireCheckout(stringPayload(task, "checkoutId"), clock.nowIso());
    }));
    handlers.register("inventory.reservation.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.inventoryService.expireReservation(stringPayload(task, "reservationId"), taskOperation(task, clock));
    }));
    handlers.register("inventory.lease.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.inventoryService.expireLease(stringPayload(task, "leaseId"), taskOperation(task, clock));
    }));
    handlers.register("ownership.permission.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.ownershipService.expirePermission(stringPayload(task, "permissionId"), taskOperation(task, clock));
    }));
    handlers.register("ownership.owner_access.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.ownershipService.expireOwnerAccess(stringPayload(task, "ownerAccessId"), taskOperation(task, clock));
    }));
    handlers.register("inventory.asset.expire", (task) => mutateScheduledEntity(unitOfWork, serviceScopes, task, async (services) => {
        await services.inventoryService.expire(stringPayload(task, "inventoryEntryId"), taskOperation(task, clock));
    }));
}
async function mutateScheduledEntity(unitOfWork, serviceScopes, _task, mutation) {
    await unitOfWork.execute(async (scope) => mutation(serviceScopes.create(scope)));
}
async function ensureRuntimeTasks(scheduler, clock) {
    const now = clock.nowIso();
    for (const taskType of ["runtime.outbox.dispatch", "runtime.retention.run"]) {
        if (await scheduler.hasActiveTask(taskType))
            continue;
        await scheduler.schedule({
            taskType, payload: {}, runAt: now, idempotencyKey: `${taskType}:bootstrap:${Date.now()}`,
            correlationId: "runtime:bootstrap", causationId: "runtime:bootstrap", createdBy: { kind: "service", id: "composition-root" }
        });
    }
}
async function scheduleNextRuntimeTask(scheduler, previous, taskType, delayMs, clock) {
    const runAt = new Date(clock.now().getTime() + delayMs).toISOString();
    await scheduler.schedule({
        taskType, payload: {}, runAt, idempotencyKey: `${taskType}:after:${previous.id}`,
        correlationId: previous.correlationId, causationId: previous.id, createdBy: { kind: "scheduler", id: "runtime" }
    });
}
const eventOperation = (event) => ({
    requestId: `event:${event.eventId}`, idempotencyKey: `event:${event.eventId}`, correlationId: event.correlationId,
    causationId: event.eventId, now: event.occurredAt, actor: { kind: "service", id: "event-consumer" }
});
const taskOperation = (task, clock) => ({
    requestId: `task:${task.id}`, idempotencyKey: `task:${task.id}`, correlationId: task.correlationId,
    causationId: task.id, now: clock.nowIso(), actor: { kind: "scheduler", id: task.taskType }
});
function stringPayload(task, key) {
    const value = task.payload[key];
    if (typeof value !== "string" || !value)
        throw new Error(`Scheduler payload ${task.taskType} requires ${key}`);
    return value;
}
const INBOX_LOCK_MS = 5 * 60 * 1_000;
