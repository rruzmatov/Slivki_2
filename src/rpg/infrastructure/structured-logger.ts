import type { Logger, OperationLogRecord } from "../application/ports/logger";

export class StructuredLogger implements Logger {
  constructor(private readonly sink: (line: string) => void = console.log) {}

  write(record: OperationLogRecord): void {
    this.sink(JSON.stringify(record));
  }
}
