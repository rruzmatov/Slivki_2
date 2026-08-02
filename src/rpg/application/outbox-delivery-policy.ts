import type { OutboxRecord } from "../domain/runtime";

const MAX_OUTBOX_ATTEMPTS = 20;

export function markOutboxPublished(record: OutboxRecord, now: Date): void {
  const timestamp = now.toISOString();
  record.attempts += 1;
  record.status = "published";
  record.publishedAt = timestamp;
  record.lastAttemptAt = timestamp;
  record.lastError = undefined;
}

export function markOutboxFailed(record: OutboxRecord, error: unknown, now: Date): void {
  record.attempts += 1;
  record.status = record.attempts >= MAX_OUTBOX_ATTEMPTS ? "dead_letter" : "failed";
  record.lastAttemptAt = now.toISOString();
  record.lastError = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
  record.nextAttemptAt = new Date(now.getTime() + retryDelayMs(record.attempts)).toISOString();
}

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1_000, 1_000 * 2 ** Math.min(attempt, 12));
}
