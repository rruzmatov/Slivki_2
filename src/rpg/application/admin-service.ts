import type { CatalogItem, GameState, TelegramUserId } from "../domain/types";
import { catalogItems } from "../data/catalog";
import { createId } from "../utils/ids";
import { EconomyService } from "./economy-service";
import { PlayerService, type TelegramIdentity } from "./player-service";

export class AdminService {
  private readonly economy = new EconomyService();
  private readonly players = new PlayerService();
  private readonly catalogById = new Map(catalogItems.map((item) => [item.id, item]));

  constructor(private readonly ownerIds: readonly TelegramUserId[]) {}

  grantMoney(state: GameState, actorId: TelegramUserId, target: TelegramIdentity, amount: number, now: string): void {
    this.assertOwner(actorId);
    const player = this.players.ensurePlayer(state.players, target, now);
    this.economy.creditPlayer(player, amount, `admin:${actorId}:grant_money`, state.ledger, now);
    this.audit(state, actorId, "grant_money", { targetId: target.id, amount }, now);
  }

  takeMoney(state: GameState, actorId: TelegramUserId, targetId: TelegramUserId, amount: number, now: string): void {
    this.assertOwner(actorId);
    const player = state.players[String(targetId)];
    if (!player) {
      throw new Error("Игрок не найден");
    }

    this.economy.debitPlayer(player, amount, `admin:${actorId}:take_money`, state.ledger, now);
    this.audit(state, actorId, "take_money", { targetId, amount }, now);
  }

  grantXp(state: GameState, actorId: TelegramUserId, target: TelegramIdentity, xp: number, now: string): void {
    this.assertOwner(actorId);
    const player = this.players.ensurePlayer(state.players, target, now);
    this.players.addXp(player, xp, now);
    this.audit(state, actorId, "grant_xp", { targetId: target.id, xp }, now);
  }

  setLevel(state: GameState, actorId: TelegramUserId, targetId: TelegramUserId, level: number, now: string): void {
    this.assertOwner(actorId);
    const player = state.players[String(targetId)];
    if (!player) {
      throw new Error("Игрок не найден");
    }

    if (!Number.isSafeInteger(level) || level < 1) {
      throw new Error("Уровень должен быть положительным целым числом");
    }

    player.level = level;
    player.updatedAt = now;
    this.audit(state, actorId, "set_level", { targetId, level }, now);
  }

  grantItem(state: GameState, actorId: TelegramUserId, target: TelegramIdentity, itemId: string, now: string): CatalogItem {
    this.assertOwner(actorId);
    const item = this.catalogById.get(itemId);
    if (!item) {
      throw new Error("Предмет не найден");
    }

    const player = this.players.ensurePlayer(state.players, target, now);
    const existing = player.inventory.find((entry) => entry.itemId === item.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      player.inventory.push({ itemId: item.id, quantity: 1, acquiredAt: now });
    }

    player.updatedAt = now;
    this.audit(state, actorId, "grant_item", { targetId: target.id, itemId }, now);
    return item;
  }

  setBlocked(state: GameState, actorId: TelegramUserId, targetId: TelegramUserId, blocked: boolean, now: string): void {
    this.assertOwner(actorId);
    const player = state.players[String(targetId)];
    if (!player) {
      throw new Error("Игрок не найден");
    }

    player.settings.blocked = blocked;
    player.updatedAt = now;
    this.audit(state, actorId, blocked ? "block_player" : "unblock_player", { targetId }, now);
  }

  resetPlayer(state: GameState, actorId: TelegramUserId, targetId: TelegramUserId, now: string): void {
    this.assertOwner(actorId);
    delete state.players[String(targetId)];
    this.audit(state, actorId, "reset_player", { targetId }, now);
  }

  private assertOwner(actorId: TelegramUserId): void {
    if (!this.ownerIds.includes(actorId)) {
      throw new Error("Недостаточно прав");
    }
  }

  private audit(state: GameState, actorId: TelegramUserId, action: string, meta: Record<string, unknown>, now: string): void {
    state.logs.push({
      id: createId("log"),
      level: "info",
      message: `admin:${action}`,
      meta: { actorId, ...meta },
      createdAt: now
    });
    state.stats.adminActions += 1;
  }
}
