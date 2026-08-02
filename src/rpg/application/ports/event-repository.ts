import type { DomainEvent } from "../../domain/events";
import type { InboxRecord, OutboxRecord } from "../../domain/runtime";
import type { OwnerRef } from "../../domain/assets";

export interface EventRepository {
  append(event: DomainEvent): Promise<void>;
  findOutbox(eventId: string): Promise<OutboxRecord | undefined>;
  saveOutbox(record: OutboxRecord): Promise<void>;
  listPendingOutbox(now: string, limit: number): Promise<OutboxRecord[]>;
  listHistory(query: {
    eventType?: string;
    aggregateId?: string;
    owner?: OwnerRef;
    occurredBefore?: string;
    limit: number;
    offset?: number;
  }): Promise<DomainEvent[]>;
  findInbox(messageId: string, consumer: string): Promise<InboxRecord | undefined>;
  saveInbox(record: InboxRecord): Promise<void>;
}
