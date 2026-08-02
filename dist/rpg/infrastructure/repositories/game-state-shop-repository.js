"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateShopRepository = void 0;
const detached_copy_1 = require("./detached-copy");
class GameStateShopRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async findCheckout(checkoutId) {
        return (0, detached_copy_1.detached)(this.state.shop.checkoutSessions[checkoutId]);
    }
    async saveCheckout(checkout) {
        this.state.shop.checkoutSessions[checkout.id] = (0, detached_copy_1.detached)(checkout);
    }
    async findOrder(orderId) {
        return (0, detached_copy_1.detached)(this.state.shop.orders[orderId]);
    }
    async findOrderByIdempotency(actorId, idempotencyKey) {
        const orderId = this.state.shop.idempotencyKeys[`${actorId}:${idempotencyKey}`];
        return orderId ? (0, detached_copy_1.detached)(this.state.shop.orders[orderId]) : undefined;
    }
    async saveOrder(order) {
        this.state.shop.orders[order.id] = (0, detached_copy_1.detached)(order);
        this.state.shop.idempotencyKeys[`${order.actorId}:${order.idempotencyKey}`] = order.id;
    }
    async listOrders(actorId, offset, limit) {
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.shop.orders)
            .filter((order) => order.actorId === actorId)
            .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
            .slice(offset, offset + limit));
    }
    async countPurchasedQuantity(actorId, productId) {
        return Object.values(this.state.shop.orders)
            .filter((order) => order.actorId === actorId && order.type === "purchase" && order.productId === productId && order.status === "completed")
            .reduce((sum, order) => sum + order.quantity, 0);
    }
    async findListingRuntime(listingId) {
        return (0, detached_copy_1.detached)(this.state.shop.listingRuntime[listingId]);
    }
    async saveListingRuntime(listingId, runtime) {
        this.state.shop.listingRuntime[listingId] = (0, detached_copy_1.detached)(runtime);
    }
}
exports.GameStateShopRepository = GameStateShopRepository;
