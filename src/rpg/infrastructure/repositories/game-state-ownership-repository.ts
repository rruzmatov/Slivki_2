import type { OwnershipRepository } from "../../application/ports/ownership-repository";
import { ownerKey, type OwnerRef } from "../../domain/assets";
import type { GameState } from "../storage/game-state";
import type { OwnerAccessGrant, OwnershipPermissionRecord, OwnershipRecord, RegisteredOwner } from "../../domain/ownership";

export class GameStateOwnershipRepository implements OwnershipRepository {
  constructor(private readonly state: GameState) {}

  async findOwner(owner: OwnerRef): Promise<RegisteredOwner | undefined> {
    return clone(this.state.ownership.owners[ownerKey(owner)]);
  }

  async saveOwner(owner: RegisteredOwner): Promise<void> {
    this.state.ownership.owners[owner.key] = clone(owner);
    this.state.ownership.entryIdsByOwner[owner.key] ??= [];
  }

  async findByEntryId(entryId: string): Promise<OwnershipRecord | undefined> {
    return clone(this.state.ownership.records[entryId]);
  }

  async saveRecord(record: OwnershipRecord): Promise<void> {
    const previous = this.state.ownership.records[record.entryId];
    if (previous) {
      const previousKey = ownerKey(previous.legalOwner);
      this.state.ownership.entryIdsByOwner[previousKey] = (this.state.ownership.entryIdsByOwner[previousKey] ?? [])
        .filter((id) => id !== record.entryId);
    }
    this.state.ownership.records[record.entryId] = clone(record);
    const nextKey = ownerKey(record.legalOwner);
    const ids = this.state.ownership.entryIdsByOwner[nextKey] ?? [];
    if (!ids.includes(record.entryId)) ids.push(record.entryId);
    this.state.ownership.entryIdsByOwner[nextKey] = ids;
  }

  async listEntryIds(owner: OwnerRef): Promise<string[]> {
    return [...(this.state.ownership.entryIdsByOwner[ownerKey(owner)] ?? [])];
  }

  async listPermissions(entryId: string): Promise<OwnershipPermissionRecord[]> {
    return Object.values(this.state.ownership.permissions)
      .filter((permission) => permission.entryId === entryId)
      .map((permission) => clone(permission));
  }

  async findPermission(permissionId: string): Promise<OwnershipPermissionRecord | undefined> {
    return clone(this.state.ownership.permissions[permissionId]);
  }

  async savePermission(permission: OwnershipPermissionRecord): Promise<void> {
    this.state.ownership.permissions[permission.id] = clone(permission);
  }

  async listOwnerAccess(owner: OwnerRef): Promise<OwnerAccessGrant[]> {
    const key = ownerKey(owner);
    return Object.values(this.state.ownership.ownerAccess)
      .filter((grant) => ownerKey(grant.owner) === key)
      .map((grant) => clone(grant));
  }

  async findOwnerAccess(ownerAccessId: string): Promise<OwnerAccessGrant | undefined> {
    return clone(this.state.ownership.ownerAccess[ownerAccessId]);
  }

  async saveOwnerAccess(grant: OwnerAccessGrant): Promise<void> {
    this.state.ownership.ownerAccess[grant.id] = clone(grant);
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
