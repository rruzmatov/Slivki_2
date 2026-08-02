import type { PlayerProfile, TelegramUserId } from "../domain/types";
import { GAME_BALANCE, xpForLevel } from "../config/game-balance";
import type { PlayerRepository } from "./ports/game-repositories";

export interface TelegramIdentity {
  id: TelegramUserId;
  username?: string;
  firstName: string;
}

export class PlayerService {
  constructor(private readonly repository: PlayerRepository) {}

  async ensurePlayer(identity: TelegramIdentity, now: string): Promise<PlayerProfile> {
    const existing = await this.repository.findById(identity.id);

    if (existing) {
      existing.username = identity.username;
      existing.firstName = identity.firstName;
      existing.updatedAt = now;
      await this.repository.save(existing);
      return existing;
    }

    const created: PlayerProfile = {
      id: identity.id,
      username: identity.username,
      firstName: identity.firstName,
      balance: GAME_BALANCE.player.startingBalance,
      bankBalance: 0,
      country: "Uzbekistan",
      level: 1,
      xp: 0,
      energy: GAME_BALANCE.player.startingEnergy,
      inventory: [],
      achievements: [],
      skills: {},
      transportIds: [],
      homeIds: [],
      businessIds: [],
      petIds: [],
      settings: {
        blocked: false,
        locale: "ru",
        notifications: true
      },
      createdAt: now,
      updatedAt: now
    };

    await this.repository.save(created);
    return created;
  }

  async addXp(player: PlayerProfile, xp: number, now: string): Promise<void> {
    player.xp += Math.max(0, Math.floor(xp));

    while (player.xp >= xpForLevel(player.level)) {
      player.xp -= xpForLevel(player.level);
      player.level += 1;
      player.energy = GAME_BALANCE.player.maxEnergy;
    }

    player.updatedAt = now;
    await this.repository.save(player);
  }
}
