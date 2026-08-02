import type { OperationContext } from "../domain/assets";
import { DomainError } from "../domain/errors";
import type { ScheduledTask } from "../domain/runtime";
import { createId } from "../utils/ids";
import type { SchedulerRepository } from "./ports/scheduler-repository";
import type { SchemaRegistry } from "./schema-registry";

export interface TransactionScheduleInput {
  taskType: string;
  payload: Readonly<Record<string, unknown>>;
  runAt: string;
  idempotencyKey: string;
  maxAttempts?: number;
}

export class TransactionSchedulerService {
  constructor(
    private readonly repository: SchedulerRepository,
    private readonly schemas: SchemaRegistry
  ) {}

  async schedule(input: TransactionScheduleInput, operation: OperationContext): Promise<ScheduledTask> {
    if (!Number.isFinite(Date.parse(input.runAt))) throw new DomainError("Некорректная дата задачи", "SCHEDULER_RUN_AT_INVALID");
    const payload = this.schemas.validate<Readonly<Record<string, unknown>>>("scheduler", input.taskType, 1, input.payload);
    const existing = await this.repository.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      if (existing.taskType !== input.taskType || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
        throw new DomainError("Ключ задачи уже использован с другими параметрами", "SCHEDULER_IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }
    const task: ScheduledTask = {
      id: createId("task"), taskType: input.taskType, payloadSchemaId: input.taskType, payloadSchemaVersion: 1,
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
