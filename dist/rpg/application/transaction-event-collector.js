"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionEventCollector = void 0;
const ids_1 = require("../utils/ids");
class TransactionEventCollector {
    schemas;
    repository;
    collected = [];
    constructor(schemas, repository) {
        this.schemas = schemas;
        this.repository = repository;
    }
    collect(input, operation) {
        const eventVersion = input.eventVersion ?? 1;
        const payload = this.schemas.validate("event", input.eventType, eventVersion, input.payload);
        const eventId = (0, ids_1.createId)("event");
        const event = {
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
    events() {
        return this.collected;
    }
    async flush() {
        for (const event of this.collected)
            await this.repository.append(event);
    }
}
exports.TransactionEventCollector = TransactionEventCollector;
