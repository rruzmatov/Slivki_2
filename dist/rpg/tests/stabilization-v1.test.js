"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const composition_root_1 = require("../bootstrap/composition-root");
const json_game_database_1 = require("../infrastructure/storage/json-game-database");
const operation = {
    requestId: "stabilization-request",
    idempotencyKey: "stabilization-request",
    correlationId: "stabilization-correlation",
    causationId: "stabilization-causation",
    now: "2026-08-02T12:00:00.000Z",
    actor: { kind: "service", id: "stabilization-test" }
};
(0, node_test_1.default)("Transaction Event Collector publishes only after a successful commit", async () => {
    const { app } = await root();
    const published = [];
    app.eventBus.subscribe("inventory.repaired", async (event) => { published.push(event); });
    await strict_1.default.rejects(() => app.unitOfWork.execute(async (scope) => {
        scope.eventCollector.collect(eventInput("rolled-back"), operation);
        throw new Error("rollback");
    }));
    strict_1.default.equal(published.length, 0);
    strict_1.default.equal((await app.execute((context) => context.events.listHistory({ eventType: "inventory.repaired", limit: 10 }))).length, 0);
    await app.unitOfWork.execute(async (scope) => {
        scope.eventCollector.collect(eventInput("committed"), operation);
    });
    strict_1.default.equal(published.length, 1);
    strict_1.default.equal(published[0].aggregateId, "committed");
    strict_1.default.equal((await app.execute((context) => context.events.listHistory({ eventType: "inventory.repaired", limit: 10 }))).length, 1);
    await app.stop();
});
(0, node_test_1.default)("Scheduler persists tasks and reclaims an expired running lease after restart", async () => {
    const { app, storagePath } = await root();
    const task = await app.schedulerService.schedule({
        taskType: "inventory.action_session.expire",
        payload: { sessionId: "missing-session" },
        runAt: "2020-01-01T00:00:00.000Z",
        idempotencyKey: "scheduler-restart-test",
        correlationId: "scheduler-restart-test",
        causationId: "scheduler-restart-test",
        createdBy: { kind: "service", id: "stabilization-test" }
    });
    await app.execute(async (context) => {
        const persisted = await context.scheduler.findById(task.id);
        strict_1.default.ok(persisted);
        persisted.status = "running";
        persisted.lockedUntil = "2020-01-01T00:01:00.000Z";
        await context.scheduler.save(persisted);
    });
    await app.stop();
    const restarted = await (0, composition_root_1.createCompositionRoot)({ storagePath });
    await restarted.schedulerService.runDue(100);
    const completed = await restarted.execute((context) => context.scheduler.findById(task.id));
    strict_1.default.equal(completed?.status, "completed");
    await restarted.stop();
});
(0, node_test_1.default)("Retention purges terminal History, Outbox, Inbox and Scheduler records", async () => {
    const { app } = await root();
    let eventId = "";
    await app.unitOfWork.execute(async (scope) => {
        const event = scope.eventCollector.collect(eventInput("retention-entry"), { ...operation, now: "2000-01-01T00:00:00.000Z" });
        eventId = event.eventId;
    }, { publishEvents: false });
    await app.execute(async (context) => {
        const outbox = await context.events.findOutbox(eventId);
        strict_1.default.ok(outbox);
        outbox.status = "dead_letter";
        outbox.lastAttemptAt = "2000-01-01T00:00:00.000Z";
        await context.events.saveOutbox(outbox);
        await context.events.saveInbox({
            messageId: eventId,
            consumer: "retention-test",
            payloadSchemaId: "inventory.repaired",
            payloadSchemaVersion: 1,
            payload: {},
            status: "processed",
            attempts: 1,
            receivedAt: "2000-01-01T00:00:00.000Z",
            updatedAt: "2000-01-01T00:00:00.000Z",
            processedAt: "2000-01-01T00:00:00.000Z"
        });
        await context.scheduler.save({
            id: "task_retention", taskType: "inventory.action_session.expire", payloadSchemaId: "inventory.action_session.expire",
            payloadSchemaVersion: 1, payload: { sessionId: "expired" }, status: "failed", runAt: "2000-01-01T00:00:00.000Z",
            attempts: 10, maxAttempts: 10, idempotencyKey: "task-retention", correlationId: "task-retention",
            causationId: "task-retention", createdBy: { kind: "service", id: "stabilization-test" },
            createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z"
        });
    });
    const result = await app.retentionService.run();
    strict_1.default.equal(result.history, 1);
    strict_1.default.equal(result.outbox, 1);
    strict_1.default.equal(result.inbox, 1);
    strict_1.default.equal(result.schedulerTasks, 1);
    strict_1.default.equal(await app.execute((context) => context.events.findOutbox(eventId)), undefined);
    strict_1.default.equal(await app.execute((context) => context.events.findInbox(eventId, "retention-test")), undefined);
    strict_1.default.equal(await app.execute((context) => context.scheduler.findById("task_retention")), undefined);
    await app.stop();
});
(0, node_test_1.default)("JSON corruption preserves the source and creates a diagnostic backup", async () => {
    const directory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "slivki-corrupt-"));
    const storagePath = node_path_1.default.join(directory, "state.json");
    const original = "{invalid-json";
    await node_fs_1.promises.writeFile(storagePath, original, "utf8");
    await strict_1.default.rejects(() => new json_game_database_1.JsonGameDatabase(storagePath).read(), /Source preserved/);
    strict_1.default.equal(await node_fs_1.promises.readFile(storagePath, "utf8"), original);
    strict_1.default.ok((await node_fs_1.promises.readdir(directory)).some((file) => file.startsWith("state.json.corrupt.")));
});
(0, node_test_1.default)("legacy Inventory History and Outbox migrate to the central runtime store", async () => {
    const directory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "slivki-events-migration-"));
    const storagePath = node_path_1.default.join(directory, "state.json");
    const state = (0, json_game_database_1.createEmptyGameState)();
    const event = {
        eventId: "event_legacy",
        eventType: "inventory.repaired",
        eventVersion: 1,
        aggregateType: "inventory_entry",
        aggregateId: "asset_legacy",
        aggregateVersion: 2,
        occurredAt: "2025-01-01T00:00:00.000Z",
        correlationId: "legacy-correlation",
        causationId: "legacy-causation",
        payload: { inventoryEntryId: "asset_legacy" },
        id: "event_legacy",
        type: "inventory.repaired"
    };
    state.inventory.history.push(event);
    state.inventory.outbox[event.eventId] = { event, attempts: 1 };
    await node_fs_1.promises.writeFile(storagePath, JSON.stringify(state), "utf8");
    const app = await (0, composition_root_1.createCompositionRoot)({ storagePath });
    const migrated = await new json_game_database_1.JsonGameDatabase(storagePath).read();
    strict_1.default.equal(migrated.runtime.history.filter((candidate) => candidate.eventId === event.eventId).length, 1);
    strict_1.default.equal(migrated.runtime.outbox[event.eventId]?.status, "pending");
    strict_1.default.equal(migrated.inventory.history.length, 0);
    strict_1.default.equal(Object.keys(migrated.inventory.outbox).length, 0);
    await app.stop();
});
(0, node_test_1.default)("JSON Repository reads are detached and require explicit saves", async () => {
    const { app } = await root();
    const identity = { id: 9101, firstName: "Detached" };
    const player = await app.gameServices.ensurePlayer(identity, operation.now);
    const originalBalance = player.balance;
    await app.execute(async (context) => {
        const detachedPlayer = await context.players.findById(identity.id);
        strict_1.default.ok(detachedPlayer);
        detachedPlayer.balance = 1;
    });
    strict_1.default.equal((await app.execute((context) => context.players.findById(identity.id)))?.balance, originalBalance);
    const owner = { kind: "player", id: identity.id };
    const grant = await app.execute((context) => context.inventoryService.grant({
        owner, productId: "bike_giant_escape_3", quantity: 1, acquiredBy: "reward"
    }, { ...operation, requestId: "detached-grant", idempotencyKey: "detached-grant" }));
    const entryId = grant.inventoryEntryIds[0];
    const originalValue = (await app.execute((context) => context.inventoryQueryService.getEntry(owner, entryId))).currentValue;
    await app.execute(async (context) => {
        const detachedEntry = await context.inventory.findByInstanceId(entryId);
        strict_1.default.ok(detachedEntry);
        detachedEntry.currentValue = 1;
    });
    strict_1.default.equal((await app.execute((context) => context.inventoryQueryService.getEntry(owner, entryId))).currentValue, originalValue);
    await app.stop();
});
function eventInput(aggregateId) {
    return {
        eventType: "inventory.repaired",
        aggregateType: "inventory_entry",
        aggregateId,
        aggregateVersion: 1,
        payload: { inventoryEntryId: aggregateId }
    };
}
async function root() {
    const directory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "slivki-stabilization-"));
    const storagePath = node_path_1.default.join(directory, "state.json");
    return { app: await (0, composition_root_1.createCompositionRoot)({ storagePath }), storagePath };
}
