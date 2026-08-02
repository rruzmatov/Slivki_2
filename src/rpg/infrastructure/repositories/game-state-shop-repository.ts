import type { ShopRepository } from "../../application/ports/shop-repository";
import type { CheckoutSession, ListingRuntimeState, ShopOrder } from "../../domain/shop";
import type { GameState } from "../storage/game-state";
import { detached, detachedValues } from "./detached-copy";

export class GameStateShopRepository implements ShopRepository {
  constructor(private readonly state: GameState) {}

  async findCheckout(checkoutId: string): Promise<CheckoutSession | undefined> {
    return detached(this.state.shop.checkoutSessions[checkoutId]);
  }

  async saveCheckout(checkout: CheckoutSession): Promise<void> {
    this.state.shop.checkoutSessions[checkout.id] = detached(checkout);
  }

  async findOrder(orderId: string): Promise<ShopOrder | undefined> {
    return detached(this.state.shop.orders[orderId]);
  }

  async findOrderByIdempotency(actorId: number, idempotencyKey: string): Promise<ShopOrder | undefined> {
    const orderId = this.state.shop.idempotencyKeys[`${actorId}:${idempotencyKey}`];
    return orderId ? detached(this.state.shop.orders[orderId]) : undefined;
  }

  async saveOrder(order: ShopOrder): Promise<void> {
    this.state.shop.orders[order.id] = detached(order);
    this.state.shop.idempotencyKeys[`${order.actorId}:${order.idempotencyKey}`] = order.id;
  }

  async listOrders(actorId: number, offset: number, limit: number): Promise<ShopOrder[]> {
    return detachedValues(Object.values(this.state.shop.orders)
      .filter((order) => order.actorId === actorId)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(offset, offset + limit));
  }

  async countPurchasedQuantity(actorId: number, productId: string): Promise<number> {
    return Object.values(this.state.shop.orders)
      .filter((order) => order.actorId === actorId && order.type === "purchase" && order.productId === productId && order.status === "completed")
      .reduce((sum, order) => sum + order.quantity, 0);
  }

  async findListingRuntime(listingId: string): Promise<ListingRuntimeState | undefined> {
    return detached(this.state.shop.listingRuntime[listingId]);
  }

  async saveListingRuntime(listingId: string, runtime: ListingRuntimeState): Promise<void> {
    this.state.shop.listingRuntime[listingId] = detached(runtime);
  }
}
