import type { OwnerRef } from "../../domain/assets";
import type { OwnerAccessGrant, OwnershipPermissionRecord, OwnershipRecord, RegisteredOwner } from "../../domain/ownership";

export interface OwnershipRepository {
  findOwner(owner: OwnerRef): Promise<RegisteredOwner | undefined>;
  saveOwner(owner: RegisteredOwner): Promise<void>;
  findByEntryId(entryId: string): Promise<OwnershipRecord | undefined>;
  saveRecord(record: OwnershipRecord): Promise<void>;
  listEntryIds(owner: OwnerRef): Promise<string[]>;
  listPermissions(entryId: string): Promise<OwnershipPermissionRecord[]>;
  findPermission(permissionId: string): Promise<OwnershipPermissionRecord | undefined>;
  savePermission(permission: OwnershipPermissionRecord): Promise<void>;
  listOwnerAccess(owner: OwnerRef): Promise<OwnerAccessGrant[]>;
  findOwnerAccess(ownerAccessId: string): Promise<OwnerAccessGrant | undefined>;
  saveOwnerAccess(grant: OwnerAccessGrant): Promise<void>;
}
