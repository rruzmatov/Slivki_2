"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxDispatcher = void 0;
const outbox_delivery_policy_1 = require("./outbox-delivery-policy");
class OutboxDispatcher {
    unitOfWork;
    eventBus;
    schemas;
    clock;
    constructor(unitOfWork, eventBus, schemas, clock) {
        this.unitOfWork = unitOfWork;
        this.eventBus = eventBus;
        this.schemas = schemas;
        this.clock = clock;
    }
    async dispatch(limit = 100) {
        const records = await this.unitOfWork.execute((scope) => scope.events.listPendingOutbox(this.clock.nowIso(), normalizeLimit(limit)), { publishEvents: false });
        let published = 0;
        for (const record of records) {
            try {
                this.schemas.validate("event", record.event.eventType, record.event.eventVersion, record.event.payload);
                await this.eventBus.publish(record.event);
                (0, outbox_delivery_policy_1.markOutboxPublished)(record, this.clock.now());
                published += 1;
            }
            catch (error) {
                (0, outbox_delivery_policy_1.markOutboxFailed)(record, error, this.clock.now());
            }
            await this.unitOfWork.execute((scope) => scope.events.saveOutbox(record), { publishEvents: false });
        }
        return published;
    }
}
exports.OutboxDispatcher = OutboxDispatcher;
function normalizeLimit(limit) {
    return Number.isSafeInteger(limit) && limit > 0 && limit <= 1_000 ? limit : 100;
}
