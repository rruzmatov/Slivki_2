"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnlockService = void 0;
const ids_1 = require("../utils/ids");
const assets_1 = require("../domain/assets");
class UnlockService {
    catalog;
    repository;
    events;
    static projectionVersion = 1;
    constructor(catalog, repository, events) {
        this.catalog = catalog;
        this.repository = repository;
        this.events = events;
    }
    async handleInventoryGranted(payload, operation) {
        const product = this.catalog.getProduct(payload.productId);
        for (const entryId of payload.inventoryEntryIds) {
            for (const definition of product.unlocks) {
                await this.grant(payload.owner, product.id, entryId, definition.type, definition.targetId, definition.mode, operation);
            }
        }
    }
    async handleInventoryRemoved(payload, operation) {
        for (const removed of payload.entries) {
            if (removed.removedCompletely)
                await this.revokeBySource(removed.inventoryEntryId, operation);
        }
    }
    async isUnlocked(owner, type, targetId) {
        const key = (0, assets_1.ownerKey)(owner);
        return (await this.repository.list(owner)).some((record) => (0, assets_1.ownerKey)(record.owner) === key && record.type === type && record.targetId === targetId && !record.revokedAt);
    }
    isManagedTarget(type, targetId) {
        return this.catalog.hasUnlockDefinition(type, targetId);
    }
    async listActive(owner, type) {
        const key = (0, assets_1.ownerKey)(owner);
        return (await this.repository.list(owner)).filter((record) => (0, assets_1.ownerKey)(record.owner) === key && !record.revokedAt && (!type || record.type === type));
    }
    async needsReconciliation(owner) {
        return await this.repository.getReconciledVersion(owner) !== UnlockService.projectionVersion;
    }
    async reconcileOwner(owner, inventory, operation) {
        if (await this.repository.getReconciledVersion(owner) === UnlockService.projectionVersion)
            return;
        for (const entry of inventory) {
            const product = this.catalog.getProduct(entry.itemId);
            for (const definition of product.unlocks) {
                await this.grant(owner, product.id, entry.instanceId, definition.type, definition.targetId, definition.mode, operation);
            }
        }
        await this.repository.setReconciledVersion(owner, UnlockService.projectionVersion);
    }
    async clearOwner(owner) {
        const key = (0, assets_1.ownerKey)(owner);
        for (const record of await this.repository.list(owner)) {
            if ((0, assets_1.ownerKey)(record.owner) === key)
                await this.repository.delete(record.id);
        }
        await this.repository.clearReconciledVersion(owner);
    }
    async grant(owner, productId, inventoryEntryId, type, targetId, mode, operation) {
        const duplicate = (await this.repository.list(owner)).find((record) => record.sourceInventoryEntryId === inventoryEntryId && (0, assets_1.ownerKey)(record.owner) === (0, assets_1.ownerKey)(owner) &&
            record.type === type && record.targetId === targetId && !record.revokedAt);
        if (duplicate)
            return;
        const record = {
            id: (0, ids_1.createId)("unlock"),
            owner,
            type,
            targetId,
            sourceProductId: productId,
            sourceInventoryEntryId: inventoryEntryId,
            mode,
            grantedAt: operation.now
        };
        await this.repository.save(record);
        this.events.collect({
            eventType: "unlock.granted",
            aggregateType: "unlock",
            aggregateId: record.id,
            aggregateVersion: 1,
            payload: { owner, type, targetId, productId },
        }, operation);
    }
    async revokeBySource(inventoryEntryId, operation) {
        for (const record of await this.repository.list()) {
            if (record.sourceInventoryEntryId !== inventoryEntryId || record.revokedAt || record.mode === "permanent")
                continue;
            record.revokedAt = operation.now;
            await this.repository.save(record);
            this.events.collect({
                eventType: "unlock.revoked",
                aggregateType: "unlock",
                aggregateId: record.id,
                aggregateVersion: 2,
                payload: { owner: record.owner, type: record.type, targetId: record.targetId },
            }, operation);
        }
    }
}
exports.UnlockService = UnlockService;
