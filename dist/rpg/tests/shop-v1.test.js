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
const game_balance_1 = require("../config/game-balance");
const now = "2026-08-02T10:00:00.000Z";
const player = { id: 1001, firstName: "Игрок", username: "player" };
async function root() {
    const directory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "slivki-shop-"));
    return (0, composition_root_1.createCompositionRoot)({ storagePath: node_path_1.default.join(directory, "state.json"), ownerIds: [999] });
}
(0, node_test_1.default)("catalog exposes universal AssetType -> Category -> Product hierarchy", async () => {
    const app = await root();
    const catalog = app.catalogService;
    strict_1.default.ok(catalog.listAssetTypes({ limit: 25 }).items.some((item) => item.id === "currency"));
    strict_1.default.equal(catalog.getCategory("bicycle").assetTypeId, "transport");
    strict_1.default.equal(catalog.getProduct("bike_giant_escape_3").categoryId, "bicycle");
    strict_1.default.equal(catalog.getProduct("currency_sum").categoryId, "currency.game");
    strict_1.default.equal(catalog.resolveActiveListing("bike_giant_escape_3", now).price.amount, 25_000);
});
(0, node_test_1.default)("purchase is atomic, inventory-centric, unlock-aware and idempotent", async () => {
    const app = await root();
    await app.adminService.grantMoney(999, player, 100_000, now);
    const quote = await app.gameServices.createPurchaseQuote(player, "bike_giant_escape_3", now);
    const first = await app.gameServices.confirmPurchase(player, quote.checkout.id, "cash", "callback-1", now);
    const replay = await app.gameServices.confirmPurchase(player, quote.checkout.id, "cash", "callback-1", now);
    const profile = await app.gameServices.getPlayerProfile(player, now);
    const inventory = await app.gameServices.getInventory(player, now);
    const unlocked = await app.execute((context) => context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", "job_courier"));
    const history = await app.execute((context) => context.events.listHistory({ eventType: "shop.order.completed", limit: 10 }));
    strict_1.default.equal(first.order.id, replay.order.id);
    strict_1.default.equal(replay.replayed, true);
    strict_1.default.equal(profile.player.balance, game_balance_1.GAME_BALANCE.player.startingBalance + 75_000);
    strict_1.default.equal(inventory.length, 1);
    strict_1.default.equal(unlocked, true);
    strict_1.default.equal((await app.gameServices.getStats()).purchases, 1);
    strict_1.default.equal(history.length, 1);
    assertEventEnvelope(history[0]);
});
(0, node_test_1.default)("failed purchase rolls back economy, inventory, order and events", async () => {
    const app = await root();
    await app.gameServices.ensurePlayer(player, now);
    const quote = await app.gameServices.createPurchaseQuote(player, "bike_giant_escape_3", now);
    await strict_1.default.rejects(() => app.gameServices.confirmPurchase(player, quote.checkout.id, "cash", "insufficient", now));
    strict_1.default.equal((await app.gameServices.getInventory(player, now)).length, 0);
    strict_1.default.equal((await app.gameServices.listShopOrders(player, now)).length, 0);
    strict_1.default.equal((await app.gameServices.getPlayerProfile(player, now)).player.balance, game_balance_1.GAME_BALANCE.player.startingBalance);
});
(0, node_test_1.default)("unique assets have distinct instances and sale revokes only removed source unlock", async () => {
    const app = await root();
    await app.adminService.grantMoney(999, player, 200_000, now);
    await app.gameServices.buyItem(player, "bike_giant_escape_3", now, "buy-a");
    await app.gameServices.buyItem(player, "bike_giant_escape_3", now, "buy-b");
    const before = await app.gameServices.getInventory(player, now);
    strict_1.default.equal(before.length, 2);
    strict_1.default.notEqual(before[0].entry.instanceId, before[1].entry.instanceId);
    await app.gameServices.sellItem(player, "bike_giant_escape_3", now, "sell-a");
    strict_1.default.equal((await app.gameServices.getInventory(player, now)).length, 1);
    strict_1.default.equal(await app.execute((context) => context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", "job_courier")), true);
});
(0, node_test_1.default)("admin grants and resets products through Inventory and Unlock services", async () => {
    const app = await root();
    await app.adminService.grantItem(999, player, "bike_trek_fx_1", now);
    const inventory = await app.gameServices.getInventory(player, now);
    strict_1.default.equal(inventory.length, 1);
    strict_1.default.equal(inventory[0].entry.acquiredBy, "admin");
    strict_1.default.equal(await app.execute((context) => context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", "job_courier")), true);
    await app.adminService.resetPlayer(999, player.id, now);
    strict_1.default.equal(await app.execute((context) => context.players.findById(player.id)), undefined);
});
(0, node_test_1.default)("RequirementEvaluator supports nested AND, OR and NOT", async () => {
    const app = await root();
    const profile = await app.gameServices.getPlayerProfile(player, now);
    const expression = {
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
    strict_1.default.equal(result.passed, true);
});
(0, node_test_1.default)("legacy JSON inventory migrates without changing external contracts", async () => {
    const directory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "slivki-legacy-"));
    const storagePath = node_path_1.default.join(directory, "state.json");
    const state = (0, json_game_database_1.createEmptyGameState)();
    state.players[String(player.id)] = {
        id: player.id, firstName: player.firstName, balance: 10_000, bankBalance: 0, country: "Uzbekistan", level: 1,
        xp: 0, energy: 100, inventory: [{ instanceId: "asset_legacy", itemId: "bike_giant_escape_3", quantity: 1, acquiredAt: now, acquiredBy: "migration" }],
        achievements: [], skills: {}, transportIds: [], homeIds: [], businessIds: [], petIds: [],
        settings: { blocked: false, locale: "ru", notifications: true }, createdAt: now, updatedAt: now
    };
    await node_fs_1.promises.writeFile(storagePath, JSON.stringify(state), "utf8");
    const app = await (0, composition_root_1.createCompositionRoot)({ storagePath });
    const inventory = await app.gameServices.getInventory(player, now);
    strict_1.default.equal(inventory[0].entry.instanceId, "asset_legacy");
    strict_1.default.equal(await app.execute((context) => context.ownershipService.isOwner("asset_legacy", { kind: "player", id: player.id })), true);
});
function assertEventEnvelope(event) {
    strict_1.default.ok(event.eventId);
    strict_1.default.ok(event.eventType);
    strict_1.default.equal(event.eventVersion, 1);
    strict_1.default.ok(event.aggregateId);
    strict_1.default.ok(event.aggregateVersion >= 1);
    strict_1.default.ok(event.occurredAt);
    strict_1.default.ok(event.correlationId);
    strict_1.default.ok(event.causationId);
    strict_1.default.ok(event.payload);
}
