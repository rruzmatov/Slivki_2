"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameOwner = exports.OwnershipService = void 0;
const assets_1 = require("../domain/assets");
const errors_1 = require("../domain/errors");
const ids_1 = require("../utils/ids");
class OwnershipService {
    repository;
    ownerDirectory;
    permissions;
    events;
    scheduler;
    constructor(repository, ownerDirectory, permissions, events, scheduler) {
        this.repository = repository;
        this.ownerDirectory = ownerDirectory;
        this.permissions = permissions;
        this.events = events;
        this.scheduler = scheduler;
    }
    async registerOwner(owner, now) {
        const existing = await this.repository.findOwner(owner);
        if (existing) {
            if (existing.status !== "active")
                throw new errors_1.DomainError("Владелец недоступен", "OWNERSHIP_OWNER_INACTIVE");
            return existing;
        }
        await this.assertOwnerExists(owner);
        const registered = {
            key: (0, assets_1.ownerKey)(owner),
            owner,
            status: "active",
            version: 1,
            createdAt: now,
            updatedAt: now
        };
        await this.repository.saveOwner(registered);
        return registered;
    }
    async getOwnership(entryId) {
        const record = await this.repository.findByEntryId(entryId);
        if (!record || record.status === "archived") {
            throw new errors_1.DomainError("Владелец объекта не найден", "OWNERSHIP_NOT_FOUND");
        }
        return record;
    }
    async findOwnership(entryId) {
        return this.repository.findByEntryId(entryId);
    }
    async listOwnedEntryIds(owner) {
        if (!await this.repository.findOwner(owner))
            return [];
        const result = [];
        for (const entryId of await this.repository.listEntryIds(owner)) {
            const record = await this.repository.findByEntryId(entryId);
            if (record?.status !== "archived" && record && (0, exports.sameOwner)(record.legalOwner, owner))
                result.push(entryId);
        }
        return result;
    }
    async isOwner(entryId, owner) {
        const record = await this.repository.findByEntryId(entryId);
        return Boolean(record && record.status !== "archived" && (0, exports.sameOwner)(record.legalOwner, owner));
    }
    async assertOwnerAccess(owner, actor, permission, now) {
        this.permissions.assertRegistered(permission);
        await this.registerOwner(owner, now);
        if (!actor || actor.kind === "service" || actor.kind === "admin" || actor.kind === "scheduler")
            return;
        if (owner.kind === "player" && actor.kind === "player" && String(actor.id) === String(owner.id) &&
            this.permissions.isLegalOwnerDefault(permission))
            return;
        if (await this.ownerDirectory.actorControlsOwner(actor, owner) && this.permissions.isLegalOwnerDefault(permission))
            return;
        const active = (await this.repository.listOwnerAccess(owner)).filter((grant) => !grant.revokedAt && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(now)) &&
            samePrincipal(grant.principal, actor) && this.permissions.allows(grant.permissions, permission));
        if (active.length === 0)
            throw new errors_1.DomainError("Нет прав на имущество владельца", "OWNERSHIP_ACCESS_DENIED");
    }
    async assertPermission(entryId, actor, permission, now, expectedOwner) {
        this.permissions.assertRegistered(permission);
        const ownership = await this.getOwnership(entryId);
        if (expectedOwner && !(0, exports.sameOwner)(ownership.legalOwner, expectedOwner)) {
            throw new errors_1.DomainError("Объект не принадлежит выбранному владельцу", "OWNERSHIP_NOT_OWNER");
        }
        if (!actor || actor.kind === "service" || actor.kind === "admin" || actor.kind === "scheduler") {
            return { allowed: true, permission, ownershipVersion: ownership.version, matchedPermissionIds: [] };
        }
        const records = (await this.repository.listPermissions(entryId)).filter((record) => !record.revokedAt && (!record.expiresAt || Date.parse(record.expiresAt) > Date.parse(now)) &&
            samePrincipal(record.principal, actor) && this.permissions.implies(record.permission, permission));
        const denied = records.filter((record) => record.effect === "deny");
        const granted = records.filter((record) => record.effect === "allow");
        const ownerAllowed = await this.ownerDirectory.actorControlsOwner(actor, ownership.legalOwner) &&
            this.permissions.isLegalOwnerDefault(permission);
        const custodyAllowed = ownership.custodyOwner &&
            await this.ownerDirectory.actorControlsOwner(actor, ownership.custodyOwner) &&
            this.permissions.isCustodyDefault(permission);
        const allowed = denied.length === 0 && (granted.length > 0 || ownerAllowed || Boolean(custodyAllowed));
        if (!allowed)
            throw new errors_1.DomainError("Недостаточно прав для операции с объектом", "OWNERSHIP_PERMISSION_DENIED");
        return {
            allowed,
            permission,
            ownershipVersion: ownership.version,
            matchedPermissionIds: [...denied, ...granted].map((record) => record.id)
        };
    }
    async assign(entryId, owner, operation) {
        await this.registerOwner(owner, operation.now);
        await this.assertOwnerAccess(owner, operation.actor, "manage", operation.now);
        if (await this.repository.findByEntryId(entryId)) {
            throw new errors_1.DomainError("Владение объектом уже зарегистрировано", "OWNERSHIP_ALREADY_ASSIGNED");
        }
        const record = {
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
    async reconcileAssignment(entryId, owner, now) {
        await this.registerOwner(owner, now);
        const existing = await this.repository.findByEntryId(entryId);
        if (existing) {
            if (!(0, exports.sameOwner)(existing.legalOwner, owner)) {
                throw new errors_1.DomainError("Legacy-объект связан с несколькими владельцами", "OWNERSHIP_RECONCILIATION_CONFLICT");
            }
            return existing;
        }
        const record = {
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
    async transfer(entryId, fromOwner, toOwner, operation) {
        await this.assertPermission(entryId, operation.actor, "transfer", operation.now, fromOwner);
        await this.registerOwner(toOwner, operation.now);
        if ((0, exports.sameOwner)(fromOwner, toOwner))
            throw new errors_1.DomainError("Владельцы должны отличаться", "OWNERSHIP_SAME_OWNER");
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
    async setCustody(entryId, custodyOwner, operation) {
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
    async clearCustody(entryId, operation) {
        const record = await this.getOwnership(entryId);
        const actor = operation.actor;
        if (actor && actor.kind !== "service" && actor.kind !== "admin" &&
            !await this.ownerDirectory.actorControlsOwner(actor, record.legalOwner) &&
            !(record.custodyOwner && await this.ownerDirectory.actorControlsOwner(actor, record.custodyOwner))) {
            throw new errors_1.DomainError("Нет прав на возврат объекта", "OWNERSHIP_PERMISSION_DENIED");
        }
        const previousCustodyOwner = record.custodyOwner;
        record.custodyOwner = undefined;
        record.version += 1;
        record.updatedAt = operation.now;
        await this.repository.saveRecord(record);
        this.publish("ownership.custody.changed", entryId, record.version, { entryId, legalOwner: record.legalOwner, previousCustodyOwner }, operation);
        return record;
    }
    async grantPermission(entryId, principal, permission, effect, source, operation, expiresAt) {
        this.permissions.assertRegistered(permission);
        await this.assertPermission(entryId, operation.actor, "manage", operation.now);
        assertOptionalFutureTimestamp(expiresAt, operation.now);
        if (!source.trim())
            throw new errors_1.DomainError("Источник разрешения обязателен", "OWNERSHIP_PERMISSION_SOURCE_INVALID");
        const record = {
            id: (0, ids_1.createId)("ownership_permission"),
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
    async revokePermission(permissionId, operation) {
        const record = await this.repository.findPermission(permissionId);
        if (!record)
            throw new errors_1.DomainError("Разрешение не найдено", "OWNERSHIP_PERMISSION_NOT_FOUND");
        await this.assertPermission(record.entryId, operation.actor, "manage", operation.now);
        if (!record.revokedAt) {
            record.revokedAt = operation.now;
            record.version += 1;
            await this.repository.savePermission(record);
            this.publish("ownership.permission.revoked", record.entryId, record.version, { permissionId, entryId: record.entryId }, operation);
        }
        return record;
    }
    async expirePermission(permissionId, operation) {
        const record = await this.repository.findPermission(permissionId);
        if (!record || record.revokedAt || !record.expiresAt || record.expiresAt > operation.now)
            return record;
        return this.revokePermission(permissionId, operation);
    }
    async grantOwnerAccess(owner, principal, permissions, source, operation, expiresAt) {
        await this.registerOwner(owner, operation.now);
        await this.assertOwnerAccess(owner, operation.actor, "manage", operation.now);
        assertOptionalFutureTimestamp(expiresAt, operation.now);
        const normalizedPermissions = [...new Set(permissions)];
        for (const permission of normalizedPermissions)
            this.permissions.assertRegistered(permission);
        if (normalizedPermissions.length === 0) {
            throw new errors_1.DomainError("Необходимо указать хотя бы одно разрешение", "OWNERSHIP_PERMISSION_INVALID");
        }
        if (!source.trim())
            throw new errors_1.DomainError("Источник разрешения обязателен", "OWNERSHIP_PERMISSION_SOURCE_INVALID");
        const grant = {
            id: (0, ids_1.createId)("owner_access"),
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
    async revokeOwnerAccess(ownerAccessId, operation) {
        const grant = await this.repository.findOwnerAccess(ownerAccessId);
        if (!grant)
            throw new errors_1.DomainError("Доступ владельца не найден", "OWNERSHIP_OWNER_ACCESS_NOT_FOUND");
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
    async expireOwnerAccess(ownerAccessId, operation) {
        const grant = await this.repository.findOwnerAccess(ownerAccessId);
        if (!grant || grant.revokedAt || !grant.expiresAt || grant.expiresAt > operation.now)
            return grant;
        return this.revokeOwnerAccess(ownerAccessId, operation);
    }
    async confiscate(entryId, custodyOwner, operation) {
        if (operation.actor?.kind !== "admin" && operation.actor?.kind !== "service") {
            throw new errors_1.DomainError("Конфискация доступна только администратору", "OWNERSHIP_PERMISSION_DENIED");
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
    async recover(entryId, operation) {
        if (operation.actor?.kind !== "admin" && operation.actor?.kind !== "service") {
            throw new errors_1.DomainError("Возврат конфискованного объекта запрещён", "OWNERSHIP_PERMISSION_DENIED");
        }
        const record = await this.getOwnership(entryId);
        if (record.status !== "confiscated")
            throw new errors_1.DomainError("Объект не конфискован", "OWNERSHIP_NOT_CONFISCATED");
        record.custodyOwner = undefined;
        record.status = "active";
        record.version += 1;
        record.updatedAt = operation.now;
        await this.repository.saveRecord(record);
        this.publish("ownership.recovered", entryId, record.version, { entryId, legalOwner: record.legalOwner }, operation);
        return record;
    }
    async archive(entryId, operation) {
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
    async clearOwner(owner, operation) {
        for (const entryId of await this.repository.listEntryIds(owner)) {
            const record = await this.repository.findByEntryId(entryId);
            if (record?.status !== "archived")
                await this.archive(entryId, operation);
        }
    }
    async assertOwnerExists(owner) {
        if (await this.ownerDirectory.exists(owner))
            return;
        if (owner.kind === "player")
            throw new errors_1.DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
        if (owner.kind === "family")
            throw new errors_1.DomainError("Семья не найдена", "FAMILY_NOT_FOUND");
        throw new errors_1.DomainError("Владелец не найден", "OWNERSHIP_OWNER_NOT_FOUND");
    }
    publish(type, aggregateId, aggregateVersion, payload, operation) {
        this.events.collect({ eventType: type, aggregateType: "ownership", aggregateId, aggregateVersion, payload }, operation);
    }
}
exports.OwnershipService = OwnershipService;
const sameOwner = (left, right) => (0, assets_1.ownerKey)(left) === (0, assets_1.ownerKey)(right);
exports.sameOwner = sameOwner;
function samePrincipal(left, right) {
    return left.kind === right.kind && String(left.id) === String(right.id);
}
function assertOptionalFutureTimestamp(value, now) {
    if (value === undefined)
        return;
    if (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.parse(now)) {
        throw new errors_1.DomainError("Срок разрешения должен быть корректной датой в будущем", "OWNERSHIP_PERMISSION_EXPIRATION_INVALID");
    }
}
