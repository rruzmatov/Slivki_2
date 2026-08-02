"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminService = void 0;
const ids_1 = require("../utils/ids");
class AdminService {
    ownerIds;
    unitOfWork;
    serviceScopes;
    catalog;
    constructor(ownerIds, unitOfWork, serviceScopes, catalog) {
        this.ownerIds = ownerIds;
        this.unitOfWork = unitOfWork;
        this.serviceScopes = serviceScopes;
        this.catalog = catalog;
    }
    async grantMoney(actorId, target, amount, now) {
        this.assertOwner(actorId);
        await this.execute(async (context) => {
            const player = await context.playerService.ensurePlayer(target, now);
            await context.economyService.creditPlayer(player, amount, `admin:${actorId}:grant_money`, now);
            await this.audit(context, actorId, "grant_money", { targetId: target.id, amount }, now);
        });
    }
    async takeMoney(actorId, targetId, amount, now) {
        this.assertOwner(actorId);
        await this.execute(async (context) => {
            const player = await context.players.findById(targetId);
            if (!player)
                throw new Error("Игрок не найден");
            await context.economyService.debitPlayer(player, amount, `admin:${actorId}:take_money`, now);
            await this.audit(context, actorId, "take_money", { targetId, amount }, now);
        });
    }
    async grantXp(actorId, target, xp, now) {
        this.assertOwner(actorId);
        await this.execute(async (context) => {
            const player = await context.playerService.ensurePlayer(target, now);
            await context.playerService.addXp(player, xp, now);
            await this.audit(context, actorId, "grant_xp", { targetId: target.id, xp }, now);
        });
    }
    async setLevel(actorId, targetId, level, now) {
        this.assertOwner(actorId);
        if (!Number.isSafeInteger(level) || level < 1)
            throw new Error("Уровень должен быть положительным целым числом");
        await this.execute(async (context) => {
            const player = await context.players.findById(targetId);
            if (!player)
                throw new Error("Игрок не найден");
            player.level = level;
            player.updatedAt = now;
            await context.players.save(player);
            await this.audit(context, actorId, "set_level", { targetId, level }, now);
        });
    }
    async grantItem(actorId, target, itemId, now) {
        this.assertOwner(actorId);
        return this.execute(async (context) => {
            const item = this.catalog.toLegacyCatalogItem(itemId);
            const player = await context.playerService.ensurePlayer(target, now);
            const owner = { kind: "player", id: player.id };
            if (await context.unlockService.needsReconciliation(owner)) {
                const operation = operationContext("admin_unlock_reconcile", actorId, now);
                await context.unlockService.reconcileOwner(owner, await context.inventoryService.listAll(owner), operation);
            }
            const operation = operationContext("admin_grant", actorId, now);
            await context.inventoryService.grant({ owner, productId: item.id, quantity: 1, acquiredBy: "admin", sourceId: operation.requestId }, operation);
            await this.audit(context, actorId, "grant_item", { targetId: target.id, itemId }, now);
            return item;
        });
    }
    async setBlocked(actorId, targetId, blocked, now) {
        this.assertOwner(actorId);
        await this.execute(async (context) => {
            const player = await context.players.findById(targetId);
            if (!player)
                throw new Error("Игрок не найден");
            player.settings.blocked = blocked;
            player.updatedAt = now;
            await context.players.save(player);
            await this.audit(context, actorId, blocked ? "block_player" : "unblock_player", { targetId }, now);
        });
    }
    async resetPlayer(actorId, targetId, now) {
        this.assertOwner(actorId);
        await this.execute(async (context) => {
            if (await context.players.findById(targetId)) {
                const owner = { kind: "player", id: targetId };
                await context.inventoryService.clear(owner, `admin_reset:${actorId}`, operationContext("admin_reset", actorId, now));
                await context.unlockService.clearOwner(owner);
            }
            await context.players.delete(targetId);
            await this.audit(context, actorId, "reset_player", { targetId }, now);
        });
    }
    async confiscateItem(actorId, targetId, inventoryEntryId, reason, now) {
        this.assertOwner(actorId);
        return this.execute(async (context) => {
            const entry = await context.inventoryService.confiscate({ kind: "player", id: targetId }, inventoryEntryId, { kind: "system", id: "admin-custody" }, reason, operationContext("admin_confiscate", actorId, now));
            await this.audit(context, actorId, "confiscate_item", { targetId, inventoryEntryId, itemId: entry.itemId, reason }, now);
            return this.catalog.toLegacyCatalogItem(entry.itemId);
        });
    }
    async recoverItem(actorId, inventoryEntryId, reason, now) {
        this.assertOwner(actorId);
        return this.execute(async (context) => {
            const entry = await context.inventoryService.recoverConfiscated(inventoryEntryId, reason, operationContext("admin_recover", actorId, now));
            await this.audit(context, actorId, "recover_item", { inventoryEntryId, itemId: entry.itemId, reason }, now);
            return this.catalog.toLegacyCatalogItem(entry.itemId);
        });
    }
    async listInventoryHistory(actorId, limit = 20) {
        this.assertOwner(actorId);
        return this.execute(async (context) => (await context.inventoryService.listHistory({ limit })).items);
    }
    async listLogs(actorId, limit = 10) {
        this.assertOwner(actorId);
        return this.execute((context) => context.auditLogs.list(limit));
    }
    execute(work) {
        return this.unitOfWork.execute((scope) => work(Object.assign(scope, this.serviceScopes.create(scope))));
    }
    assertOwner(actorId) {
        if (!this.ownerIds.includes(actorId))
            throw new Error("Недостаточно прав");
    }
    async audit(context, actorId, action, meta, now) {
        await context.auditLogs.append({
            id: (0, ids_1.createId)("log"), level: "info", message: `admin:${action}`, meta: { actorId, ...meta }, createdAt: now
        });
        const stats = await context.stats.get();
        stats.adminActions += 1;
        await context.stats.save(stats);
    }
}
exports.AdminService = AdminService;
const operationContext = (prefix, actorId, now) => {
    const requestId = (0, ids_1.createId)(prefix);
    return { requestId, idempotencyKey: requestId, correlationId: requestId, now, actor: { kind: "admin", id: actorId } };
};
