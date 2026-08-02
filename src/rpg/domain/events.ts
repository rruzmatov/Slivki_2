export interface DomainEvent<TPayload = Readonly<Record<string, unknown>>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId: string;
  payload: TPayload;
  id: string;
  type: string;
}

export interface NewDomainEvent<TPayload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
  eventType: string;
  eventVersion?: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: TPayload;
}
