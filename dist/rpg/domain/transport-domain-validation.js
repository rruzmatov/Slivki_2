"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTransportIdentifier = assertTransportIdentifier;
exports.timestampMilliseconds = timestampMilliseconds;
exports.assertTimestampOrder = assertTimestampOrder;
exports.assertSafeInteger = assertSafeInteger;
exports.assertNonEmptyReason = assertNonEmptyReason;
exports.safeIntegerFromBigInt = safeIntegerFromBigInt;
const transport_errors_1 = require("./transport-errors");
function assertTransportIdentifier(value, field) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_IDENTIFIER_INVALID", { field, value });
    }
    return value;
}
function timestampMilliseconds(value, field) {
    const milliseconds = Date.parse(value);
    if (!value || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_TIMESTAMP_INVALID", { field, value });
    }
    return milliseconds;
}
function assertTimestampOrder(earlier, later, field) {
    if (timestampMilliseconds(later, field) < timestampMilliseconds(earlier, `${field}.reference`)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_TIMESTAMP_INVALID", { field, value: later });
    }
}
function assertSafeInteger(value, field, errorCode, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw transport_errors_1.TransportErrorFactory.create(errorCode, { field, value });
    }
    return value;
}
function assertNonEmptyReason(value, errorCode, field = "reasonCode") {
    const normalized = value.trim();
    if (!normalized || normalized.length > 128) {
        throw transport_errors_1.TransportErrorFactory.create(errorCode, { field });
    }
    return normalized;
}
function safeIntegerFromBigInt(value, errorCode, field) {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw transport_errors_1.TransportErrorFactory.create(errorCode, { field });
    }
    return Number(value);
}
