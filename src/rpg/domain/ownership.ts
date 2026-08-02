import type { ActorRef, OwnerRef } from "./assets";
import type { DomainEvent } from "./events";

export type KnownOwnershipPermission =
  | "view"
  | "use"
  | "move"
  | "equip"
  | "inspect"
  | "repair"
  | "maintain"
  | "transfer"
  | "sell"
  | "lease"
  | "manage"
  | "upgrade"
  | "confiscate";

export type OwnershipPermission = KnownOwnershipPermission | (string & {});

export interface RegisteredOwner {
  key: string;
  owner: OwnerRef;
  status: "active" | "suspended" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OwnershipRecord {
  entryId: string;
  legalOwner: OwnerRef;
  custodyOwner?: OwnerRef;
  status: "active" | "confiscated" | "archived";
  acquiredAt: string;
  acquiredByOperationId: string;
  version: number;
  updatedAt: string;
}

export interface OwnershipPermissionRecord {
  id: string;
  entryId: string;
  principal: ActorRef;
  permission: OwnershipPermission;
  effect: "allow" | "deny";
  source: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  version: number;
}

export interface OwnerAccessGrant {
  id: string;
  owner: OwnerRef;
  principal: ActorRef;
  permissions: OwnershipPermission[];
  source: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  version: number;
}

export interface OwnershipPersistentState {
  version: "1.0.0";
  owners: Record<string, RegisteredOwner>;
  records: Record<string, OwnershipRecord>;
  entryIdsByOwner: Record<string, string[]>;
  permissions: Record<string, OwnershipPermissionRecord>;
  ownerAccess: Record<string, OwnerAccessGrant>;
  history: DomainEvent[];
  outbox: Record<string, { event: DomainEvent; attempts: number; publishedAt?: string }>;
}

export const createEmptyOwnershipState = (): OwnershipPersistentState => ({
  version: "1.0.0",
  owners: {},
  records: {},
  entryIdsByOwner: {},
  permissions: {},
  ownerAccess: {},
  history: [],
  outbox: {}
});
