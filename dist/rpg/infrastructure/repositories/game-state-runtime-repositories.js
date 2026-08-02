"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateRetentionRepository = exports.GameStateSchedulerRepository = exports.GameStateEventRepository = void 0;
const assets_1 = require("../../domain/assets");
const detached_copy_1 = require("./detached-copy");
class GameStateEventRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async append(event) {
        const storedEvent = (0, detached_copy_1.detached)(event);
        this.state.runtime.history.push(storedEvent);
        this.state.runtime.outbox[event.eventId] = {
            event: storedEvent,
            status: "pending",
            attempts: 0,
            nextAttemptAt: event.occurredAt,
            createdAt: event.occurredAt
        };
    }
    async findOutbox(eventId) { return (0, detached_copy_1.detached)(this.state.runtime.outbox[eventId]); }
    async saveOutbox(record) { this.state.runtime.outbox[record.event.eventId] = (0, detached_copy_1.detached)(record); }
    async listPendingOutbox(now, limit) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.runtime.outbox)
            .filter((record) => (record.status === "pending" || record.status === "failed") && record.nextAttemptAt <= now)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .slice(0, limit));
    }
    async listHistory(query) {
        return (0, detached_copy_1.detachedValues)(this.state.runtime.history
            .filter((event) => (!query.eventType || event.eventType === query.eventType) &&
            (!query.aggregateId || event.aggregateId === query.aggregateId) &&
            (!query.owner || eventHasOwner(event, query.owner)) &&
            (!query.occurredBefore || event.occurredAt < query.occurredBefore))
            .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
            .slice(query.offset ?? 0, (query.offset ?? 0) + query.limit));
    }
    async findInbox(messageId, consumer) {
        return (0, detached_copy_1.detached)(this.state.runtime.inbox[`${consumer}:${messageId}`]);
    }
    async saveInbox(record) { this.state.runtime.inbox[`${record.consumer}:${record.messageId}`] = (0, detached_copy_1.detached)(record); }
}
exports.GameStateEventRepository = GameStateEventRepository;
class GameStateSchedulerRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async findById(id) { return (0, detached_copy_1.detached)(this.state.runtime.schedulerTasks[id]); }
    async findByIdempotencyKey(idempotencyKey) {
        return (0, detached_copy_1.detached)(Object.values(this.state.runtime.schedulerTasks).find((task) => task.idempotencyKey === idempotencyKey));
    }
    async findActiveByType(taskType) {
        return (0, detached_copy_1.detached)(Object.values(this.state.runtime.schedulerTasks).find((task) => task.taskType === taskType && (task.status === "pending" || task.status === "running")));
    }
    async save(task) { this.state.runtime.schedulerTasks[task.id] = (0, detached_copy_1.detached)(task); }
    async listDue(now, limit) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.runtime.schedulerTasks)
            .filter((task) => (task.status === "pending" || task.status === "running") &&
            task.runAt <= now && (!task.lockedUntil || task.lockedUntil <= now))
            .sort((left, right) => left.runAt.localeCompare(right.runAt))
            .slice(0, limit));
    }
    async listByStatus(status, limit) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.runtime.schedulerTasks).filter((task) => task.status === status).slice(0, limit));
    }
}
exports.GameStateSchedulerRepository = GameStateSchedulerRepository;
function eventHasOwner(event, owner) {
    const payload = event.payload;
    return [payload.owner, payload.fromOwner, payload.toOwner].some((candidate) => isOwnerRef(candidate) && (0, assets_1.ownerKey)(candidate) === (0, assets_1.ownerKey)(owner));
}
function isOwnerRef(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const candidate = value;
    return typeof candidate.kind === "string" && (typeof candidate.id === "string" || typeof candidate.id === "number");
}
class GameStateRetentionRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async purge(cutoffs) {
        const result = { history: 0, outbox: 0, inbox: 0, idempotency: 0, schedulerTasks: 0, inventoryOperations: 0, actionSessions: 0, checkoutSessions: 0 };
        const historyBefore = this.state.runtime.history.length;
        this.state.runtime.history = this.state.runtime.history.filter((event) => event.occurredAt >= cutoffs.historyBefore);
        result.history = historyBefore - this.state.runtime.history.length;
        result.outbox = purgeRecord(this.state.runtime.outbox, (record) => (record.status === "published" || record.status === "dead_letter") &&
            (record.publishedAt ?? record.lastAttemptAt ?? record.createdAt) < cutoffs.outboxBefore);
        result.inbox = purgeRecord(this.state.runtime.inbox, (record) => {
            if (record.status === "processed")
                return (record.processedAt ?? record.updatedAt) < cutoffs.inboxBefore;
            if (record.status === "failed")
                return record.updatedAt < cutoffs.inboxBefore;
            return Boolean(record.lockedUntil && record.lockedUntil < cutoffs.inboxBefore);
        });
        result.idempotency = purgeRecord(this.state.runtime.idempotency, (record) => record.expiresAt < cutoffs.idempotencyBefore);
        result.schedulerTasks = purgeRecord(this.state.runtime.schedulerTasks, (task) => (task.status === "completed" || task.status === "cancelled" || task.status === "failed") &&
            (task.completedAt ?? task.updatedAt) < cutoffs.schedulerBefore);
        result.inventoryOperations = purgeRecord(this.state.inventory.operations, (record) => record.createdAt < cutoffs.inventoryOperationsBefore);
        for (const [key, operationId] of Object.entries(this.state.inventory.idempotencyKeys)) {
            if (!this.state.inventory.operations[operationId])
                delete this.state.inventory.idempotencyKeys[key];
        }
        result.actionSessions = purgeRecord(this.state.inventory.actionSessions, (session) => session.status !== "active" && session.expiresAt < cutoffs.actionSessionsBefore);
        result.checkoutSessions = purgeRecord(this.state.shop.checkoutSessions, (session) => session.status !== "active" && session.expiresAt < cutoffs.checkoutSessionsBefore);
        return result;
    }
}
exports.GameStateRetentionRepository = GameStateRetentionRepository;
function purgeRecord(record, predicate) {
    let removed = 0;
    for (const [key, value] of Object.entries(record)) {
        if (!predicate(value))
            continue;
        delete record[key];
        removed += 1;
    }
    return removed;
}
