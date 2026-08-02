export interface OperationLogRecord {
  readonly timestamp: string;
  readonly level: "info" | "error";
  readonly operationType: string;
  readonly operationId: string;
  readonly correlationId: string;
  readonly actorId: string;
  readonly vehicleId: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly errorCode?: string;
}

export interface Logger {
  write(record: OperationLogRecord): void;
}
