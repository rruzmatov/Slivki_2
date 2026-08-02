"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyShopState = void 0;
const createEmptyShopState = () => ({
    version: "1.0.0",
    checkoutSessions: {},
    orders: {},
    idempotencyKeys: {},
    listingRuntime: {}
});
exports.createEmptyShopState = createEmptyShopState;
