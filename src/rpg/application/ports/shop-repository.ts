import type { ListingRuntimeState } from "../../domain/shop";
import type { CheckoutSession, ShopOrder } from "../../domain/shop";

export interface ShopRepository {
  findCheckout(checkoutId: string): Promise<CheckoutSession | undefined>;
  saveCheckout(checkout: CheckoutSession): Promise<void>;
  findOrder(orderId: string): Promise<ShopOrder | undefined>;
  findOrderByIdempotency(actorId: number, idempotencyKey: string): Promise<ShopOrder | undefined>;
  saveOrder(order: ShopOrder): Promise<void>;
  listOrders(actorId: number, offset: number, limit: number): Promise<ShopOrder[]>;
  countPurchasedQuantity(actorId: number, productId: string): Promise<number>;
  findListingRuntime(listingId: string): Promise<ListingRuntimeState | undefined>;
  saveListingRuntime(listingId: string, runtime: ListingRuntimeState): Promise<void>;
}
