import type { AccountRef, InventoryEntryId, ListingId, Money, OwnerRef, ProductId } from "./assets";

export type CheckoutId = string;
export type ShopOrderId = string;
export type CheckoutStatus = "active" | "consumed" | "cancelled" | "expired";
export type ShopOrderType = "purchase" | "sale";

export interface CheckoutSession {
  id: CheckoutId;
  type: ShopOrderType;
  actorId: number;
  owner: OwnerRef;
  productId: ProductId;
  listingId?: ListingId;
  inventoryEntryId?: InventoryEntryId;
  quantity: number;
  unitPrice: Money;
  totalPrice: Money;
  listingVersion?: number;
  status: CheckoutStatus;
  expiresAt: string;
  createdAt: string;
  consumedOrderId?: ShopOrderId;
}

export interface ShopOrder {
  id: ShopOrderId;
  type: ShopOrderType;
  actorId: number;
  owner: OwnerRef;
  productId: ProductId;
  listingId?: ListingId;
  inventoryEntryIds: InventoryEntryId[];
  quantity: number;
  unitPrice: Money;
  totalPrice: Money;
  account: AccountRef;
  status: "completed";
  idempotencyKey: string;
  correlationId: string;
  createdAt: string;
  completedAt: string;
}

export interface ListingRuntimeState {
  version: number;
  stockRemaining?: number;
  updatedAt: string;
}

export interface ShopPersistentState {
  version: "1.0.0";
  checkoutSessions: Record<CheckoutId, CheckoutSession>;
  orders: Record<ShopOrderId, ShopOrder>;
  idempotencyKeys: Record<string, ShopOrderId>;
  listingRuntime: Record<ListingId, ListingRuntimeState>;
}

export const createEmptyShopState = (): ShopPersistentState => ({
  version: "1.0.0",
  checkoutSessions: {},
  orders: {},
  idempotencyKeys: {},
  listingRuntime: {}
});

