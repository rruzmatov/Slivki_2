import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RequirementExpression } from "../domain/assets";
import { createCompositionRoot, type RpgCompositionRoot } from "../bootstrap/composition-root";
import { createEmptyGameState } from "../infrastructure/storage/json-game-database";
import { GAME_BALANCE } from "../config/game-balance";

const now = "2026-08-02T10:00:00.000Z";
const player = { id: 1001, firstName: "Игрок", username: "player" };

async function root(): Promise<RpgCompositionRoot> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-shop-"));
  return createCompositionRoot({ storagePath: path.join(directory, "state.json"), ownerIds: [999] });
}

test("catalog exposes universal AssetType -> Category -> Product hierarchy", async () => {
  const app = await root();
  const catalog = app.catalogService;
  assert.ok(catalog.listAssetTypes({ limit: 25 }).items.some((item) => item.id === "currency"));
  assert.equal(catalog.getCategory("bicycle").assetTypeId, "transport");
  assert.equal(catalog.getProduct("bike_giant_escape_3").categoryId, "bicycle");
  assert.equal(catalog.getProduct("currency_sum").categoryId, "currency.game");
  assert.equal(catalog.resolveActiveListing("bike_giant_escape_3", now).price.amount, 25_000);
});

test("purchase is atomic, inventory-centric, unlock-aware and idempotent", async () => {
  const app = await root();
  await app.adminService.grantMoney(999, player, 100_000, now);
  const quote = await app.gameServices.createPurchaseQuote(player, "bike_giant_escape_3", now);
  const first = await app.gameServices.confirmPurchase(player, quote.checkout.id, "cash", "callback-1", now);
  const replay = await app.gameServices.confirmPurchase(player, quote.checkout.id, "cash", "callback-1", now);
  const profile = await app.gameServices.getPlayerProfile(player, now);
  const inventory = await app.gameServices.getInventory(player, now);
  const unlocked = await app.execute((context) => context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", "job_courier"));
  const history = await app.execute((context) => context.events.listHistory({ eventType: "shop.order.completed", limit: 10 }));
  assert.equal(first.order.id, replay.order.id);
  assert.equal(replay.replayed, true);
  assert.equal(profile.player.balance, GAME_BALANCE.player.startingBalance + 75_000);
  assert.equal(inventory.length, 1);
  assert.equal(unlocked, true);
  assert.equal((await app.gameServices.getStats()).purchases, 1);
  assert.equal(history.length, 1);
  assertEventEnvelope(history[0]);
});

test("failed purchase rolls back economy, inventory, order and events", async () => {
  const app = await root();
  await app.gameServices.ensurePlayer(player, now);
  const quote = await app.gameServices.createPurchaseQuote(player, "bike_giant_escape_3", now);
  await assert.rejects(() => app.gameServices.confirmPurchase(player, quote.checkout.id, "cash", "insufficient", now));
  assert.equal((await app.gameServices.getInventory(player, now)).length, 0);
  assert.equal((await app.gameServices.listShopOrders(player, now)).length, 0);
  assert.equal((await app.gameServices.getPlayerProfile(player, now)).player.balance, GAME_BALANCE.player.startingBalance);
});

test("unique assets have distinct instances and sale revokes only removed source unlock", async () => {
  const app = await root();
  await app.adminService.grantMoney(999, player, 200_000, now);
  await app.gameServices.buyItem(player, "bike_giant_escape_3", now, "buy-a");
  await app.gameServices.buyItem(player, "bike_giant_escape_3", now, "buy-b");
  const before = await app.gameServices.getInventory(player, now);
  assert.equal(before.length, 2);
  assert.notEqual(before[0].entry.instanceId, before[1].entry.instanceId);
  await app.gameServices.sellItem(player, "bike_giant_escape_3", now, "sell-a");
  assert.equal((await app.gameServices.getInventory(player, now)).length, 1);
  assert.equal(await app.execute((context) => context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", "job_courier")), true);
});

test("admin grants and resets products through Inventory and Unlock services", async () => {
  const app = await root();
  await app.adminService.grantItem(999, player, "bike_trek_fx_1", now);
  const inventory = await app.gameServices.getInventory(player, now);
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].entry.acquiredBy, "admin");
  assert.equal(await app.execute((context) => context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", "job_courier")), true);
  await app.adminService.resetPlayer(999, player.id, now);
  assert.equal(await app.execute((context) => context.players.findById(player.id)), undefined);
});

test("RequirementEvaluator supports nested AND, OR and NOT", async () => {
  const app = await root();
  const profile = await app.gameServices.getPlayerProfile(player, now);
  const expression: RequirementExpression = {
    operator: "and",
    rules: [
      { operator: "or", rules: [
        { operator: "predicate", predicate: { kind: "player.level.at_least", params: { value: 10 }, message: "уровень" } },
        { operator: "predicate", predicate: { kind: "player.country.equals", params: { country: "Uzbekistan" }, message: "страна" } }
      ] },
      { operator: "not", rule: {
        operator: "predicate", predicate: { kind: "achievement.owned", params: { achievementId: "forbidden" }, message: "запрещено" }
      } }
    ]
  };
  const result = await app.execute((context) => context.requirementEvaluator.evaluate({ player: profile.player }, expression));
  assert.equal(result.passed, true);
});

test("legacy JSON inventory migrates without changing external contracts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-legacy-"));
  const storagePath = path.join(directory, "state.json");
  const state = createEmptyGameState();
  state.players[String(player.id)] = {
    id: player.id, firstName: player.firstName, balance: 10_000, bankBalance: 0, country: "Uzbekistan", level: 1,
    xp: 0, energy: 100, inventory: [{ instanceId: "asset_legacy", itemId: "bike_giant_escape_3", quantity: 1, acquiredAt: now, acquiredBy: "migration" }],
    achievements: [], skills: {}, transportIds: [], homeIds: [], businessIds: [], petIds: [],
    settings: { blocked: false, locale: "ru", notifications: true }, createdAt: now, updatedAt: now
  };
  await fs.writeFile(storagePath, JSON.stringify(state), "utf8");
  const app = await createCompositionRoot({ storagePath });
  const inventory = await app.gameServices.getInventory(player, now);
  assert.equal(inventory[0].entry.instanceId, "asset_legacy");
  assert.equal(await app.execute((context) => context.ownershipService.isOwner("asset_legacy", { kind: "player", id: player.id })), true);
});

function assertEventEnvelope(event: import("../domain/events").DomainEvent): void {
  assert.ok(event.eventId);
  assert.ok(event.eventType);
  assert.equal(event.eventVersion, 1);
  assert.ok(event.aggregateId);
  assert.ok(event.aggregateVersion >= 1);
  assert.ok(event.occurredAt);
  assert.ok(event.correlationId);
  assert.ok(event.causationId);
  assert.ok(event.payload);
}
