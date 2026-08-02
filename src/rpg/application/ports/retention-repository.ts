export interface RetentionCutoffs {
  historyBefore: string;
  outboxBefore: string;
  inboxBefore: string;
  idempotencyBefore: string;
  schedulerBefore: string;
  inventoryOperationsBefore: string;
  actionSessionsBefore: string;
  checkoutSessionsBefore: string;
}

export interface RetentionResult {
  history: number;
  outbox: number;
  inbox: number;
  idempotency: number;
  schedulerTasks: number;
  inventoryOperations: number;
  actionSessions: number;
  checkoutSessions: number;
}

export interface RetentionRepository {
  purge(cutoffs: RetentionCutoffs): Promise<RetentionResult>;
}
