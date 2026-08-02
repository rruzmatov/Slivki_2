import type { CatalogItem, TelegramUserId } from "../domain/types";
import type { DomainEvent } from "../domain/events";
import { createId } from "../utils/ids";
import type { CatalogService } from "./catalog-service";
import type { TelegramIdentity } from "./player-service";
import type { UnitOfWorkManager } from "./ports/unit-of-work";
import type { GameTransactionContext, TransactionServiceScopeFactory } from "./transaction-services";

export class AdminService {
  constructor(
    private readonly ownerIds: readonly TelegramUserId[],
    private readonly unitOfWork: UnitOfWorkManager,
    private readonly serviceScopes: TransactionServiceScopeFactory,
    private readonly catalog: CatalogService
  ) {}

  async grantMoney(actorId: TelegramUserId, target: TelegramIdentity, amount: number, now: string): Promise<void> {
    this.assertOwner(actorId);
    await this.execute(async (context) => {
      const player = await context.playerService.ensurePlayer(target, now);
      await context.economyService.creditPlayer(player, amount, `admin:${actorId}:grant_money`, now);
      await this.audit(context, actorId, "grant_money", { targetId: target.id, amount }, now);
    });
  }

  async takeMoney(actorId: TelegramUserId, targetId: TelegramUserId, amount: number, now: string): Promise<void> {
    this.assertOwner(actorId);
    await this.execute(async (context) => {
      const player = await context.players.findById(targetId);
      if (!player) throw new Error("Игрок не найден");
      await context.economyService.debitPlayer(player, amount, `admin:${actorId}:take_money`, now);
      await this.audit(context, actorId, "take_money", { targetId, amount }, now);
    });
  }

  async grantXp(actorId: TelegramUserId, target: TelegramIdentity, xp: number, now: string): Promise<void> {
    this.assertOwner(actorId);
    await this.execute(async (context) => {
      const player = await context.playerService.ensurePlayer(target, now);
      await context.playerService.addXp(player, xp, now);
      await this.audit(context, actorId, "grant_xp", { targetId: target.id, xp }, now);
    });
  }

  async setLevel(actorId: TelegramUserId, targetId: TelegramUserId, level: number, now: string): Promise<void> {
    this.assertOwner(actorId);
    if (!Number.isSafeInteger(level) || level < 1) throw new Error("Уровень должен быть положительным целым числом");
    await this.execute(async (context) => {
      const player = await context.players.findById(targetId);
      if (!player) throw new Error("Игрок не найден");
      player.level = level;
      player.updatedAt = now;
      await context.players.save(player);
      await this.audit(context, actorId, "set_level", { targetId, level }, now);
    });
  }

  async grantItem(actorId: TelegramUserId, target: TelegramIdentity, itemId: string, now: string): Promise<CatalogItem> {
    this.assertOwner(actorId);
    return this.execute(async (context) => {
      const item = this.catalog.toLegacyCatalogItem(itemId);
      const player = await context.playerService.ensurePlayer(target, now);
      const owner = { kind: "player" as const, id: player.id };
      if (await context.unlockService.needsReconciliation(owner)) {
        const operation = operationContext("admin_unlock_reconcile", actorId, now);
        await context.unlockService.reconcileOwner(owner, await context.inventoryService.listAll(owner), operation);
      }
      const operation = operationContext("admin_grant", actorId, now);
      await context.inventoryService.grant({ owner, productId: item.id, quantity: 1, acquiredBy: "admin", sourceId: operation.requestId }, operation);
      await this.audit(context, actorId, "grant_item", { targetId: target.id, itemId }, now);
      return item;
    });
  }

  async setBlocked(actorId: TelegramUserId, targetId: TelegramUserId, blocked: boolean, now: string): Promise<void> {
    this.assertOwner(actorId);
    await this.execute(async (context) => {
      const player = await context.players.findById(targetId);
      if (!player) throw new Error("Игрок не найден");
      player.settings.blocked = blocked;
      player.updatedAt = now;
      await context.players.save(player);
      await this.audit(context, actorId, blocked ? "block_player" : "unblock_player", { targetId }, now);
    });
  }

  async resetPlayer(actorId: TelegramUserId, targetId: TelegramUserId, now: string): Promise<void> {
    this.assertOwner(actorId);
    await this.execute(async (context) => {
      if (await context.players.findById(targetId)) {
        const owner = { kind: "player" as const, id: targetId };
        await context.inventoryService.clear(owner, `admin_reset:${actorId}`, operationContext("admin_reset", actorId, now));
        await context.unlockService.clearOwner(owner);
      }
      await context.players.delete(targetId);
      await this.audit(context, actorId, "reset_player", { targetId }, now);
    });
  }

  async confiscateItem(actorId: TelegramUserId, targetId: TelegramUserId, inventoryEntryId: string, reason: string, now: string): Promise<CatalogItem> {
    this.assertOwner(actorId);
    return this.execute(async (context) => {
      const entry = await context.inventoryService.confiscate(
        { kind: "player", id: targetId }, inventoryEntryId, { kind: "system", id: "admin-custody" }, reason,
        operationContext("admin_confiscate", actorId, now)
      );
      await this.audit(context, actorId, "confiscate_item", { targetId, inventoryEntryId, itemId: entry.itemId, reason }, now);
      return this.catalog.toLegacyCatalogItem(entry.itemId);
    });
  }

  async recoverItem(actorId: TelegramUserId, inventoryEntryId: string, reason: string, now: string): Promise<CatalogItem> {
    this.assertOwner(actorId);
    return this.execute(async (context) => {
      const entry = await context.inventoryService.recoverConfiscated(inventoryEntryId, reason, operationContext("admin_recover", actorId, now));
      await this.audit(context, actorId, "recover_item", { inventoryEntryId, itemId: entry.itemId, reason }, now);
      return this.catalog.toLegacyCatalogItem(entry.itemId);
    });
  }

  async listInventoryHistory(actorId: TelegramUserId, limit = 20): Promise<readonly DomainEvent[]> {
    this.assertOwner(actorId);
    return this.execute(async (context) => (await context.inventoryService.listHistory({ limit })).items);
  }

  async listLogs(actorId: TelegramUserId, limit = 10) {
    this.assertOwner(actorId);
    return this.execute((context) => context.auditLogs.list(limit));
  }

  private execute<T>(work: (context: GameTransactionContext) => Promise<T>): Promise<T> {
    return this.unitOfWork.execute((scope) => work(Object.assign(scope, this.serviceScopes.create(scope))));
  }

  private assertOwner(actorId: TelegramUserId): void {
    if (!this.ownerIds.includes(actorId)) throw new Error("Недостаточно прав");
  }

  private async audit(context: GameTransactionContext, actorId: TelegramUserId, action: string, meta: Record<string, unknown>, now: string): Promise<void> {
    await context.auditLogs.append({
      id: createId("log"), level: "info", message: `admin:${action}`, meta: { actorId, ...meta }, createdAt: now
    });
    const stats = await context.stats.get();
    stats.adminActions += 1;
    await context.stats.save(stats);
  }
}

const operationContext = (prefix: string, actorId: number, now: string) => {
  const requestId = createId(prefix);
  return { requestId, idempotencyKey: requestId, correlationId: requestId, now, actor: { kind: "admin" as const, id: actorId } };
};
