import type { ActorRef } from "./assets";
import type { DomainEvent } from "./events";

export type OutboxStatus = "pending" | "published" | "failed" | "dead_letter";
export type InboxStatus = "processing" | "processed" | "failed";
export type SchedulerTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface OutboxRecord {
  event: DomainEvent;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  createdAt: string;
  publishedAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface InboxRecord {
  messageId: string;
  consumer: string;
  payloadSchemaId: string;
  payloadSchemaVersion: number;
  payload: Readonly<Record<string, unknown>>;
  status: InboxStatus;
  attempts: number;
  receivedAt: string;
  updatedAt: string;
  lockedUntil?: string;
  processedAt?: string;
  lastError?: string;
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  payloadHash: string;
  result: unknown;
  createdAt: string;
  expiresAt: string;
}

export interface ScheduledTask {
  id: string;
  taskType: string;
  payloadSchemaId: string;
  payloadSchemaVersion: number;
  payload: Readonly<Record<string, unknown>>;
  status: SchedulerTaskStatus;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  correlationId: string;
  causationId: string;
  createdBy: ActorRef;
  createdAt: string;
  updatedAt: string;
  lockedUntil?: string;
  completedAt?: string;
  lastError?: string;
}

export interface RuntimePersistentState {
  version: "1.0.0";
  history: DomainEvent[];
  outbox: Record<string, OutboxRecord>;
  inbox: Record<string, InboxRecord>;
  idempotency: Record<string, IdempotencyRecord>;
  schedulerTasks: Record<string, ScheduledTask>;
}

export const createEmptyRuntimeState = (): RuntimePersistentState => ({
  version: "1.0.0",
  history: [],
  outbox: {},
  inbox: {},
  idempotency: {},
  schedulerTasks: {}
});
