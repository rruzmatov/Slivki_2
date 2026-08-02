"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyRuntimeState = void 0;
const createEmptyRuntimeState = () => ({
    version: "1.0.0",
    history: [],
    outbox: {},
    inbox: {},
    idempotency: {},
    schedulerTasks: {}
});
exports.createEmptyRuntimeState = createEmptyRuntimeState;
