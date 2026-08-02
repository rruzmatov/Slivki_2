import type { CatalogService } from "./catalog-service";
import type { SchemaRegistry } from "./schema-registry";
import type { Product } from "../domain/assets";
import type { InventoryEntry } from "../domain/types";
import { createId } from "../utils/ids";

export function ensureInventoryEntryState(
  entry: InventoryEntry,
  catalog: CatalogService,
  schemas: SchemaRegistry
): void {
  entry.instanceId = entry.instanceId || createId("asset");
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

function transportDefaultCondition(product: Product): InventoryEntry["condition"] {
  const transport = product.attributes.transport;
  if (typeof transport !== "object" || transport === null || Array.isArray(transport)) return "new";
  const condition = (transport as Record<string, unknown>).defaultCondition;
  return condition === "good" || condition === "worn" || condition === "broken" ? condition : "new";
}
