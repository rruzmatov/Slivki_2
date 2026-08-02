"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShopService = void 0;
const game_balance_1 = require("../config/game-balance");
const errors_1 = require("../domain/errors");
const ids_1 = require("../utils/ids");
class ShopService {
    catalog;
    inventory;
    economy;
    requirements;
    repository;
    ownership;
    players;
    families;
    events;
    scheduler;
    constructor(catalog, inventory, economy, requirements, repository, ownership, players, families, events, scheduler) {
        this.catalog = catalog;
        this.inventory = inventory;
        this.economy = economy;
        this.requirements = requirements;
        this.repository = repository;
        this.ownership = ownership;
        this.players = players;
        this.families = families;
        this.events = events;
        this.scheduler = scheduler;
    }
    async createPurchaseQuote(actor, input, operation) {
        const player = await this.getActivePlayer(actor.id);
        await this.assertOwnerAccess(player, input.owner);
        const product = this.catalog.getProduct(input.productId);
        const listing = input.listingId ? this.catalog.getListing(input.listingId) : this.catalog.resolveActiveListing(product.id, operation.now);
        if (listing.productId !== product.id)
            throw new errors_1.DomainError("Предложение не относится к выбранному товару", "SHOP_LISTING_PRODUCT_MISMATCH");
        const quantity = normalizeQuantity(input.quantity, listing.minQuantity, listing.maxQuantity);
        await this.assertListingAvailable(listing.id, quantity, operation.now);
        const family = player.familyId ? await this.families.findById(player.familyId) : undefined;
        await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, product.requirements);
        await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, listing.purchaseRequirements);
        await this.assertPerPlayerLimit(actor.id, product.id, quantity, listing.perPlayerLimit);
        const total = safeMultiply(listing.price.amount, quantity);
        const checkout = {
            id: (0, ids_1.createId)("checkout"),
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
            expiresAt: new Date(Date.parse(operation.now) + game_balance_1.GAME_BALANCE.antiAbuse.purchaseIdempotencyTtlMs).toISOString(),
            createdAt: operation.now
        };
        await this.repository.saveCheckout(checkout);
        await this.scheduler.schedule({
            taskType: "shop.checkout.expire", payload: { checkoutId: checkout.id }, runAt: checkout.expiresAt,
            idempotencyKey: `shop.checkout.expire:${checkout.id}`
        }, operation);
        return checkout;
    }
    async confirmPurchase(actor, input, operation) {
        const duplicate = await this.repository.findOrderByIdempotency(actor.id, input.idempotencyKey);
        if (duplicate) {
            if (duplicate.type !== "purchase")
                throw new errors_1.DomainError("Idempotency key уже использован другой операцией", "SHOP_IDEMPOTENCY_CONFLICT");
            return this.receiptFromOrder(duplicate, true);
        }
        const checkout = await this.getCheckoutForActor(actor.id, input.checkoutId, operation.now);
        if (checkout.type !== "purchase" || !checkout.listingId)
            throw new errors_1.DomainError("Checkout не является покупкой", "SHOP_CHECKOUT_TYPE_INVALID");
        if (checkout.status === "consumed" && checkout.consumedOrderId) {
            const order = await this.repository.findOrder(checkout.consumedOrderId);
            if (order)
                return this.receiptFromOrder(order, true);
        }
        this.assertCheckoutActive(checkout, operation.now);
        const player = await this.getActivePlayer(actor.id);
        await this.assertOwnerAccess(player, checkout.owner);
        await this.assertAccountAccess(player, input.paymentAccount);
        const product = this.catalog.getProduct(checkout.productId);
        const listing = this.catalog.getListing(checkout.listingId);
        if (listing.version !== checkout.listingVersion || listing.price.amount !== checkout.unitPrice.amount || listing.price.currency !== checkout.unitPrice.currency) {
            throw new errors_1.DomainError("Цена товара изменилась. Создайте новое подтверждение", "SHOP_PRICE_CHANGED");
        }
        await this.assertListingAvailable(listing.id, checkout.quantity, operation.now);
        const family = player.familyId ? await this.families.findById(player.familyId) : undefined;
        await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, product.requirements);
        await this.requirements.assert({ player, family, owner: { kind: "player", id: player.id } }, listing.purchaseRequirements);
        await this.assertPerPlayerLimit(actor.id, product.id, checkout.quantity, listing.perPlayerLimit);
        const orderId = (0, ids_1.createId)("order");
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
        const order = {
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
    async createSaleQuote(actor, input, operation) {
        const player = await this.getActivePlayer(actor.id);
        await this.assertOwnerAccess(player, input.owner);
        const entry = await this.inventory.getEntry(input.owner, input.inventoryEntryId);
        const product = this.catalog.getProduct(entry.itemId);
        const listing = this.catalog.resolveActiveListing(product.id, operation.now);
        if (!listing.salePolicy?.enabled)
            throw new errors_1.DomainError("Этот объект нельзя продать", "INVENTORY_NOT_SELLABLE");
        const quantity = normalizeQuantity(input.quantity, 1, entry.quantity);
        const unitPrice = entry.currentValue ?? listing.salePolicy.fixedUnitPrice?.amount ?? product.valuation.defaultResaleValue?.amount ?? 0;
        if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0)
            throw new errors_1.DomainError("Для объекта не определена цена продажи", "INVENTORY_NOT_SELLABLE");
        const checkout = {
            id: (0, ids_1.createId)("checkout"),
            type: "sale",
            actorId: actor.id,
            owner: input.owner,
            productId: product.id,
            inventoryEntryId: entry.instanceId,
            quantity,
            unitPrice: { amount: unitPrice, currency: listing.price.currency },
            totalPrice: { amount: safeMultiply(unitPrice, quantity), currency: listing.price.currency },
            status: "active",
            expiresAt: new Date(Date.parse(operation.now) + game_balance_1.GAME_BALANCE.antiAbuse.purchaseIdempotencyTtlMs).toISOString(),
            createdAt: operation.now
        };
        await this.repository.saveCheckout(checkout);
        await this.scheduler.schedule({
            taskType: "shop.checkout.expire", payload: { checkoutId: checkout.id }, runAt: checkout.expiresAt,
            idempotencyKey: `shop.checkout.expire:${checkout.id}`
        }, operation);
        return checkout;
    }
    async confirmSale(actor, input, operation) {
        const duplicate = await this.repository.findOrderByIdempotency(actor.id, input.idempotencyKey);
        if (duplicate) {
            if (duplicate.type !== "sale")
                throw new errors_1.DomainError("Idempotency key уже использован другой операцией", "SHOP_IDEMPOTENCY_CONFLICT");
            return this.receiptFromOrder(duplicate, true);
        }
        const checkout = await this.getCheckoutForActor(actor.id, input.checkoutId, operation.now);
        if (checkout.type !== "sale" || !checkout.inventoryEntryId)
            throw new errors_1.DomainError("Checkout не является продажей", "SHOP_CHECKOUT_TYPE_INVALID");
        if (checkout.status === "consumed" && checkout.consumedOrderId) {
            const order = await this.repository.findOrder(checkout.consumedOrderId);
            if (order)
                return this.receiptFromOrder(order, true);
        }
        this.assertCheckoutActive(checkout, operation.now);
        const player = await this.getActivePlayer(actor.id);
        await this.assertOwnerAccess(player, checkout.owner);
        await this.assertAccountAccess(player, input.targetAccount);
        const entry = await this.inventory.getEntry(checkout.owner, checkout.inventoryEntryId);
        if (entry.itemId !== checkout.productId || entry.quantity < checkout.quantity) {
            throw new errors_1.DomainError("Состав инвентаря изменился. Создайте новое предложение", "INVENTORY_QUANTITY_INVALID");
        }
        const orderId = (0, ids_1.createId)("order");
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
        const order = {
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
    async cancelCheckout(actorId, checkoutId, operation) {
        const checkout = await this.getCheckoutForActor(actorId, checkoutId, operation.now);
        if (checkout.status === "consumed")
            throw new errors_1.DomainError("Завершённую операцию нельзя отменить", "SHOP_QUOTE_CONSUMED");
        if (checkout.status === "expired")
            throw new errors_1.DomainError("Время подтверждения истекло", "SHOP_QUOTE_EXPIRED");
        if (checkout.status === "active")
            checkout.status = "cancelled";
        await this.repository.saveCheckout(checkout);
        return checkout;
    }
    async getOrder(actorId, orderId) {
        const order = await this.repository.findOrder(orderId);
        if (!order || order.actorId !== actorId)
            throw new errors_1.DomainError("Операция магазина не найдена", "SHOP_ORDER_NOT_FOUND");
        return order;
    }
    async listOrders(actorId, query) {
        const limit = normalizeQuantity(query.limit, 1, 25);
        const offset = parseCursor(query.cursor);
        const orders = await this.repository.listOrders(actorId, offset, limit + 1);
        const items = orders.slice(0, limit);
        const hasMore = orders.length > limit;
        const nextOffset = offset + items.length;
        return { items, nextCursor: hasMore ? String(nextOffset) : undefined, hasMore };
    }
    async expireCheckout(checkoutId, now) {
        const checkout = await this.repository.findCheckout(checkoutId);
        if (checkout?.status === "active" && checkout.expiresAt <= now) {
            checkout.status = "expired";
            await this.repository.saveCheckout(checkout);
        }
        return checkout;
    }
    async getActivePlayer(actorId) {
        const player = await this.players.findById(actorId);
        if (!player)
            throw new errors_1.DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
        if (player.settings.blocked)
            throw new errors_1.DomainError("Игрок заблокирован", "PLAYER_BLOCKED");
        return player;
    }
    async getCheckoutForActor(actorId, checkoutId, now) {
        const checkout = await this.repository.findCheckout(checkoutId);
        if (!checkout)
            throw new errors_1.DomainError("Подтверждение магазина не найдено", "SHOP_CHECKOUT_NOT_FOUND");
        if (checkout.actorId !== actorId)
            throw new errors_1.DomainError("Подтверждение принадлежит другому игроку", "SHOP_CALLBACK_FORBIDDEN");
        if (checkout.status === "active" && Date.parse(checkout.expiresAt) < Date.parse(now)) {
            checkout.status = "expired";
            await this.repository.saveCheckout(checkout);
        }
        return checkout;
    }
    assertCheckoutActive(checkout, now) {
        if (Date.parse(checkout.expiresAt) < Date.parse(now) || checkout.status === "expired")
            throw new errors_1.DomainError("Время подтверждения истекло", "SHOP_QUOTE_EXPIRED");
        if (checkout.status !== "active")
            throw new errors_1.DomainError("Подтверждение уже использовано или отменено", "SHOP_QUOTE_CONSUMED");
    }
    async assertOwnerAccess(player, owner) {
        try {
            await this.ownership.assertOwnerAccess(owner, { kind: "player", id: player.id }, "manage", player.updatedAt);
        }
        catch (error) {
            if (error instanceof errors_1.DomainError)
                throw new errors_1.DomainError("Нельзя управлять имуществом выбранного владельца", "SHOP_OWNER_FORBIDDEN");
            throw error;
        }
    }
    async assertAccountAccess(player, account) {
        if (account.kind !== "family_capital" && account.playerId === player.id)
            return;
        if (account.kind === "family_capital" && player.familyId === account.familyId && await this.families.findById(account.familyId))
            return;
        throw new errors_1.DomainError("Нельзя использовать выбранный счёт", "ECONOMY_ACCOUNT_FORBIDDEN");
    }
    async assertListingAvailable(listingId, quantity, now) {
        const listing = this.catalog.getListing(listingId);
        const at = Date.parse(now);
        if (listing.status !== "active" ||
            (listing.availableFrom && Date.parse(listing.availableFrom) > at) ||
            (listing.availableUntil && Date.parse(listing.availableUntil) < at)) {
            throw new errors_1.DomainError("Предложение магазина неактивно", "SHOP_LISTING_INACTIVE");
        }
        if (listing.stockMode === "unlimited")
            return;
        const runtime = await this.repository.findListingRuntime(listing.id);
        const remaining = runtime?.stockRemaining ?? listing.stockRemaining ?? 0;
        if (remaining < quantity)
            throw new errors_1.DomainError("Товар закончился", "SHOP_STOCK_EXHAUSTED");
    }
    async consumeStock(listingId, quantity, now) {
        const listing = this.catalog.getListing(listingId);
        if (listing.stockMode === "unlimited")
            return;
        const runtime = await this.repository.findListingRuntime(listing.id) ?? {
            version: listing.version,
            stockRemaining: listing.stockRemaining ?? 0,
            updatedAt: now
        };
        const remaining = runtime.stockRemaining ?? 0;
        if (remaining < quantity)
            throw new errors_1.DomainError("Товар закончился", "SHOP_STOCK_EXHAUSTED");
        runtime.stockRemaining = remaining - quantity;
        runtime.updatedAt = now;
        await this.repository.saveListingRuntime(listing.id, runtime);
    }
    async assertPerPlayerLimit(actorId, productId, quantity, limit) {
        if (!limit)
            return;
        const purchased = await this.repository.countPurchasedQuantity(actorId, productId);
        if (purchased + quantity > limit)
            throw new errors_1.DomainError("Достигнут лимит покупок этого товара", "SHOP_PLAYER_LIMIT_EXCEEDED");
    }
    async receiptFromOrder(order, replayed) {
        return { order, accountBalance: (await this.economy.getBalance(order.account)).amount, replayed };
    }
    publishOrderCompleted(order, operation) {
        this.events.collect({
            eventType: "shop.order.completed",
            aggregateType: "shop_order",
            aggregateId: order.id,
            aggregateVersion: 1,
            payload: { order },
        }, operation);
    }
}
exports.ShopService = ShopService;
const safeMultiply = (left, right) => {
    const result = left * right;
    if (!Number.isSafeInteger(result) || result <= 0)
        throw new errors_1.DomainError("Сумма операции выходит за допустимый диапазон", "ECONOMY_AMOUNT_INVALID");
    return result;
};
function normalizeQuantity(value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new errors_1.DomainError(`Количество должно быть от ${minimum} до ${maximum}`, "INVENTORY_QUANTITY_INVALID");
    }
    return value;
}
function parseCursor(cursor) {
    if (!cursor)
        return 0;
    const value = Number(cursor);
    if (!Number.isSafeInteger(value) || value < 0)
        throw new errors_1.DomainError("Некорректный курсор операций", "SHOP_CURSOR_INVALID");
    return value;
}
