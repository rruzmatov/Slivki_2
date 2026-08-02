import type { Clock } from "./ports/clock";
import type { RetentionResult } from "./ports/retention-repository";
import type { UnitOfWorkManager } from "./ports/unit-of-work";

export interface RetentionPolicy {
  historyDays: number;
  outboxDays: number;
  inboxDays: number;
  idempotencyDays: number;
  schedulerDays: number;
  inventoryOperationDays: number;
  actionSessionDays: number;
  checkoutSessionDays: number;
}

export const DEFAULT_RETENTION_POLICY: Readonly<RetentionPolicy> = Object.freeze({
  historyDays: 180,
  outboxDays: 7,
  inboxDays: 30,
  idempotencyDays: 7,
  schedulerDays: 30,
  inventoryOperationDays: 30,
  actionSessionDays: 2,
  checkoutSessionDays: 2
});

export class RetentionService {
  constructor(
    private readonly unitOfWork: UnitOfWorkManager,
    private readonly clock: Clock,
    private readonly policy: Readonly<RetentionPolicy> = DEFAULT_RETENTION_POLICY
  ) {}

  async run(): Promise<RetentionResult> {
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

const cutoff = (now: number, days: number): string => new Date(now - days * 24 * 60 * 60 * 1_000).toISOString();
