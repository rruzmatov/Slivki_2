"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerService = void 0;
const game_balance_1 = require("../config/game-balance");
class PlayerService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async ensurePlayer(identity, now) {
        const existing = await this.repository.findById(identity.id);
        if (existing) {
            existing.username = identity.username;
            existing.firstName = identity.firstName;
            existing.updatedAt = now;
            await this.repository.save(existing);
            return existing;
        }
        const created = {
            id: identity.id,
            username: identity.username,
            firstName: identity.firstName,
            balance: game_balance_1.GAME_BALANCE.player.startingBalance,
            bankBalance: 0,
            country: "Uzbekistan",
            level: 1,
            xp: 0,
            energy: game_balance_1.GAME_BALANCE.player.startingEnergy,
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
    async addXp(player, xp, now) {
        player.xp += Math.max(0, Math.floor(xp));
        while (player.xp >= (0, game_balance_1.xpForLevel)(player.level)) {
            player.xp -= (0, game_balance_1.xpForLevel)(player.level);
            player.level += 1;
            player.energy = game_balance_1.GAME_BALANCE.player.maxEnergy;
        }
        player.updatedAt = now;
        await this.repository.save(player);
    }
}
exports.PlayerService = PlayerService;
