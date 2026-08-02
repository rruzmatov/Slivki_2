"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureInventoryEntryState = ensureInventoryEntryState;
const ids_1 = require("../utils/ids");
function ensureInventoryEntryState(entry, catalog, schemas) {
    entry.instanceId = entry.instanceId || (0, ids_1.createId)("asset");
    entry.acquiredBy = entry.acquiredBy || "migration";
    const product = catalog.getProduct(entry.itemId);
    entry.currentValue = entry.currentValue ?? product.valuation.defaultResaleValue?.amount ?? product.valuation.baseAssetValue.amount;
    entry.reservedQuantity = entry.reservedQuantity ?? 0;
    entry.lifecycleStatus = entry.lifecycleStatus ?? "active";
    entry.location = entry.location ?? { kind: "inventory" };
    entry.origin = entry.origin ?? { type: entry.acquiredBy, referenceId: entry.sourceId };
    entry.state = schemas.validate("metadata", "inventory-entry.state", 1, entry.state ?? {});
    entry.metadata = schemas.validate("metadata", "inventory-entry.metadata", 1, entry.metadata ?? {});
    entry.rootInstanceId = entry.rootInstanceId ?? entry.instanceId;
    entry.version = entry.version ?? 1;
    entry.updatedAt = entry.updatedAt ?? entry.acquiredAt;
    if (product.capabilities.includes("repairable") || product.capabilities.includes("maintainable")) {
        entry.condition = entry.condition ?? transportDefaultCondition(product);
        entry.wearLevel = entry.wearLevel ?? 0;
        entry.repairHistory = entry.repairHistory ?? [];
        entry.upgradeHistory = entry.upgradeHistory ?? [];
    }
}
function transportDefaultCondition(product) {
    const transport = product.attributes.transport;
    if (typeof transport !== "object" || transport === null || Array.isArray(transport))
        return "new";
    const condition = transport.defaultCondition;
    return condition === "good" || condition === "worn" || condition === "broken" ? condition : "new";
}
