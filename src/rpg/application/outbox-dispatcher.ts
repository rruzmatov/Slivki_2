import type { Clock } from "./ports/clock";
import type { UnitOfWorkManager } from "./ports/unit-of-work";
import type { EventBus } from "./event-bus";
import type { SchemaRegistry } from "./schema-registry";
import { markOutboxFailed, markOutboxPublished } from "./outbox-delivery-policy";

export class OutboxDispatcher {
  constructor(
    private readonly unitOfWork: UnitOfWorkManager,
    private readonly eventBus: EventBus,
    private readonly schemas: SchemaRegistry,
    private readonly clock: Clock
  ) {}

  async dispatch(limit = 100): Promise<number> {
    const records = await this.unitOfWork.execute(
      (scope) => scope.events.listPendingOutbox(this.clock.nowIso(), normalizeLimit(limit)),
      { publishEvents: false }
    );
    let published = 0;
    for (const record of records) {
      try {
        this.schemas.validate("event", record.event.eventType, record.event.eventVersion, record.event.payload);
        await this.eventBus.publish(record.event);
        markOutboxPublished(record, this.clock.now());
        published += 1;
      } catch (error) {
        markOutboxFailed(record, error, this.clock.now());
      }
      await this.unitOfWork.execute((scope) => scope.events.saveOutbox(record), { publishEvents: false });
    }
    return published;
  }
}

function normalizeLimit(limit: number): number {
  return Number.isSafeInteger(limit) && limit > 0 && limit <= 1_000 ? limit : 100;
}
