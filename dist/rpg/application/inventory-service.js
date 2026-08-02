"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const errors_1 = require("../domain/errors");
const ids_1 = require("../utils/ids");
const ownership_service_1 = require("./ownership-service");
const inventory_entry_state_1 = require("./inventory-entry-state");
class InventoryService {
    catalog;
    repository;
    ownership;
    legacyInventory;
    queries;
    events;
    schemas;
    scheduler;
    constructor(catalog, repository, ownership, legacyInventory, queries, events, schemas, scheduler) {
        this.catalog = catalog;
        this.repository = repository;
        this.ownership = ownership;
        this.legacyInventory = legacyInventory;
        this.queries = queries;
        this.events = events;
        this.schemas = schemas;
        this.scheduler = scheduler;
    }
    async list(owner, query = { limit: 25 }) {
        return this.queries.list(owner, query);
    }
    async listAll(owner) {
        return this.queries.listAll(owner);
    }
    async getEntry(owner, inventoryEntryId) {
        return this.queries.getEntry(owner, inventoryEntryId);
    }
    async findFirstByProduct(owner, productId) {
        return this.queries.findFirstByProduct(owner, productId);
    }
    async getOwnedProductCount(owner, productId) {
        return this.queries.getOwnedProductCount(owner, productId);
    }
    async hasProduct(owner, productId) {
        return this.queries.hasProduct(owner, productId);
    }
    async hasCategory(owner, categoryId) {
        return this.queries.hasCategory(owner, categoryId);
    }
    async hasAssetType(owner, assetTypeId) {
        return this.queries.hasAssetType(owner, assetTypeId);
    }
    async grant(input, operation) {
        const replay = await this.findReplay("grant", input, operation);
        if (replay)
            return replay;
        const product = this.catalog.getProduct(input.productId);
        const assetType = this.catalog.getAssetTypeForProduct(product.id);
        if (assetType.id === "currency") {
            throw new errors_1.DomainError("Денежные средства изменяются только через EconomyService", "INVENTORY_CURRENCY_FORBIDDEN");
        }
        await this.ownership.assertOwnerAccess(input.owner, operation.actor, "manage", operation.now);
        if (!(product.allowedOwnerKinds ?? assetType.allowedOwnerKinds).includes(input.owner.kind)) {
            throw new errors_1.DomainError("Этот объект нельзя выдать выбранному владельцу", "INVENTORY_OWNER_FORBIDDEN");
        }
        const quantity = normalizeQuantity(input.quantity, 1_000);
        const mode = product.inventoryMode ?? assetType.defaultInventoryMode;
        const inventoryEntryIds = [];
        if (mode === "immediate") {
            this.publishGranted(input, [], quantity, operation);
            return this.completeOperation("grant", input, operation, { productId: product.id, inventoryEntryIds: [], quantity });
        }
        if (mode === "stack") {
            const candidate = this.createEntry(product, quantity, input, operation.now);
            const existing = (await this.entriesForOwner(input.owner))
                .find((entry) => stackCompatible(entry, candidate, candidate.location));
            if (existing) {
                this.ensureEntryState(existing);
                existing.quantity += quantity;
                existing.updatedAt = operation.now;
                existing.version = (existing.version ?? 1) + 1;
                await this.repository.save(existing);
                inventoryEntryIds.push(existing.instanceId);
            }
            else {
                await this.repository.add(candidate);
                await this.ownership.assign(candidate.instanceId, input.owner, operation);
                inventoryEntryIds.push(candidate.instanceId);
            }
        }
        else if (mode === "entitlement") {
            const existing = (await this.entriesForOwner(input.owner)).find((entry) => entry.itemId === product.id);
            if (existing)
                throw new errors_1.DomainError("Это право уже принадлежит владельцу", "INVENTORY_ENTITLEMENT_EXISTS");
            if (quantity !== 1)
                throw new errors_1.DomainError("Право можно выдать только в одном экземпляре", "INVENTORY_QUANTITY_INVALID");
            const entry = this.createEntry(product, 1, input, operation.now);
            await this.repository.add(entry);
            await this.ownership.assign(entry.instanceId, input.owner, operation);
            inventoryEntryIds.push(entry.instanceId);
        }
        else {
            for (let index = 0; index < quantity; index += 1) {
                const entry = this.createEntry(product, 1, input, operation.now);
                await this.repository.add(entry);
                await this.ownership.assign(entry.instanceId, input.owner, operation);
                inventoryEntryIds.push(entry.instanceId);
            }
        }
        await this.refreshOwnershipIndexes(input.owner, operation.now);
        await this.syncCompatibilityProjection(input.owner, operation.now);
        this.publishGranted(input, inventoryEntryIds, quantity, operation);
        return this.completeOperation("grant", input, operation, { productId: product.id, inventoryEntryIds, quantity });
    }
    async remove(input, operation) {
        const replay = await this.findReplay("remove", input, operation);
        if (replay)
            return replay;
        const entry = await this.getEntry(input.owner, input.inventoryEntryId);
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "manage", operation.now, input.owner);
        await this.assertEntryAvailable(entry, input.quantity);
        const quantity = normalizeQuantity(input.quantity, entry.quantity);
        if (quantity > entry.quantity)
            throw new errors_1.DomainError("Недостаточно предметов в инвентаре", "INVENTORY_QUANTITY_INVALID");
        const productId = entry.itemId;
        const removedCompletely = quantity === entry.quantity;
        if (removedCompletely) {
            entry.lifecycleStatus = input.disposition === "consume" ? "revoked" : "archived";
            entry.updatedAt = operation.now;
            entry.version = (entry.version ?? 1) + 1;
            await this.repository.save(entry);
            await this.ownership.archive(entry.instanceId, operation);
        }
        else {
            entry.quantity -= quantity;
            entry.updatedAt = operation.now;
            entry.version = (entry.version ?? 1) + 1;
            await this.repository.save(entry);
        }
        await this.refreshOwnershipIndexes(input.owner, operation.now);
        await this.syncCompatibilityProjection(input.owner, operation.now);
        this.publish({
            type: "inventory.removed",
            aggregateId: entry.instanceId,
            payload: {
                owner: input.owner,
                productId,
                entries: [{ inventoryEntryId: entry.instanceId, removedCompletely }],
                quantity,
                reason: input.reason
            }
        }, operation);
        if (input.disposition === "consume") {
            this.publish({
                type: "inventory.consumed",
                aggregateId: entry.instanceId,
                payload: { owner: input.owner, productId, quantity, reason: input.reason }
            }, operation);
        }
        return this.completeOperation("remove", input, operation, { productId, inventoryEntryIds: [entry.instanceId], quantity });
    }
    async clear(owner, reason, operation) {
        for (const entry of await this.listAll(owner)) {
            entry.instanceId = entry.instanceId || (0, ids_1.createId)("asset");
            entry.acquiredBy = entry.acquiredBy || "migration";
            await this.remove({
                owner,
                inventoryEntryId: entry.instanceId,
                quantity: entry.quantity,
                reason
            }, { ...operation, requestId: `${operation.requestId}:${entry.instanceId}`, idempotencyKey: `${operation.idempotencyKey ?? operation.requestId}:${entry.instanceId}` });
        }
    }
    async calculateAssetValue(owner) {
        return this.queries.calculateAssetValue(owner);
    }
    async getAvailability(owner, inventoryEntryId, now) {
        return this.queries.getAvailability(owner, inventoryEntryId, now);
    }
    async listHistory(query = { limit: 25 }) {
        return this.queries.listHistory(query);
    }
    async createGiftActionSession(input, operation) {
        if (operation.actor?.kind !== "player" || Number(operation.actor.id) !== input.actorId) {
            throw new errors_1.DomainError("Подтверждение подарка создаёт только владелец", "OWNERSHIP_PERMISSION_DENIED");
        }
        if (!isValidTimestamp(input.expiresAt) || input.expiresAt <= operation.now) {
            throw new errors_1.DomainError("Срок подтверждения подарка должен быть в будущем", "INVENTORY_ACTION_EXPIRATION_INVALID");
        }
        const owner = { kind: "player", id: input.actorId };
        const entry = await this.getEntry(owner, input.entryId);
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "transfer", operation.now, owner);
        await this.assertEntryAvailable(entry, input.quantity, operation.now);
        const session = {
            id: (0, ids_1.createId)("ivgift"),
            type: "gift",
            actorId: input.actorId,
            entryId: input.entryId,
            targetOwner: input.targetOwner,
            quantity: normalizeQuantity(input.quantity, entry.quantity),
            status: "active",
            createdAt: operation.now,
            expiresAt: input.expiresAt
        };
        await this.repository.saveActionSession(session);
        await this.scheduler.schedule({
            taskType: "inventory.action_session.expire",
            payload: { sessionId: session.id },
            runAt: session.expiresAt,
            idempotencyKey: `inventory.action_session.expire:${session.id}`
        }, operation);
        return session;
    }
    async getActionSession(sessionId, actorId) {
        const session = await this.repository.findActionSession(sessionId);
        if (!session || (actorId !== undefined && session.actorId !== actorId)) {
            throw new errors_1.DomainError("Операция Inventory не найдена", "INVENTORY_ACTION_NOT_FOUND");
        }
        return session;
    }
    async completeActionSession(sessionId, actorId, completedEntryId) {
        const session = await this.getActionSession(sessionId, actorId);
        if (session.status !== "active")
            throw new errors_1.DomainError("Операция Inventory уже закрыта", "INVENTORY_ACTION_CLOSED");
        session.status = "completed";
        session.completedEntryId = completedEntryId;
        await this.repository.saveActionSession(session);
        return session;
    }
    async cancelActionSession(sessionId, actorId) {
        const session = await this.getActionSession(sessionId, actorId);
        if (session.status === "completed")
            throw new errors_1.DomainError("Операция уже выполнена", "INVENTORY_ACTION_COMPLETED");
        if (session.status === "active") {
            session.status = "cancelled";
            await this.repository.saveActionSession(session);
        }
    }
    async expireActionSession(sessionId, now) {
        const session = await this.repository.findActionSession(sessionId);
        if (session?.status === "active" && session.expiresAt <= now) {
            session.status = "expired";
            await this.repository.saveActionSession(session);
        }
    }
    async transfer(input, operation) {
        const replay = await this.findReplay("transfer", input, operation);
        if (replay)
            return replay;
        if ((0, ownership_service_1.sameOwner)(input.fromOwner, input.toOwner))
            throw new errors_1.DomainError("Владельцы передачи должны отличаться", "OWNERSHIP_SAME_OWNER");
        await this.ensureOwnerMigrated(input.fromOwner, operation.now);
        await this.ownership.registerOwner(input.toOwner, operation.now);
        const source = await this.getEntry(input.fromOwner, input.inventoryEntryId);
        const product = this.catalog.getProduct(source.itemId);
        const assetType = this.catalog.getAssetTypeForProduct(product.id);
        if (assetType.id === "currency")
            throw new errors_1.DomainError("Денежные переводы выполняет EconomyService", "INVENTORY_CURRENCY_FORBIDDEN");
        if (!product.capabilities.includes("tradable"))
            throw new errors_1.DomainError("Объект нельзя передать", "INVENTORY_TRANSFER_FORBIDDEN");
        if (!(product.allowedOwnerKinds ?? assetType.allowedOwnerKinds).includes(input.toOwner.kind)) {
            throw new errors_1.DomainError("Этот объект нельзя передать выбранному владельцу", "INVENTORY_OWNER_FORBIDDEN");
        }
        await this.ownership.assertPermission(source.instanceId, operation.actor, "transfer", operation.now, input.fromOwner);
        const quantity = normalizeQuantity(input.quantity, source.quantity);
        if (input.reservationId)
            await this.assertReservation(input.reservationId, source.instanceId, quantity, operation.now);
        await this.assertEntryAvailable(source, quantity, operation.now, input.reservationId);
        const mode = product.inventoryMode ?? assetType.defaultInventoryMode;
        let targetEntryId = source.instanceId;
        const targetExisting = mode === "stack"
            ? (await this.entriesForOwner(input.toOwner)).find((entry) => entry.itemId === source.itemId && stackCompatible(entry, source, input.destination))
            : undefined;
        if (mode === "entitlement" && (await this.entriesForOwner(input.toOwner)).some((entry) => entry.itemId === source.itemId)) {
            throw new errors_1.DomainError("Право уже принадлежит получателю", "INVENTORY_ENTITLEMENT_EXISTS");
        }
        if (targetExisting) {
            targetExisting.quantity += quantity;
            targetExisting.updatedAt = operation.now;
            targetExisting.version = (targetExisting.version ?? 1) + 1;
            await this.repository.save(targetExisting);
            targetEntryId = targetExisting.instanceId;
            await this.decreaseOrArchiveSource(source, input.fromOwner, quantity, operation);
        }
        else if (quantity === source.quantity) {
            source.location = input.destination ?? { kind: "inventory" };
            source.updatedAt = operation.now;
            source.version = (source.version ?? 1) + 1;
            await this.repository.save(source);
            await this.ownership.transfer(source.instanceId, input.fromOwner, input.toOwner, operation);
        }
        else {
            source.quantity -= quantity;
            source.updatedAt = operation.now;
            source.version = (source.version ?? 1) + 1;
            await this.repository.save(source);
            const target = cloneEntryForTransfer(source, quantity, input.destination, operation.now);
            await this.repository.add(target);
            await this.ownership.assign(target.instanceId, input.toOwner, {
                ...operation,
                actor: { kind: "service", id: "inventory-transfer" },
                causationId: operation.requestId
            });
            targetEntryId = target.instanceId;
        }
        await this.refreshOwnershipIndexes(input.fromOwner, operation.now);
        await this.refreshOwnershipIndexes(input.toOwner, operation.now);
        await this.syncCompatibilityProjection(input.fromOwner, operation.now);
        await this.syncCompatibilityProjection(input.toOwner, operation.now);
        if (input.reservationId)
            await this.commitReservation(input.reservationId, operation.now);
        const removedCompletely = !await this.ownership.isOwner(source.instanceId, input.fromOwner);
        this.publish({
            type: "inventory.removed",
            aggregateId: source.instanceId,
            payload: {
                owner: input.fromOwner,
                productId: source.itemId,
                entries: [{ inventoryEntryId: source.instanceId, removedCompletely }],
                quantity,
                reason: input.reason
            }
        }, operation);
        this.publish({
            type: "inventory.granted",
            aggregateId: targetEntryId,
            payload: {
                owner: input.toOwner,
                productId: source.itemId,
                inventoryEntryIds: [targetEntryId],
                quantity,
                acquiredBy: input.transferType === "gift" ? "gift" : "migration"
            }
        }, operation);
        this.publish({
            type: input.transferType === "gift" ? "inventory.gifted" : "inventory.transferred",
            aggregateId: targetEntryId,
            payload: {
                fromOwner: input.fromOwner,
                toOwner: input.toOwner,
                sourceInventoryEntryId: source.instanceId,
                targetInventoryEntryId: targetEntryId,
                productId: source.itemId,
                quantity,
                reason: input.reason
            }
        }, operation);
        return this.completeOperation("transfer", input, operation, {
            productId: source.itemId,
            inventoryEntryIds: [targetEntryId],
            quantity
        });
    }
    async gift(input, operation) {
        return this.transfer({ ...input, transferType: "gift" }, operation);
    }
    async reserve(input, operation) {
        const replay = await this.findReplay("reserve", input, operation);
        if (replay)
            return replay;
        const entry = await this.getEntry(input.owner, input.inventoryEntryId);
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "use", operation.now, input.owner);
        const quantity = normalizeQuantity(input.quantity, entry.quantity);
        if (!isValidTimestamp(input.expiresAt) || Date.parse(input.expiresAt) <= Date.parse(operation.now)) {
            throw new errors_1.DomainError("Срок резерва должен быть в будущем", "INVENTORY_RESERVATION_EXPIRATION_INVALID");
        }
        await this.assertEntryAvailable(entry, quantity, operation.now);
        const reservation = {
            id: (0, ids_1.createId)("reservation"),
            entryId: entry.instanceId,
            quantity,
            purposeType: input.purposeType,
            purposeRef: input.purposeRef,
            createdBy: operation.actor ?? { kind: "service", id: "inventory" },
            status: "active",
            expiresAt: input.expiresAt,
            idempotencyKey: operation.idempotencyKey ?? operation.requestId,
            version: 1,
            createdAt: operation.now,
            updatedAt: operation.now
        };
        await this.repository.saveReservation(reservation);
        await this.scheduler.schedule({
            taskType: "inventory.reservation.expire",
            payload: { reservationId: reservation.id },
            runAt: reservation.expiresAt,
            idempotencyKey: `inventory.reservation.expire:${reservation.id}`
        }, operation);
        entry.reservedQuantity = (entry.reservedQuantity ?? 0) + quantity;
        entry.updatedAt = operation.now;
        entry.version = (entry.version ?? 1) + 1;
        await this.repository.save(entry);
        this.publish({ type: "inventory.reserved", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner: input.owner, reservation } }, operation);
        return this.completeOperation("reserve", input, operation, reservation);
    }
    async releaseReservation(reservationId, reason, operation) {
        const payload = { reservationId, reason };
        const replay = await this.findReplay("release_reservation", payload, operation);
        if (replay)
            return replay;
        const reservation = await this.repository.findReservation(reservationId);
        if (!reservation)
            throw new errors_1.DomainError("Резерв не найден", "INVENTORY_RESERVATION_NOT_FOUND");
        const ownership = await this.ownership.findOwnership(reservation.entryId);
        const actor = operation.actor;
        if (actor && actor.kind !== "service" && actor.kind !== "admin" &&
            !(actor.kind === reservation.createdBy.kind && String(actor.id) === String(reservation.createdBy.id))) {
            if (!ownership)
                throw new errors_1.DomainError("Нет прав на резерв", "OWNERSHIP_PERMISSION_DENIED");
            await this.ownership.assertPermission(reservation.entryId, actor, "manage", operation.now, ownership.legalOwner);
        }
        if (reservation.status === "committed")
            throw new errors_1.DomainError("Резерв уже использован", "INVENTORY_RESERVATION_COMMITTED");
        if (reservation.status === "active") {
            reservation.status = "released";
            reservation.updatedAt = operation.now;
            reservation.version += 1;
            await this.repository.saveReservation(reservation);
            const entry = await this.repository.findByInstanceId(reservation.entryId);
            if (entry) {
                entry.reservedQuantity = Math.max(0, (entry.reservedQuantity ?? 0) - reservation.quantity);
                entry.updatedAt = operation.now;
                entry.version = (entry.version ?? 1) + 1;
                await this.repository.save(entry);
            }
            this.publish({ type: "inventory.reservation.released", aggregateId: reservation.entryId, aggregateVersion: entry?.version ?? reservation.version, payload: { reservationId, reason } }, operation);
        }
        return this.completeOperation("release_reservation", payload, operation, reservation);
    }
    async expireReservation(reservationId, operation) {
        const reservation = await this.repository.findReservation(reservationId);
        if (reservation?.status !== "active" || reservation.expiresAt > operation.now)
            return reservation;
        reservation.status = "expired";
        reservation.updatedAt = operation.now;
        reservation.version += 1;
        await this.repository.saveReservation(reservation);
        const entry = await this.repository.findByInstanceId(reservation.entryId);
        if (entry) {
            entry.reservedQuantity = Math.max(0, (entry.reservedQuantity ?? 0) - reservation.quantity);
            entry.updatedAt = operation.now;
            entry.version = (entry.version ?? 1) + 1;
            await this.repository.save(entry);
        }
        this.publish({
            type: "inventory.reservation.released",
            aggregateId: reservation.entryId,
            aggregateVersion: entry?.version ?? reservation.version,
            payload: { reservationId, reason: "scheduler_expired", status: "expired" }
        }, operation);
        return reservation;
    }
    async executeExchange(legs, operation) {
        const replay = await this.findReplay("exchange", legs, operation);
        if (replay)
            return replay;
        if (legs.length < 2 || legs.length > 100)
            throw new errors_1.DomainError("Обмен должен содержать от 2 до 100 активов", "INVENTORY_EXCHANGE_INVALID");
        for (const leg of legs) {
            const entry = await this.getEntry(leg.fromOwner, leg.inventoryEntryId);
            await this.ownership.assertPermission(entry.instanceId, operation.actor, "transfer", operation.now, leg.fromOwner);
            if (leg.reservationId)
                await this.assertReservation(leg.reservationId, entry.instanceId, leg.quantity, operation.now);
            await this.assertEntryAvailable(entry, leg.quantity, operation.now, leg.reservationId);
        }
        const results = [];
        for (const [index, leg] of legs.entries())
            results.push(await this.transfer({
                fromOwner: leg.fromOwner,
                toOwner: leg.toOwner,
                inventoryEntryId: leg.inventoryEntryId,
                quantity: leg.quantity,
                destination: leg.destination,
                reason: `exchange:${operation.requestId}`,
                transferType: "exchange",
                reservationId: leg.reservationId
            }, childOperation(operation, `leg:${index}`)));
        this.publish({
            type: "inventory.exchange.completed",
            aggregateId: operation.requestId,
            payload: { legs: legs.map((leg) => ({ ...leg })) }
        }, operation);
        return this.completeOperation("exchange", legs, operation, results);
    }
    async consume(input, operation) {
        return this.remove({ ...input, disposition: "consume" }, operation);
    }
    async equip(owner, inventoryEntryId, slotCode, operation) {
        const input = { owner, inventoryEntryId, slotCode };
        if (await this.findReplay("equip", input, operation))
            return;
        const entry = await this.getEntry(owner, inventoryEntryId);
        const product = this.catalog.getProduct(entry.itemId);
        if (!product.capabilities.includes("equippable"))
            throw new errors_1.DomainError("Объект нельзя экипировать", "INVENTORY_CAPABILITY_REQUIRED");
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "equip", operation.now, owner);
        await this.assertEntryAvailable(entry, 1, operation.now);
        if ((await this.repository.listEquipment()).some((record) => (0, ownership_service_1.sameOwner)(record.owner, owner) && record.slotCode === slotCode)) {
            throw new errors_1.DomainError("Слот уже занят", "INVENTORY_SLOT_OCCUPIED");
        }
        const record = {
            id: (0, ids_1.createId)("equipment"), owner, slotCode, entryId: entry.instanceId, quantity: 1,
            equippedAt: operation.now, version: 1
        };
        await this.repository.saveEquipment(record);
        entry.location = { kind: "equipped", id: slotCode };
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.equipped", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, entryId: entry.instanceId, slotCode } }, operation);
        await this.completeOperation("equip", input, operation, true);
    }
    async unequip(owner, slotCode, operation) {
        const input = { owner, slotCode };
        if (await this.findReplay("unequip", input, operation))
            return;
        const record = (await this.repository.listEquipment()).find((candidate) => (0, ownership_service_1.sameOwner)(candidate.owner, owner) && candidate.slotCode === slotCode);
        if (!record)
            throw new errors_1.DomainError("Экипированный объект не найден", "INVENTORY_EQUIPMENT_NOT_FOUND");
        const entry = await this.getEntry(owner, record.entryId);
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "equip", operation.now, owner);
        await this.repository.deleteEquipment(record.id);
        entry.location = { kind: "inventory" };
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.unequipped", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, entryId: entry.instanceId, slotCode } }, operation);
        await this.completeOperation("unequip", input, operation, true);
    }
    async move(owner, inventoryEntryId, destination, operation) {
        const input = { owner, inventoryEntryId, destination };
        const replay = await this.findReplay("move", input, operation);
        if (replay)
            return replay;
        if (!destination.kind.trim())
            throw new errors_1.DomainError("Некорректное местоположение", "INVENTORY_LOCATION_INVALID");
        const entry = await this.getEntry(owner, inventoryEntryId);
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "move", operation.now, owner);
        const previousLocation = entry.location;
        entry.location = destination;
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.moved", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, previousLocation, destination } }, operation);
        return this.completeOperation("move", input, operation, entry);
    }
    async createLease(lessor, lessee, inventoryEntryId, quantity, startsAt, endsAt, termsRef, operation) {
        const input = { lessor, lessee, inventoryEntryId, quantity, startsAt, endsAt, termsRef };
        const replay = await this.findReplay("lease", input, operation);
        if (replay)
            return replay;
        if (!isValidTimestamp(startsAt) ||
            !isValidTimestamp(endsAt) ||
            Date.parse(startsAt) > Date.parse(endsAt) ||
            Date.parse(endsAt) <= Date.parse(operation.now)) {
            throw new errors_1.DomainError("Некорректный срок аренды", "INVENTORY_LEASE_PERIOD_INVALID");
        }
        if ((0, ownership_service_1.sameOwner)(lessor, lessee))
            throw new errors_1.DomainError("Арендодатель и арендатор должны отличаться", "OWNERSHIP_SAME_OWNER");
        if (!termsRef.trim())
            throw new errors_1.DomainError("Условия аренды обязательны", "INVENTORY_LEASE_TERMS_INVALID");
        let entry = await this.getEntry(lessor, inventoryEntryId);
        const product = this.catalog.getProduct(entry.itemId);
        if (!product.capabilities.includes("leaseable") && !product.capabilities.includes("tradable")) {
            throw new errors_1.DomainError("Объект нельзя сдавать в аренду", "INVENTORY_CAPABILITY_REQUIRED");
        }
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "lease", operation.now, lessor);
        quantity = normalizeQuantity(quantity, entry.quantity);
        await this.assertEntryAvailable(entry, quantity, operation.now);
        await this.ownership.registerOwner(lessee, operation.now);
        if (quantity < entry.quantity) {
            entry = (await this.splitStack(lessor, entry.instanceId, quantity, childOperation(operation, "lease-split"))).child;
        }
        const lease = {
            id: (0, ids_1.createId)("lease"), lessor, lessee, entryId: entry.instanceId, quantity,
            startsAt, endsAt, status: "active", termsRef,
            createdBy: operation.actor ?? { kind: "service", id: "inventory" },
            version: 1, createdAt: operation.now, updatedAt: operation.now
        };
        await this.repository.saveLease(lease);
        await this.scheduler.schedule({
            taskType: "inventory.lease.expire",
            payload: { leaseId: lease.id },
            runAt: lease.endsAt,
            idempotencyKey: `inventory.lease.expire:${lease.id}`
        }, operation);
        await this.ownership.setCustody(entry.instanceId, lessee, operation);
        entry.location = { kind: "leased", id: lease.id };
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.leased", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { lease } }, operation);
        return this.completeOperation("lease", input, operation, lease);
    }
    async returnLease(leaseId, operation) {
        const input = { leaseId };
        const replay = await this.findReplay("return_lease", input, operation);
        if (replay)
            return replay;
        const lease = await this.repository.findLease(leaseId);
        if (!lease)
            throw new errors_1.DomainError("Аренда не найдена", "INVENTORY_LEASE_NOT_FOUND");
        if (lease.status !== "active")
            throw new errors_1.DomainError("Аренда уже завершена", "INVENTORY_LEASE_NOT_ACTIVE");
        const entry = await this.repository.findByInstanceId(lease.entryId);
        if (!entry)
            throw new errors_1.DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
        lease.status = "returned";
        lease.returnedAt = operation.now;
        lease.updatedAt = operation.now;
        lease.version += 1;
        await this.repository.saveLease(lease);
        await this.ownership.clearCustody(entry.instanceId, operation);
        entry.location = { kind: "inventory" };
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.returned", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { leaseId, lessor: lease.lessor, lessee: lease.lessee } }, operation);
        return this.completeOperation("return_lease", input, operation, lease);
    }
    async expireLease(leaseId, operation) {
        const lease = await this.repository.findLease(leaseId);
        if (lease?.status !== "active" || lease.endsAt > operation.now)
            return lease;
        const entry = await this.repository.findByInstanceId(lease.entryId);
        if (!entry)
            throw new errors_1.DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
        lease.status = "expired";
        lease.returnedAt = operation.now;
        lease.updatedAt = operation.now;
        lease.version += 1;
        await this.repository.saveLease(lease);
        await this.ownership.clearCustody(entry.instanceId, operation);
        entry.location = { kind: "inventory" };
        await this.touchEntry(entry, operation.now);
        this.publish({
            type: "inventory.returned",
            aggregateId: entry.instanceId,
            aggregateVersion: entry.version ?? 1,
            payload: { leaseId, lessor: lease.lessor, lessee: lease.lessee, status: "expired" }
        }, operation);
        return lease;
    }
    async destroy(owner, inventoryEntryId, reason, operation) {
        const input = { owner, inventoryEntryId, reason };
        const replay = await this.findReplay("destroy", input, operation);
        if (replay)
            return replay;
        const entry = await this.getEntry(owner, inventoryEntryId);
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "manage", operation.now, owner);
        await this.assertNoHolds(entry.instanceId);
        entry.lifecycleStatus = "destroyed";
        await this.touchEntry(entry, operation.now);
        await this.syncCompatibilityProjection(owner, operation.now);
        this.publish({ type: "inventory.destroyed", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, productId: entry.itemId, reason } }, operation);
        return this.completeOperation("destroy", input, operation, entry);
    }
    async restore(owner, inventoryEntryId, reason, operation) {
        const input = { owner, inventoryEntryId, reason };
        const replay = await this.findReplay("restore", input, operation);
        if (replay)
            return replay;
        await this.ensureOwnerMigrated(owner, operation.now);
        const entry = await this.repository.findByInstanceId(inventoryEntryId);
        if (!entry || !await this.ownership.isOwner(inventoryEntryId, owner)) {
            throw new errors_1.DomainError("Уничтоженный объект не найден", "INVENTORY_ENTRY_NOT_FOUND");
        }
        if (entry.lifecycleStatus !== "destroyed")
            throw new errors_1.DomainError("Объект не уничтожен", "INVENTORY_ENTRY_NOT_DESTROYED");
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "manage", operation.now, owner);
        entry.lifecycleStatus = "active";
        await this.touchEntry(entry, operation.now);
        await this.syncCompatibilityProjection(owner, operation.now);
        this.publish({ type: "inventory.recovered", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, productId: entry.itemId, reason, recoveryType: "restore" } }, operation);
        return this.completeOperation("restore", input, operation, entry);
    }
    async confiscate(owner, inventoryEntryId, custodyOwner, reason, operation) {
        const input = { owner, inventoryEntryId, custodyOwner, reason };
        const replay = await this.findReplay("confiscate", input, operation);
        if (replay)
            return replay;
        if (!reason.trim())
            throw new errors_1.DomainError("Причина конфискации обязательна", "INVENTORY_CONFISCATION_REASON_REQUIRED");
        const entry = await this.getEntry(owner, inventoryEntryId);
        await this.assertNoHolds(entry.instanceId);
        await this.ownership.confiscate(entry.instanceId, custodyOwner, operation);
        entry.location = { kind: "custody", id: `${custodyOwner.kind}:${custodyOwner.id}` };
        entry.state = { ...(entry.state ?? {}), confiscationReason: reason };
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.confiscated", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, custodyOwner, productId: entry.itemId, reason } }, operation);
        return this.completeOperation("confiscate", input, operation, entry);
    }
    async recoverConfiscated(inventoryEntryId, reason, operation) {
        const input = { inventoryEntryId, reason };
        const replay = await this.findReplay("recover_confiscated", input, operation);
        if (replay)
            return replay;
        const entry = await this.repository.findByInstanceId(inventoryEntryId);
        if (!entry)
            throw new errors_1.DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
        const ownership = await this.ownership.recover(entry.instanceId, operation);
        entry.location = { kind: "inventory" };
        const { confiscationReason: _ignored, ...remainingState } = entry.state ?? {};
        entry.state = remainingState;
        await this.touchEntry(entry, operation.now);
        await this.syncCompatibilityProjection(ownership.legalOwner, operation.now);
        this.publish({ type: "inventory.recovered", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner: ownership.legalOwner, productId: entry.itemId, reason, recoveryType: "confiscation" } }, operation);
        return this.completeOperation("recover_confiscated", input, operation, entry);
    }
    async splitStack(owner, inventoryEntryId, quantity, operation) {
        const input = { owner, inventoryEntryId, quantity };
        const replay = await this.findReplay("split_stack", input, operation);
        if (replay)
            return replay;
        const source = await this.getEntry(owner, inventoryEntryId);
        const product = this.catalog.getProduct(source.itemId);
        const mode = product.inventoryMode ?? this.catalog.getAssetTypeForProduct(product.id).defaultInventoryMode;
        if (mode !== "stack")
            throw new errors_1.DomainError("Разделять можно только stack", "INVENTORY_NOT_STACK");
        const normalized = normalizeQuantity(quantity, source.quantity - 1);
        await this.ownership.assertPermission(source.instanceId, operation.actor, "manage", operation.now, owner);
        await this.assertEntryAvailable(source, normalized, operation.now);
        source.quantity -= normalized;
        await this.touchEntry(source, operation.now);
        const child = cloneEntryForTransfer(source, normalized, source.location, operation.now);
        await this.repository.add(child);
        await this.ownership.assign(child.instanceId, owner, operation);
        await this.syncCompatibilityProjection(owner, operation.now);
        this.publish({ type: "inventory.split", aggregateId: source.instanceId, aggregateVersion: source.version ?? 1, payload: { owner, sourceEntryId: source.instanceId, childEntryId: child.instanceId, quantity: normalized } }, operation);
        return this.completeOperation("split_stack", input, operation, { source, child });
    }
    async mergeStacks(owner, targetEntryId, sourceEntryIds, operation) {
        const input = { owner, targetEntryId, sourceEntryIds };
        const replay = await this.findReplay("merge_stacks", input, operation);
        if (replay)
            return replay;
        if (sourceEntryIds.length === 0 || sourceEntryIds.length > 99 || sourceEntryIds.includes(targetEntryId)) {
            throw new errors_1.DomainError("Некорректный набор stack", "INVENTORY_STACK_INCOMPATIBLE");
        }
        const target = await this.getEntry(owner, targetEntryId);
        const product = this.catalog.getProduct(target.itemId);
        const mode = product.inventoryMode ?? this.catalog.getAssetTypeForProduct(product.id).defaultInventoryMode;
        if (mode !== "stack")
            throw new errors_1.DomainError("Объединять можно только stack", "INVENTORY_NOT_STACK");
        await this.ownership.assertPermission(target.instanceId, operation.actor, "manage", operation.now, owner);
        const sources = [];
        for (const entryId of sourceEntryIds)
            sources.push(await this.getEntry(owner, entryId));
        for (const source of sources) {
            if (!stackCompatible(target, source, target.location))
                throw new errors_1.DomainError("Stack имеют разные состояния", "INVENTORY_STACK_INCOMPATIBLE");
            await this.assertEntryAvailable(source, source.quantity, operation.now);
        }
        for (const source of sources) {
            target.quantity += source.quantity;
            source.lifecycleStatus = "archived";
            await this.touchEntry(source, operation.now);
            await this.ownership.archive(source.instanceId, operation);
        }
        await this.touchEntry(target, operation.now);
        await this.syncCompatibilityProjection(owner, operation.now);
        this.publish({ type: "inventory.merged", aggregateId: target.instanceId, aggregateVersion: target.version ?? 1, payload: { owner, targetEntryId, sourceEntryIds, quantity: target.quantity } }, operation);
        return this.completeOperation("merge_stacks", input, operation, target);
    }
    async repair(owner, inventoryEntryId, conditionAfter, wearAfter, cost, operation, currentValue) {
        const input = { owner, inventoryEntryId, conditionAfter, wearAfter, cost, currentValue };
        const replay = await this.findReplay("repair", input, operation);
        if (replay)
            return replay;
        const entry = await this.getEntry(owner, inventoryEntryId);
        const product = this.catalog.getProduct(entry.itemId);
        if (!product.capabilities.includes("repairable"))
            throw new errors_1.DomainError("Объект нельзя ремонтировать", "INVENTORY_CAPABILITY_REQUIRED");
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "repair", operation.now, owner);
        if (!Number.isInteger(wearAfter) || wearAfter < 0 || wearAfter > 100 || !Number.isSafeInteger(cost) || cost < 0) {
            throw new errors_1.DomainError("Некорректный результат ремонта", "INVENTORY_REPAIR_RESULT_INVALID");
        }
        const before = { condition: entry.condition ?? "new", wear: entry.wearLevel ?? 0 };
        entry.condition = conditionAfter;
        entry.wearLevel = wearAfter;
        if (currentValue !== undefined)
            entry.currentValue = currentValue;
        entry.repairHistory ??= [];
        entry.repairHistory.push({
            repairedAt: operation.now,
            cost,
            conditionBefore: before.condition,
            wearBefore: before.wear,
            conditionAfter,
            wearAfter
        });
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.repaired", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, productId: entry.itemId, before, after: { condition: conditionAfter, wear: wearAfter }, cost } }, operation);
        return this.completeOperation("repair", input, operation, entry);
    }
    async maintain(owner, inventoryEntryId, conditionAfter, wearAfter, cost, currentValue, operation) {
        const input = { owner, inventoryEntryId, conditionAfter, wearAfter, cost, currentValue };
        const replay = await this.findReplay("maintain", input, operation);
        if (replay)
            return replay;
        const entry = await this.getEntry(owner, inventoryEntryId);
        const product = this.catalog.getProduct(entry.itemId);
        if (!product.capabilities.includes("maintainable"))
            throw new errors_1.DomainError("Объект не требует обслуживания", "INVENTORY_CAPABILITY_REQUIRED");
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "repair", operation.now, owner);
        if (!Number.isInteger(wearAfter) || wearAfter < 0 || wearAfter > 100 || !Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(currentValue) || currentValue < 0) {
            throw new errors_1.DomainError("Некорректный результат обслуживания", "INVENTORY_MAINTENANCE_RESULT_INVALID");
        }
        const before = { condition: entry.condition ?? "new", wear: entry.wearLevel ?? 0, currentValue: entry.currentValue ?? 0 };
        entry.condition = conditionAfter;
        entry.wearLevel = wearAfter;
        entry.currentValue = currentValue;
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.maintained", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, productId: entry.itemId, before, after: { condition: conditionAfter, wear: wearAfter, currentValue }, cost } }, operation);
        return this.completeOperation("maintain", input, operation, entry);
    }
    async upgrade(owner, inventoryEntryId, upgradeId, statePatch, cost, operation) {
        const input = { owner, inventoryEntryId, upgradeId, statePatch, cost };
        const replay = await this.findReplay("upgrade", input, operation);
        if (replay)
            return replay;
        const entry = await this.getEntry(owner, inventoryEntryId);
        const product = this.catalog.getProduct(entry.itemId);
        if (!product.capabilities.includes("upgradeable"))
            throw new errors_1.DomainError("Объект нельзя улучшать", "INVENTORY_CAPABILITY_REQUIRED");
        await this.ownership.assertPermission(entry.instanceId, operation.actor, "manage", operation.now, owner);
        if (!upgradeId.trim() || !Number.isSafeInteger(cost) || cost < 0)
            throw new errors_1.DomainError("Некорректное улучшение", "INVENTORY_UPGRADE_INVALID");
        const before = { ...(entry.state ?? {}) };
        entry.state = { ...before, ...statePatch };
        entry.upgradeHistory ??= [];
        entry.upgradeHistory.push({ upgradedAt: operation.now, upgradeId, cost, note: `state:${Object.keys(statePatch).sort().join(",")}` });
        await this.touchEntry(entry, operation.now);
        this.publish({ type: "inventory.upgraded", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner, productId: entry.itemId, upgradeId, before, after: entry.state, cost } }, operation);
        return this.completeOperation("upgrade", input, operation, entry);
    }
    async expire(inventoryEntryId, operation) {
        const input = { inventoryEntryId };
        const replay = await this.findReplay("expire", input, operation);
        if (replay)
            return replay;
        if (operation.actor?.kind !== "scheduler" && operation.actor?.kind !== "service") {
            throw new errors_1.DomainError("Истечение объекта запускается системным сервисом", "OWNERSHIP_PERMISSION_DENIED");
        }
        const entry = await this.repository.findByInstanceId(inventoryEntryId);
        if (!entry)
            throw new errors_1.DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
        const product = this.catalog.getProduct(entry.itemId);
        if (!product.capabilities.includes("expirable"))
            throw new errors_1.DomainError("Объект не имеет срока действия", "INVENTORY_NOT_EXPIRABLE");
        const ownership = await this.ownership.getOwnership(entry.instanceId);
        entry.lifecycleStatus = "expired";
        await this.touchEntry(entry, operation.now);
        await this.syncCompatibilityProjection(ownership.legalOwner, operation.now);
        this.publish({ type: "inventory.expired", aggregateId: entry.instanceId, aggregateVersion: entry.version ?? 1, payload: { owner: ownership.legalOwner, productId: entry.itemId } }, operation);
        return this.completeOperation("expire", input, operation, entry);
    }
    ensureEntryState(entry) {
        (0, inventory_entry_state_1.ensureInventoryEntryState)(entry, this.catalog, this.schemas);
    }
    async refreshOwnershipIndexes(owner, now) {
        if (owner.kind !== "player")
            return;
        const entries = await this.entriesForOwner(owner);
        await this.legacyInventory.updateAssetIndexes(owner, {
            transportIds: uniqueProducts(entries, (id) => this.catalog.getAssetTypeForProduct(id).id === "transport"),
            homeIds: uniqueProducts(entries, (id) => this.catalog.getAssetTypeForProduct(id).id === "real_estate"),
            businessIds: uniqueProducts(entries, (id) => this.catalog.getAssetTypeForProduct(id).id === "business"),
            petIds: uniqueProducts(entries, (id) => this.catalog.getAssetTypeForProduct(id).id === "pet")
        }, now);
    }
    async entriesForOwner(owner) {
        return (await this.repository.listByIds(await this.ownership.listOwnedEntryIds(owner)))
            .filter((entry) => (entry.lifecycleStatus ?? "active") === "active");
    }
    async ensureOwnerMigrated(owner, now) {
        await this.ownership.registerOwner(owner, now);
        for (const candidate of await this.legacyInventory.load(owner)) {
            this.ensureEntryState(candidate);
            const central = await this.repository.findByInstanceId(candidate.instanceId);
            if (!central)
                await this.repository.add(candidate);
            await this.ownership.reconcileAssignment(candidate.instanceId, owner, candidate.acquiredAt || now);
        }
        await this.syncCompatibilityProjection(owner, now);
    }
    async syncCompatibilityProjection(owner, now) {
        await this.legacyInventory.save(owner, await this.entriesForOwner(owner), now);
    }
    async assertEntryAvailable(entry, requestedQuantity, now = new Date().toISOString(), allowedReservationId) {
        this.ensureEntryState(entry);
        if (entry.lifecycleStatus !== "active")
            throw new errors_1.DomainError("Объект недоступен", "INVENTORY_ENTRY_NOT_AVAILABLE");
        const equipped = (await this.repository.listEquipment(entry.instanceId)).length > 0;
        if (equipped)
            throw new errors_1.DomainError("Сначала снимите объект", "INVENTORY_ENTRY_EQUIPPED");
        const ownership = await this.ownership.getOwnership(entry.instanceId);
        if (ownership.status === "confiscated")
            throw new errors_1.DomainError("Объект конфискован", "INVENTORY_ENTRY_CONFISCATED");
        const reserved = (await this.repository.listReservations(entry.instanceId))
            .filter((reservation) => reservation.entryId === entry.instanceId && reservation.status === "active" &&
            reservation.id !== allowedReservationId && Date.parse(reservation.expiresAt) > Date.parse(now))
            .reduce((sum, reservation) => sum + reservation.quantity, 0);
        const leased = (await this.repository.listLeases(entry.instanceId))
            .filter((lease) => lease.entryId === entry.instanceId && lease.status === "active")
            .reduce((sum, lease) => sum + lease.quantity, 0);
        if (entry.quantity - reserved - leased < requestedQuantity) {
            throw new errors_1.DomainError("Недостаточно доступного количества", "INVENTORY_QUANTITY_RESERVED");
        }
    }
    async assertReservation(reservationId, entryId, quantity, now) {
        const reservation = await this.repository.findReservation(reservationId);
        if (!reservation || reservation.entryId !== entryId) {
            throw new errors_1.DomainError("Резерв не относится к объекту", "INVENTORY_RESERVATION_NOT_FOUND");
        }
        if (reservation.status !== "active" || Date.parse(reservation.expiresAt) <= Date.parse(now)) {
            throw new errors_1.DomainError("Резерв истёк или уже использован", "INVENTORY_RESERVATION_EXPIRED");
        }
        if (reservation.quantity < quantity) {
            throw new errors_1.DomainError("Резерв не покрывает количество", "INVENTORY_RESERVATION_QUANTITY_INVALID");
        }
    }
    async commitReservation(reservationId, now) {
        const reservation = await this.repository.findReservation(reservationId);
        if (reservation?.status !== "active")
            return;
        reservation.status = "committed";
        reservation.updatedAt = now;
        reservation.version += 1;
        await this.repository.saveReservation(reservation);
        const entry = await this.repository.findByInstanceId(reservation.entryId);
        if (entry) {
            entry.reservedQuantity = Math.max(0, (entry.reservedQuantity ?? 0) - reservation.quantity);
            entry.updatedAt = now;
            entry.version = (entry.version ?? 1) + 1;
            await this.repository.save(entry);
        }
    }
    async assertNoHolds(entryId) {
        if ((await this.repository.listReservations(entryId)).some((reservation) => reservation.status === "active")) {
            throw new errors_1.DomainError("Объект зарезервирован", "INVENTORY_ENTRY_RESERVED");
        }
        if ((await this.repository.listLeases(entryId)).some((lease) => lease.status === "active")) {
            throw new errors_1.DomainError("Объект находится в аренде", "INVENTORY_ENTRY_LEASED");
        }
        if ((await this.repository.listEquipment(entryId)).length > 0) {
            throw new errors_1.DomainError("Объект экипирован", "INVENTORY_ENTRY_EQUIPPED");
        }
    }
    async decreaseOrArchiveSource(source, owner, quantity, operation) {
        if (quantity === source.quantity) {
            source.lifecycleStatus = "archived";
            await this.touchEntry(source, operation.now);
            await this.ownership.archive(source.instanceId, operation);
            return;
        }
        source.quantity -= quantity;
        await this.touchEntry(source, operation.now);
        await this.refreshOwnershipIndexes(owner, operation.now);
    }
    async touchEntry(entry, now) {
        entry.updatedAt = now;
        entry.version = (entry.version ?? 1) + 1;
        entry.state = this.schemas.validate("metadata", "inventory-entry.state", 1, entry.state ?? {});
        entry.metadata = this.schemas.validate("metadata", "inventory-entry.metadata", 1, entry.metadata ?? {});
        await this.repository.save(entry);
    }
    async findReplay(type, payload, operation) {
        const key = operation.idempotencyKey ?? operation.requestId;
        const existing = await this.repository.findOperationByIdempotencyKey(key);
        if (!existing)
            return undefined;
        const payloadHash = stableStringify(payload);
        if (!existing || existing.type !== type || existing.payloadHash !== payloadHash) {
            throw new errors_1.DomainError("Ключ идемпотентности уже использован другой операцией", "INVENTORY_IDEMPOTENCY_CONFLICT");
        }
        return cloneValue(existing.result);
    }
    async completeOperation(type, payload, operation, result) {
        const key = operation.idempotencyKey ?? operation.requestId;
        const existing = await this.repository.findOperationByIdempotencyKey(key);
        if (existing) {
            if (existing?.type === type && existing.payloadHash === stableStringify(payload))
                return cloneValue(existing.result);
            throw new errors_1.DomainError("Ключ идемпотентности уже использован другой операцией", "INVENTORY_IDEMPOTENCY_CONFLICT");
        }
        const record = {
            id: (0, ids_1.createId)("inventory_operation"),
            type,
            requestId: operation.requestId,
            idempotencyKey: key,
            correlationId: operation.correlationId,
            actor: operation.actor,
            payloadHash: stableStringify(payload),
            result: cloneValue(result),
            createdAt: operation.now
        };
        await this.repository.saveOperation(key, record);
        return result;
    }
    publish(input, operation) {
        this.events.collect({
            eventType: input.type,
            aggregateType: "inventory",
            aggregateId: input.aggregateId,
            aggregateVersion: input.aggregateVersion ?? 1,
            payload: input.payload
        }, operation);
    }
    createEntry(product, quantity, input, now) {
        const entry = {
            instanceId: (0, ids_1.createId)("asset"),
            itemId: product.id,
            quantity,
            acquiredAt: now,
            acquiredBy: input.acquiredBy,
            sourceId: input.sourceId,
            currentValue: product.valuation.defaultResaleValue?.amount ?? product.valuation.baseAssetValue.amount,
            purchasePrice: input.purchasePrice,
            reservedQuantity: 0,
            origin: { type: input.acquiredBy, referenceId: input.sourceId },
            location: input.location ?? { kind: "inventory" },
            lifecycleStatus: "active",
            state: { ...(input.initialState ?? {}) },
            metadata: { ...(input.metadata ?? {}) },
            rootInstanceId: "",
            version: 1,
            updatedAt: now
        };
        entry.rootInstanceId = entry.instanceId;
        this.ensureEntryState(entry);
        return entry;
    }
    publishGranted(input, inventoryEntryIds, quantity, operation) {
        this.publish({
            type: "inventory.granted",
            aggregateId: inventoryEntryIds[0] ?? input.productId,
            payload: {
                owner: input.owner,
                productId: input.productId,
                inventoryEntryIds,
                quantity,
                acquiredBy: input.acquiredBy
            }
        }, operation);
    }
}
exports.InventoryService = InventoryService;
function uniqueProducts(entries, predicate) {
    return [...new Set(entries.filter((entry) => predicate(entry.itemId)).map((entry) => entry.itemId))];
}
function normalizeQuantity(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new errors_1.DomainError(`Количество должно быть от 1 до ${maximum}`, "INVENTORY_QUANTITY_INVALID");
    return value;
}
function childOperation(operation, suffix) {
    const idempotencyKey = operation.idempotencyKey ?? operation.requestId;
    return {
        ...operation,
        requestId: `${operation.requestId}:${suffix}`,
        idempotencyKey: `${idempotencyKey}:${suffix}`,
        causationId: operation.requestId
    };
}
function cloneEntryForTransfer(source, quantity, location, now) {
    const entry = cloneValue(source);
    entry.instanceId = (0, ids_1.createId)("asset");
    entry.quantity = quantity;
    entry.reservedQuantity = 0;
    entry.location = location ?? { kind: "inventory" };
    entry.parentInstanceId = source.instanceId;
    entry.rootInstanceId = source.rootInstanceId ?? source.instanceId;
    entry.lifecycleStatus = "active";
    entry.acquiredAt = now;
    entry.updatedAt = now;
    entry.version = 1;
    return entry;
}
function stackCompatible(target, source, destination) {
    return target.itemId === source.itemId &&
        stableStringify(target.location ?? { kind: "inventory" }) === stableStringify(destination ?? source.location ?? { kind: "inventory" }) &&
        target.purchasePrice === source.purchasePrice &&
        target.condition === source.condition &&
        target.wearLevel === source.wearLevel &&
        stableStringify(target.durability) === stableStringify(source.durability) &&
        stableStringify(target.state ?? {}) === stableStringify(source.state ?? {}) &&
        stableStringify(target.metadata ?? {}) === stableStringify(source.metadata ?? {});
}
function isValidTimestamp(value) {
    return Number.isFinite(Date.parse(value));
}
function stableStringify(value) {
    return JSON.stringify(sortValue(value)) ?? "undefined";
}
function sortValue(value) {
    if (Array.isArray(value))
        return value.map(sortValue);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, candidate]) => candidate !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, candidate]) => [key, sortValue(candidate)]));
}
function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}
