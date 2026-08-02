"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonGameDatabase = exports.createEmptyGameState = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const shop_1 = require("../../domain/shop");
const unlocks_1 = require("../../domain/unlocks");
const inventory_1 = require("../../domain/inventory");
const ownership_1 = require("../../domain/ownership");
const runtime_1 = require("../../domain/runtime");
const assets_1 = require("../../domain/assets");
const ids_1 = require("../../utils/ids");
const ownerSchema = zod_1.z.object({
    kind: zod_1.z.string().min(1),
    id: zod_1.z.union([zod_1.z.number().int(), zod_1.z.string().min(1)])
});
const actorSchema = zod_1.z.object({
    kind: zod_1.z.union([zod_1.z.literal("player"), zod_1.z.literal("admin"), zod_1.z.literal("service"), zod_1.z.literal("scheduler")]),
    id: zod_1.z.union([zod_1.z.number().int(), zod_1.z.string().min(1)])
});
const ownershipPermissionCodeSchema = zod_1.z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/);
const locationSchema = zod_1.z.object({ kind: zod_1.z.string().min(1), id: zod_1.z.string().optional() });
const accountSchema = zod_1.z.union([
    zod_1.z.object({ kind: zod_1.z.literal("player_cash"), playerId: zod_1.z.number().int() }),
    zod_1.z.object({ kind: zod_1.z.literal("player_bank"), playerId: zod_1.z.number().int() }),
    zod_1.z.object({ kind: zod_1.z.literal("family_capital"), familyId: zod_1.z.string() })
]);
const moneySchema = zod_1.z.object({
    amount: zod_1.z.number().int().positive(),
    currency: zod_1.z.string().min(1)
});
const inventoryEntrySchema = zod_1.z.object({
    instanceId: zod_1.z.string().default(() => (0, ids_1.createId)("asset")),
    itemId: zod_1.z.string(),
    quantity: zod_1.z.number().int().positive(),
    reservedQuantity: zod_1.z.number().int().nonnegative().default(0),
    acquiredAt: zod_1.z.string(),
    acquiredBy: zod_1.z.union([
        zod_1.z.literal("purchase"),
        zod_1.z.literal("gift"),
        zod_1.z.literal("admin"),
        zod_1.z.literal("reward"),
        zod_1.z.literal("migration")
    ]).default("migration"),
    sourceId: zod_1.z.string().optional(),
    condition: zod_1.z.union([zod_1.z.literal("new"), zod_1.z.literal("good"), zod_1.z.literal("worn"), zod_1.z.literal("broken")]).optional(),
    currentValue: zod_1.z.number().int().nonnegative().optional(),
    purchasePrice: zod_1.z.number().int().nonnegative().optional(),
    wearLevel: zod_1.z.number().int().min(0).max(100).optional(),
    durability: zod_1.z.object({
        current: zod_1.z.number().int().nonnegative(),
        maximum: zod_1.z.number().int().positive()
    }).optional(),
    repairHistory: zod_1.z.array(zod_1.z.object({
        repairedAt: zod_1.z.string(),
        cost: zod_1.z.number().int().nonnegative(),
        conditionBefore: zod_1.z.union([zod_1.z.literal("new"), zod_1.z.literal("good"), zod_1.z.literal("worn"), zod_1.z.literal("broken")]),
        wearBefore: zod_1.z.number().int().min(0).max(100),
        conditionAfter: zod_1.z.union([zod_1.z.literal("new"), zod_1.z.literal("good"), zod_1.z.literal("worn"), zod_1.z.literal("broken")]),
        wearAfter: zod_1.z.number().int().min(0).max(100)
    })).optional(),
    upgradeHistory: zod_1.z.array(zod_1.z.object({
        upgradedAt: zod_1.z.string(),
        upgradeId: zod_1.z.string(),
        cost: zod_1.z.number().int().nonnegative(),
        note: zod_1.z.string()
    })).optional(),
    origin: zod_1.z.object({ type: zod_1.z.string(), referenceId: zod_1.z.string().optional() }).optional(),
    location: locationSchema.default({ kind: "inventory" }),
    lifecycleStatus: zod_1.z.union([
        zod_1.z.literal("active"), zod_1.z.literal("destroyed"), zod_1.z.literal("expired"), zod_1.z.literal("revoked"), zod_1.z.literal("archived")
    ]).default("active"),
    state: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    rootInstanceId: zod_1.z.string().optional(),
    parentInstanceId: zod_1.z.string().optional(),
    version: zod_1.z.number().int().positive().default(1),
    updatedAt: zod_1.z.string().optional()
});
const domainEventSchema = zod_1.z.preprocess(normalizeLegacyEvent, zod_1.z.object({
    eventId: zod_1.z.string(),
    eventType: zod_1.z.string(),
    eventVersion: zod_1.z.number().int().positive(),
    aggregateType: zod_1.z.string(),
    aggregateId: zod_1.z.string(),
    aggregateVersion: zod_1.z.number().int().positive(),
    occurredAt: zod_1.z.string(),
    correlationId: zod_1.z.string(),
    causationId: zod_1.z.string(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    id: zod_1.z.string(),
    type: zod_1.z.string()
}));
function normalizeLegacyEvent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
    const event = value;
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
const inventoryStateSchema = zod_1.z.object({
    version: zod_1.z.literal("1.0.0"),
    entries: zod_1.z.record(zod_1.z.string(), inventoryEntrySchema),
    reservations: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(),
        entryId: zod_1.z.string(),
        quantity: zod_1.z.number().int().positive(),
        purposeType: zod_1.z.string(),
        purposeRef: zod_1.z.string(),
        createdBy: actorSchema,
        status: zod_1.z.union([zod_1.z.literal("active"), zod_1.z.literal("released"), zod_1.z.literal("committed"), zod_1.z.literal("expired")]),
        expiresAt: zod_1.z.string(),
        idempotencyKey: zod_1.z.string(),
        version: zod_1.z.number().int().positive(),
        createdAt: zod_1.z.string(),
        updatedAt: zod_1.z.string()
    })),
    equipment: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(), owner: ownerSchema, slotCode: zod_1.z.string(), entryId: zod_1.z.string(), quantity: zod_1.z.number().int().positive(),
        equippedAt: zod_1.z.string(), version: zod_1.z.number().int().positive()
    })),
    leases: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(), lessor: ownerSchema, lessee: ownerSchema, entryId: zod_1.z.string(), quantity: zod_1.z.number().int().positive(),
        startsAt: zod_1.z.string(), endsAt: zod_1.z.string(),
        status: zod_1.z.union([zod_1.z.literal("active"), zod_1.z.literal("returned"), zod_1.z.literal("expired")]),
        termsRef: zod_1.z.string(), createdBy: actorSchema, returnedAt: zod_1.z.string().optional(), version: zod_1.z.number().int().positive(),
        createdAt: zod_1.z.string(), updatedAt: zod_1.z.string()
    })),
    operations: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(), type: zod_1.z.string(), requestId: zod_1.z.string(), idempotencyKey: zod_1.z.string(), correlationId: zod_1.z.string(),
        actor: actorSchema.optional(), payloadHash: zod_1.z.string(), result: zod_1.z.unknown(), createdAt: zod_1.z.string()
    })),
    idempotencyKeys: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
    history: zod_1.z.array(domainEventSchema),
    outbox: zod_1.z.record(zod_1.z.string(), zod_1.z.object({ event: domainEventSchema, publishedAt: zod_1.z.string().optional(), attempts: zod_1.z.number().int().nonnegative() })),
    actionSessions: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(), type: zod_1.z.literal("gift"), actorId: zod_1.z.number().int(), entryId: zod_1.z.string(), targetOwner: ownerSchema,
        quantity: zod_1.z.number().int().positive(),
        status: zod_1.z.union([zod_1.z.literal("active"), zod_1.z.literal("completed"), zod_1.z.literal("cancelled"), zod_1.z.literal("expired")]),
        createdAt: zod_1.z.string(), expiresAt: zod_1.z.string(), completedEntryId: zod_1.z.string().optional()
    })).default({})
});
const ownershipStateSchema = zod_1.z.object({
    version: zod_1.z.literal("1.0.0"),
    owners: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        key: zod_1.z.string(), owner: ownerSchema,
        status: zod_1.z.union([zod_1.z.literal("active"), zod_1.z.literal("suspended"), zod_1.z.literal("archived")]),
        version: zod_1.z.number().int().positive(), createdAt: zod_1.z.string(), updatedAt: zod_1.z.string()
    })),
    records: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        entryId: zod_1.z.string(), legalOwner: ownerSchema, custodyOwner: ownerSchema.optional(),
        status: zod_1.z.union([zod_1.z.literal("active"), zod_1.z.literal("confiscated"), zod_1.z.literal("archived")]),
        acquiredAt: zod_1.z.string(), acquiredByOperationId: zod_1.z.string(), version: zod_1.z.number().int().positive(), updatedAt: zod_1.z.string()
    })),
    entryIdsByOwner: zod_1.z.record(zod_1.z.string(), zod_1.z.array(zod_1.z.string())),
    permissions: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(), entryId: zod_1.z.string(), principal: actorSchema,
        permission: ownershipPermissionCodeSchema,
        effect: zod_1.z.union([zod_1.z.literal("allow"), zod_1.z.literal("deny")]), source: zod_1.z.string(), createdAt: zod_1.z.string(),
        expiresAt: zod_1.z.string().optional(), revokedAt: zod_1.z.string().optional(), version: zod_1.z.number().int().positive()
    })),
    ownerAccess: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(), owner: ownerSchema, principal: actorSchema,
        permissions: zod_1.z.array(ownershipPermissionCodeSchema),
        source: zod_1.z.string(), createdAt: zod_1.z.string(), expiresAt: zod_1.z.string().optional(), revokedAt: zod_1.z.string().optional(),
        version: zod_1.z.number().int().positive()
    })),
    history: zod_1.z.array(domainEventSchema),
    outbox: zod_1.z.record(zod_1.z.string(), zod_1.z.object({ event: domainEventSchema, publishedAt: zod_1.z.string().optional(), attempts: zod_1.z.number().int().nonnegative() })).default({})
});
const checkoutSessionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: zod_1.z.union([zod_1.z.literal("purchase"), zod_1.z.literal("sale")]),
    actorId: zod_1.z.number().int(),
    owner: ownerSchema,
    productId: zod_1.z.string(),
    listingId: zod_1.z.string().optional(),
    inventoryEntryId: zod_1.z.string().optional(),
    quantity: zod_1.z.number().int().positive(),
    unitPrice: moneySchema,
    totalPrice: moneySchema,
    listingVersion: zod_1.z.number().int().positive().optional(),
    status: zod_1.z.union([zod_1.z.literal("active"), zod_1.z.literal("consumed"), zod_1.z.literal("cancelled"), zod_1.z.literal("expired")]),
    expiresAt: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    consumedOrderId: zod_1.z.string().optional()
});
const shopOrderSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: zod_1.z.union([zod_1.z.literal("purchase"), zod_1.z.literal("sale")]),
    actorId: zod_1.z.number().int(),
    owner: ownerSchema,
    productId: zod_1.z.string(),
    listingId: zod_1.z.string().optional(),
    inventoryEntryIds: zod_1.z.array(zod_1.z.string()),
    quantity: zod_1.z.number().int().positive(),
    unitPrice: moneySchema,
    totalPrice: moneySchema,
    account: accountSchema,
    status: zod_1.z.literal("completed"),
    idempotencyKey: zod_1.z.string(),
    correlationId: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    completedAt: zod_1.z.string()
});
const shopStateSchema = zod_1.z.object({
    version: zod_1.z.literal("1.0.0"),
    checkoutSessions: zod_1.z.record(zod_1.z.string(), checkoutSessionSchema),
    orders: zod_1.z.record(zod_1.z.string(), shopOrderSchema),
    idempotencyKeys: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
    listingRuntime: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        version: zod_1.z.number().int().positive(),
        stockRemaining: zod_1.z.number().int().nonnegative().optional(),
        updatedAt: zod_1.z.string()
    }))
});
const unlockStateSchema = zod_1.z.object({
    records: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(),
        owner: ownerSchema,
        type: zod_1.z.string(),
        targetId: zod_1.z.string(),
        sourceProductId: zod_1.z.string(),
        sourceInventoryEntryId: zod_1.z.string(),
        mode: zod_1.z.union([zod_1.z.literal("permanent"), zod_1.z.literal("while_owned")]),
        grantedAt: zod_1.z.string(),
        revokedAt: zod_1.z.string().optional()
    })),
    reconciledOwners: zod_1.z.record(zod_1.z.string(), zod_1.z.number().int().positive()).default({})
});
const outboxRecordSchema = zod_1.z.object({
    event: domainEventSchema,
    status: zod_1.z.union([zod_1.z.literal("pending"), zod_1.z.literal("published"), zod_1.z.literal("failed"), zod_1.z.literal("dead_letter")]),
    attempts: zod_1.z.number().int().nonnegative(),
    nextAttemptAt: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    publishedAt: zod_1.z.string().optional(),
    lastAttemptAt: zod_1.z.string().optional(),
    lastError: zod_1.z.string().optional()
});
const inboxRecordSchema = zod_1.z.preprocess(normalizeLegacyInbox, zod_1.z.object({
    messageId: zod_1.z.string(),
    consumer: zod_1.z.string(),
    payloadSchemaId: zod_1.z.string(),
    payloadSchemaVersion: zod_1.z.number().int().positive(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    status: zod_1.z.union([zod_1.z.literal("processing"), zod_1.z.literal("processed"), zod_1.z.literal("failed")]),
    attempts: zod_1.z.number().int().nonnegative(),
    receivedAt: zod_1.z.string(),
    updatedAt: zod_1.z.string(),
    lockedUntil: zod_1.z.string().optional(),
    processedAt: zod_1.z.string().optional(),
    lastError: zod_1.z.string().optional()
}));
function normalizeLegacyInbox(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
    const record = value;
    return { ...record, updatedAt: record.updatedAt ?? record.processedAt ?? record.receivedAt };
}
const idempotencyRecordSchema = zod_1.z.object({
    scope: zod_1.z.string(), key: zod_1.z.string(), payloadHash: zod_1.z.string(), result: zod_1.z.unknown(), createdAt: zod_1.z.string(), expiresAt: zod_1.z.string()
});
const scheduledTaskSchema = zod_1.z.object({
    id: zod_1.z.string(), taskType: zod_1.z.string(), payloadSchemaId: zod_1.z.string(), payloadSchemaVersion: zod_1.z.number().int().positive(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    status: zod_1.z.union([zod_1.z.literal("pending"), zod_1.z.literal("running"), zod_1.z.literal("completed"), zod_1.z.literal("failed"), zod_1.z.literal("cancelled")]),
    runAt: zod_1.z.string(), attempts: zod_1.z.number().int().nonnegative(), maxAttempts: zod_1.z.number().int().positive(),
    idempotencyKey: zod_1.z.string(), correlationId: zod_1.z.string(), causationId: zod_1.z.string(), createdBy: actorSchema,
    createdAt: zod_1.z.string(), updatedAt: zod_1.z.string(), lockedUntil: zod_1.z.string().optional(), completedAt: zod_1.z.string().optional(), lastError: zod_1.z.string().optional()
});
const runtimeStateSchema = zod_1.z.object({
    version: zod_1.z.literal("1.0.0"),
    history: zod_1.z.array(domainEventSchema),
    outbox: zod_1.z.record(zod_1.z.string(), outboxRecordSchema),
    inbox: zod_1.z.record(zod_1.z.string(), inboxRecordSchema),
    idempotency: zod_1.z.record(zod_1.z.string(), idempotencyRecordSchema),
    schedulerTasks: zod_1.z.record(zod_1.z.string(), scheduledTaskSchema)
});
const playerSchema = zod_1.z.object({
    id: zod_1.z.number().int(),
    username: zod_1.z.string().optional(),
    firstName: zod_1.z.string(),
    balance: zod_1.z.number().int().nonnegative(),
    bankBalance: zod_1.z.number().int().nonnegative().default(0),
    country: zod_1.z.string().default("Uzbekistan"),
    level: zod_1.z.number().int().positive(),
    xp: zod_1.z.number().int().nonnegative(),
    energy: zod_1.z.number().int().nonnegative(),
    jobId: zod_1.z.string().optional(),
    familyId: zod_1.z.string().optional(),
    inventory: zod_1.z.array(inventoryEntrySchema),
    achievements: zod_1.z.array(zod_1.z.string()),
    skills: zod_1.z.record(zod_1.z.string(), zod_1.z.number()),
    transportIds: zod_1.z.array(zod_1.z.string()),
    homeIds: zod_1.z.array(zod_1.z.string()),
    businessIds: zod_1.z.array(zod_1.z.string()).default([]),
    petIds: zod_1.z.array(zod_1.z.string()),
    settings: zod_1.z.object({
        blocked: zod_1.z.boolean(),
        locale: zod_1.z.literal("ru"),
        notifications: zod_1.z.boolean()
    }),
    dailyRewardClaimedAt: zod_1.z.string().optional(),
    lastWorkedAt: zod_1.z.string().optional(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string()
});
const familySchema = zod_1.z.object({
    id: zod_1.z.string(),
    partnerIds: zod_1.z.tuple([zod_1.z.number().int(), zod_1.z.number().int()]),
    love: zod_1.z.number().int().nonnegative(),
    level: zod_1.z.number().int().positive(),
    xp: zod_1.z.number().int().nonnegative(),
    capital: zod_1.z.number().int().nonnegative(),
    title: zod_1.z.string(),
    inventory: zod_1.z.array(inventoryEntrySchema),
    achievements: zod_1.z.array(zod_1.z.string()),
    travelIds: zod_1.z.array(zod_1.z.string()),
    stats: zod_1.z.object({
        jobsCompleted: zod_1.z.number().int().nonnegative(),
        purchases: zod_1.z.number().int().nonnegative(),
        travels: zod_1.z.number().int().nonnegative(),
        giftsSent: zod_1.z.number().int().nonnegative(),
        totalEarned: zod_1.z.number().int().nonnegative(),
        totalSpent: zod_1.z.number().int().nonnegative()
    }),
    weddingDate: zod_1.z.string(),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string()
});
const gameStateSchema = zod_1.z.object({
    players: zod_1.z.record(zod_1.z.string(), playerSchema),
    families: zod_1.z.record(zod_1.z.string(), familySchema),
    marriageProposals: zod_1.z.record(zod_1.z.string(), zod_1.z.object({
        id: zod_1.z.string(),
        proposerId: zod_1.z.number().int(),
        targetId: zod_1.z.number().int(),
        chatId: zod_1.z.number().int(),
        expiresAt: zod_1.z.string(),
        createdAt: zod_1.z.string()
    })),
    ledger: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        userId: zod_1.z.number().int().optional(),
        familyId: zod_1.z.string().optional(),
        amount: zod_1.z.number().int(),
        reason: zod_1.z.string(),
        currency: zod_1.z.string().optional(),
        accountKind: zod_1.z.union([zod_1.z.literal("player_cash"), zod_1.z.literal("player_bank"), zod_1.z.literal("family_capital")]).optional(),
        referenceType: zod_1.z.string().optional(),
        referenceId: zod_1.z.string().optional(),
        idempotencyKey: zod_1.z.string().optional(),
        correlationId: zod_1.z.string().optional(),
        balanceAfter: zod_1.z.number().int().nonnegative().optional(),
        createdAt: zod_1.z.string()
    })),
    logs: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        level: zod_1.z.union([zod_1.z.literal("info"), zod_1.z.literal("warn"), zod_1.z.literal("error")]),
        message: zod_1.z.string(),
        meta: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
        createdAt: zod_1.z.string()
    })),
    shop: shopStateSchema.default(shop_1.createEmptyShopState),
    unlocks: unlockStateSchema.default(unlocks_1.createEmptyUnlockState),
    inventory: inventoryStateSchema.default(inventory_1.createEmptyInventoryState),
    ownership: ownershipStateSchema.default(ownership_1.createEmptyOwnershipState),
    runtime: runtimeStateSchema.default(runtime_1.createEmptyRuntimeState),
    stats: zod_1.z.object({
        commandsHandled: zod_1.z.number().int().nonnegative(),
        purchases: zod_1.z.number().int().nonnegative(),
        marriages: zod_1.z.number().int().nonnegative(),
        jobsCompleted: zod_1.z.number().int().nonnegative(),
        travels: zod_1.z.number().int().nonnegative(),
        dailyRewards: zod_1.z.number().int().nonnegative(),
        adminActions: zod_1.z.number().int().nonnegative()
    })
});
const createEmptyGameState = () => ({
    players: {},
    families: {},
    marriageProposals: {},
    ledger: [],
    logs: [],
    shop: (0, shop_1.createEmptyShopState)(),
    unlocks: (0, unlocks_1.createEmptyUnlockState)(),
    inventory: (0, inventory_1.createEmptyInventoryState)(),
    ownership: (0, ownership_1.createEmptyOwnershipState)(),
    runtime: (0, runtime_1.createEmptyRuntimeState)(),
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
exports.createEmptyGameState = createEmptyGameState;
function migrateLegacyInventory(state) {
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
function migrateLegacyRuntimeState(state) {
    const knownEventIds = new Set(state.runtime.history.map((event) => event.eventId));
    for (const history of [state.inventory.history, state.ownership.history]) {
        for (const event of history) {
            if (knownEventIds.has(event.eventId))
                continue;
            state.runtime.history.push(event);
            knownEventIds.add(event.eventId);
        }
    }
    for (const outbox of [state.inventory.outbox, state.ownership.outbox]) {
        for (const record of Object.values(outbox)) {
            if (state.runtime.outbox[record.event.eventId])
                continue;
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
function migrateOwnerInventory(state, owner, legacyEntries, createdAt) {
    const key = (0, assets_1.ownerKey)(owner);
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
        if (existingOwnership && (0, assets_1.ownerKey)(existingOwnership.legalOwner) !== key) {
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
function projectedInventory(state, owner) {
    const key = (0, assets_1.ownerKey)(owner);
    return (state.ownership.entryIdsByOwner[key] ?? []).flatMap((entryId) => {
        const entry = state.inventory.entries[entryId];
        const ownership = state.ownership.records[entryId];
        return entry && ownership && (0, assets_1.ownerKey)(ownership.legalOwner) === key &&
            ownership.status !== "archived" && entry.lifecycleStatus === "active" ? [entry] : [];
    });
}
class JsonGameDatabase {
    filePath;
    queue = Promise.resolve();
    constructor(filePath) {
        this.filePath = filePath;
    }
    async read() {
        await this.ensureFile();
        const raw = await node_fs_1.promises.readFile(this.filePath, "utf8");
        try {
            return migrateLegacyInventory(gameStateSchema.parse(JSON.parse(raw)));
        }
        catch (error) {
            const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
            await node_fs_1.promises.copyFile(this.filePath, corruptPath);
            throw new Error(`RPG JSON storage is corrupted. Source preserved; backup copied to ${corruptPath}. ${String(error)}`);
        }
    }
    async transaction(handler) {
        const previous = this.queue;
        let release = () => undefined;
        this.queue = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            const state = await this.read();
            const result = await handler(state);
            gameStateSchema.parse(state);
            await this.write(state);
            return result;
        }
        finally {
            release();
        }
    }
    async ensureFile() {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(this.filePath), { recursive: true });
        try {
            await node_fs_1.promises.access(this.filePath);
        }
        catch {
            await this.write((0, exports.createEmptyGameState)());
        }
    }
    async write(state) {
        const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        const payload = `${JSON.stringify(state, null, 2)}\n`;
        await node_fs_1.promises.writeFile(tmpPath, payload, "utf8");
        await node_fs_1.promises.rename(tmpPath, this.filePath);
    }
}
exports.JsonGameDatabase = JsonGameDatabase;
