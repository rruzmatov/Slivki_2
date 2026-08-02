import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GameState } from "./game-state";
import { createEmptyShopState } from "../../domain/shop";
import { createEmptyUnlockState } from "../../domain/unlocks";
import { createEmptyInventoryState } from "../../domain/inventory";
import { createEmptyOwnershipState } from "../../domain/ownership";
import { createEmptyRuntimeState } from "../../domain/runtime";
import { ownerKey, type OwnerRef } from "../../domain/assets";
import { createId } from "../../utils/ids";

const ownerSchema = z.object({
  kind: z.string().min(1),
  id: z.union([z.number().int(), z.string().min(1)])
});

const actorSchema = z.object({
  kind: z.union([z.literal("player"), z.literal("admin"), z.literal("service"), z.literal("scheduler")]),
  id: z.union([z.number().int(), z.string().min(1)])
});
const ownershipPermissionCodeSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/);

const locationSchema = z.object({ kind: z.string().min(1), id: z.string().optional() });

const accountSchema = z.union([
  z.object({ kind: z.literal("player_cash"), playerId: z.number().int() }),
  z.object({ kind: z.literal("player_bank"), playerId: z.number().int() }),
  z.object({ kind: z.literal("family_capital"), familyId: z.string() })
]);

const moneySchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().min(1)
});

const inventoryEntrySchema = z.object({
  instanceId: z.string().default(() => createId("asset")),
  itemId: z.string(),
  quantity: z.number().int().positive(),
  reservedQuantity: z.number().int().nonnegative().default(0),
  acquiredAt: z.string(),
  acquiredBy: z.union([
    z.literal("purchase"),
    z.literal("gift"),
    z.literal("admin"),
    z.literal("reward"),
    z.literal("migration")
  ]).default("migration"),
  sourceId: z.string().optional(),
  condition: z.union([z.literal("new"), z.literal("good"), z.literal("worn"), z.literal("broken")]).optional(),
  currentValue: z.number().int().nonnegative().optional(),
  purchasePrice: z.number().int().nonnegative().optional(),
  wearLevel: z.number().int().min(0).max(100).optional(),
  durability: z.object({
    current: z.number().int().nonnegative(),
    maximum: z.number().int().positive()
  }).optional(),
  repairHistory: z.array(z.object({
    repairedAt: z.string(),
    cost: z.number().int().nonnegative(),
    conditionBefore: z.union([z.literal("new"), z.literal("good"), z.literal("worn"), z.literal("broken")]),
    wearBefore: z.number().int().min(0).max(100),
    conditionAfter: z.union([z.literal("new"), z.literal("good"), z.literal("worn"), z.literal("broken")]),
    wearAfter: z.number().int().min(0).max(100)
  })).optional(),
  upgradeHistory: z.array(z.object({
    upgradedAt: z.string(),
    upgradeId: z.string(),
    cost: z.number().int().nonnegative(),
    note: z.string()
  })).optional(),
  origin: z.object({ type: z.string(), referenceId: z.string().optional() }).optional(),
  location: locationSchema.default({ kind: "inventory" }),
  lifecycleStatus: z.union([
    z.literal("active"), z.literal("destroyed"), z.literal("expired"), z.literal("revoked"), z.literal("archived")
  ]).default("active"),
  state: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  rootInstanceId: z.string().optional(),
  parentInstanceId: z.string().optional(),
  version: z.number().int().positive().default(1),
  updatedAt: z.string().optional()
});

const domainEventSchema = z.preprocess(normalizeLegacyEvent, z.object({
  eventId: z.string(),
  eventType: z.string(),
  eventVersion: z.number().int().positive(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  aggregateVersion: z.number().int().positive(),
  occurredAt: z.string(),
  correlationId: z.string(),
  causationId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  id: z.string(),
  type: z.string()
}));

function normalizeLegacyEvent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const event = value as Record<string, unknown>;
  const eventId = event.eventId ?? event.id;
  const eventType = event.eventType ?? event.type;
  return {
    ...event,
    eventId,
    eventType,
    eventVersion: event.eventVersion ?? 1,
    aggregateVersion: event.aggregateVersion ?? 1,
    causationId: event.causationId ?? event.correlationId ?? eventId,
    id: event.id ?? eventId,
    type: event.type ?? eventType
  };
}

const inventoryStateSchema = z.object({
  version: z.literal("1.0.0"),
  entries: z.record(z.string(), inventoryEntrySchema),
  reservations: z.record(z.string(), z.object({
    id: z.string(),
    entryId: z.string(),
    quantity: z.number().int().positive(),
    purposeType: z.string(),
    purposeRef: z.string(),
    createdBy: actorSchema,
    status: z.union([z.literal("active"), z.literal("released"), z.literal("committed"), z.literal("expired")]),
    expiresAt: z.string(),
    idempotencyKey: z.string(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string()
  })),
  equipment: z.record(z.string(), z.object({
    id: z.string(), owner: ownerSchema, slotCode: z.string(), entryId: z.string(), quantity: z.number().int().positive(),
    equippedAt: z.string(), version: z.number().int().positive()
  })),
  leases: z.record(z.string(), z.object({
    id: z.string(), lessor: ownerSchema, lessee: ownerSchema, entryId: z.string(), quantity: z.number().int().positive(),
    startsAt: z.string(), endsAt: z.string(),
    status: z.union([z.literal("active"), z.literal("returned"), z.literal("expired")]),
    termsRef: z.string(), createdBy: actorSchema, returnedAt: z.string().optional(), version: z.number().int().positive(),
    createdAt: z.string(), updatedAt: z.string()
  })),
  operations: z.record(z.string(), z.object({
    id: z.string(), type: z.string(), requestId: z.string(), idempotencyKey: z.string(), correlationId: z.string(),
    actor: actorSchema.optional(), payloadHash: z.string(), result: z.unknown(), createdAt: z.string()
  })),
  idempotencyKeys: z.record(z.string(), z.string()),
  history: z.array(domainEventSchema),
  outbox: z.record(z.string(), z.object({ event: domainEventSchema, publishedAt: z.string().optional(), attempts: z.number().int().nonnegative() })),
  actionSessions: z.record(z.string(), z.object({
    id: z.string(), type: z.literal("gift"), actorId: z.number().int(), entryId: z.string(), targetOwner: ownerSchema,
    quantity: z.number().int().positive(),
    status: z.union([z.literal("active"), z.literal("completed"), z.literal("cancelled"), z.literal("expired")]),
    createdAt: z.string(), expiresAt: z.string(), completedEntryId: z.string().optional()
  })).default({})
});

const ownershipStateSchema = z.object({
  version: z.literal("1.0.0"),
  owners: z.record(z.string(), z.object({
    key: z.string(), owner: ownerSchema,
    status: z.union([z.literal("active"), z.literal("suspended"), z.literal("archived")]),
    version: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string()
  })),
  records: z.record(z.string(), z.object({
    entryId: z.string(), legalOwner: ownerSchema, custodyOwner: ownerSchema.optional(),
    status: z.union([z.literal("active"), z.literal("confiscated"), z.literal("archived")]),
    acquiredAt: z.string(), acquiredByOperationId: z.string(), version: z.number().int().positive(), updatedAt: z.string()
  })),
  entryIdsByOwner: z.record(z.string(), z.array(z.string())),
  permissions: z.record(z.string(), z.object({
    id: z.string(), entryId: z.string(), principal: actorSchema,
    permission: ownershipPermissionCodeSchema,
    effect: z.union([z.literal("allow"), z.literal("deny")]), source: z.string(), createdAt: z.string(),
    expiresAt: z.string().optional(), revokedAt: z.string().optional(), version: z.number().int().positive()
  })),
  ownerAccess: z.record(z.string(), z.object({
    id: z.string(), owner: ownerSchema, principal: actorSchema,
    permissions: z.array(ownershipPermissionCodeSchema),
    source: z.string(), createdAt: z.string(), expiresAt: z.string().optional(), revokedAt: z.string().optional(),
    version: z.number().int().positive()
  })),
  history: z.array(domainEventSchema),
  outbox: z.record(z.string(), z.object({ event: domainEventSchema, publishedAt: z.string().optional(), attempts: z.number().int().nonnegative() })).default({})
});

const checkoutSessionSchema = z.object({
  id: z.string(),
  type: z.union([z.literal("purchase"), z.literal("sale")]),
  actorId: z.number().int(),
  owner: ownerSchema,
  productId: z.string(),
  listingId: z.string().optional(),
  inventoryEntryId: z.string().optional(),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  totalPrice: moneySchema,
  listingVersion: z.number().int().positive().optional(),
  status: z.union([z.literal("active"), z.literal("consumed"), z.literal("cancelled"), z.literal("expired")]),
  expiresAt: z.string(),
  createdAt: z.string(),
  consumedOrderId: z.string().optional()
});

const shopOrderSchema = z.object({
  id: z.string(),
  type: z.union([z.literal("purchase"), z.literal("sale")]),
  actorId: z.number().int(),
  owner: ownerSchema,
  productId: z.string(),
  listingId: z.string().optional(),
  inventoryEntryIds: z.array(z.string()),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  totalPrice: moneySchema,
  account: accountSchema,
  status: z.literal("completed"),
  idempotencyKey: z.string(),
  correlationId: z.string(),
  createdAt: z.string(),
  completedAt: z.string()
});

const shopStateSchema = z.object({
  version: z.literal("1.0.0"),
  checkoutSessions: z.record(z.string(), checkoutSessionSchema),
  orders: z.record(z.string(), shopOrderSchema),
  idempotencyKeys: z.record(z.string(), z.string()),
  listingRuntime: z.record(z.string(), z.object({
    version: z.number().int().positive(),
    stockRemaining: z.number().int().nonnegative().optional(),
    updatedAt: z.string()
  }))
});

const unlockStateSchema = z.object({
  records: z.record(z.string(), z.object({
    id: z.string(),
    owner: ownerSchema,
    type: z.string(),
    targetId: z.string(),
    sourceProductId: z.string(),
    sourceInventoryEntryId: z.string(),
    mode: z.union([z.literal("permanent"), z.literal("while_owned")]),
    grantedAt: z.string(),
    revokedAt: z.string().optional()
  })),
  reconciledOwners: z.record(z.string(), z.number().int().positive()).default({})
});

const outboxRecordSchema = z.object({
  event: domainEventSchema,
  status: z.union([z.literal("pending"), z.literal("published"), z.literal("failed"), z.literal("dead_letter")]),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string(),
  createdAt: z.string(),
  publishedAt: z.string().optional(),
  lastAttemptAt: z.string().optional(),
  lastError: z.string().optional()
});

const inboxRecordSchema = z.preprocess(normalizeLegacyInbox, z.object({
  messageId: z.string(),
  consumer: z.string(),
  payloadSchemaId: z.string(),
  payloadSchemaVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  status: z.union([z.literal("processing"), z.literal("processed"), z.literal("failed")]),
  attempts: z.number().int().nonnegative(),
  receivedAt: z.string(),
  updatedAt: z.string(),
  lockedUntil: z.string().optional(),
  processedAt: z.string().optional(),
  lastError: z.string().optional()
}));

function normalizeLegacyInbox(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return { ...record, updatedAt: record.updatedAt ?? record.processedAt ?? record.receivedAt };
}

const idempotencyRecordSchema = z.object({
  scope: z.string(), key: z.string(), payloadHash: z.string(), result: z.unknown(), createdAt: z.string(), expiresAt: z.string()
});

const scheduledTaskSchema = z.object({
  id: z.string(), taskType: z.string(), payloadSchemaId: z.string(), payloadSchemaVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  status: z.union([z.literal("pending"), z.literal("running"), z.literal("completed"), z.literal("failed"), z.literal("cancelled")]),
  runAt: z.string(), attempts: z.number().int().nonnegative(), maxAttempts: z.number().int().positive(),
  idempotencyKey: z.string(), correlationId: z.string(), causationId: z.string(), createdBy: actorSchema,
  createdAt: z.string(), updatedAt: z.string(), lockedUntil: z.string().optional(), completedAt: z.string().optional(), lastError: z.string().optional()
});

const runtimeStateSchema = z.object({
  version: z.literal("1.0.0"),
  history: z.array(domainEventSchema),
  outbox: z.record(z.string(), outboxRecordSchema),
  inbox: z.record(z.string(), inboxRecordSchema),
  idempotency: z.record(z.string(), idempotencyRecordSchema),
  schedulerTasks: z.record(z.string(), scheduledTaskSchema)
});

const playerSchema = z.object({
  id: z.number().int(),
  username: z.string().optional(),
  firstName: z.string(),
  balance: z.number().int().nonnegative(),
  bankBalance: z.number().int().nonnegative().default(0),
  country: z.string().default("Uzbekistan"),
  level: z.number().int().positive(),
  xp: z.number().int().nonnegative(),
  energy: z.number().int().nonnegative(),
  jobId: z.string().optional(),
  familyId: z.string().optional(),
  inventory: z.array(inventoryEntrySchema),
  achievements: z.array(z.string()),
  skills: z.record(z.string(), z.number()),
  transportIds: z.array(z.string()),
  homeIds: z.array(z.string()),
  businessIds: z.array(z.string()).default([]),
  petIds: z.array(z.string()),
  settings: z.object({
    blocked: z.boolean(),
    locale: z.literal("ru"),
    notifications: z.boolean()
  }),
  dailyRewardClaimedAt: z.string().optional(),
  lastWorkedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const familySchema = z.object({
  id: z.string(),
  partnerIds: z.tuple([z.number().int(), z.number().int()]),
  love: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  xp: z.number().int().nonnegative(),
  capital: z.number().int().nonnegative(),
  title: z.string(),
  inventory: z.array(inventoryEntrySchema),
  achievements: z.array(z.string()),
  travelIds: z.array(z.string()),
  stats: z.object({
    jobsCompleted: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
    travels: z.number().int().nonnegative(),
    giftsSent: z.number().int().nonnegative(),
    totalEarned: z.number().int().nonnegative(),
    totalSpent: z.number().int().nonnegative()
  }),
  weddingDate: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const gameStateSchema: z.ZodType<GameState> = z.object({
  players: z.record(z.string(), playerSchema),
  families: z.record(z.string(), familySchema),
  marriageProposals: z.record(z.string(), z.object({
    id: z.string(),
    proposerId: z.number().int(),
    targetId: z.number().int(),
    chatId: z.number().int(),
    expiresAt: z.string(),
    createdAt: z.string()
  })),
  ledger: z.array(z.object({
    id: z.string(),
    userId: z.number().int().optional(),
    familyId: z.string().optional(),
    amount: z.number().int(),
    reason: z.string(),
    currency: z.string().optional(),
    accountKind: z.union([z.literal("player_cash"), z.literal("player_bank"), z.literal("family_capital")]).optional(),
    referenceType: z.string().optional(),
    referenceId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    correlationId: z.string().optional(),
    balanceAfter: z.number().int().nonnegative().optional(),
    createdAt: z.string()
  })),
  logs: z.array(z.object({
    id: z.string(),
    level: z.union([z.literal("info"), z.literal("warn"), z.literal("error")]),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string()
  })),
  shop: shopStateSchema.default(createEmptyShopState),
  unlocks: unlockStateSchema.default(createEmptyUnlockState),
  inventory: inventoryStateSchema.default(createEmptyInventoryState),
  ownership: ownershipStateSchema.default(createEmptyOwnershipState),
  runtime: runtimeStateSchema.default(createEmptyRuntimeState),
  stats: z.object({
    commandsHandled: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
    marriages: z.number().int().nonnegative(),
    jobsCompleted: z.number().int().nonnegative(),
    travels: z.number().int().nonnegative(),
    dailyRewards: z.number().int().nonnegative(),
    adminActions: z.number().int().nonnegative()
  })
});

export const createEmptyGameState = (): GameState => ({
  players: {},
  families: {},
  marriageProposals: {},
  ledger: [],
  logs: [],
  shop: createEmptyShopState(),
  unlocks: createEmptyUnlockState(),
  inventory: createEmptyInventoryState(),
  ownership: createEmptyOwnershipState(),
  runtime: createEmptyRuntimeState(),
  stats: {
    commandsHandled: 0,
    purchases: 0,
    marriages: 0,
    jobsCompleted: 0,
    travels: 0,
    dailyRewards: 0,
    adminActions: 0
  }
});

function migrateLegacyInventory(state: GameState): GameState {
  for (const player of Object.values(state.players)) {
    migrateOwnerInventory(state, { kind: "player", id: player.id }, player.inventory, player.createdAt);
    player.inventory = projectedInventory(state, { kind: "player", id: player.id });
  }
  for (const family of Object.values(state.families)) {
    migrateOwnerInventory(state, { kind: "family", id: family.id }, family.inventory, family.createdAt);
    family.inventory = projectedInventory(state, { kind: "family", id: family.id });
  }
  migrateLegacyRuntimeState(state);
  return state;
}

function migrateLegacyRuntimeState(state: GameState): void {
  const knownEventIds = new Set(state.runtime.history.map((event) => event.eventId));
  for (const history of [state.inventory.history, state.ownership.history]) {
    for (const event of history) {
      if (knownEventIds.has(event.eventId)) continue;
      state.runtime.history.push(event);
      knownEventIds.add(event.eventId);
    }
  }
  for (const outbox of [state.inventory.outbox, state.ownership.outbox]) {
    for (const record of Object.values(outbox)) {
      if (state.runtime.outbox[record.event.eventId]) continue;
      state.runtime.outbox[record.event.eventId] = {
        event: record.event,
        status: record.publishedAt ? "published" : "pending",
        attempts: record.attempts,
        nextAttemptAt: record.event.occurredAt,
        createdAt: record.event.occurredAt,
        publishedAt: record.publishedAt,
        lastAttemptAt: record.publishedAt
      };
    }
  }
  state.inventory.history = [];
  state.inventory.outbox = {};
  state.ownership.history = [];
  state.ownership.outbox = {};
}

function migrateOwnerInventory(
  state: GameState,
  owner: OwnerRef,
  legacyEntries: GameState["players"][string]["inventory"],
  createdAt: string
): void {
  const key = ownerKey(owner);
  state.ownership.owners[key] ??= {
    key,
    owner,
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
  state.ownership.entryIdsByOwner[key] ??= [];

  for (const entry of legacyEntries) {
    entry.rootInstanceId ??= entry.instanceId;
    entry.updatedAt ??= entry.acquiredAt;
    const existingOwnership = state.ownership.records[entry.instanceId];
    if (existingOwnership && ownerKey(existingOwnership.legalOwner) !== key) {
      throw new Error(`Inventory entry ${entry.instanceId} has conflicting legacy owners`);
    }
    state.inventory.entries[entry.instanceId] ??= entry;
    state.ownership.records[entry.instanceId] ??= {
      entryId: entry.instanceId,
      legalOwner: owner,
      status: "active",
      acquiredAt: entry.acquiredAt,
      acquiredByOperationId: "legacy-migration",
      version: 1,
      updatedAt: entry.updatedAt
    };
    if (!state.ownership.entryIdsByOwner[key].includes(entry.instanceId)) {
      state.ownership.entryIdsByOwner[key].push(entry.instanceId);
    }
  }
}

function projectedInventory(state: GameState, owner: OwnerRef): GameState["players"][string]["inventory"] {
  const key = ownerKey(owner);
  return (state.ownership.entryIdsByOwner[key] ?? []).flatMap((entryId) => {
    const entry = state.inventory.entries[entryId];
    const ownership = state.ownership.records[entryId];
    return entry && ownership && ownerKey(ownership.legalOwner) === key &&
      ownership.status !== "archived" && entry.lifecycleStatus === "active" ? [entry] : [];
  });
}

export class JsonGameDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<GameState> {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");

    try {
      return migrateLegacyInventory(gameStateSchema.parse(JSON.parse(raw)));
    } catch (error) {
      const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
      await fs.copyFile(this.filePath, corruptPath);
      throw new Error(`RPG JSON storage is corrupted. Source preserved; backup copied to ${corruptPath}. ${String(error)}`);
    }
  }

  async transaction<T>(handler: (state: GameState) => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      const state = await this.read();
      const result = await handler(state);
      gameStateSchema.parse(state);
      await this.write(state);
      return result;
    } finally {
      release();
    }
  }

  private async ensureFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.write(createEmptyGameState());
    }
  }

  private async write(state: GameState): Promise<void> {
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(state, null, 2)}\n`;

    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, this.filePath);
  }
}
