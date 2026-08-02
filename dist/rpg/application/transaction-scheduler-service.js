"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionSchedulerService = void 0;
const errors_1 = require("../domain/errors");
const ids_1 = require("../utils/ids");
class TransactionSchedulerService {
    repository;
    schemas;
    constructor(repository, schemas) {
        this.repository = repository;
        this.schemas = schemas;
    }
    async schedule(input, operation) {
        if (!Number.isFinite(Date.parse(input.runAt)))
            throw new errors_1.DomainError("Некорректная дата задачи", "SCHEDULER_RUN_AT_INVALID");
        const payload = this.schemas.validate("scheduler", input.taskType, 1, input.payload);
        const existing = await this.repository.findByIdempotencyKey(input.idempotencyKey);
        if (existing) {
            if (existing.taskType !== input.taskType || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
                throw new errors_1.DomainError("Ключ задачи уже использован с другими параметрами", "SCHEDULER_IDEMPOTENCY_CONFLICT");
            }
            return existing;
        }
        const task = {
            id: (0, ids_1.createId)("task"), taskType: input.taskType, payloadSchemaId: input.taskType, payloadSchemaVersion: 1,
            payload, status: "pending", runAt: input.runAt, attempts: 0, maxAttempts: input.maxAttempts ?? 10,
            idempotencyKey: input.idempotencyKey, correlationId: operation.correlationId,
            causationId: operation.causationId ?? operation.requestId,
            createdBy: operation.actor ?? { kind: "service", id: "application" },
            createdAt: operation.now, updatedAt: operation.now
        };
        await this.repository.save(task);
        return task;
    }
}
exports.TransactionSchedulerService = TransactionSchedulerService;
