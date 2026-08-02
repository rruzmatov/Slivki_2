import { achievements, jobs, travelLocations } from "../data/catalog";
import { legacyRequirementsToExpression } from "../data/asset-catalog";
import type {
  AssetCondition,
  CatalogItem,
  Family,
  InventoryActionSession,
  InventoryEntry,
  PlayerProfile,
  Requirement,
  TelegramUserId
} from "../domain/types";
import type { AccountRef, AssetCategory, AssetType, OperationContext, OwnerRef } from "../domain/assets";
import type { CheckoutSession, ShopOrder } from "../domain/shop";
import type { DomainEvent } from "../domain/events";
import { GAME_BALANCE } from "../config/game-balance";
import { createId } from "../utils/ids";
import type { CatalogService } from "./catalog-service";
import type { TelegramIdentity } from "./player-service";
import type { UnitOfWorkManager, TransactionScope } from "./ports/unit-of-work";
import type { GameTransactionContext, TransactionServiceScopeFactory } from "./transaction-services";

export class GameServices {
  constructor(
    private readonly unitOfWork: UnitOfWorkManager,
    private readonly serviceScopes: TransactionServiceScopeFactory,
    private readonly catalog: CatalogService
  ) {}

  async ensurePlayer(identity: TelegramIdentity, now: string): Promise<PlayerProfile> {
    return this.execute((context) => this.ensurePlayerInContext(context, identity, now));
  }

  async recordCommand(): Promise<void> {
    await this.execute(async (context) => {
      const stats = await context.stats.get();
      stats.commandsHandled += 1;
      await context.stats.save(stats);
    });
  }

  async getStats() {
    return this.execute((context) => context.stats.get());
  }

  async buyItem(identity: TelegramIdentity, itemId: string, now: string, requestId = createId("purchase")): Promise<CatalogItem> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const operation = this.operation(now, requestId);
      const checkout = await context.shopService.createPurchaseQuote(identity, {
        productId: itemId, quantity: 1, owner: { kind: "player", id: player.id }
      }, operation);
      await context.shopService.confirmPurchase(identity, {
        checkoutId: checkout.id,
        paymentAccount: { kind: "player_cash", playerId: player.id },
        idempotencyKey: requestId
      }, operation);
      return this.getCatalogItem(itemId);
    });
  }

  async setJob(identity: TelegramIdentity, jobId: string, now: string): Promise<{ title: string }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("Работа не найдена");
      if (player.level < job.minLevel) throw new Error(`Работа доступна с ${job.minLevel} уровня`);
      await this.assertJobUnlocked(context, player, job.id);
      await this.assertRequirements(context, player, await this.getPlayerFamily(context, player), job.requirements);
      player.jobId = job.id;
      player.updatedAt = now;
      await context.players.save(player);
      return { title: job.title };
    });
  }

  async quitJob(identity: TelegramIdentity, now: string): Promise<void> {
    await this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      player.jobId = undefined;
      player.updatedAt = now;
      await context.players.save(player);
    });
  }

  async deposit(identity: TelegramIdentity, amount: number, now: string): Promise<{ balance: number; bankBalance: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const normalized = this.normalizeAmount(amount);
      const requestId = createId("bank_deposit");
      await context.economyService.transfer(
        { kind: "player_cash", playerId: player.id }, { kind: "player_bank", playerId: player.id },
        { amount: normalized, currency: "SUM" }, "bank:deposit", requestId, requestId, this.operation(now, requestId)
      );
      return this.playerBalances(context, player.id);
    });
  }

  async withdraw(identity: TelegramIdentity, amount: number, now: string): Promise<{ balance: number; bankBalance: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const normalized = this.normalizeAmount(amount);
      const requestId = createId("bank_withdraw");
      await context.economyService.transfer(
        { kind: "player_bank", playerId: player.id }, { kind: "player_cash", playerId: player.id },
        { amount: normalized, currency: "SUM" }, "bank:withdraw", requestId, requestId, this.operation(now, requestId)
      );
      return this.playerBalances(context, player.id);
    });
  }

  async transfer(identity: TelegramIdentity, targetId: TelegramUserId, amount: number, now: string): Promise<void> {
    await this.execute(async (context) => {
      const sender = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(sender);
      const receiver = await context.players.findById(targetId);
      if (!receiver) throw new Error("Получатель не найден в RPG state");
      const requestId = createId("player_transfer");
      await context.economyService.transfer(
        { kind: "player_cash", playerId: sender.id }, { kind: "player_cash", playerId: receiver.id },
        { amount: this.normalizeAmount(amount), currency: "SUM" }, `transfer:${targetId}`, requestId, requestId,
        { ...this.operation(now, requestId), actor: { kind: "player", id: sender.id } }
      );
    });
  }

  async work(identity: TelegramIdentity, jobId: string | undefined, now: string): Promise<{ title: string; payout: number; xp: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const selectedJobId = jobId ?? player.jobId;
      if (!selectedJobId) throw new Error("Сначала выберите профессию через /job job_courier");
      const job = jobs.find((candidate) => candidate.id === selectedJobId);
      if (!job) throw new Error("Работа не найдена");
      if (player.level < job.minLevel) throw new Error(`Работа доступна с ${job.minLevel} уровня`);
      await this.assertJobUnlocked(context, player, job.id);
      const family = await this.getPlayerFamily(context, player);
      await this.assertRequirements(context, player, family, job.requirements);
      if (player.energy < job.energyCost) throw new Error("Недостаточно энергии");
      const lastWorkedAt = player.lastWorkedAt ? Date.parse(player.lastWorkedAt) : 0;
      if (lastWorkedAt > 0 && Date.parse(now) - lastWorkedAt < job.cooldownSeconds * 1_000) throw new Error("Работа еще на перезарядке");
      player.energy -= job.energyCost;
      player.lastWorkedAt = now;
      await context.players.save(player);
      await context.economyService.creditPlayer(player, job.payout, `job:${job.id}`, now);
      await context.playerService.addXp(player, job.xp, now);
      if (family) {
        await context.economyService.increaseFamilyCapital(family, Math.floor(job.payout * 0.15), `job:${job.id}:family`, now);
        family.xp += Math.floor(job.xp * 0.2);
        family.stats.jobsCompleted += 1;
        family.stats.totalEarned += job.payout;
        this.recalculateFamilyLevel(family, now);
        await context.families.save(family);
      }
      await this.tryGrantAchievement(context, player, "ach_first_job", now);
      const stats = await context.stats.get();
      stats.jobsCompleted += 1;
      await context.stats.save(stats);
      return { title: job.title, payout: job.payout, xp: job.xp };
    });
  }

  async claimDailyReward(identity: TelegramIdentity, now: string): Promise<{ reward: number; xp: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const lastClaim = player.dailyRewardClaimedAt ? Date.parse(player.dailyRewardClaimedAt) : 0;
      const minDelayMs = GAME_BALANCE.antiAbuse.dailyRewardHours * 60 * 60 * 1_000;
      if (lastClaim > 0 && Date.parse(now) - lastClaim < minDelayMs) throw new Error("Ежедневная награда уже получена");
      player.dailyRewardClaimedAt = now;
      await context.players.save(player);
      await context.economyService.creditPlayer(player, GAME_BALANCE.economy.dailyReward, "daily_reward", now);
      await context.playerService.addXp(player, GAME_BALANCE.economy.dailyRewardXp, now);
      const stats = await context.stats.get();
      stats.dailyRewards += 1;
      await context.stats.save(stats);
      return { reward: GAME_BALANCE.economy.dailyReward, xp: GAME_BALANCE.economy.dailyRewardXp };
    });
  }

  async createProposal(proposer: TelegramIdentity, targetId: TelegramUserId, chatId: number, now: string): Promise<string> {
    return this.execute(async (context) => {
      const proposerPlayer = await this.ensurePlayerInContext(context, proposer, now);
      this.assertActive(proposerPlayer);
      if (proposerPlayer.id === targetId) throw new Error("Нельзя сделать предложение самому себе");
      if (proposerPlayer.familyId) throw new Error("Вы уже состоите в семье");
      const duplicate = (await context.proposals.list()).find((item) => item.proposerId === proposerPlayer.id && item.targetId === targetId);
      if (duplicate) throw new Error("Предложение уже отправлено");
      const id = createId("proposal");
      await context.proposals.save({
        id, proposerId: proposerPlayer.id, targetId, chatId, createdAt: now,
        expiresAt: new Date(Date.parse(now) + GAME_BALANCE.family.proposalTtlSeconds * 1_000).toISOString()
      });
      return id;
    });
  }

  async acceptProposal(target: TelegramIdentity, proposalId: string, now: string): Promise<Family> {
    return this.execute(async (context) => {
      const targetPlayer = await this.ensurePlayerInContext(context, target, now);
      const proposal = await context.proposals.findById(proposalId);
      if (!proposal || proposal.targetId !== targetPlayer.id || Date.parse(proposal.expiresAt) < Date.parse(now)) {
        throw new Error("Предложение не найдено или истекло");
      }
      const proposer = await context.players.findById(proposal.proposerId);
      if (!proposer) throw new Error("Автор предложения не найден");
      if (proposer.familyId || targetPlayer.familyId) throw new Error("Один из игроков уже состоит в семье");
      const family: Family = {
        id: createId("family"), partnerIds: [proposer.id, targetPlayer.id], love: GAME_BALANCE.family.startingLove,
        level: GAME_BALANCE.family.startingLevel, xp: 0, capital: proposer.balance + targetPlayer.balance,
        title: "Новая семья", inventory: [], achievements: [], travelIds: [],
        stats: { jobsCompleted: 0, purchases: 0, travels: 0, giftsSent: 0, totalEarned: 0, totalSpent: 0 },
        weddingDate: now, createdAt: now, updatedAt: now
      };
      proposer.familyId = family.id;
      targetPlayer.familyId = family.id;
      proposer.updatedAt = now;
      targetPlayer.updatedAt = now;
      await context.families.save(family);
      await context.players.save(proposer);
      await context.players.save(targetPlayer);
      await context.proposals.delete(proposalId);
      await this.tryGrantAchievement(context, proposer, "ach_family_created", now);
      await this.tryGrantAchievement(context, targetPlayer, "ach_family_created", now);
      const stats = await context.stats.get();
      stats.marriages += 1;
      await context.stats.save(stats);
      return family;
    });
  }

  async rejectProposal(target: TelegramIdentity, proposalId: string, now: string): Promise<void> {
    await this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, target, now);
      const proposal = await context.proposals.findById(proposalId);
      if (!proposal || proposal.targetId !== player.id) throw new Error("Предложение не найдено");
      await context.proposals.delete(proposalId);
    });
  }

  async divorce(identity: TelegramIdentity, now: string): Promise<void> {
    await this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const family = await this.getPlayerFamily(context, player);
      if (!family) throw new Error("Вы не состоите в семье");
      for (const partnerId of family.partnerIds) {
        const partner = await context.players.findById(partnerId);
        if (partner) { partner.familyId = undefined; partner.updatedAt = now; await context.players.save(partner); }
      }
      const owner: OwnerRef = { kind: "family", id: family.id };
      await context.inventoryService.clear(owner, `family_divorce:${player.id}`, this.operation(now));
      await context.unlockService.clearOwner(owner);
      await this.audit(context, "family:divorce", { familyId: family.id, actorId: player.id, partnerIds: family.partnerIds }, now);
      await context.families.delete(family.id);
    });
  }

  async travel(identity: TelegramIdentity, locationId: string, now: string): Promise<{ name: string; xp: number; love: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const family = await this.getPlayerFamily(context, player);
      if (!family) throw new Error("Путешествия доступны семье");
      const location = travelLocations.find((candidate) => candidate.id === locationId);
      if (!location) throw new Error("Локация не найдена");
      await this.assertRequirements(context, player, family, location.requirements);
      await context.economyService.debitPlayer(player, location.price, `travel:${location.id}`, now);
      await this.consumeTravelTickets(context, player, location.requirements, location.id, now);
      family.love += location.love;
      family.xp += location.xp;
      family.travelIds = [...new Set([...family.travelIds, location.id])];
      family.stats.travels += 1;
      family.stats.totalSpent += location.price;
      this.recalculateFamilyLevel(family, now);
      await context.families.save(family);
      await context.playerService.addXp(player, location.xp, now);
      await this.tryGrantAchievement(context, player, "ach_first_travel", now);
      const stats = await context.stats.get();
      stats.travels += 1;
      await context.stats.save(stats);
      return { name: location.name, xp: location.xp, love: location.love };
    });
  }

  async gift(identity: TelegramIdentity, itemId: string, now: string): Promise<CatalogItem> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const family = await this.getPlayerFamily(context, player);
      if (!family) throw new Error("Подарки доступны после свадьбы");
      const item = this.getCatalogItem(itemId);
      if (item.category !== "gift" && item.category !== "jewelry") throw new Error("Этот предмет нельзя подарить через команду подарка");
      await context.economyService.debitPlayer(player, item.price, `gift:${item.id}`, now);
      family.love += item.category === "jewelry" ? 18 : 5;
      family.stats.giftsSent += 1;
      family.stats.totalSpent += item.price;
      await this.addInventoryItem(context, { kind: "family", id: family.id }, item, now, "gift", `gift:${player.id}:${now}`, player.id);
      this.recalculateFamilyLevel(family, now);
      await context.families.save(family);
      await this.audit(context, "family:gift", { familyId: family.id, actorId: player.id, itemId: item.id }, now);
      return item;
    });
  }

  async sellItem(identity: TelegramIdentity, itemId: string, now: string, requestId = createId("sale")): Promise<{ item: CatalogItem; payout: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const item = this.getCatalogItem(itemId);
      const owner: OwnerRef = { kind: "player", id: player.id };
      const entry = await context.inventoryService.findFirstByProduct(owner, itemId);
      if (!entry) throw new Error("Предмета нет в инвентаре");
      const operation = this.operation(now, requestId);
      const checkout = await context.shopService.createSaleQuote(identity, { owner, inventoryEntryId: entry.instanceId, quantity: 1 }, operation);
      const receipt = await context.shopService.confirmSale(identity, {
        checkoutId: checkout.id, targetAccount: { kind: "player_cash", playerId: player.id }, idempotencyKey: requestId
      }, operation);
      return { item, payout: receipt.order.totalPrice.amount };
    });
  }

  async createPurchaseQuote(identity: TelegramIdentity, itemId: string, now: string): Promise<{ item: CatalogItem; checkout: CheckoutSession }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const checkout = await context.shopService.createPurchaseQuote(identity, {
        productId: itemId, quantity: 1, owner: { kind: "player", id: player.id }
      }, this.operation(now));
      return { item: this.getCatalogItem(itemId), checkout };
    });
  }

  async confirmPurchase(identity: TelegramIdentity, checkoutId: string, paymentSource: "cash" | "bank", idempotencyKey: string, now: string): Promise<{ item: CatalogItem; order: ShopOrder; balance: number; replayed: boolean }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const account: AccountRef = paymentSource === "cash"
        ? { kind: "player_cash", playerId: player.id }
        : { kind: "player_bank", playerId: player.id };
      const receipt = await context.shopService.confirmPurchase(identity, { checkoutId, paymentAccount: account, idempotencyKey }, this.operation(now, idempotencyKey));
      return { item: this.getCatalogItem(receipt.order.productId), order: receipt.order, balance: receipt.accountBalance, replayed: receipt.replayed };
    });
  }

  async createSaleQuote(identity: TelegramIdentity, itemId: string, now: string): Promise<{ item: CatalogItem; checkout: CheckoutSession }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const owner: OwnerRef = { kind: "player", id: player.id };
      const entry = await context.inventoryService.findFirstByProduct(owner, itemId);
      if (!entry) throw new Error("Предмета нет в инвентаре");
      const checkout = await context.shopService.createSaleQuote(identity, { owner, inventoryEntryId: entry.instanceId, quantity: 1 }, this.operation(now));
      return { item: this.getCatalogItem(itemId), checkout };
    });
  }

  async confirmSale(identity: TelegramIdentity, checkoutId: string, idempotencyKey: string, now: string): Promise<{ item: CatalogItem; order: ShopOrder; balance: number; replayed: boolean }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const receipt = await context.shopService.confirmSale(identity, {
        checkoutId, targetAccount: { kind: "player_cash", playerId: player.id }, idempotencyKey
      }, this.operation(now, idempotencyKey));
      return { item: this.getCatalogItem(receipt.order.productId), order: receipt.order, balance: receipt.accountBalance, replayed: receipt.replayed };
    });
  }

  async cancelShopCheckout(identity: TelegramIdentity, checkoutId: string, now: string): Promise<void> {
    await this.execute(async (context) => {
      await this.ensurePlayerInContext(context, identity, now);
      await context.shopService.cancelCheckout(identity.id, checkoutId, this.operation(now));
    });
  }

  async listShopOrders(identity: TelegramIdentity, now: string, limit = 10): Promise<ShopOrder[]> {
    return this.execute(async (context) => {
      await this.ensurePlayerInContext(context, identity, now);
      return [...(await context.shopService.listOrders(identity.id, { limit })).items];
    });
  }

  async repairItem(identity: TelegramIdentity, itemId: string, now: string): Promise<{ item: CatalogItem; cost: number; condition: AssetCondition; value: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const item = this.getCatalogItem(itemId);
      const owner: OwnerRef = { kind: "player", id: player.id };
      const entry = await context.inventoryService.findFirstByProduct(owner, itemId);
      if (!entry) throw new Error("Предмета нет в инвентаре");
      if (item.transport?.canRepair === false) throw new Error("Этот предмет нельзя ремонтировать");
      context.inventoryService.ensureEntryState(entry);
      if ((entry.wearLevel ?? 0) <= 0 && entry.condition === "new") throw new Error("Ремонт не нужен");
      const cost = Math.max(1, Math.ceil((item.transport?.repairCost ?? repairFallback(item)) * ((entry.wearLevel ?? 0) / 100)));
      await context.economyService.debitPlayer(player, cost, `repair:${item.id}`, now);
      const repaired = await context.inventoryService.repair(owner, entry.instanceId, "new", 0, cost,
        { ...this.operation(now), actor: { kind: "player", id: player.id } },
        item.transport?.resalePrice ?? Math.floor(item.price * GAME_BALANCE.economy.resaleRate));
      await this.audit(context, "repair", { userId: player.id, itemId: item.id, cost }, now);
      return { item, cost, condition: repaired.condition ?? "new", value: repaired.currentValue ?? item.assetValue };
    });
  }

  async serviceItem(identity: TelegramIdentity, itemId: string, now: string): Promise<{ item: CatalogItem; cost: number; condition: AssetCondition; value: number }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      this.assertActive(player);
      const item = this.getCatalogItem(itemId);
      const owner: OwnerRef = { kind: "player", id: player.id };
      const entry = await context.inventoryService.findFirstByProduct(owner, itemId);
      if (!entry) throw new Error("Предмета нет в инвентаре");
      context.inventoryService.ensureEntryState(entry);
      const cost = item.transport?.maintenanceCost ?? 0;
      if (cost <= 0) throw new Error("Для этого предмета обслуживание не требуется");
      await context.economyService.debitPlayer(player, cost, `maintenance:${item.id}`, now);
      const wearAfter = Math.max(0, (entry.wearLevel ?? 0) - 10);
      const maintained = await context.inventoryService.maintain(owner, entry.instanceId, this.conditionFromWear(wearAfter), wearAfter, cost,
        this.valueFromWear(item, wearAfter), { ...this.operation(now), actor: { kind: "player", id: player.id } });
      await this.audit(context, "maintenance", { userId: player.id, itemId: item.id, cost }, now);
      return { item, cost, condition: maintained.condition ?? "new", value: maintained.currentValue ?? item.assetValue };
    });
  }

  async getPlayerProfile(identity: TelegramIdentity, now: string): Promise<{ player: PlayerProfile; family?: Family }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      return { player, family: await this.getPlayerFamily(context, player) };
    });
  }

  async getInventory(identity: TelegramIdentity, now: string): Promise<Array<{ item: CatalogItem; quantity: number; entry: InventoryEntry }>> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      return (await context.inventoryService.listAll({ kind: "player", id: player.id })).map((entry) => ({
        item: this.getCatalogItem(entry.itemId), quantity: entry.quantity, entry
      }));
    });
  }

  async getInventoryEntry(identity: TelegramIdentity, inventoryEntryId: string, now: string): Promise<{ item: CatalogItem; entry: InventoryEntry }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const entry = await context.inventoryService.getEntry({ kind: "player", id: player.id }, inventoryEntryId);
      return { item: this.getCatalogItem(entry.itemId), entry };
    });
  }

  async giftInventoryEntry(identity: TelegramIdentity, inventoryEntryId: string, targetPlayerId: TelegramUserId, now: string, requestId = createId("inventory_gift")): Promise<{ item: CatalogItem; entryId: string; targetPlayer: PlayerProfile }> {
    return this.execute((context) => this.giftInventoryEntryInContext(context, identity, inventoryEntryId, targetPlayerId, now, requestId));
  }

  async createInventoryGiftQuote(identity: TelegramIdentity, inventoryEntryId: string, targetPlayerId: TelegramUserId, now: string): Promise<{ item: CatalogItem; targetPlayer: PlayerProfile; session: InventoryActionSession }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const targetPlayer = await context.players.findById(targetPlayerId);
      if (!targetPlayer) throw new Error("Получатель должен сначала создать RPG-профиль");
      if (targetPlayer.id === player.id) throw new Error("Нельзя подарить объект самому себе");
      if (targetPlayer.settings.blocked) throw new Error("Получатель заблокирован");
      const entry = await context.inventoryService.getEntry({ kind: "player", id: player.id }, inventoryEntryId);
      if (!this.catalog.getProduct(entry.itemId).capabilities.includes("tradable")) throw new Error("Этот объект нельзя передать");
      const session = await context.inventoryService.createGiftActionSession({
        actorId: player.id,
        entryId: entry.instanceId,
        targetOwner: { kind: "player", id: targetPlayer.id },
        quantity: 1,
        expiresAt: new Date(Date.parse(now) + 10 * 60 * 1_000).toISOString()
      }, {
        requestId: createId("inventory_gift_quote"),
        correlationId: `inventory-gift:${player.id}:${targetPlayer.id}`,
        now,
        actor: { kind: "player", id: player.id }
      });
      return { item: this.getCatalogItem(entry.itemId), targetPlayer, session };
    });
  }

  async confirmInventoryGift(identity: TelegramIdentity, sessionId: string, requestId: string, now: string): Promise<{ item: CatalogItem; entryId: string; targetPlayer: PlayerProfile; replayed: boolean }> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const session = await context.inventoryService.getActionSession(sessionId, player.id);
      if (session.status === "completed" && session.completedEntryId) {
        const targetPlayer = await context.players.findById(Number(session.targetOwner.id));
        const entry = await context.inventoryService.getEntry(session.targetOwner, session.completedEntryId);
        if (!targetPlayer) throw new Error("Получатель не найден");
        return { item: this.getCatalogItem(entry.itemId), entryId: entry.instanceId, targetPlayer, replayed: true };
      }
      if (Date.parse(session.expiresAt) <= Date.parse(now)) {
        await context.inventoryService.expireActionSession(session.id, now);
        throw new Error("Время подтверждения подарка истекло");
      }
      if (session.status !== "active") throw new Error("Подтверждение подарка уже закрыто");
      const result = await this.giftInventoryEntryInContext(context, identity, session.entryId, Number(session.targetOwner.id), now, requestId);
      await context.inventoryService.completeActionSession(session.id, player.id, result.entryId);
      return { ...result, replayed: false };
    });
  }

  async cancelInventoryAction(identity: TelegramIdentity, sessionId: string, now: string): Promise<void> {
    await this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      await context.inventoryService.cancelActionSession(sessionId, player.id);
    });
  }

  async getInventoryHistory(identity: TelegramIdentity, now: string, limit = 10): Promise<readonly DomainEvent[]> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      return (await context.inventoryService.listHistory({ owner: { kind: "player", id: player.id }, limit })).items;
    });
  }

  async getCurrentBicycle(identity: TelegramIdentity, now: string): Promise<{ item: CatalogItem; entry: InventoryEntry } | undefined> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const entry = (await context.inventoryService.listAll({ kind: "player", id: player.id }))
        .find((candidate) => this.catalog.getProduct(candidate.itemId).categoryId === "bicycle");
      if (!entry) return undefined;
      context.inventoryService.ensureEntryState(entry);
      return { item: this.getCatalogItem(entry.itemId), entry };
    });
  }

  async getFamily(identity: TelegramIdentity, now: string): Promise<Family> {
    return this.execute(async (context) => {
      const player = await this.ensurePlayerInContext(context, identity, now);
      const family = await this.getPlayerFamily(context, player);
      if (!family) throw new Error("Семья не найдена");
      return family;
    });
  }

  async getFamilyRating(): Promise<Array<{ family: Family; score: number }>> {
    return this.execute(async (context) => {
      const result = [];
      for (const family of await context.families.list()) {
        result.push({
          family,
          score: family.love * 10 + family.level * 1_000 + family.capital + family.achievements.length * 5_000 +
            family.travelIds.length * 2_000 + await context.inventoryService.calculateAssetValue({ kind: "family", id: family.id })
        });
      }
      return result.sort((left, right) => right.score - left.score);
    });
  }

  async getRichestPlayers(): Promise<Array<{ player: PlayerProfile; netWorth: number }>> {
    return this.execute(async (context) => {
      const result = [];
      for (const player of await context.players.list()) {
        result.push({ player, netWorth: player.balance + player.bankBalance + await context.inventoryService.calculateAssetValue({ kind: "player", id: player.id }) });
      }
      return result.sort((left, right) => right.netWorth - left.netWorth);
    });
  }

  listCatalog(category?: string): CatalogItem[] { return this.catalog.listLegacyCatalog(category); }
  listAssetTypes(): AssetType[] { return [...this.catalog.listAssetTypes({ limit: 25 }).items]; }
  listAssetCategories(assetTypeId: string): AssetCategory[] { return [...this.catalog.listCategories({ assetTypeId, limit: 25 }).items]; }
  listJobs(): typeof jobs { return jobs; }
  getCatalogItem(itemId: string): CatalogItem { return this.catalog.toLegacyCatalogItem(itemId); }

  async handleCompletedShopOrder(order: ShopOrder, now: string): Promise<void> {
    await this.execute(async (context) => {
      const player = await context.players.findById(order.actorId);
      if (!player) return;
      if (order.type === "purchase") {
        const stats = await context.stats.get();
        stats.purchases += 1;
        await context.stats.save(stats);
        await context.playerService.addXp(player, Math.max(1, Math.floor(order.totalPrice.amount / 1_000)), now);
        const family = await this.getPlayerFamily(context, player);
        if (family) {
          family.stats.purchases += 1;
          family.stats.totalSpent += order.totalPrice.amount;
          this.recalculateFamilyLevel(family, now);
          await context.families.save(family);
        }
        if (this.catalog.getProduct(order.productId).categoryId === "car") await this.tryGrantAchievement(context, player, "ach_first_car", now);
      }
      await this.audit(context, order.type, {
        orderId: order.id, userId: player.id, itemId: order.productId,
        ...(order.type === "purchase" ? { price: order.totalPrice.amount } : { payout: order.totalPrice.amount }), owner: order.owner
      }, now);
    });
  }

  private async execute<T>(work: (context: GameTransactionContext) => Promise<T>): Promise<T> {
    return this.unitOfWork.execute((scope) => work(this.context(scope)));
  }

  private context(scope: TransactionScope): GameTransactionContext {
    return Object.assign(scope, this.serviceScopes.create(scope));
  }

  private async ensurePlayerInContext(context: GameTransactionContext, identity: TelegramIdentity, now: string): Promise<PlayerProfile> {
    const player = await context.playerService.ensurePlayer(identity, now);
    const playerOwner: OwnerRef = { kind: "player", id: player.id };
    if (await context.unlockService.needsReconciliation(playerOwner)) {
      await context.unlockService.reconcileOwner(playerOwner, await context.inventoryService.listAll(playerOwner), this.operation(now, `unlock-reconcile:player:${player.id}`));
    }
    const family = await this.getPlayerFamily(context, player);
    if (family) {
      const familyOwner: OwnerRef = { kind: "family", id: family.id };
      if (await context.unlockService.needsReconciliation(familyOwner)) {
        await context.unlockService.reconcileOwner(familyOwner, await context.inventoryService.listAll(familyOwner), this.operation(now, `unlock-reconcile:family:${family.id}`));
      }
    }
    return player;
  }

  private async giftInventoryEntryInContext(context: GameTransactionContext, identity: TelegramIdentity, inventoryEntryId: string, targetPlayerId: TelegramUserId, now: string, requestId: string): Promise<{ item: CatalogItem; entryId: string; targetPlayer: PlayerProfile }> {
    const player = await this.ensurePlayerInContext(context, identity, now);
    this.assertActive(player);
    const targetPlayer = await context.players.findById(targetPlayerId);
    if (!targetPlayer) throw new Error("Получатель должен сначала создать RPG-профиль");
    if (targetPlayer.settings.blocked) throw new Error("Получатель заблокирован");
    const entry = await context.inventoryService.getEntry({ kind: "player", id: player.id }, inventoryEntryId);
    const result = await context.inventoryService.gift({
      fromOwner: { kind: "player", id: player.id }, toOwner: { kind: "player", id: targetPlayer.id },
      inventoryEntryId, quantity: 1, reason: `player_gift:${player.id}:${targetPlayer.id}`
    }, { requestId, idempotencyKey: requestId, correlationId: requestId, now, actor: { kind: "player", id: player.id } });
    await this.audit(context, "inventory:gift", {
      actorId: player.id, targetPlayerId: targetPlayer.id, sourceEntryId: inventoryEntryId,
      targetEntryId: result.inventoryEntryIds[0], productId: entry.itemId
    }, now);
    return { item: this.getCatalogItem(entry.itemId), entryId: result.inventoryEntryIds[0], targetPlayer };
  }

  private async assertRequirements(context: GameTransactionContext, player: PlayerProfile, family: Family | undefined, requirements: Requirement[] = []): Promise<void> {
    await context.requirementEvaluator.assert({ player, family, owner: { kind: "player", id: player.id } }, legacyRequirementsToExpression(requirements));
  }

  private assertActive(player: PlayerProfile): void {
    if (player.settings.blocked) throw new Error("Игрок заблокирован");
  }

  private normalizeAmount(amount: number): number {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Сумма должна быть положительным целым числом");
    return amount;
  }

  private async getPlayerFamily(context: GameTransactionContext, player: PlayerProfile): Promise<Family | undefined> {
    return player.familyId ? context.families.findById(player.familyId) : undefined;
  }

  private async playerBalances(context: GameTransactionContext, playerId: number): Promise<{ balance: number; bankBalance: number }> {
    return {
      balance: (await context.economyService.getBalance({ kind: "player_cash", playerId })).amount,
      bankBalance: (await context.economyService.getBalance({ kind: "player_bank", playerId })).amount
    };
  }

  private async addInventoryItem(context: GameTransactionContext, owner: OwnerRef, item: CatalogItem, now: string, acquiredBy: InventoryEntry["acquiredBy"], sourceId: string, actorId?: number): Promise<void> {
    const operation = this.operation(now, sourceId);
    await context.inventoryService.grant({ owner, productId: item.id, quantity: 1, acquiredBy, sourceId }, actorId
      ? { ...operation, actor: { kind: "player", id: actorId } }
      : operation);
  }

  private async consumeTravelTickets(context: GameTransactionContext, player: PlayerProfile, requirements: readonly Requirement[], travelId: string, now: string): Promise<void> {
    for (const requirement of requirements) {
      if (!requirement.itemId) continue;
      const product = this.catalog.getProduct(requirement.itemId);
      if (this.catalog.getAssetTypeForProduct(product.id).id !== "ticket") continue;
      const owner: OwnerRef = { kind: "player", id: player.id };
      const entry = await context.inventoryService.findFirstByProduct(owner, product.id);
      if (!entry) throw new Error(`Требуется билет ${product.name}`);
      const requestId = `travel:${travelId}:ticket:${entry.instanceId}:${now}`;
      await context.inventoryService.consume({ owner, inventoryEntryId: entry.instanceId, quantity: 1, reason: `travel:${travelId}` }, {
        requestId, idempotencyKey: requestId, correlationId: `travel:${travelId}:${player.id}:${now}`, now,
        actor: { kind: "player", id: player.id }
      });
    }
  }

  private async tryGrantAchievement(context: GameTransactionContext, player: PlayerProfile, achievementId: string, now: string): Promise<void> {
    const achievement = achievements.find((candidate) => candidate.id === achievementId);
    if (!achievement || player.achievements.includes(achievementId)) return;
    player.achievements.push(achievement.id);
    await context.players.save(player);
    await context.economyService.creditPlayer(player, achievement.reward, `achievement:${achievement.id}`, now);
    await context.playerService.addXp(player, achievement.xp, now);
  }

  private recalculateFamilyLevel(family: Family, now: string): void {
    while (family.xp >= family.level * 250) { family.xp -= family.level * 250; family.level += 1; }
    family.title = this.familyTitle(family.level);
    family.updatedAt = now;
  }

  private familyTitle(level: number): string {
    if (level >= 50) return "Легендарная династия";
    if (level >= 25) return "Великая семья";
    if (level >= 10) return "Крепкий союз";
    if (level >= 3) return "Развивающаяся семья";
    return "Новая семья";
  }

  private conditionFromWear(wearLevel: number): AssetCondition {
    if (wearLevel >= 90) return "broken";
    if (wearLevel >= 55) return "worn";
    if (wearLevel > 0) return "good";
    return "new";
  }

  private valueFromWear(item: CatalogItem, wearLevel: number): number {
    const base = item.transport?.resalePrice ?? item.assetValue;
    return Math.max(1, Math.floor(base * (1 - Math.min(90, wearLevel) / 100)));
  }

  private async audit(context: GameTransactionContext, message: string, meta: Record<string, unknown>, now: string): Promise<void> {
    await context.auditLogs.append({ id: createId("log"), level: "info", message, meta, createdAt: now });
  }

  private operation(now: string, requestId = createId("request")): OperationContext {
    return { requestId, correlationId: requestId, now };
  }

  private async assertJobUnlocked(context: GameTransactionContext, player: PlayerProfile, jobId: string): Promise<void> {
    if (!context.unlockService.isManagedTarget("job", jobId)) return;
    if (!await context.unlockService.isUnlocked({ kind: "player", id: player.id }, "job", jobId)) {
      throw new Error("Эта профессия не открыта принадлежащими вам объектами");
    }
  }
}

const repairFallback = (item: CatalogItem): number => Math.max(1, Math.floor(item.price * 0.08));
