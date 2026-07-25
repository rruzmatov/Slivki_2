import type { PlayerProfile, TelegramUserId } from "../domain/types";
import { GAME_BALANCE, xpForLevel } from "../config/game-balance";

export interface TelegramIdentity {
  id: TelegramUserId;
  username?: string;
  firstName: string;
}

export class PlayerService {
  ensurePlayer(players: Record<string, PlayerProfile>, identity: TelegramIdentity, now: string): PlayerProfile {
    const existing = players[String(identity.id)];

    if (existing) {
      existing.username = identity.username;
      existing.firstName = identity.firstName;
      existing.updatedAt = now;
      return existing;
    }

    const created: PlayerProfile = {
      id: identity.id,
      username: identity.username,
      firstName: identity.firstName,
      balance: GAME_BALANCE.player.startingBalance,
      level: 1,
      xp: 0,
      energy: GAME_BALANCE.player.startingEnergy,
      inventory: [],
      achievements: [],
      skills: {},
      transportIds: [],
      homeIds: [],
      petIds: [],
      settings: {
        blocked: false,
        locale: "ru",
        notifications: true
      },
      createdAt: now,
      updatedAt: now
    };

    players[String(identity.id)] = created;
    return created;
  }

  addXp(player: PlayerProfile, xp: number, now: string): void {
    player.xp += Math.max(0, Math.floor(xp));

    while (player.xp >= xpForLevel(player.level)) {
      player.xp -= xpForLevel(player.level);
      player.level += 1;
      player.energy = GAME_BALANCE.player.maxEnergy;
    }

    player.updatedAt = now;
  }
}
