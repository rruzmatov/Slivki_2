import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCompositionRoot, type RpgCompositionRoot } from "../bootstrap/composition-root";
import { createEmptyGameState, JsonGameDatabase } from "../infrastructure/storage/json-game-database";
import type { DomainEvent } from "../domain/events";
import type { OperationContext } from "../domain/assets";

const operation: OperationContext = {
  requestId: "stabilization-request",
  idempotencyKey: "stabilization-request",
  correlationId: "stabilization-correlation",
  causationId: "stabilization-causation",
  now: "2026-08-02T12:00:00.000Z",
  actor: { kind: "service", id: "stabilization-test" }
};

test("Transaction Event Collector publishes only after a successful commit", async () => {
  const { app } = await root();
  const published: DomainEvent[] = [];
  app.eventBus.subscribe<Readonly<Record<string, unknown>>>("inventory.repaired", async (event) => { published.push(event); });
  await assert.rejects(() => app.unitOfWork.execute(async (scope) => {
    scope.eventCollector.collect(eventInput("rolled-back"), operation);
    throw new Error("rollback");
  }));
  assert.equal(published.length, 0);
  assert.equal((await app.execute((context) => context.events.listHistory({ eventType: "inventory.repaired", limit: 10 }))).length, 0);

  await app.unitOfWork.execute(async (scope) => {
    scope.eventCollector.collect(eventInput("committed"), operation);
  });
  assert.equal(published.length, 1);
  assert.equal(published[0].aggregateId, "committed");
  assert.equal((await app.execute((context) => context.events.listHistory({ eventType: "inventory.repaired", limit: 10 }))).length, 1);
  await app.stop();
});

test("Scheduler persists tasks and reclaims an expired running lease after restart", async () => {
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
    assert.ok(persisted);
    persisted.status = "running";
    persisted.lockedUntil = "2020-01-01T00:01:00.000Z";
    await context.scheduler.save(persisted);
  });
  await app.stop();

  const restarted = await createCompositionRoot({ storagePath });
  await restarted.schedulerService.runDue(100);
  const completed = await restarted.execute((context) => context.scheduler.findById(task.id));
  assert.equal(completed?.status, "completed");
  await restarted.stop();
});

test("Retention purges terminal History, Outbox, Inbox and Scheduler records", async () => {
  const { app } = await root();
  let eventId = "";
  await app.unitOfWork.execute(async (scope) => {
    const event = scope.eventCollector.collect(eventInput("retention-entry"), { ...operation, now: "2000-01-01T00:00:00.000Z" });
    eventId = event.eventId;
  }, { publishEvents: false });
  await app.execute(async (context) => {
    const outbox = await context.events.findOutbox(eventId);
    assert.ok(outbox);
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
  assert.equal(result.history, 1);
  assert.equal(result.outbox, 1);
  assert.equal(result.inbox, 1);
  assert.equal(result.schedulerTasks, 1);
  assert.equal(await app.execute((context) => context.events.findOutbox(eventId)), undefined);
  assert.equal(await app.execute((context) => context.events.findInbox(eventId, "retention-test")), undefined);
  assert.equal(await app.execute((context) => context.scheduler.findById("task_retention")), undefined);
  await app.stop();
});

test("JSON corruption preserves the source and creates a diagnostic backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-corrupt-"));
  const storagePath = path.join(directory, "state.json");
  const original = "{invalid-json";
  await fs.writeFile(storagePath, original, "utf8");
  await assert.rejects(() => new JsonGameDatabase(storagePath).read(), /Source preserved/);
  assert.equal(await fs.readFile(storagePath, "utf8"), original);
  assert.ok((await fs.readdir(directory)).some((file) => file.startsWith("state.json.corrupt.")));
});

test("legacy Inventory History and Outbox migrate to the central runtime store", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-events-migration-"));
  const storagePath = path.join(directory, "state.json");
  const state = createEmptyGameState();
  const event: DomainEvent = {
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
  await fs.writeFile(storagePath, JSON.stringify(state), "utf8");

  const app = await createCompositionRoot({ storagePath });
  const migrated = await new JsonGameDatabase(storagePath).read();
  assert.equal(migrated.runtime.history.filter((candidate) => candidate.eventId === event.eventId).length, 1);
  assert.equal(migrated.runtime.outbox[event.eventId]?.status, "pending");
  assert.equal(migrated.inventory.history.length, 0);
  assert.equal(Object.keys(migrated.inventory.outbox).length, 0);
  await app.stop();
});

test("JSON Repository reads are detached and require explicit saves", async () => {
  const { app } = await root();
  const identity = { id: 9101, firstName: "Detached" };
  const player = await app.gameServices.ensurePlayer(identity, operation.now);
  const originalBalance = player.balance;
  await app.execute(async (context) => {
    const detachedPlayer = await context.players.findById(identity.id);
    assert.ok(detachedPlayer);
    detachedPlayer.balance = 1;
  });
  assert.equal((await app.execute((context) => context.players.findById(identity.id)))?.balance, originalBalance);

  const owner = { kind: "player" as const, id: identity.id };
  const grant = await app.execute((context) => context.inventoryService.grant({
    owner, productId: "bike_giant_escape_3", quantity: 1, acquiredBy: "reward"
  }, { ...operation, requestId: "detached-grant", idempotencyKey: "detached-grant" }));
  const entryId = grant.inventoryEntryIds[0];
  const originalValue = (await app.execute((context) => context.inventoryQueryService.getEntry(owner, entryId))).currentValue;
  await app.execute(async (context) => {
    const detachedEntry = await context.inventory.findByInstanceId(entryId);
    assert.ok(detachedEntry);
    detachedEntry.currentValue = 1;
  });
  assert.equal((await app.execute((context) => context.inventoryQueryService.getEntry(owner, entryId))).currentValue, originalValue);
  await app.stop();
});

function eventInput(aggregateId: string) {
  return {
    eventType: "inventory.repaired",
    aggregateType: "inventory_entry",
    aggregateId,
    aggregateVersion: 1,
    payload: { inventoryEntryId: aggregateId }
  } as const;
}

async function root(): Promise<{ app: RpgCompositionRoot; storagePath: string }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-stabilization-"));
  const storagePath = path.join(directory, "state.json");
  return { app: await createCompositionRoot({ storagePath }), storagePath };
}
