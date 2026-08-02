"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
const errors_1 = require("../domain/errors");
class EventBus {
    handlers = new Map();
    subscribe(eventType, handler) {
        const handlers = this.handlers.get(eventType) ?? [];
        handlers.push(handler);
        this.handlers.set(eventType, handlers);
        return () => {
            const current = this.handlers.get(eventType) ?? [];
            this.handlers.set(eventType, current.filter((candidate) => candidate !== handler));
        };
    }
    async publish(event) {
        const handlers = [...(this.handlers.get(event.eventType) ?? [])];
        if (handlers.length > 1_000)
            throw new errors_1.DomainError("Превышен лимит обработчиков доменного события", "EVENT_BUS_LIMIT_EXCEEDED");
        for (const handler of handlers)
            await handler(event);
    }
}
exports.EventBus = EventBus;
