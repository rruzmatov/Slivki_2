"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyInventoryState = void 0;
const createEmptyInventoryState = () => ({
    version: "1.0.0",
    entries: {},
    reservations: {},
    equipment: {},
    leases: {},
    operations: {},
    idempotencyKeys: {},
    history: [],
    outbox: {},
    actionSessions: {}
});
exports.createEmptyInventoryState = createEmptyInventoryState;
