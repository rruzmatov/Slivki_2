import type { ScheduledTask } from "../../domain/runtime";

export interface SchedulerRepository {
  findById(id: string): Promise<ScheduledTask | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ScheduledTask | undefined>;
  findActiveByType(taskType: string): Promise<ScheduledTask | undefined>;
  save(task: ScheduledTask): Promise<void>;
  listDue(now: string, limit: number): Promise<ScheduledTask[]>;
  listByStatus(status: ScheduledTask["status"], limit: number): Promise<ScheduledTask[]>;
}
