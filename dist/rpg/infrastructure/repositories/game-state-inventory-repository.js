"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateInventoryRepository = void 0;
const errors_1 = require("../../domain/errors");
const detached_copy_1 = require("./detached-copy");
class GameStateInventoryRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async list() {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.inventory.entries));
    }
    async listByIds(instanceIds) {
        return instanceIds.flatMap((id) => {
            const entry = this.state.inventory.entries[id];
            return entry ? [(0, detached_copy_1.detached)(entry)] : [];
        });
    }
    async findByInstanceId(instanceId) {
        return (0, detached_copy_1.detached)(this.state.inventory.entries[instanceId]);
    }
    async findByProductId(productId) {
        return (await this.list()).filter((entry) => entry.itemId === productId);
    }
    async add(entry) {
        if (this.state.inventory.entries[entry.instanceId]) {
            throw new errors_1.DomainError("Объект инвентаря уже существует", "INVENTORY_ENTRY_EXISTS");
        }
        this.state.inventory.entries[entry.instanceId] = (0, detached_copy_1.detached)(entry);
    }
    async save(entry) {
        if (!this.state.inventory.entries[entry.instanceId]) {
            throw new errors_1.DomainError("Объект инвентаря не найден", "INVENTORY_ENTRY_NOT_FOUND");
        }
        this.state.inventory.entries[entry.instanceId] = (0, detached_copy_1.detached)(entry);
    }
    async listReservations(entryId) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.inventory.reservations).filter((record) => !entryId || record.entryId === entryId));
    }
    async findReservation(reservationId) {
        return (0, detached_copy_1.detached)(this.state.inventory.reservations[reservationId]);
    }
    async saveReservation(reservation) {
        this.state.inventory.reservations[reservation.id] = (0, detached_copy_1.detached)(reservation);
    }
    async listEquipment(entryId) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.inventory.equipment).filter((record) => !entryId || record.entryId === entryId));
    }
    async saveEquipment(record) {
        this.state.inventory.equipment[record.id] = (0, detached_copy_1.detached)(record);
    }
    async deleteEquipment(recordId) {
        delete this.state.inventory.equipment[recordId];
    }
    async listLeases(entryId) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.inventory.leases).filter((record) => !entryId || record.entryId === entryId));
    }
    async findLease(leaseId) {
        return (0, detached_copy_1.detached)(this.state.inventory.leases[leaseId]);
    }
    async saveLease(lease) {
        this.state.inventory.leases[lease.id] = (0, detached_copy_1.detached)(lease);
    }
    async findOperationByIdempotencyKey(key) {
        const operationId = this.state.inventory.idempotencyKeys[key];
        return operationId ? (0, detached_copy_1.detached)(this.state.inventory.operations[operationId]) : undefined;
    }
    async saveOperation(key, operation) {
        this.state.inventory.operations[operation.id] = (0, detached_copy_1.detached)(operation);
        this.state.inventory.idempotencyKeys[key] = operation.id;
    }
    async findActionSession(sessionId) {
        return (0, detached_copy_1.detached)(this.state.inventory.actionSessions[sessionId]);
    }
    async saveActionSession(session) {
        this.state.inventory.actionSessions[session.id] = (0, detached_copy_1.detached)(session);
    }
}
exports.GameStateInventoryRepository = GameStateInventoryRepository;
