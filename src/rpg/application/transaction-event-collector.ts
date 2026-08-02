import type { OperationContext } from "../domain/assets";
import type { DomainEvent, NewDomainEvent } from "../domain/events";
import { createId } from "../utils/ids";
import type { EventRepository } from "./ports/event-repository";
import type { SchemaRegistry } from "./schema-registry";

export class TransactionEventCollector {
  private readonly collected: DomainEvent[] = [];

  constructor(
    private readonly schemas: SchemaRegistry,
    private readonly repository: EventRepository
  ) {}

  collect<TPayload extends Readonly<Record<string, unknown>>>(
    input: NewDomainEvent<TPayload>,
    operation: OperationContext
  ): DomainEvent<TPayload> {
    const eventVersion = input.eventVersion ?? 1;
    const payload = this.schemas.validate<TPayload>("event", input.eventType, eventVersion, input.payload);
    const eventId = createId("event");
    const event: DomainEvent<TPayload> = {
      eventId,
      eventType: input.eventType,
      eventVersion,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      occurredAt: operation.now,
      correlationId: operation.correlationId,
      causationId: operation.causationId ?? operation.requestId,
      payload,
      id: eventId,
      type: input.eventType
    };
    this.collected.push(event);
    return event;
  }

  events(): readonly DomainEvent[] {
    return this.collected;
  }

  async flush(): Promise<void> {
    for (const event of this.collected) await this.repository.append(event);
  }
}
