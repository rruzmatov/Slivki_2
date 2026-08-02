import { DomainError } from "../domain/errors";
import type { DomainEvent } from "../domain/events";

export type DomainEventHandler<TPayload = Readonly<Record<string, unknown>>> =
  (event: DomainEvent<TPayload>) => Promise<void>;

export class EventBus {
  private readonly handlers = new Map<string, DomainEventHandler<unknown>[]>();

  subscribe<TPayload>(eventType: string, handler: DomainEventHandler<TPayload>): () => void {
    const handlers = this.handlers.get(eventType) ?? [];
    handlers.push(handler as DomainEventHandler<unknown>);
    this.handlers.set(eventType, handlers);
    return () => {
      const current = this.handlers.get(eventType) ?? [];
      this.handlers.set(eventType, current.filter((candidate) => candidate !== handler));
    };
  }

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const handlers = [...(this.handlers.get(event.eventType) ?? [])];
    if (handlers.length > 1_000) throw new DomainError("Превышен лимит обработчиков доменного события", "EVENT_BUS_LIMIT_EXCEEDED");
    for (const handler of handlers) await handler(event as DomainEvent<unknown>);
  }
}
