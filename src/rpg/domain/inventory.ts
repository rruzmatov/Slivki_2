import type { ActorRef, OwnerRef } from "./assets";
import type { DomainEvent } from "./events";

export type InventoryLifecycleStatus = "active" | "destroyed" | "expired" | "revoked" | "archived";
export type InventoryDisposition = "revoke" | "consume" | "archive";

export interface InventoryReservation {
  id: string;
  entryId: string;
  quantity: number;
  purposeType: string;
  purposeRef: string;
  createdBy: ActorRef;
  status: "active" | "released" | "committed" | "expired";
  expiresAt: string;
  idempotencyKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryEquipmentRecord {
  id: string;
  owner: OwnerRef;
  slotCode: string;
  entryId: string;
  quantity: number;
  equippedAt: string;
  version: number;
}

export interface InventoryLeaseRecord {
  id: string;
  lessor: OwnerRef;
  lessee: OwnerRef;
  entryId: string;
  quantity: number;
  startsAt: string;
  endsAt: string;
  status: "active" | "returned" | "expired";
  termsRef: string;
  createdBy: ActorRef;
  returnedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryOperationRecord {
  id: string;
  type: string;
  requestId: string;
  idempotencyKey: string;
  correlationId: string;
  actor?: ActorRef;
  payloadHash: string;
  result: unknown;
  createdAt: string;
}

export interface InventoryOutboxRecord {
  event: DomainEvent;
  publishedAt?: string;
  attempts: number;
}

export interface InventoryActionSession {
  id: string;
  type: "gift";
  actorId: number;
  entryId: string;
  targetOwner: OwnerRef;
  quantity: number;
  status: "active" | "completed" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  completedEntryId?: string;
}

export interface InventoryPersistentState<TEntry = unknown> {
  version: "1.0.0";
  entries: Record<string, TEntry>;
  reservations: Record<string, InventoryReservation>;
  equipment: Record<string, InventoryEquipmentRecord>;
  leases: Record<string, InventoryLeaseRecord>;
  operations: Record<string, InventoryOperationRecord>;
  idempotencyKeys: Record<string, string>;
  history: DomainEvent[];
  outbox: Record<string, InventoryOutboxRecord>;
  actionSessions: Record<string, InventoryActionSession>;
}

export const createEmptyInventoryState = <TEntry = unknown>(): InventoryPersistentState<TEntry> => ({
  version: "1.0.0",
  entries: {},
  reservations: {},
  equipment: {},
  leases: {},
  operations: {},
  idempotencyKeys: {},
  history: [],
  outbox: {},
  actionSessions: {}
});
