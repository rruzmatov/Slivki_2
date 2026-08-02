import type { InventoryRepository } from "../../application/ports/inventory-repository";
import { DomainError } from "../../domain/errors";
import type { InventoryEntry } from "../../domain/types";
import type { GameState } from "../storage/game-state";
import type {
  InventoryActionSession,
  InventoryEquipmentRecord,
  InventoryLeaseRecord,
  InventoryOperationRecord,
  InventoryReservation
} from "../../domain/inventory";
import { detached, detachedValues } from "./detached-copy";

export class GameStateInventoryRepository implements InventoryRepository {
  constructor(private readonly state: GameState) {}

  async list(): Promise<InventoryEntry[]> {
    return detachedValues(Object.values(this.state.inventory.entries));
  }

  async listByIds(instanceIds: readonly string[]): Promise<InventoryEntry[]> {
    return instanceIds.flatMap((id) => {
      const entry = this.state.inventory.entries[id];
      return entry ? [detached(entry)] : [];
    });
  }

  async findByInstanceId(instanceId: string): Promise<InventoryEntry | undefined> {
    return detached(this.state.inventory.entries[instanceId]);
  }

  async findByProductId(productId: string): Promise<InventoryEntry[]> {
    return (await this.list()).filter((entry) => entry.itemId === productId);
  }

  async add(entry: InventoryEntry): Promise<void> {
    if (this.state.inventory.entries[entry.instanceId]) {
      throw new DomainError("Объект инвентаря уже существует", "INVENTORY_ENTRY_EXISTS");
    }
    this.state.inventory.entries[entry.instanceId] = detached(entry);
  }

  async save(entry: InventoryEntry): Promise<void> {
    if (!this.state.inventory.entries[entry.instanceId]) {
      throw new DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
    }
    this.state.inventory.entries[entry.instanceId] = detached(entry);
  }

  async listReservations(entryId?: string): Promise<InventoryReservation[]> {
    return detachedValues(Object.values(this.state.inventory.reservations).filter((record) => !entryId || record.entryId === entryId));
  }

  async findReservation(reservationId: string): Promise<InventoryReservation | undefined> {
    return detached(this.state.inventory.reservations[reservationId]);
  }

  async saveReservation(reservation: InventoryReservation): Promise<void> {
    this.state.inventory.reservations[reservation.id] = detached(reservation);
  }

  async listEquipment(entryId?: string): Promise<InventoryEquipmentRecord[]> {
    return detachedValues(Object.values(this.state.inventory.equipment).filter((record) => !entryId || record.entryId === entryId));
  }

  async saveEquipment(record: InventoryEquipmentRecord): Promise<void> {
    this.state.inventory.equipment[record.id] = detached(record);
  }

  async deleteEquipment(recordId: string): Promise<void> {
    delete this.state.inventory.equipment[recordId];
  }

  async listLeases(entryId?: string): Promise<InventoryLeaseRecord[]> {
    return detachedValues(Object.values(this.state.inventory.leases).filter((record) => !entryId || record.entryId === entryId));
  }

  async findLease(leaseId: string): Promise<InventoryLeaseRecord | undefined> {
    return detached(this.state.inventory.leases[leaseId]);
  }

  async saveLease(lease: InventoryLeaseRecord): Promise<void> {
    this.state.inventory.leases[lease.id] = detached(lease);
  }

  async findOperationByIdempotencyKey(key: string): Promise<InventoryOperationRecord | undefined> {
    const operationId = this.state.inventory.idempotencyKeys[key];
    return operationId ? detached(this.state.inventory.operations[operationId]) : undefined;
  }

  async saveOperation(key: string, operation: InventoryOperationRecord): Promise<void> {
    this.state.inventory.operations[operation.id] = detached(operation);
    this.state.inventory.idempotencyKeys[key] = operation.id;
  }

  async findActionSession(sessionId: string): Promise<InventoryActionSession | undefined> {
    return detached(this.state.inventory.actionSessions[sessionId]);
  }

  async saveActionSession(session: InventoryActionSession): Promise<void> {
    this.state.inventory.actionSessions[session.id] = detached(session);
  }
}
