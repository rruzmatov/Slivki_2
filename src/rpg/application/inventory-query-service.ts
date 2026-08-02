import type { CatalogService } from "./catalog-service";
import type { EventRepository } from "./ports/event-repository";
import type { InventoryRepository } from "./ports/inventory-repository";
import type { OwnershipService } from "./ownership-service";
import type { SchemaRegistry } from "./schema-registry";
import { ensureInventoryEntryState } from "./inventory-entry-state";
import type { OwnerRef, Page, PageRequest } from "../domain/assets";
import { DomainError } from "../domain/errors";
import type { DomainEvent } from "../domain/events";
import type { InventoryEntry } from "../domain/types";

export interface InventoryAvailability {
  total: number;
  reserved: number;
  leased: number;
  available: number;
}

export interface InventoryHistoryQuery extends PageRequest {
  owner?: OwnerRef;
  inventoryEntryId?: string;
  eventType?: string;
}

export class InventoryQueryService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly repository: InventoryRepository,
    private readonly ownership: OwnershipService,
    private readonly eventRepository: EventRepository,
    private readonly schemas: SchemaRegistry
  ) {}

  async list(owner: OwnerRef, query: PageRequest = { limit: 25 }): Promise<Page<InventoryEntry>> {
    const inventory = await this.entriesForOwner(owner);
    const offset = parseCursor(query.cursor);
    const limit = normalizeLimit(query.limit, 25);
    const items = inventory.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < inventory.length;
    return { items, nextCursor: hasMore ? String(nextOffset) : undefined, hasMore };
  }

  async listAll(owner: OwnerRef): Promise<InventoryEntry[]> {
    return this.entriesForOwner(owner);
  }

  async getEntry(owner: OwnerRef, inventoryEntryId: string): Promise<InventoryEntry> {
    const entry = await this.repository.findByInstanceId(inventoryEntryId);
    if (entry && !await this.ownership.isOwner(inventoryEntryId, owner)) {
      throw new DomainError("Объект не принадлежит выбранному владельцу", "OWNERSHIP_NOT_OWNER");
    }
    if (!entry) throw new DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
    this.normalize(entry);
    return entry;
  }

  async findFirstByProduct(owner: OwnerRef, productId: string): Promise<InventoryEntry | undefined> {
    return (await this.entriesForOwner(owner)).find((entry) => entry.itemId === productId);
  }

  async getOwnedProductCount(owner: OwnerRef, productId: string): Promise<number> {
    return (await this.entriesForOwner(owner)).filter((entry) => entry.itemId === productId)
      .reduce((sum, entry) => sum + entry.quantity, 0);
  }

  async hasProduct(owner: OwnerRef, productId: string): Promise<boolean> {
    return await this.getOwnedProductCount(owner, productId) > 0;
  }

  async hasCategory(owner: OwnerRef, categoryId: string): Promise<boolean> {
    return (await this.entriesForOwner(owner)).some((entry) => this.catalog.getProduct(entry.itemId).categoryId === categoryId);
  }

  async hasAssetType(owner: OwnerRef, assetTypeId: string): Promise<boolean> {
    if (assetTypeId === "currency") return false;
    return (await this.entriesForOwner(owner)).some((entry) => this.catalog.getAssetTypeForProduct(entry.itemId).id === assetTypeId);
  }

  async calculateAssetValue(owner: OwnerRef): Promise<number> {
    return (await this.entriesForOwner(owner)).reduce((sum, entry) => {
      const product = this.catalog.getProduct(entry.itemId);
      return sum + (entry.currentValue ?? product.valuation.baseAssetValue.amount) * entry.quantity;
    }, 0);
  }

  async getAvailability(owner: OwnerRef, inventoryEntryId: string, now: string): Promise<InventoryAvailability> {
    const entry = await this.getEntry(owner, inventoryEntryId);
    const reserved = (await this.repository.listReservations(entry.instanceId))
      .filter((record) => record.status === "active" && record.expiresAt > now)
      .reduce((sum, record) => sum + record.quantity, 0);
    const leased = (await this.repository.listLeases(entry.instanceId))
      .filter((record) => record.status === "active")
      .reduce((sum, record) => sum + record.quantity, 0);
    return { total: entry.quantity, reserved, leased, available: Math.max(0, entry.quantity - reserved - leased) };
  }

  async listHistory(query: InventoryHistoryQuery = { limit: 25 }): Promise<Page<DomainEvent>> {
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

  private async entriesForOwner(owner: OwnerRef): Promise<InventoryEntry[]> {
    const entries = (await this.repository.listByIds(await this.ownership.listOwnedEntryIds(owner)))
      .filter((entry) => (entry.lifecycleStatus ?? "active") === "active");
    for (const entry of entries) this.normalize(entry);
    return entries;
  }

  private normalize(entry: InventoryEntry): void {
    ensureInventoryEntryState(entry, this.catalog, this.schemas);
  }
}

function normalizeLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new DomainError(`Количество должно быть от 1 до ${maximum}`, "INVENTORY_QUANTITY_INVALID");
  }
  return value;
}

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("Некорректный курсор инвентаря", "INVENTORY_CURSOR_INVALID");
  return value;
}
