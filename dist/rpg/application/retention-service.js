"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetentionService = exports.DEFAULT_RETENTION_POLICY = void 0;
exports.DEFAULT_RETENTION_POLICY = Object.freeze({
    historyDays: 180,
    outboxDays: 7,
    inboxDays: 30,
    idempotencyDays: 7,
    schedulerDays: 30,
    inventoryOperationDays: 30,
    actionSessionDays: 2,
    checkoutSessionDays: 2
});
class RetentionService {
    unitOfWork;
    clock;
    policy;
    constructor(unitOfWork, clock, policy = exports.DEFAULT_RETENTION_POLICY) {
        this.unitOfWork = unitOfWork;
        this.clock = clock;
        this.policy = policy;
    }
    async run() {
        const now = this.clock.now().getTime();
        return this.unitOfWork.execute((scope) => scope.retention.purge({
            historyBefore: cutoff(now, this.policy.historyDays),
            outboxBefore: cutoff(now, this.policy.outboxDays),
            inboxBefore: cutoff(now, this.policy.inboxDays),
            idempotencyBefore: cutoff(now, this.policy.idempotencyDays),
            schedulerBefore: cutoff(now, this.policy.schedulerDays),
            inventoryOperationsBefore: cutoff(now, this.policy.inventoryOperationDays),
            actionSessionsBefore: cutoff(now, this.policy.actionSessionDays),
            checkoutSessionsBefore: cutoff(now, this.policy.checkoutSessionDays)
        }), { publishEvents: false });
    }
}
exports.RetentionService = RetentionService;
const cutoff = (now, days) => new Date(now - days * 24 * 60 * 60 * 1_000).toISOString();
