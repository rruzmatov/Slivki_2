import type { TransportErrorCode } from "./transport-errors";
import { TransportErrorFactory } from "./transport-errors";

export function assertTransportIdentifier(value: string, field: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) {
    throw TransportErrorFactory.create("TRANSPORT_IDENTIFIER_INVALID", { field, value });
  }
  return value;
}

export function timestampMilliseconds(value: string, field: string): number {
  const milliseconds = Date.parse(value);
  if (!value || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw TransportErrorFactory.create("TRANSPORT_TIMESTAMP_INVALID", { field, value });
  }
  return milliseconds;
}

export function assertTimestampOrder(earlier: string, later: string, field: string): void {
  if (timestampMilliseconds(later, field) < timestampMilliseconds(earlier, `${field}.reference`)) {
    throw TransportErrorFactory.create("TRANSPORT_TIMESTAMP_INVALID", { field, value: later });
  }
}

export function assertSafeInteger(
  value: number,
  field: string,
  errorCode: TransportErrorCode,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw TransportErrorFactory.create(errorCode, { field, value });
  }
  return value;
}

export function assertNonEmptyReason(value: string, errorCode: TransportErrorCode, field = "reasonCode"): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) {
    throw TransportErrorFactory.create(errorCode, { field });
  }
  return normalized;
}

export function safeIntegerFromBigInt(value: bigint, errorCode: TransportErrorCode, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw TransportErrorFactory.create(errorCode, { field });
  }
  return Number(value);
}
