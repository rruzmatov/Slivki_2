"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.xpForLevel = exports.GAME_BALANCE = void 0;
exports.GAME_BALANCE = {
    player: {
        startingBalance: 0,
        startingEnergy: 100,
        maxEnergy: 100,
        xpBase: 100,
        xpGrowth: 1.18
    },
    family: {
        startingLove: 10,
        startingLevel: 1,
        proposalTtlSeconds: 60 * 10
    },
    antiAbuse: {
        commandCooldownMs: 900,
        purchaseIdempotencyTtlMs: 60_000,
        dailyRewardHours: 20
    },
    economy: {
        dailyReward: 250,
        dailyRewardXp: 20,
        resaleRate: 0.55
    },
    pagination: {
        pageSize: 8
    }
};
const xpForLevel = (level) => Math.floor(exports.GAME_BALANCE.player.xpBase * exports.GAME_BALANCE.player.xpGrowth ** Math.max(0, level - 1));
exports.xpForLevel = xpForLevel;
