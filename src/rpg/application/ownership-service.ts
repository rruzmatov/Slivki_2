import type { OwnershipRepository } from "./ports/ownership-repository";
import type { OwnerDirectoryRepository } from "./ports/game-repositories";
import { ownerKey, type ActorRef, type OperationContext, type OwnerRef } from "../domain/assets";
import { DomainError } from "../domain/errors";
import type {
  OwnerAccessGrant,
  OwnershipPermission,
  OwnershipPermissionRecord,
  OwnershipRecord,
  RegisteredOwner
} from "../domain/ownership";
import { createId } from "../utils/ids";
import type { TransactionEventCollector } from "./transaction-event-collector";
import type { TransactionSchedulerService } from "./transaction-scheduler-service";
import type { OwnershipPermissionRegistry } from "../domain/ownership-permissions";

export interface OwnershipDecision {
  allowed: boolean;
  permission: OwnershipPermission;
  ownershipVersion?: number;
  matchedPermissionIds: string[];
}

export class OwnershipService {
  constructor(
    private readonly repository: OwnershipRepository,
    private readonly ownerDirectory: OwnerDirectoryRepository,
    private readonly permissions: OwnershipPermissionRegistry,
    private readonly events: TransactionEventCollector,
    private readonly scheduler: TransactionSchedulerService
  ) {}

  async registerOwner(owner: OwnerRef, now: string): Promise<RegisteredOwner> {
    const existing = await this.repository.findOwner(owner);
    if (existing) {
      if (existing.status !== "active") throw new DomainError("Владелец недоступен", "OWNERSHIP_OWNER_INACTIVE");
      return existing;
    }
    await this.assertOwnerExists(owner);
    const registered: RegisteredOwner = {
      key: ownerKey(owner),
      owner,
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    await this.repository.saveOwner(registered);
    return registered;
  }

  async getOwnership(entryId: string): Promise<OwnershipRecord> {
    const record = await this.repository.findByEntryId(entryId);
    if (!record || record.status === "archived") {
      throw new DomainError("Владелец объекта не найден", "OWNERSHIP_NOT_FOUND");
    }
    return record;
  }

  async findOwnership(entryId: string): Promise<OwnershipRecord | undefined> {
    return this.repository.findByEntryId(entryId);
  }

  async listOwnedEntryIds(owner: OwnerRef): Promise<string[]> {
    if (!await this.repository.findOwner(owner)) return [];
    const result: string[] = [];
    for (const entryId of await this.repository.listEntryIds(owner)) {
      const record = await this.repository.findByEntryId(entryId);
      if (record?.status !== "archived" && record && sameOwner(record.legalOwner, owner)) result.push(entryId);
    }
    return result;
  }

  async isOwner(entryId: string, owner: OwnerRef): Promise<boolean> {
    const record = await this.repository.findByEntryId(entryId);
    return Boolean(record && record.status !== "archived" && sameOwner(record.legalOwner, owner));
  }

  async assertOwnerAccess(
    owner: OwnerRef,
    actor: ActorRef | undefined,
    permission: OwnershipPermission,
    now: string
  ): Promise<void> {
    this.permissions.assertRegistered(permission);
    await this.registerOwner(owner, now);
    if (!actor || actor.kind === "service" || actor.kind === "admin" || actor.kind === "scheduler") return;
    if (owner.kind === "player" && actor.kind === "player" && String(actor.id) === String(owner.id) &&
      this.permissions.isLegalOwnerDefault(permission)) return;
    if (await this.ownerDirectory.actorControlsOwner(actor, owner) && this.permissions.isLegalOwnerDefault(permission)) return;
    const active = (await this.repository.listOwnerAccess(owner)).filter((grant) =>
      !grant.revokedAt && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(now)) &&
      samePrincipal(grant.principal, actor) && this.permissions.allows(grant.permissions, permission)
    );
    if (active.length === 0) throw new DomainError("Нет прав на имущество владельца", "OWNERSHIP_ACCESS_DENIED");
  }

  async assertPermission(
    entryId: string,
    actor: ActorRef | undefined,
    permission: OwnershipPermission,
    now: string,
    expectedOwner?: OwnerRef
  ): Promise<OwnershipDecision> {
    this.permissions.assertRegistered(permission);
    const ownership = await this.getOwnership(entryId);
    if (expectedOwner && !sameOwner(ownership.legalOwner, expectedOwner)) {
      throw new DomainError("Объект не принадлежит выбранному владельцу", "OWNERSHIP_NOT_OWNER");
    }
    if (!actor || actor.kind === "service" || actor.kind === "admin" || actor.kind === "scheduler") {
      return { allowed: true, permission, ownershipVersion: ownership.version, matchedPermissionIds: [] };
    }

    const records = (await this.repository.listPermissions(entryId)).filter((record) =>
      !record.revokedAt && (!record.expiresAt || Date.parse(record.expiresAt) > Date.parse(now)) &&
      samePrincipal(record.principal, actor) && this.permissions.implies(record.permission, permission)
    );
    const denied = records.filter((record) => record.effect === "deny");
    const granted = records.filter((record) => record.effect === "allow");
    const ownerAllowed = await this.ownerDirectory.actorControlsOwner(actor, ownership.legalOwner) &&
      this.permissions.isLegalOwnerDefault(permission);
    const custodyAllowed = ownership.custodyOwner &&
      await this.ownerDirectory.actorControlsOwner(actor, ownership.custodyOwner) &&
      this.permissions.isCustodyDefault(permission);
    const allowed = denied.length === 0 && (granted.length > 0 || ownerAllowed || Boolean(custodyAllowed));
    if (!allowed) throw new DomainError("Недостаточно прав для операции с объектом", "OWNERSHIP_PERMISSION_DENIED");
    return {
      allowed,
      permission,
      ownershipVersion: ownership.version,
      matchedPermissionIds: [...denied, ...granted].map((record) => record.id)
    };
  }

  async assign(entryId: string, owner: OwnerRef, operation: OperationContext): Promise<OwnershipRecord> {
    await this.registerOwner(owner, operation.now);
    await this.assertOwnerAccess(owner, operation.actor, "manage", operation.now);
    if (await this.repository.findByEntryId(entryId)) {
      throw new DomainError("Владение объектом уже зарегистрировано", "OWNERSHIP_ALREADY_ASSIGNED");
    }
    const record: OwnershipRecord = {
      entryId,
      legalOwner: owner,
      status: "active",
      acquiredAt: operation.now,
      acquiredByOperationId: operation.requestId,
      version: 1,
      updatedAt: operation.now
    };
    await this.repository.saveRecord(record);
    this.publish("ownership.assigned", entryId, record.version, { entryId, owner }, operation);
    return record;
  }

  async reconcileAssignment(entryId: string, owner: OwnerRef, now: string): Promise<OwnershipRecord> {
    await this.registerOwner(owner, now);
    const existing = await this.repository.findByEntryId(entryId);
    if (existing) {
      if (!sameOwner(existing.legalOwner, owner)) {
        throw new DomainError("Legacy-объект связан с несколькими владельцами", "OWNERSHIP_RECONCILIATION_CONFLICT");
      }
      return existing;
    }
    const record: OwnershipRecord = {
      entryId,
      legalOwner: owner,
      status: "active",
      acquiredAt: now,
      acquiredByOperationId: "legacy-migration",
      version: 1,
      updatedAt: now
    };
    await this.repository.saveRecord(record);
    return record;
  }

  async transfer(
    entryId: string,
    fromOwner: OwnerRef,
    toOwner: OwnerRef,
    operation: OperationContext
  ): Promise<OwnershipRecord> {
    await this.assertPermission(entryId, operation.actor, "transfer", operation.now, fromOwner);
    await this.registerOwner(toOwner, operation.now);
    if (sameOwner(fromOwner, toOwner)) throw new DomainError("Владельцы должны отличаться", "OWNERSHIP_SAME_OWNER");
    const record = await this.getOwnership(entryId);
    const previousOwner = record.legalOwner;
    record.legalOwner = toOwner;
    record.custodyOwner = undefined;
    record.status = "active";
    record.version += 1;
    record.updatedAt = operation.now;
    await this.repository.saveRecord(record);
    this.publish("ownership.transferred", entryId, record.version, { entryId, fromOwner: previousOwner, toOwner }, operation);
    return record;
  }

  async setCustody(entryId: string, custodyOwner: OwnerRef, operation: OperationContext): Promise<OwnershipRecord> {
    const record = await this.getOwnership(entryId);
    await this.assertPermission(entryId, operation.actor, "lease", operation.now, record.legalOwner);
    await this.registerOwner(custodyOwner, operation.now);
    record.custodyOwner = custodyOwner;
    record.version += 1;
    record.updatedAt = operation.now;
    await this.repository.saveRecord(record);
    this.publish("ownership.custody.changed", entryId, record.version, { entryId, legalOwner: record.legalOwner, custodyOwner }, operation);
    return record;
  }

  async clearCustody(entryId: string, operation: OperationContext): Promise<OwnershipRecord> {
    const record = await this.getOwnership(entryId);
    const actor = operation.actor;
    if (actor && actor.kind !== "service" && actor.kind !== "admin" &&
      !await this.ownerDirectory.actorControlsOwner(actor, record.legalOwner) &&
      !(record.custodyOwner && await this.ownerDirectory.actorControlsOwner(actor, record.custodyOwner))) {
      throw new DomainError("Нет прав на возврат объекта", "OWNERSHIP_PERMISSION_DENIED");
    }
    const previousCustodyOwner = record.custodyOwner;
    record.custodyOwner = undefined;
    record.version += 1;
    record.updatedAt = operation.now;
    await this.repository.saveRecord(record);
    this.publish("ownership.custody.changed", entryId, record.version, { entryId, legalOwner: record.legalOwner, previousCustodyOwner }, operation);
    return record;
  }

  async grantPermission(
    entryId: string,
    principal: ActorRef,
    permission: OwnershipPermission,
    effect: "allow" | "deny",
    source: string,
    operation: OperationContext,
    expiresAt?: string
  ): Promise<OwnershipPermissionRecord> {
    this.permissions.assertRegistered(permission);
    await this.assertPermission(entryId, operation.actor, "manage", operation.now);
    assertOptionalFutureTimestamp(expiresAt, operation.now);
    if (!source.trim()) throw new DomainError("Источник разрешения обязателен", "OWNERSHIP_PERMISSION_SOURCE_INVALID");
    const record: OwnershipPermissionRecord = {
      id: createId("ownership_permission"),
      entryId,
      principal,
      permission,
      effect,
      source,
      createdAt: operation.now,
      expiresAt,
      version: 1
    };
    await this.repository.savePermission(record);
    if (expiresAt) {
      await this.scheduler.schedule({
        taskType: "ownership.permission.expire",
        payload: { permissionId: record.id },
        runAt: expiresAt,
        idempotencyKey: `ownership.permission.expire:${record.id}`
      }, operation);
    }
    this.publish("ownership.permission.granted", entryId, record.version, { ...record }, operation);
    return record;
  }

  async revokePermission(permissionId: string, operation: OperationContext): Promise<OwnershipPermissionRecord> {
    const record = await this.repository.findPermission(permissionId);
    if (!record) throw new DomainError("Разрешение не найдено", "OWNERSHIP_PERMISSION_NOT_FOUND");
    await this.assertPermission(record.entryId, operation.actor, "manage", operation.now);
    if (!record.revokedAt) {
      record.revokedAt = operation.now;
      record.version += 1;
      await this.repository.savePermission(record);
      this.publish("ownership.permission.revoked", record.entryId, record.version, { permissionId, entryId: record.entryId }, operation);
    }
    return record;
  }

  async expirePermission(permissionId: string, operation: OperationContext): Promise<OwnershipPermissionRecord | undefined> {
    const record = await this.repository.findPermission(permissionId);
    if (!record || record.revokedAt || !record.expiresAt || record.expiresAt > operation.now) return record;
    return this.revokePermission(permissionId, operation);
  }

  async grantOwnerAccess(
    owner: OwnerRef,
    principal: ActorRef,
    permissions: OwnershipPermission[],
    source: string,
    operation: OperationContext,
    expiresAt?: string
  ): Promise<OwnerAccessGrant> {
    await this.registerOwner(owner, operation.now);
    await this.assertOwnerAccess(owner, operation.actor, "manage", operation.now);
    assertOptionalFutureTimestamp(expiresAt, operation.now);
    const normalizedPermissions = [...new Set(permissions)];
    for (const permission of normalizedPermissions) this.permissions.assertRegistered(permission);
    if (normalizedPermissions.length === 0) {
      throw new DomainError("Необходимо указать хотя бы одно разрешение", "OWNERSHIP_PERMISSION_INVALID");
    }
    if (!source.trim()) throw new DomainError("Источник разрешения обязателен", "OWNERSHIP_PERMISSION_SOURCE_INVALID");
    const grant: OwnerAccessGrant = {
      id: createId("owner_access"),
      owner,
      principal,
      permissions: normalizedPermissions,
      source,
      createdAt: operation.now,
      expiresAt,
      version: 1
    };
    await this.repository.saveOwnerAccess(grant);
    if (expiresAt) {
      await this.scheduler.schedule({
        taskType: "ownership.owner_access.expire",
        payload: { ownerAccessId: grant.id },
        runAt: expiresAt,
        idempotencyKey: `ownership.owner_access.expire:${grant.id}`
      }, operation);
    }
    this.publish("ownership.owner_access.granted", grant.id, grant.version, { ...grant }, operation);
    return grant;
  }

  async revokeOwnerAccess(ownerAccessId: string, operation: OperationContext): Promise<OwnerAccessGrant> {
    const grant = await this.repository.findOwnerAccess(ownerAccessId);
    if (!grant) throw new DomainError("Доступ владельца не найден", "OWNERSHIP_OWNER_ACCESS_NOT_FOUND");
    await this.assertOwnerAccess(grant.owner, operation.actor, "manage", operation.now);
    if (!grant.revokedAt) {
      grant.revokedAt = operation.now;
      grant.version += 1;
      await this.repository.saveOwnerAccess(grant);
      this.publish("ownership.owner_access.revoked", grant.id, grant.version, {
        ownerAccessId: grant.id,
        owner: grant.owner,
        principal: grant.principal
      }, operation);
    }
    return grant;
  }

  async expireOwnerAccess(ownerAccessId: string, operation: OperationContext): Promise<OwnerAccessGrant | undefined> {
    const grant = await this.repository.findOwnerAccess(ownerAccessId);
    if (!grant || grant.revokedAt || !grant.expiresAt || grant.expiresAt > operation.now) return grant;
    return this.revokeOwnerAccess(ownerAccessId, operation);
  }

  async confiscate(entryId: string, custodyOwner: OwnerRef, operation: OperationContext): Promise<OwnershipRecord> {
    if (operation.actor?.kind !== "admin" && operation.actor?.kind !== "service") {
      throw new DomainError("Конфискация доступна только администратору", "OWNERSHIP_PERMISSION_DENIED");
    }
    const record = await this.getOwnership(entryId);
    await this.registerOwner(custodyOwner, operation.now);
    record.custodyOwner = custodyOwner;
    record.status = "confiscated";
    record.version += 1;
    record.updatedAt = operation.now;
    await this.repository.saveRecord(record);
    this.publish("ownership.confiscated", entryId, record.version, { entryId, legalOwner: record.legalOwner, custodyOwner }, operation);
    return record;
  }

  async recover(entryId: string, operation: OperationContext): Promise<OwnershipRecord> {
    if (operation.actor?.kind !== "admin" && operation.actor?.kind !== "service") {
      throw new DomainError("Возврат конфискованного объекта запрещён", "OWNERSHIP_PERMISSION_DENIED");
    }
    const record = await this.getOwnership(entryId);
    if (record.status !== "confiscated") throw new DomainError("Объект не конфискован", "OWNERSHIP_NOT_CONFISCATED");
    record.custodyOwner = undefined;
    record.status = "active";
    record.version += 1;
    record.updatedAt = operation.now;
    await this.repository.saveRecord(record);
    this.publish("ownership.recovered", entryId, record.version, { entryId, legalOwner: record.legalOwner }, operation);
    return record;
  }

  async archive(entryId: string, operation: OperationContext): Promise<OwnershipRecord> {
    const record = await this.getOwnership(entryId);
    await this.assertPermission(entryId, operation.actor, "manage", operation.now, record.legalOwner);
    record.status = "archived";
    record.custodyOwner = undefined;
    record.version += 1;
    record.updatedAt = operation.now;
    await this.repository.saveRecord(record);
    this.publish("ownership.archived", entryId, record.version, { entryId, legalOwner: record.legalOwner }, operation);
    return record;
  }

  async clearOwner(owner: OwnerRef, operation: OperationContext): Promise<void> {
    for (const entryId of await this.repository.listEntryIds(owner)) {
      const record = await this.repository.findByEntryId(entryId);
      if (record?.status !== "archived") await this.archive(entryId, operation);
    }
  }

  private async assertOwnerExists(owner: OwnerRef): Promise<void> {
    if (await this.ownerDirectory.exists(owner)) return;
    if (owner.kind === "player") throw new DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
    if (owner.kind === "family") throw new DomainError("Семья не найдена", "FAMILY_NOT_FOUND");
    throw new DomainError("Владелец не найден", "OWNERSHIP_OWNER_NOT_FOUND");
  }

  private publish(
    type: string,
    aggregateId: string,
    aggregateVersion: number,
    payload: Readonly<Record<string, unknown>>,
    operation: OperationContext
  ): void {
    this.events.collect({ eventType: type, aggregateType: "ownership", aggregateId, aggregateVersion, payload }, operation);
  }
}

export const sameOwner = (left: OwnerRef, right: OwnerRef): boolean => ownerKey(left) === ownerKey(right);

function samePrincipal(left: ActorRef, right: ActorRef): boolean {
  return left.kind === right.kind && String(left.id) === String(right.id);
}

function assertOptionalFutureTimestamp(value: string | undefined, now: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.parse(now)) {
    throw new DomainError("Срок разрешения должен быть корректной датой в будущем", "OWNERSHIP_PERMISSION_EXPIRATION_INVALID");
  }
}
