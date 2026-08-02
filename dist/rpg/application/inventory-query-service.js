"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryQueryService = void 0;
const inventory_entry_state_1 = require("./inventory-entry-state");
const errors_1 = require("../domain/errors");
class InventoryQueryService {
    catalog;
    repository;
    ownership;
    eventRepository;
    schemas;
    constructor(catalog, repository, ownership, eventRepository, schemas) {
        this.catalog = catalog;
        this.repository = repository;
        this.ownership = ownership;
        this.eventRepository = eventRepository;
        this.schemas = schemas;
    }
    async list(owner, query = { limit: 25 }) {
        const inventory = await this.entriesForOwner(owner);
        const offset = parseCursor(query.cursor);
        const limit = normalizeLimit(query.limit, 25);
        const items = inventory.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        const hasMore = nextOffset < inventory.length;
        return { items, nextCursor: hasMore ? String(nextOffset) : undefined, hasMore };
    }
    async listAll(owner) {
        return this.entriesForOwner(owner);
    }
    async getEntry(owner, inventoryEntryId) {
        const entry = await this.repository.findByInstanceId(inventoryEntryId);
        if (entry && !await this.ownership.isOwner(inventoryEntryId, owner)) {
            throw new errors_1.DomainError("Объект не принадлежит выбранному владельцу", "OWNERSHIP_NOT_OWNER");
        }
        if (!entry)
            throw new errors_1.DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
        this.normalize(entry);
        return entry;
    }
    async findFirstByProduct(owner, productId) {
        return (await this.entriesForOwner(owner)).find((entry) => entry.itemId === productId);
    }
    async getOwnedProductCount(owner, productId) {
        return (await this.entriesForOwner(owner)).filter((entry) => entry.itemId === productId)
            .reduce((sum, entry) => sum + entry.quantity, 0);
    }
    async hasProduct(owner, productId) {
        return await this.getOwnedProductCount(owner, productId) > 0;
    }
    async hasCategory(owner, categoryId) {
        return (await this.entriesForOwner(owner)).some((entry) => this.catalog.getProduct(entry.itemId).categoryId === categoryId);
    }
    async hasAssetType(owner, assetTypeId) {
        if (assetTypeId === "currency")
            return false;
        return (await this.entriesForOwner(owner)).some((entry) => this.catalog.getAssetTypeForProduct(entry.itemId).id === assetTypeId);
    }
    async calculateAssetValue(owner) {
        return (await this.entriesForOwner(owner)).reduce((sum, entry) => {
            const product = this.catalog.getProduct(entry.itemId);
            return sum + (entry.currentValue ?? product.valuation.baseAssetValue.amount) * entry.quantity;
        }, 0);
    }
    async getAvailability(owner, inventoryEntryId, now) {
        const entry = await this.getEntry(owner, inventoryEntryId);
        const reserved = (await this.repository.listReservations(entry.instanceId))
            .filter((record) => record.status === "active" && record.expiresAt > now)
            .reduce((sum, record) => sum + record.quantity, 0);
        const leased = (await this.repository.listLeases(entry.instanceId))
            .filter((record) => record.status === "active")
            .reduce((sum, record) => sum + record.quantity, 0);
        return { total: entry.quantity, reserved, leased, available: Math.max(0, entry.quantity - reserved - leased) };
    }
    async listHistory(query = { limit: 25 }) {
        const offset = parseCursor(query.cursor);
        const limit = normalizeLimit(query.limit, 100);
        const history = await this.eventRepository.listHistory({
            eventType: query.eventType,
            aggregateId: query.inventoryEntryId,
            owner: query.owner,
            limit: limit + 1,
            offset
        });
        const items = history.slice(0, limit);
        const hasMore = history.length > limit;
        return { items, nextCursor: hasMore ? String(offset + items.length) : undefined, hasMore };
    }
    async entriesForOwner(owner) {
        const entries = (await this.repository.listByIds(await this.ownership.listOwnedEntryIds(owner)))
            .filter((entry) => (entry.lifecycleStatus ?? "active") === "active");
        for (const entry of entries)
            this.normalize(entry);
        return entries;
    }
    normalize(entry) {
        (0, inventory_entry_state_1.ensureInventoryEntryState)(entry, this.catalog, this.schemas);
    }
}
exports.InventoryQueryService = InventoryQueryService;
function normalizeLimit(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new errors_1.DomainError(`Количество должно быть от 1 до ${maximum}`, "INVENTORY_QUANTITY_INVALID");
    }
    return value;
}
function parseCursor(cursor) {
    if (!cursor)
        return 0;
    const value = Number(cursor);
    if (!Number.isSafeInteger(value) || value < 0)
        throw new errors_1.DomainError("Некорректный курсор инвентаря", "INVENTORY_CURSOR_INVALID");
    return value;
}
