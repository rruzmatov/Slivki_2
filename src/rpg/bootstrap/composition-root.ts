import path from "node:path";
import type { DomainEvent } from "../domain/events";
import type { InboxRecord, ScheduledTask } from "../domain/runtime";
import { CatalogService } from "../application/catalog-service";
import { EconomyService } from "../application/economy-service";
import { EventBus } from "../application/event-bus";
import { GameServices } from "../application/game-services";
import { AdminService } from "../application/admin-service";
import { InventoryService, type InventoryGrantedPayload, type InventoryRemovedPayload } from "../application/inventory-service";
import { InventoryQueryService } from "../application/inventory-query-service";
import { OwnershipService } from "../application/ownership-service";
import { PlayerService } from "../application/player-service";
import { RequirementEvaluator } from "../application/requirement-evaluator";
import { ShopService } from "../application/shop-service";
import { UnlockService } from "../application/unlock-service";
import { TransactionSchedulerService } from "../application/transaction-scheduler-service";
import { OutboxDispatcher } from "../application/outbox-dispatcher";
import { RetentionService } from "../application/retention-service";
import { SchedulerHandlerRegistry, SchedulerService } from "../application/scheduler-service";
import type { TransactionScope, UnitOfWorkManager } from "../application/ports/unit-of-work";
import type { TransactionServiceScopeFactory, TransactionServices } from "../application/transaction-services";
import type { GameTransactionContext } from "../application/transaction-services";
import type { SchemaRegistry } from "../application/schema-registry";
import { StaticCatalogRepository } from "../infrastructure/repositories/static-catalog-repository";
import { JsonGameDatabase } from "../infrastructure/storage/json-game-database";
import { JsonUnitOfWorkManager } from "../infrastructure/unit-of-work/json-unit-of-work-manager";
import { SystemClock } from "../infrastructure/system-clock";
import type { Clock } from "../application/ports/clock";
import { createDefaultSchemaRegistry } from "./schema-registrations";
import { OwnershipPermissionRegistry } from "../domain/ownership-permissions";
import { VehicleCapabilityRegistry, VehicleEnergyTypeRegistry } from "../domain/transport-registry";
import { ownershipPermissionDefinitions } from "../data/ownership-permissions";
import { vehicleCapabilityDefinitions, vehicleEnergyTypeDefinitions } from "../data/transport-foundation";
import type { Logger } from "../application/ports/logger";
import { StructuredLogger } from "../infrastructure/structured-logger";

export interface CompositionRootOptions {
  storagePath?: string;
  ownerIds?: readonly number[];
  startScheduler?: boolean;
  schedulerPollIntervalMs?: number;
}

export interface RpgCompositionRoot {
  gameServices: GameServices;
  adminService: AdminService;
  schedulerService: SchedulerService;
  retentionService: RetentionService;
  outboxDispatcher: OutboxDispatcher;
  eventBus: EventBus;
  unitOfWork: UnitOfWorkManager;
  catalogService: CatalogService;
  schemaRegistry: SchemaRegistry;
  permissionRegistry: OwnershipPermissionRegistry;
  capabilityRegistry: VehicleCapabilityRegistry;
  energyTypeRegistry: VehicleEnergyTypeRegistry;
  logger: Logger;
  execute<T>(work: (context: GameTransactionContext) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
}

class CompositionRootServiceScopeFactory implements TransactionServiceScopeFactory {
  constructor(
    private readonly catalog: CatalogService,
    private readonly schemas: SchemaRegistry,
    private readonly permissions: OwnershipPermissionRegistry
  ) {}

  create(scope: TransactionScope): TransactionServices {
    const transactionScheduler = new TransactionSchedulerService(scope.scheduler, this.schemas);
    const ownershipService = new OwnershipService(
      scope.ownership,
      scope.ownerDirectory,
      this.permissions,
      scope.eventCollector,
      transactionScheduler
    );
    const economyService = new EconomyService(scope.economy);
    const playerService = new PlayerService(scope.players);
    const unlockService = new UnlockService(this.catalog, scope.unlocks, scope.eventCollector);
    const inventoryQueryService = new InventoryQueryService(
      this.catalog, scope.inventory, ownershipService, scope.events, this.schemas
    );
    const inventoryService = new InventoryService(
      this.catalog, scope.inventory, ownershipService, scope.legacyInventory, inventoryQueryService,
      scope.eventCollector, this.schemas, transactionScheduler
    );
    const requirementEvaluator = new RequirementEvaluator(inventoryQueryService, unlockService);
    const shopService = new ShopService(
      this.catalog, inventoryService, economyService, requirementEvaluator, scope.shop, ownershipService,
      scope.players, scope.families, scope.eventCollector, transactionScheduler
    );
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

export async function createCompositionRoot(options: CompositionRootOptions = {}): Promise<RpgCompositionRoot> {
  const schemaRegistry = createDefaultSchemaRegistry();
  const permissionRegistry = new OwnershipPermissionRegistry(ownershipPermissionDefinitions);
  const capabilityRegistry = new VehicleCapabilityRegistry(vehicleCapabilityDefinitions);
  const energyTypeRegistry = new VehicleEnergyTypeRegistry(vehicleEnergyTypeDefinitions);
  const catalogService = await CatalogService.create(
    new StaticCatalogRepository(),
    schemaRegistry,
    capabilityRegistry,
    energyTypeRegistry
  );
  const eventBus = new EventBus();
  const database = new JsonGameDatabase(options.storagePath ?? path.join(process.cwd(), "src", "rpg-game-state.json"));
  const clock = new SystemClock();
  const unitOfWork = new JsonUnitOfWorkManager(database, schemaRegistry, eventBus, clock);
  const logger = new StructuredLogger();
  const serviceScopes = new CompositionRootServiceScopeFactory(catalogService, schemaRegistry, permissionRegistry);
  const gameServices = new GameServices(unitOfWork, serviceScopes, catalogService);
  const adminService = new AdminService(options.ownerIds ?? [], unitOfWork, serviceScopes, catalogService);
  const outboxDispatcher = new OutboxDispatcher(unitOfWork, eventBus, schemaRegistry, clock);
  const retentionService = new RetentionService(unitOfWork, clock);
  const schedulerHandlers = new SchedulerHandlerRegistry();
  const schedulerService = new SchedulerService(unitOfWork, schemaRegistry, schedulerHandlers, clock);

  registerEventConsumers(eventBus, unitOfWork, serviceScopes, gameServices, clock);
  registerSchedulerHandlers(schedulerHandlers, schedulerService, outboxDispatcher, retentionService, unitOfWork, serviceScopes, clock);
  await ensureRuntimeTasks(schedulerService, clock);
  if (options.startScheduler) schedulerService.start(options.schedulerPollIntervalMs);

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

function registerEventConsumers(
  eventBus: EventBus,
  unitOfWork: UnitOfWorkManager,
  serviceScopes: TransactionServiceScopeFactory,
  gameServices: GameServices,
  clock: Clock
): void {
  subscribeIdempotent<InventoryGrantedPayload>(eventBus, unitOfWork, "inventory.granted", "unlocks.inventory-granted.v1", async (event) => {
    await unitOfWork.execute(async (scope) => {
      await serviceScopes.create(scope).unlockService.handleInventoryGranted(event.payload, eventOperation(event));
    });
  }, clock);
  subscribeIdempotent<InventoryRemovedPayload>(eventBus, unitOfWork, "inventory.removed", "unlocks.inventory-removed.v1", async (event) => {
    await unitOfWork.execute(async (scope) => {
      await serviceScopes.create(scope).unlockService.handleInventoryRemoved(event.payload, eventOperation(event));
    });
  }, clock);
  subscribeIdempotent<{ order: import("../domain/shop").ShopOrder }>(eventBus, unitOfWork, "shop.order.completed", "game.shop-order-projection.v1", async (event) => {
    await gameServices.handleCompletedShopOrder(event.payload.order, event.occurredAt);
  }, clock);
}

function subscribeIdempotent<TPayload extends Readonly<Record<string, unknown>>>(
  eventBus: EventBus,
  unitOfWork: UnitOfWorkManager,
  eventType: string,
  consumer: string,
  handler: (event: DomainEvent<TPayload>) => Promise<void>,
  clock: Clock
): void {
  eventBus.subscribe<TPayload>(eventType, async (event) => {
    const shouldProcess = await unitOfWork.execute(async (scope) => {
      const existing = await scope.events.findInbox(event.eventId, consumer);
      const now = clock.nowIso();
      if (existing?.status === "processed" ||
        (existing?.status === "processing" && existing.lockedUntil && existing.lockedUntil > now)) return false;
      const record: InboxRecord = {
        messageId: event.eventId, consumer, payloadSchemaId: event.eventType, payloadSchemaVersion: event.eventVersion,
        payload: event.payload as Readonly<Record<string, unknown>>, status: "processing", attempts: (existing?.attempts ?? 0) + 1,
        receivedAt: existing?.receivedAt ?? now, updatedAt: now,
        lockedUntil: new Date(clock.now().getTime() + INBOX_LOCK_MS).toISOString()
      };
      await scope.events.saveInbox(record);
      return true;
    }, { publishEvents: false });
    if (!shouldProcess) return;
    try {
      await handler(event);
      await updateInbox(unitOfWork, event, consumer, "processed", clock);
    } catch (error) {
      await updateInbox(unitOfWork, event, consumer, "failed", clock, error);
      throw error;
    }
  });
}

async function updateInbox(
  unitOfWork: UnitOfWorkManager,
  event: DomainEvent,
  consumer: string,
  status: "processed" | "failed",
  clock: Clock,
  error?: unknown
): Promise<void> {
  await unitOfWork.execute(async (scope) => {
    const record = await scope.events.findInbox(event.eventId, consumer);
    if (!record) return;
    record.status = status;
    record.updatedAt = clock.nowIso();
    record.lockedUntil = undefined;
    if (status === "processed") record.processedAt = clock.nowIso();
    else record.lastError = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
    await scope.events.saveInbox(record);
  }, { publishEvents: false });
}

function registerSchedulerHandlers(
  handlers: SchedulerHandlerRegistry,
  scheduler: SchedulerService,
  outbox: OutboxDispatcher,
  retention: RetentionService,
  unitOfWork: UnitOfWorkManager,
  serviceScopes: TransactionServiceScopeFactory,
  clock: Clock
): void {
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

async function mutateScheduledEntity(
  unitOfWork: UnitOfWorkManager,
  serviceScopes: TransactionServiceScopeFactory,
  _task: ScheduledTask,
  mutation: (services: TransactionServices) => Promise<void>
): Promise<void> {
  await unitOfWork.execute(async (scope) => mutation(serviceScopes.create(scope)));
}

async function ensureRuntimeTasks(scheduler: SchedulerService, clock: Clock): Promise<void> {
  const now = clock.nowIso();
  for (const taskType of ["runtime.outbox.dispatch", "runtime.retention.run"] as const) {
    if (await scheduler.hasActiveTask(taskType)) continue;
    await scheduler.schedule({
      taskType, payload: {}, runAt: now, idempotencyKey: `${taskType}:bootstrap:${Date.now()}`,
      correlationId: "runtime:bootstrap", causationId: "runtime:bootstrap", createdBy: { kind: "service", id: "composition-root" }
    });
  }
}

async function scheduleNextRuntimeTask(scheduler: SchedulerService, previous: ScheduledTask, taskType: string, delayMs: number, clock: Clock): Promise<void> {
  const runAt = new Date(clock.now().getTime() + delayMs).toISOString();
  await scheduler.schedule({
    taskType, payload: {}, runAt, idempotencyKey: `${taskType}:after:${previous.id}`,
    correlationId: previous.correlationId, causationId: previous.id, createdBy: { kind: "scheduler", id: "runtime" }
  });
}

const eventOperation = (event: DomainEvent) => ({
  requestId: `event:${event.eventId}`, idempotencyKey: `event:${event.eventId}`, correlationId: event.correlationId,
  causationId: event.eventId, now: event.occurredAt, actor: { kind: "service" as const, id: "event-consumer" }
});

const taskOperation = (task: ScheduledTask, clock: Clock) => ({
  requestId: `task:${task.id}`, idempotencyKey: `task:${task.id}`, correlationId: task.correlationId,
  causationId: task.id, now: clock.nowIso(), actor: { kind: "scheduler" as const, id: task.taskType }
});

function stringPayload(task: ScheduledTask, key: string): string {
  const value = task.payload[key];
  if (typeof value !== "string" || !value) throw new Error(`Scheduler payload ${task.taskType} requires ${key}`);
  return value;
}

const INBOX_LOCK_MS = 5 * 60 * 1_000;
