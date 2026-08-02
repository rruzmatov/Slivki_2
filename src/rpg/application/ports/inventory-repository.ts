import type { InventoryEntry } from "../../domain/types";
import type {
  InventoryActionSession,
  InventoryEquipmentRecord,
  InventoryLeaseRecord,
  InventoryOperationRecord,
  InventoryReservation
} from "../../domain/inventory";

export interface InventoryRepository {
  list(): Promise<InventoryEntry[]>;
  listByIds(instanceIds: readonly string[]): Promise<InventoryEntry[]>;
  findByInstanceId(instanceId: string): Promise<InventoryEntry | undefined>;
  findByProductId(productId: string): Promise<InventoryEntry[]>;
  add(entry: InventoryEntry): Promise<void>;
  save(entry: InventoryEntry): Promise<void>;
  listReservations(entryId?: string): Promise<InventoryReservation[]>;
  findReservation(reservationId: string): Promise<InventoryReservation | undefined>;
  saveReservation(reservation: InventoryReservation): Promise<void>;
  listEquipment(entryId?: string): Promise<InventoryEquipmentRecord[]>;
  saveEquipment(record: InventoryEquipmentRecord): Promise<void>;
  deleteEquipment(recordId: string): Promise<void>;
  listLeases(entryId?: string): Promise<InventoryLeaseRecord[]>;
  findLease(leaseId: string): Promise<InventoryLeaseRecord | undefined>;
  saveLease(lease: InventoryLeaseRecord): Promise<void>;
  findOperationByIdempotencyKey(key: string): Promise<InventoryOperationRecord | undefined>;
  saveOperation(key: string, operation: InventoryOperationRecord): Promise<void>;
  findActionSession(sessionId: string): Promise<InventoryActionSession | undefined>;
  saveActionSession(session: InventoryActionSession): Promise<void>;
}
