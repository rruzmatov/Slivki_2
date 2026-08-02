import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCompositionRoot, type RpgCompositionRoot } from "../bootstrap/composition-root";
import { DomainError } from "../domain/errors";
import type { OperationContext, OwnerRef } from "../domain/assets";
import { GAME_BALANCE } from "../config/game-balance";

const now = "2026-08-02T12:00:00.000Z";
const playerOne = { id: 2001, firstName: "Первый" };
const playerTwo = { id: 2002, firstName: "Второй" };
const firstOwner: OwnerRef = { kind: "player", id: playerOne.id };
const secondOwner: OwnerRef = { kind: "player", id: playerTwo.id };

const operation = (id: string, actorId?: number): OperationContext => ({
  requestId: id, idempotencyKey: id, correlationId: id, now,
  actor: actorId ? { kind: "player", id: actorId } : { kind: "service", id: "inventory-test" }
});

async function root(): Promise<RpgCompositionRoot> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-inventory-"));
  const app = await createCompositionRoot({ storagePath: path.join(directory, "state.json"), ownerIds: [999] });
  await app.gameServices.ensurePlayer(playerOne, now);
  await app.gameServices.ensurePlayer(playerTwo, now);
  return app;
}

test("Inventory rejects currency while Economy remains authoritative", async () => {
  const app = await root();
  await assert.rejects(() => app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "currency_sum", quantity: 100, acquiredBy: "reward"
  }, operation("currency"))), (error) => error instanceof DomainError && error.code === "INVENTORY_CURRENCY_FORBIDDEN");
  assert.equal((await app.gameServices.getPlayerProfile(playerOne, now)).player.balance, GAME_BALANCE.player.startingBalance);
});

test("Inventory stores assets and Ownership is authoritative with idempotent replay", async () => {
  const app = await root();
  const first = await app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "bike_giant_escape_3", quantity: 1, acquiredBy: "reward", sourceId: "reward-1"
  }, operation("grant-bike")));
  const replay = await app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "bike_giant_escape_3", quantity: 1, acquiredBy: "reward", sourceId: "reward-1"
  }, operation("grant-bike")));
  assert.equal(replay.inventoryEntryIds[0], first.inventoryEntryIds[0]);
  assert.equal(await app.execute((context) => context.ownershipService.isOwner(first.inventoryEntryIds[0], firstOwner)), true);
  assert.equal((await app.gameServices.getInventory(playerOne, now)).length, 1);
});

test("transfer changes legal owner and compatibility projections atomically", async () => {
  const app = await root();
  const granted = await app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "bike_trek_fx_1", quantity: 1, acquiredBy: "reward"
  }, operation("grant-transfer")));
  const result = await app.execute((context) => context.inventoryService.transfer({
    fromOwner: firstOwner, toOwner: secondOwner, inventoryEntryId: granted.inventoryEntryIds[0], quantity: 1, reason: "test"
  }, operation("transfer-bike", playerOne.id)));
  assert.equal(await app.execute((context) => context.ownershipService.isOwner(result.inventoryEntryIds[0], secondOwner)), true);
  assert.equal((await app.gameServices.getInventory(playerOne, now)).length, 0);
  assert.equal((await app.gameServices.getInventory(playerTwo, now)).length, 1);
});

test("permissions support explicit deny and scheduled expiration", async () => {
  const app = await root();
  const granted = await app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "bike_trek_fx_1", quantity: 1, acquiredBy: "reward"
  }, operation("grant-permission")));
  const expiresAt = "2026-08-02T13:00:00.000Z";
  await app.execute((context) => context.ownershipService.grantPermission(
    granted.inventoryEntryIds[0], { kind: "player", id: playerTwo.id }, "use", "deny", "test", operation("deny", playerOne.id), expiresAt
  ));
  await assert.rejects(() => app.execute((context) => context.ownershipService.assertPermission(
    granted.inventoryEntryIds[0], { kind: "player", id: playerTwo.id }, "use", now, firstOwner
  )), (error) => error instanceof DomainError && error.code === "OWNERSHIP_PERMISSION_DENIED");
  const tasks = await app.execute((context) => context.scheduler.listByStatus("pending", 100));
  assert.ok(tasks.some((task) => task.taskType === "ownership.permission.expire"));
});

test("reservations, split and merge preserve quantities and durable tasks", async () => {
  const app = await root();
  const grant = await app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "gift_ring", quantity: 4, acquiredBy: "reward"
  }, operation("stack-grant")));
  const reservation = await app.execute((context) => context.inventoryService.reserve({
    owner: firstOwner, inventoryEntryId: grant.inventoryEntryIds[0], quantity: 1,
    purposeType: "test", purposeRef: "test", expiresAt: "2026-08-02T13:00:00.000Z"
  }, operation("reserve", playerOne.id)));
  await app.execute((context) => context.inventoryService.releaseReservation(reservation.id, "test", operation("release", playerOne.id)));
  const split = await app.execute((context) => context.inventoryService.splitStack(firstOwner, grant.inventoryEntryIds[0], 2, operation("split", playerOne.id)));
  const merged = await app.execute((context) => context.inventoryService.mergeStacks(firstOwner, split.source.instanceId, [split.child.instanceId], operation("merge", playerOne.id)));
  assert.equal(merged.quantity, 4);
  assert.ok((await app.execute((context) => context.scheduler.listByStatus("pending", 100))).some((task) => task.taskType === "inventory.reservation.expire"));
});

test("lease assigns custody and return clears it", async () => {
  const app = await root();
  const grant = await app.execute((context) => context.inventoryService.grant({
    owner: firstOwner, productId: "bike_giant_escape_3", quantity: 1, acquiredBy: "reward"
  }, operation("lease-grant")));
  const lease = await app.execute((context) => context.inventoryService.createLease(
    firstOwner, secondOwner, grant.inventoryEntryIds[0], 1, now, "2026-08-03T12:00:00.000Z", "test-terms", operation("lease", playerOne.id)
  ));
  assert.deepEqual((await app.execute((context) => context.ownershipService.getOwnership(lease.entryId))).custodyOwner, secondOwner);
  await app.execute((context) => context.inventoryService.returnLease(lease.id, operation("return", playerOne.id)));
  assert.equal((await app.execute((context) => context.ownershipService.getOwnership(lease.entryId))).custodyOwner, undefined);
});

test("confiscation and recovery retain legal ownership", async () => {
  const app = await root();
  const item = await app.adminService.grantItem(999, playerOne, "bike_giant_escape_3", now);
  const entry = (await app.gameServices.getInventory(playerOne, now))[0].entry;
  assert.equal(item.id, entry.itemId);
  await app.adminService.confiscateItem(999, playerOne.id, entry.instanceId, "test", now);
  assert.equal((await app.execute((context) => context.ownershipService.getOwnership(entry.instanceId))).status, "confiscated");
  await app.adminService.recoverItem(999, entry.instanceId, "test", now);
  assert.equal((await app.execute((context) => context.ownershipService.getOwnership(entry.instanceId))).status, "active");
});

test("gift callback replay is idempotent", async () => {
  const app = await root();
  await app.adminService.grantItem(999, playerOne, "gift_ring", now);
  const entry = (await app.gameServices.getInventory(playerOne, now))[0].entry;
  const quote = await app.gameServices.createInventoryGiftQuote(playerOne, entry.instanceId, playerTwo.id, now);
  const first = await app.gameServices.confirmInventoryGift(playerOne, quote.session.id, "gift-callback", now);
  const replay = await app.gameServices.confirmInventoryGift(playerOne, quote.session.id, "gift-callback", now);
  assert.equal(first.entryId, replay.entryId);
  assert.equal(replay.replayed, true);
  assert.ok((await app.execute((context) => context.scheduler.listByStatus("pending", 100))).some((task) => task.taskType === "inventory.action_session.expire"));
});

test("retention removes terminal runtime records without touching active tasks", async () => {
  const app = await root();
  const before = await app.execute((context) => context.scheduler.listByStatus("pending", 100));
  await app.retentionService.run();
  const after = await app.execute((context) => context.scheduler.listByStatus("pending", 100));
  assert.equal(after.length, before.length);
});
