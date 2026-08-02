"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = exports.SchedulerHandlerRegistry = void 0;
const promises_1 = require("node:timers/promises");
const errors_1 = require("../domain/errors");
const ids_1 = require("../utils/ids");
class SchedulerHandlerRegistry {
    handlers = new Map();
    register(taskType, handler) {
        if (this.handlers.has(taskType))
            throw new errors_1.DomainError(`Обработчик Scheduler уже зарегистрирован: ${taskType}`, "SCHEDULER_HANDLER_DUPLICATE");
        this.handlers.set(taskType, handler);
    }
    get(taskType) {
        const handler = this.handlers.get(taskType);
        if (!handler)
            throw new errors_1.DomainError(`Обработчик Scheduler не зарегистрирован: ${taskType}`, "SCHEDULER_HANDLER_NOT_FOUND");
        return handler;
    }
}
exports.SchedulerHandlerRegistry = SchedulerHandlerRegistry;
class SchedulerService {
    unitOfWork;
    schemas;
    handlers;
    clock;
    abortController = new AbortController();
    worker;
    constructor(unitOfWork, schemas, handlers, clock) {
        this.unitOfWork = unitOfWork;
        this.schemas = schemas;
        this.handlers = handlers;
        this.clock = clock;
    }
    async schedule(input) {
        const runAt = parseTimestamp(input.runAt, "SCHEDULER_RUN_AT_INVALID");
        const schemaId = input.payloadSchemaId ?? input.taskType;
        const schemaVersion = input.payloadSchemaVersion ?? 1;
        const payload = this.schemas.validate("scheduler", schemaId, schemaVersion, input.payload);
        return this.unitOfWork.execute(async (scope) => {
            const existing = await scope.scheduler.findByIdempotencyKey(input.idempotencyKey);
            if (existing) {
                if (existing.taskType !== input.taskType || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
                    throw new errors_1.DomainError("Ключ задачи уже использован с другими параметрами", "SCHEDULER_IDEMPOTENCY_CONFLICT");
                }
                return existing;
            }
            const now = this.clock.nowIso();
            const task = {
                id: (0, ids_1.createId)("task"), taskType: input.taskType, payloadSchemaId: schemaId, payloadSchemaVersion: schemaVersion,
                payload, status: "pending", runAt: runAt.toISOString(), attempts: 0, maxAttempts: normalizeMaxAttempts(input.maxAttempts),
                idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, causationId: input.causationId,
                createdBy: input.createdBy, createdAt: now, updatedAt: now
            };
            await scope.scheduler.save(task);
            return task;
        });
    }
    async cancel(taskId) {
        return this.unitOfWork.execute(async (scope) => {
            const task = await scope.scheduler.findById(taskId);
            if (!task)
                throw new errors_1.DomainError("Задача Scheduler не найдена", "SCHEDULER_TASK_NOT_FOUND");
            if (task.status === "completed")
                throw new errors_1.DomainError("Завершённую задачу нельзя отменить", "SCHEDULER_TASK_FINAL");
            task.status = "cancelled";
            task.updatedAt = this.clock.nowIso();
            task.completedAt = task.updatedAt;
            await scope.scheduler.save(task);
            return task;
        });
    }
    async hasActiveTask(taskType) {
        return this.unitOfWork.execute(async (scope) => Boolean(await scope.scheduler.findActiveByType(taskType)), { publishEvents: false });
    }
    async runDue(limit = 100) {
        const tasks = await this.unitOfWork.execute((scope) => scope.scheduler.listDue(this.clock.nowIso(), normalizeBatchSize(limit)), { publishEvents: false });
        let handled = 0;
        for (const task of tasks) {
            const claimed = await this.claim(task.id);
            if (!claimed)
                continue;
            try {
                this.schemas.validate("scheduler", claimed.payloadSchemaId, claimed.payloadSchemaVersion, claimed.payload);
                await this.handlers.get(claimed.taskType)(claimed);
                await this.finish(claimed.id, "completed");
            }
            catch (error) {
                await this.fail(claimed.id, error);
            }
            handled += 1;
        }
        return handled;
    }
    start(pollIntervalMs = 5_000) {
        if (this.worker)
            return;
        if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250) {
            throw new errors_1.DomainError("Интервал Scheduler должен быть не меньше 250 мс", "SCHEDULER_INTERVAL_INVALID");
        }
        this.worker = this.runWorker(pollIntervalMs);
    }
    async stop() {
        this.abortController.abort();
        await this.worker;
    }
    async runWorker(pollIntervalMs) {
        try {
            await this.runDue();
            for await (const _ of (0, promises_1.setInterval)(pollIntervalMs, undefined, { signal: this.abortController.signal }))
                await this.runDue();
        }
        catch (error) {
            if (!this.abortController.signal.aborted)
                throw error;
        }
    }
    async claim(taskId) {
        return this.unitOfWork.execute(async (scope) => {
            const task = await scope.scheduler.findById(taskId);
            const now = this.clock.nowIso();
            if (!task || (task.status !== "pending" && task.status !== "running") ||
                task.runAt > now || (task.lockedUntil && task.lockedUntil > now))
                return undefined;
            task.status = "running";
            task.attempts += 1;
            task.lockedUntil = new Date(this.clock.now().getTime() + 60_000).toISOString();
            task.updatedAt = now;
            await scope.scheduler.save(task);
            return task;
        }, { publishEvents: false });
    }
    async finish(taskId, status) {
        await this.unitOfWork.execute(async (scope) => {
            const task = await scope.scheduler.findById(taskId);
            if (!task)
                return;
            task.status = status;
            task.lockedUntil = undefined;
            task.updatedAt = this.clock.nowIso();
            task.completedAt = task.updatedAt;
            await scope.scheduler.save(task);
        }, { publishEvents: false });
    }
    async fail(taskId, error) {
        await this.unitOfWork.execute(async (scope) => {
            const task = await scope.scheduler.findById(taskId);
            if (!task)
                return;
            task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
            task.lastError = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
            task.lockedUntil = undefined;
            task.runAt = new Date(this.clock.now().getTime() + retryDelayMs(task.attempts)).toISOString();
            task.updatedAt = this.clock.nowIso();
            await scope.scheduler.save(task);
        }, { publishEvents: false });
    }
}
exports.SchedulerService = SchedulerService;
function parseTimestamp(value, code) {
    const result = new Date(value);
    if (!Number.isFinite(result.getTime()))
        throw new errors_1.DomainError("Некорректная дата задачи", code);
    return result;
}
function normalizeMaxAttempts(value = 10) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100)
        throw new errors_1.DomainError("Количество попыток должно быть от 1 до 100", "SCHEDULER_ATTEMPTS_INVALID");
    return value;
}
const normalizeBatchSize = (value) => Number.isSafeInteger(value) && value > 0 && value <= 1_000 ? value : 100;
const retryDelayMs = (attempt) => Math.min(60 * 60 * 1_000, 1_000 * 2 ** Math.min(attempt, 12));
