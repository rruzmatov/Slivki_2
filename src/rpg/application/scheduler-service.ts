import { setInterval as interval } from "node:timers/promises";
import type { ActorRef } from "../domain/assets";
import { DomainError } from "../domain/errors";
import type { ScheduledTask } from "../domain/runtime";
import { createId } from "../utils/ids";
import type { Clock } from "./ports/clock";
import type { UnitOfWorkManager } from "./ports/unit-of-work";
import type { SchemaRegistry } from "./schema-registry";

export type ScheduledTaskHandler = (task: ScheduledTask) => Promise<void>;

export interface ScheduleTaskInput {
  taskType: string;
  payloadSchemaId?: string;
  payloadSchemaVersion?: number;
  payload: Readonly<Record<string, unknown>>;
  runAt: string;
  maxAttempts?: number;
  idempotencyKey: string;
  correlationId: string;
  causationId: string;
  createdBy: ActorRef;
}

export class SchedulerHandlerRegistry {
  private readonly handlers = new Map<string, ScheduledTaskHandler>();

  register(taskType: string, handler: ScheduledTaskHandler): void {
    if (this.handlers.has(taskType)) throw new DomainError(`Обработчик Scheduler уже зарегистрирован: ${taskType}`, "SCHEDULER_HANDLER_DUPLICATE");
    this.handlers.set(taskType, handler);
  }

  get(taskType: string): ScheduledTaskHandler {
    const handler = this.handlers.get(taskType);
    if (!handler) throw new DomainError(`Обработчик Scheduler не зарегистрирован: ${taskType}`, "SCHEDULER_HANDLER_NOT_FOUND");
    return handler;
  }
}

export class SchedulerService {
  private readonly abortController = new AbortController();
  private worker?: Promise<void>;

  constructor(
    private readonly unitOfWork: UnitOfWorkManager,
    private readonly schemas: SchemaRegistry,
    private readonly handlers: SchedulerHandlerRegistry,
    private readonly clock: Clock
  ) {}

  async schedule(input: ScheduleTaskInput): Promise<ScheduledTask> {
    const runAt = parseTimestamp(input.runAt, "SCHEDULER_RUN_AT_INVALID");
    const schemaId = input.payloadSchemaId ?? input.taskType;
    const schemaVersion = input.payloadSchemaVersion ?? 1;
    const payload = this.schemas.validate<Readonly<Record<string, unknown>>>("scheduler", schemaId, schemaVersion, input.payload);
    return this.unitOfWork.execute(async (scope) => {
      const existing = await scope.scheduler.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.taskType !== input.taskType || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
          throw new DomainError("Ключ задачи уже использован с другими параметрами", "SCHEDULER_IDEMPOTENCY_CONFLICT");
        }
        return existing;
      }
      const now = this.clock.nowIso();
      const task: ScheduledTask = {
        id: createId("task"), taskType: input.taskType, payloadSchemaId: schemaId, payloadSchemaVersion: schemaVersion,
        payload, status: "pending", runAt: runAt.toISOString(), attempts: 0, maxAttempts: normalizeMaxAttempts(input.maxAttempts),
        idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, causationId: input.causationId,
        createdBy: input.createdBy, createdAt: now, updatedAt: now
      };
      await scope.scheduler.save(task);
      return task;
    });
  }

  async cancel(taskId: string): Promise<ScheduledTask> {
    return this.unitOfWork.execute(async (scope) => {
      const task = await scope.scheduler.findById(taskId);
      if (!task) throw new DomainError("Задача Scheduler не найдена", "SCHEDULER_TASK_NOT_FOUND");
      if (task.status === "completed") throw new DomainError("Завершённую задачу нельзя отменить", "SCHEDULER_TASK_FINAL");
      task.status = "cancelled";
      task.updatedAt = this.clock.nowIso();
      task.completedAt = task.updatedAt;
      await scope.scheduler.save(task);
      return task;
    });
  }

  async hasActiveTask(taskType: string): Promise<boolean> {
    return this.unitOfWork.execute(async (scope) => Boolean(await scope.scheduler.findActiveByType(taskType)), { publishEvents: false });
  }

  async runDue(limit = 100): Promise<number> {
    const tasks = await this.unitOfWork.execute(
      (scope) => scope.scheduler.listDue(this.clock.nowIso(), normalizeBatchSize(limit)),
      { publishEvents: false }
    );
    let handled = 0;
    for (const task of tasks) {
      const claimed = await this.claim(task.id);
      if (!claimed) continue;
      try {
        this.schemas.validate("scheduler", claimed.payloadSchemaId, claimed.payloadSchemaVersion, claimed.payload);
        await this.handlers.get(claimed.taskType)(claimed);
        await this.finish(claimed.id, "completed");
      } catch (error) {
        await this.fail(claimed.id, error);
      }
      handled += 1;
    }
    return handled;
  }

  start(pollIntervalMs = 5_000): void {
    if (this.worker) return;
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250) {
      throw new DomainError("Интервал Scheduler должен быть не меньше 250 мс", "SCHEDULER_INTERVAL_INVALID");
    }
    this.worker = this.runWorker(pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    await this.worker;
  }

  private async runWorker(pollIntervalMs: number): Promise<void> {
    try {
      await this.runDue();
      for await (const _ of interval(pollIntervalMs, undefined, { signal: this.abortController.signal })) await this.runDue();
    } catch (error) {
      if (!this.abortController.signal.aborted) throw error;
    }
  }

  private async claim(taskId: string): Promise<ScheduledTask | undefined> {
    return this.unitOfWork.execute(async (scope) => {
      const task = await scope.scheduler.findById(taskId);
      const now = this.clock.nowIso();
      if (!task || (task.status !== "pending" && task.status !== "running") ||
        task.runAt > now || (task.lockedUntil && task.lockedUntil > now)) return undefined;
      task.status = "running";
      task.attempts += 1;
      task.lockedUntil = new Date(this.clock.now().getTime() + 60_000).toISOString();
      task.updatedAt = now;
      await scope.scheduler.save(task);
      return task;
    }, { publishEvents: false });
  }

  private async finish(taskId: string, status: "completed"): Promise<void> {
    await this.unitOfWork.execute(async (scope) => {
      const task = await scope.scheduler.findById(taskId);
      if (!task) return;
      task.status = status;
      task.lockedUntil = undefined;
      task.updatedAt = this.clock.nowIso();
      task.completedAt = task.updatedAt;
      await scope.scheduler.save(task);
    }, { publishEvents: false });
  }

  private async fail(taskId: string, error: unknown): Promise<void> {
    await this.unitOfWork.execute(async (scope) => {
      const task = await scope.scheduler.findById(taskId);
      if (!task) return;
      task.status = task.attempts >= task.maxAttempts ? "failed" : "pending";
      task.lastError = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
      task.lockedUntil = undefined;
      task.runAt = new Date(this.clock.now().getTime() + retryDelayMs(task.attempts)).toISOString();
      task.updatedAt = this.clock.nowIso();
      await scope.scheduler.save(task);
    }, { publishEvents: false });
  }
}

function parseTimestamp(value: string, code: string): Date {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new DomainError("Некорректная дата задачи", code);
  return result;
}

function normalizeMaxAttempts(value = 10): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new DomainError("Количество попыток должно быть от 1 до 100", "SCHEDULER_ATTEMPTS_INVALID");
  return value;
}

const normalizeBatchSize = (value: number): number => Number.isSafeInteger(value) && value > 0 && value <= 1_000 ? value : 100;
const retryDelayMs = (attempt: number): number => Math.min(60 * 60 * 1_000, 1_000 * 2 ** Math.min(attempt, 12));
