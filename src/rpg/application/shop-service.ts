import type { CatalogService } from "./catalog-service";
import type { EconomyService } from "./economy-service";
import type { InventoryService } from "./inventory-service";
import type { ShopRepository } from "./ports/shop-repository";
import type { RequirementEvaluator } from "./requirement-evaluator";
import { GAME_BALANCE } from "../config/game-balance";
import type { AccountRef, OperationContext, OwnerRef, Page, PageRequest } from "../domain/assets";
import { DomainError } from "../domain/errors";
import type { CheckoutSession, ShopOrder } from "../domain/shop";
import type { PlayerProfile } from "../domain/types";
import { createId } from "../utils/ids";
import type { TelegramIdentity } from "./player-service";
import type { OwnershipService } from "./ownership-service";
import type { FamilyRepository, PlayerRepository } from "./ports/game-repositories";
import type { TransactionEventCollector } from "./transaction-event-collector";
import type { TransactionSchedulerService } from "./transaction-scheduler-service";

export interface CreatePurchaseQuoteInput {
  productId: string;
  listingId?: string;
  quantity: number;
  owner: OwnerRef;
}

export interface ConfirmPurchaseInput {
  checkoutId: string;
  paymentAccount: AccountRef;
  idempotencyKey: string;
}

export interface CreateSaleQuoteInput {
  owner: OwnerRef;
  inventoryEntryId: string;
  quantity: number;
}

export interface ConfirmSaleInput {
  checkoutId: string;
  targetAccount: AccountRef;
  idempotencyKey: string;
}

export interface PurchaseReceipt {
  order: ShopOrder;
  accountBalance: number;
  replayed: boolean;
}

export type SaleReceipt = PurchaseReceipt;

export class ShopService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly economy: EconomyService,
    private readonly requirements: RequirementEvaluator,
    private readonly repository: ShopRepository,
    private readonly ownership: OwnershipService,
    private readonly players: PlayerRepository,
    private readonly families: FamilyRepository,
    private readonly events: TransactionEventCollector,
    private readonly scheduler: TransactionSchedulerService
  ) {}

  async createPurchaseQuote(
    actor: TelegramIdentity,
    input: CreatePurchaseQuoteInput,
    operation: OperationContext
  ): Promise<CheckoutSession> {
    const player = await this.getActivePlayer(actor.id);
    await this.assertOwnerAccess(player, input.owner);
    const product = this.catalog.getProduct(input.productId);
    const listing = input.listingId ? this.catalog.getListing(input.listingId) : this.catalog.resolveActiveListing(product.id, operation.now);
    if (listing.productId !== product.id) throw new DomainError("Предложение не относится к выбранному товару", "SHOP_LISTING_PRODUCT_MISMATCH");
    const quantity = normalizeQuantity(input.quantity, listing.minQuantity, listing.maxQuantity);
    await this.assertListingAvailable(listing.id, quantity, operation.now);
    const family = player.familyId ? await this.families.findById(player.familyId) : undefined;
    await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, product.requirements);
    await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, listing.purchaseRequirements);
    await this.assertPerPlayerLimit(actor.id, product.id, quantity, listing.perPlayerLimit);

    const total = safeMultiply(listing.price.amount, quantity);
    const checkout: CheckoutSession = {
      id: createId("checkout"),
      type: "purchase",
      actorId: actor.id,
      owner: input.owner,
      productId: product.id,
      listingId: listing.id,
      quantity,
      unitPrice: listing.price,
      totalPrice: { amount: total, currency: listing.price.currency },
      listingVersion: listing.version,
      status: "active",
      expiresAt: new Date(Date.parse(operation.now) + GAME_BALANCE.antiAbuse.purchaseIdempotencyTtlMs).toISOString(),
      createdAt: operation.now
    };
    await this.repository.saveCheckout(checkout);
    await this.scheduler.schedule({
      taskType: "shop.checkout.expire", payload: { checkoutId: checkout.id }, runAt: checkout.expiresAt,
      idempotencyKey: `shop.checkout.expire:${checkout.id}`
    }, operation);
    return checkout;
  }

  async confirmPurchase(
    actor: TelegramIdentity,
    input: ConfirmPurchaseInput,
    operation: OperationContext
  ): Promise<PurchaseReceipt> {
    const duplicate = await this.repository.findOrderByIdempotency(actor.id, input.idempotencyKey);
    if (duplicate) {
      if (duplicate.type !== "purchase") throw new DomainError("Idempotency key уже использован другой операцией", "SHOP_IDEMPOTENCY_CONFLICT");
      return this.receiptFromOrder(duplicate, true);
    }
    const checkout = await this.getCheckoutForActor(actor.id, input.checkoutId, operation.now);
    if (checkout.type !== "purchase" || !checkout.listingId) throw new DomainError("Checkout не является покупкой", "SHOP_CHECKOUT_TYPE_INVALID");
    if (checkout.status === "consumed" && checkout.consumedOrderId) {
      const order = await this.repository.findOrder(checkout.consumedOrderId);
      if (order) return this.receiptFromOrder(order, true);
    }
    this.assertCheckoutActive(checkout, operation.now);

    const player = await this.getActivePlayer(actor.id);
    await this.assertOwnerAccess(player, checkout.owner);
    await this.assertAccountAccess(player, input.paymentAccount);
    const product = this.catalog.getProduct(checkout.productId);
    const listing = this.catalog.getListing(checkout.listingId);
    if (listing.version !== checkout.listingVersion || listing.price.amount !== checkout.unitPrice.amount || listing.price.currency !== checkout.unitPrice.currency) {
      throw new DomainError("Цена товара изменилась. Создайте новое подтверждение", "SHOP_PRICE_CHANGED");
    }
    await this.assertListingAvailable(listing.id, checkout.quantity, operation.now);
    const family = player.familyId ? await this.families.findById(player.familyId) : undefined;
    await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, product.requirements);
    await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, listing.purchaseRequirements);
    await this.assertPerPlayerLimit(actor.id, product.id, checkout.quantity, listing.perPlayerLimit);

    const orderId = createId("order");
    const economyResult = await this.economy.debit({
      account: input.paymentAccount,
      amount: checkout.totalPrice,
      reason: `purchase:${product.id}`,
      referenceType: "shop_order",
      referenceId: orderId,
      idempotencyKey: `shop:${actor.id}:${input.idempotencyKey}`
    }, { ...operation, actor: { kind: "player", id: actor.id } });
    const inventoryResult = await this.inventory.grant({
      owner: checkout.owner,
      productId: product.id,
      quantity: checkout.quantity,
      acquiredBy: "purchase",
      sourceId: orderId
    }, { ...operation, actor: { kind: "player", id: actor.id } });
    await this.consumeStock(listing.id, checkout.quantity, operation.now);

    const order: ShopOrder = {
      id: orderId,
      type: "purchase",
      actorId: actor.id,
      owner: checkout.owner,
      productId: product.id,
      listingId: listing.id,
      inventoryEntryIds: inventoryResult.inventoryEntryIds,
      quantity: checkout.quantity,
      unitPrice: checkout.unitPrice,
      totalPrice: checkout.totalPrice,
      account: input.paymentAccount,
      status: "completed",
      idempotencyKey: input.idempotencyKey,
      correlationId: operation.correlationId,
      createdAt: checkout.createdAt,
      completedAt: operation.now
    };
    await this.repository.saveOrder(order);
    checkout.status = "consumed";
    checkout.consumedOrderId = order.id;
    await this.repository.saveCheckout(checkout);
    this.publishOrderCompleted(order, operation);
    return { order, accountBalance: economyResult.balanceAfter.amount, replayed: false };
  }

  async createSaleQuote(
    actor: TelegramIdentity,
    input: CreateSaleQuoteInput,
    operation: OperationContext
  ): Promise<CheckoutSession> {
    const player = await this.getActivePlayer(actor.id);
    await this.assertOwnerAccess(player, input.owner);
    const entry = await this.inventory.getEntry(input.owner, input.inventoryEntryId);
    const product = this.catalog.getProduct(entry.itemId);
    const listing = this.catalog.resolveActiveListing(product.id, operation.now);
    if (!listing.salePolicy?.enabled) throw new DomainError("Этот объект нельзя продать", "INVENTORY_NOT_SELLABLE");
    const quantity = normalizeQuantity(input.quantity, 1, entry.quantity);
    const unitPrice = entry.currentValue ?? listing.salePolicy.fixedUnitPrice?.amount ?? product.valuation.defaultResaleValue?.amount ?? 0;
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) throw new DomainError("Для объекта не определена цена продажи", "INVENTORY_NOT_SELLABLE");
    const checkout: CheckoutSession = {
      id: createId("checkout"),
      type: "sale",
      actorId: actor.id,
      owner: input.owner,
      productId: product.id,
      inventoryEntryId: entry.instanceId,
      quantity,
      unitPrice: { amount: unitPrice, currency: listing.price.currency },
      totalPrice: { amount: safeMultiply(unitPrice, quantity), currency: listing.price.currency },
      status: "active",
      expiresAt: new Date(Date.parse(operation.now) + GAME_BALANCE.antiAbuse.purchaseIdempotencyTtlMs).toISOString(),
      createdAt: operation.now
    };
    await this.repository.saveCheckout(checkout);
    await this.scheduler.schedule({
      taskType: "shop.checkout.expire", payload: { checkoutId: checkout.id }, runAt: checkout.expiresAt,
      idempotencyKey: `shop.checkout.expire:${checkout.id}`
    }, operation);
    return checkout;
  }

  async confirmSale(
    actor: TelegramIdentity,
    input: ConfirmSaleInput,
    operation: OperationContext
  ): Promise<SaleReceipt> {
    const duplicate = await this.repository.findOrderByIdempotency(actor.id, input.idempotencyKey);
    if (duplicate) {
      if (duplicate.type !== "sale") throw new DomainError("Idempotency key уже использован другой операцией", "SHOP_IDEMPOTENCY_CONFLICT");
      return this.receiptFromOrder(duplicate, true);
    }
    const checkout = await this.getCheckoutForActor(actor.id, input.checkoutId, operation.now);
    if (checkout.type !== "sale" || !checkout.inventoryEntryId) throw new DomainError("Checkout не является продажей", "SHOP_CHECKOUT_TYPE_INVALID");
    if (checkout.status === "consumed" && checkout.consumedOrderId) {
      const order = await this.repository.findOrder(checkout.consumedOrderId);
      if (order) return this.receiptFromOrder(order, true);
    }
    this.assertCheckoutActive(checkout, operation.now);

    const player = await this.getActivePlayer(actor.id);
    await this.assertOwnerAccess(player, checkout.owner);
    await this.assertAccountAccess(player, input.targetAccount);
    const entry = await this.inventory.getEntry(checkout.owner, checkout.inventoryEntryId);
    if (entry.itemId !== checkout.productId || entry.quantity < checkout.quantity) {
      throw new DomainError("Состав инвентаря изменился. Создайте новое предложение", "INVENTORY_QUANTITY_INVALID");
    }

    const orderId = createId("order");
    const inventoryResult = await this.inventory.remove({
      owner: checkout.owner,
      inventoryEntryId: checkout.inventoryEntryId,
      quantity: checkout.quantity,
      reason: `shop_sale:${orderId}`
    }, { ...operation, actor: { kind: "player", id: actor.id } });
    const economyResult = await this.economy.credit({
      account: input.targetAccount,
      amount: checkout.totalPrice,
      reason: `sale:${checkout.productId}`,
      referenceType: "shop_order",
      referenceId: orderId,
      idempotencyKey: `shop:${actor.id}:${input.idempotencyKey}`
    }, operation);
    const order: ShopOrder = {
      id: orderId,
      type: "sale",
      actorId: actor.id,
      owner: checkout.owner,
      productId: checkout.productId,
      inventoryEntryIds: inventoryResult.inventoryEntryIds,
      quantity: checkout.quantity,
      unitPrice: checkout.unitPrice,
      totalPrice: checkout.totalPrice,
      account: input.targetAccount,
      status: "completed",
      idempotencyKey: input.idempotencyKey,
      correlationId: operation.correlationId,
      createdAt: checkout.createdAt,
      completedAt: operation.now
    };
    await this.repository.saveOrder(order);
    checkout.status = "consumed";
    checkout.consumedOrderId = order.id;
    await this.repository.saveCheckout(checkout);
    this.publishOrderCompleted(order, operation);
    return { order, accountBalance: economyResult.balanceAfter.amount, replayed: false };
  }

  async cancelCheckout(actorId: number, checkoutId: string, operation: OperationContext): Promise<CheckoutSession> {
    const checkout = await this.getCheckoutForActor(actorId, checkoutId, operation.now);
    if (checkout.status === "consumed") throw new DomainError("Завершённую операцию нельзя отменить", "SHOP_QUOTE_CONSUMED");
    if (checkout.status === "expired") throw new DomainError("Время подтверждения истекло", "SHOP_QUOTE_EXPIRED");
    if (checkout.status === "active") checkout.status = "cancelled";
    await this.repository.saveCheckout(checkout);
    return checkout;
  }

  async getOrder(actorId: number, orderId: string): Promise<ShopOrder> {
    const order = await this.repository.findOrder(orderId);
    if (!order || order.actorId !== actorId) throw new DomainError("Операция магазина не найдена", "SHOP_ORDER_NOT_FOUND");
    return order;
  }

  async listOrders(actorId: number, query: PageRequest): Promise<Page<ShopOrder>> {
    const limit = normalizeQuantity(query.limit, 1, 25);
    const offset = parseCursor(query.cursor);
    const orders = await this.repository.listOrders(actorId, offset, limit + 1);
    const items = orders.slice(0, limit);
    const hasMore = orders.length > limit;
    const nextOffset = offset + items.length;
    return { items, nextCursor: hasMore ? String(nextOffset) : undefined, hasMore };
  }

  async expireCheckout(checkoutId: string, now: string): Promise<CheckoutSession | undefined> {
    const checkout = await this.repository.findCheckout(checkoutId);
    if (checkout?.status === "active" && checkout.expiresAt <= now) {
      checkout.status = "expired";
      await this.repository.saveCheckout(checkout);
    }
    return checkout;
  }

  private async getActivePlayer(actorId: number): Promise<PlayerProfile> {
    const player = await this.players.findById(actorId);
    if (!player) throw new DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
    if (player.settings.blocked) throw new DomainError("Игрок заблокирован", "PLAYER_BLOCKED");
    return player;
  }

  private async getCheckoutForActor(actorId: number, checkoutId: string, now: string): Promise<CheckoutSession> {
    const checkout = await this.repository.findCheckout(checkoutId);
    if (!checkout) throw new DomainError("Подтверждение магазина не найдено", "SHOP_CHECKOUT_NOT_FOUND");
    if (checkout.actorId !== actorId) throw new DomainError("Подтверждение принадлежит другому игроку", "SHOP_CALLBACK_FORBIDDEN");
    if (checkout.status === "active" && Date.parse(checkout.expiresAt) < Date.parse(now)) {
      checkout.status = "expired";
      await this.repository.saveCheckout(checkout);
    }
    return checkout;
  }

  private assertCheckoutActive(checkout: CheckoutSession, now: string): void {
    if (Date.parse(checkout.expiresAt) < Date.parse(now) || checkout.status === "expired") throw new DomainError("Время подтверждения истекло", "SHOP_QUOTE_EXPIRED");
    if (checkout.status !== "active") throw new DomainError("Подтверждение уже использовано или отменено", "SHOP_QUOTE_CONSUMED");
  }

  private async assertOwnerAccess(player: PlayerProfile, owner: OwnerRef): Promise<void> {
    try {
      await this.ownership.assertOwnerAccess(owner, { kind: "player", id: player.id }, "manage", player.updatedAt);
    } catch (error) {
      if (error instanceof DomainError) throw new DomainError("Нельзя управлять имуществом выбранного владельца", "SHOP_OWNER_FORBIDDEN");
      throw error;
    }
  }

  private async assertAccountAccess(player: PlayerProfile, account: AccountRef): Promise<void> {
    if (account.kind !== "family_capital" && account.playerId === player.id) return;
    if (account.kind === "family_capital" && player.familyId === account.familyId && await this.families.findById(account.familyId)) return;
    throw new DomainError("Нельзя использовать выбранный счёт", "ECONOMY_ACCOUNT_FORBIDDEN");
  }

  private async assertListingAvailable(listingId: string, quantity: number, now: string): Promise<void> {
    const listing = this.catalog.getListing(listingId);
    const at = Date.parse(now);
    if (
      listing.status !== "active" ||
      (listing.availableFrom && Date.parse(listing.availableFrom) > at) ||
      (listing.availableUntil && Date.parse(listing.availableUntil) < at)
    ) {
      throw new DomainError("Предложение магазина неактивно", "SHOP_LISTING_INACTIVE");
    }
    if (listing.stockMode === "unlimited") return;
    const runtime = await this.repository.findListingRuntime(listing.id);
    const remaining = runtime?.stockRemaining ?? listing.stockRemaining ?? 0;
    if (remaining < quantity) throw new DomainError("Товар закончился", "SHOP_STOCK_EXHAUSTED");
  }

  private async consumeStock(listingId: string, quantity: number, now: string): Promise<void> {
    const listing = this.catalog.getListing(listingId);
    if (listing.stockMode === "unlimited") return;
    const runtime = await this.repository.findListingRuntime(listing.id) ?? {
      version: listing.version,
      stockRemaining: listing.stockRemaining ?? 0,
      updatedAt: now
    };
    const remaining = runtime.stockRemaining ?? 0;
    if (remaining < quantity) throw new DomainError("Товар закончился", "SHOP_STOCK_EXHAUSTED");
    runtime.stockRemaining = remaining - quantity;
    runtime.updatedAt = now;
    await this.repository.saveListingRuntime(listing.id, runtime);
  }

  private async assertPerPlayerLimit(actorId: number, productId: string, quantity: number, limit?: number): Promise<void> {
    if (!limit) return;
    const purchased = await this.repository.countPurchasedQuantity(actorId, productId);
    if (purchased + quantity > limit) throw new DomainError("Достигнут лимит покупок этого товара", "SHOP_PLAYER_LIMIT_EXCEEDED");
  }

  private async receiptFromOrder(order: ShopOrder, replayed: boolean): Promise<PurchaseReceipt> {
    return { order, accountBalance: (await this.economy.getBalance(order.account)).amount, replayed };
  }

  private publishOrderCompleted(order: ShopOrder, operation: OperationContext): void {
    this.events.collect({
      eventType: "shop.order.completed",
      aggregateType: "shop_order",
      aggregateId: order.id,
      aggregateVersion: 1,
      payload: { order },
    }, operation);
  }
}

const safeMultiply = (left: number, right: number): number => {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result <= 0) throw new DomainError("Сумма операции выходит за допустимый диапазон", "ECONOMY_AMOUNT_INVALID");
  return result;
};

function normalizeQuantity(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DomainError(`Количество должно быть от ${minimum} до ${maximum}`, "INVENTORY_QUANTITY_INVALID");
  }
  return value;
}

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainError("Некорректный курсор операций", "SHOP_CURSOR_INVALID");
  return value;
}
