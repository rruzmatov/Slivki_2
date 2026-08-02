import type { CatalogService } from "./catalog-service";
import type { InventoryGrantedPayload, InventoryRemovedPayload } from "./inventory-service";
import { createId } from "../utils/ids";
import { ownerKey, type OwnerRef } from "../domain/assets";
import type { InventoryEntry } from "../domain/types";
import type { UnlockRecord } from "../domain/unlocks";
import type { UnlockRepository } from "./ports/game-repositories";
import type { TransactionEventCollector } from "./transaction-event-collector";
import type { OperationContext } from "../domain/assets";

export class UnlockService {
  private static readonly projectionVersion = 1;

  constructor(
    private readonly catalog: CatalogService,
    private readonly repository: UnlockRepository,
    private readonly events: TransactionEventCollector
  ) {}

  async handleInventoryGranted(payload: InventoryGrantedPayload, operation: OperationContext): Promise<void> {
    const product = this.catalog.getProduct(payload.productId);
    for (const entryId of payload.inventoryEntryIds) {
      for (const definition of product.unlocks) {
        await this.grant(payload.owner, product.id, entryId, definition.type, definition.targetId, definition.mode, operation);
      }
    }
  }

  async handleInventoryRemoved(payload: InventoryRemovedPayload, operation: OperationContext): Promise<void> {
    for (const removed of payload.entries) {
      if (removed.removedCompletely) await this.revokeBySource(removed.inventoryEntryId, operation);
    }
  }

  async isUnlocked(owner: OwnerRef, type: string, targetId: string): Promise<boolean> {
    const key = ownerKey(owner);
    return (await this.repository.list(owner)).some((record) =>
      ownerKey(record.owner) === key && record.type === type && record.targetId === targetId && !record.revokedAt
    );
  }

  isManagedTarget(type: string, targetId: string): boolean {
    return this.catalog.hasUnlockDefinition(type, targetId);
  }

  async listActive(owner: OwnerRef, type?: string): Promise<UnlockRecord[]> {
    const key = ownerKey(owner);
    return (await this.repository.list(owner)).filter((record) =>
      ownerKey(record.owner) === key && !record.revokedAt && (!type || record.type === type)
    );
  }

  async needsReconciliation(owner: OwnerRef): Promise<boolean> {
    return await this.repository.getReconciledVersion(owner) !== UnlockService.projectionVersion;
  }

  async reconcileOwner(owner: OwnerRef, inventory: readonly InventoryEntry[], operation: OperationContext): Promise<void> {
    if (await this.repository.getReconciledVersion(owner) === UnlockService.projectionVersion) return;
    for (const entry of inventory) {
      const product = this.catalog.getProduct(entry.itemId);
      for (const definition of product.unlocks) {
        await this.grant(owner, product.id, entry.instanceId, definition.type, definition.targetId, definition.mode, operation);
      }
    }
    await this.repository.setReconciledVersion(owner, UnlockService.projectionVersion);
  }

  async clearOwner(owner: OwnerRef): Promise<void> {
    const key = ownerKey(owner);
    for (const record of await this.repository.list(owner)) {
      if (ownerKey(record.owner) === key) await this.repository.delete(record.id);
    }
    await this.repository.clearReconciledVersion(owner);
  }

  private async grant(
    owner: OwnerRef,
    productId: string,
    inventoryEntryId: string,
    type: string,
    targetId: string,
    mode: "permanent" | "while_owned",
    operation: OperationContext
  ): Promise<void> {
    const duplicate = (await this.repository.list(owner)).find((record) =>
      record.sourceInventoryEntryId === inventoryEntryId && ownerKey(record.owner) === ownerKey(owner) &&
      record.type === type && record.targetId === targetId && !record.revokedAt
    );
    if (duplicate) return;

    const record: UnlockRecord = {
      id: createId("unlock"),
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

  private async revokeBySource(inventoryEntryId: string, operation: OperationContext): Promise<void> {
    for (const record of await this.repository.list()) {
      if (record.sourceInventoryEntryId !== inventoryEntryId || record.revokedAt || record.mode === "permanent") continue;
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
