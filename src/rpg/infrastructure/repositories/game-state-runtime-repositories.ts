import type { EventRepository } from "../../application/ports/event-repository";
import type { RetentionCutoffs, RetentionRepository, RetentionResult } from "../../application/ports/retention-repository";
import type { SchedulerRepository } from "../../application/ports/scheduler-repository";
import type { DomainEvent } from "../../domain/events";
import type { InboxRecord, OutboxRecord, ScheduledTask } from "../../domain/runtime";
import type { GameState } from "../storage/game-state";
import { ownerKey, type OwnerRef } from "../../domain/assets";
import { detached, detachedValues } from "./detached-copy";

export class GameStateEventRepository implements EventRepository {
  constructor(private readonly state: GameState) {}

  async append(event: DomainEvent): Promise<void> {
    const storedEvent = detached(event);
    this.state.runtime.history.push(storedEvent);
    this.state.runtime.outbox[event.eventId] = {
      event: storedEvent,
      status: "pending",
      attempts: 0,
      nextAttemptAt: event.occurredAt,
      createdAt: event.occurredAt
    };
  }
  async findOutbox(eventId: string): Promise<OutboxRecord | undefined> { return detached(this.state.runtime.outbox[eventId]); }
  async saveOutbox(record: OutboxRecord): Promise<void> { this.state.runtime.outbox[record.event.eventId] = detached(record); }
  async listPendingOutbox(now: string, limit: number): Promise<OutboxRecord[]> {
    return detachedValues(Object.values(this.state.runtime.outbox)
      .filter((record) => (record.status === "pending" || record.status === "failed") && record.nextAttemptAt <= now)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit));
  }
  async listHistory(query: { eventType?: string; aggregateId?: string; owner?: OwnerRef; occurredBefore?: string; limit: number; offset?: number }): Promise<DomainEvent[]> {
    return detachedValues(this.state.runtime.history
      .filter((event) => (!query.eventType || event.eventType === query.eventType) &&
        (!query.aggregateId || event.aggregateId === query.aggregateId) &&
        (!query.owner || eventHasOwner(event, query.owner)) &&
        (!query.occurredBefore || event.occurredAt < query.occurredBefore))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(query.offset ?? 0, (query.offset ?? 0) + query.limit));
  }
  async findInbox(messageId: string, consumer: string): Promise<InboxRecord | undefined> {
    return detached(this.state.runtime.inbox[`${consumer}:${messageId}`]);
  }
  async saveInbox(record: InboxRecord): Promise<void> { this.state.runtime.inbox[`${record.consumer}:${record.messageId}`] = detached(record); }
}

export class GameStateSchedulerRepository implements SchedulerRepository {
  constructor(private readonly state: GameState) {}
  async findById(id: string): Promise<ScheduledTask | undefined> { return detached(this.state.runtime.schedulerTasks[id]); }
  async findByIdempotencyKey(idempotencyKey: string): Promise<ScheduledTask | undefined> {
    return detached(Object.values(this.state.runtime.schedulerTasks).find((task) => task.idempotencyKey === idempotencyKey));
  }
  async findActiveByType(taskType: string): Promise<ScheduledTask | undefined> {
    return detached(Object.values(this.state.runtime.schedulerTasks).find((task) =>
      task.taskType === taskType && (task.status === "pending" || task.status === "running")));
  }
  async save(task: ScheduledTask): Promise<void> { this.state.runtime.schedulerTasks[task.id] = detached(task); }
  async listDue(now: string, limit: number): Promise<ScheduledTask[]> {
    return detachedValues(Object.values(this.state.runtime.schedulerTasks)
      .filter((task) => (task.status === "pending" || task.status === "running") &&
        task.runAt <= now && (!task.lockedUntil || task.lockedUntil <= now))
      .sort((left, right) => left.runAt.localeCompare(right.runAt))
      .slice(0, limit));
  }
  async listByStatus(status: ScheduledTask["status"], limit: number): Promise<ScheduledTask[]> {
    return detachedValues(Object.values(this.state.runtime.schedulerTasks).filter((task) => task.status === status).slice(0, limit));
  }
}

function eventHasOwner(event: DomainEvent, owner: OwnerRef): boolean {
  const payload = event.payload as Record<string, unknown>;
  return [payload.owner, payload.fromOwner, payload.toOwner].some((candidate) =>
    isOwnerRef(candidate) && ownerKey(candidate) === ownerKey(owner));
}

function isOwnerRef(value: unknown): value is OwnerRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.kind === "string" && (typeof candidate.id === "string" || typeof candidate.id === "number");
}

export class GameStateRetentionRepository implements RetentionRepository {
  constructor(private readonly state: GameState) {}
  async purge(cutoffs: RetentionCutoffs): Promise<RetentionResult> {
    const result: RetentionResult = { history: 0, outbox: 0, inbox: 0, idempotency: 0, schedulerTasks: 0, inventoryOperations: 0, actionSessions: 0, checkoutSessions: 0 };
    const historyBefore = this.state.runtime.history.length;
    this.state.runtime.history = this.state.runtime.history.filter((event) => event.occurredAt >= cutoffs.historyBefore);
    result.history = historyBefore - this.state.runtime.history.length;
    result.outbox = purgeRecord(this.state.runtime.outbox, (record) =>
      (record.status === "published" || record.status === "dead_letter") &&
      (record.publishedAt ?? record.lastAttemptAt ?? record.createdAt) < cutoffs.outboxBefore);
    result.inbox = purgeRecord(this.state.runtime.inbox, (record) => {
      if (record.status === "processed") return (record.processedAt ?? record.updatedAt) < cutoffs.inboxBefore;
      if (record.status === "failed") return record.updatedAt < cutoffs.inboxBefore;
      return Boolean(record.lockedUntil && record.lockedUntil < cutoffs.inboxBefore);
    });
    result.idempotency = purgeRecord(this.state.runtime.idempotency, (record) => record.expiresAt < cutoffs.idempotencyBefore);
    result.schedulerTasks = purgeRecord(this.state.runtime.schedulerTasks, (task) =>
      (task.status === "completed" || task.status === "cancelled" || task.status === "failed") &&
      (task.completedAt ?? task.updatedAt) < cutoffs.schedulerBefore);
    result.inventoryOperations = purgeRecord(this.state.inventory.operations, (record) => record.createdAt < cutoffs.inventoryOperationsBefore);
    for (const [key, operationId] of Object.entries(this.state.inventory.idempotencyKeys)) {
      if (!this.state.inventory.operations[operationId]) delete this.state.inventory.idempotencyKeys[key];
    }
    result.actionSessions = purgeRecord(this.state.inventory.actionSessions, (session) => session.status !== "active" && session.expiresAt < cutoffs.actionSessionsBefore);
    result.checkoutSessions = purgeRecord(this.state.shop.checkoutSessions, (session) => session.status !== "active" && session.expiresAt < cutoffs.checkoutSessionsBefore);
    return result;
  }
}

function purgeRecord<T>(record: Record<string, T>, predicate: (value: T) => boolean): number {
  let removed = 0;
  for (const [key, value] of Object.entries(record)) {
    if (!predicate(value)) continue;
    delete record[key];
    removed += 1;
  }
  return removed;
}
