export const GAME_BALANCE = {
  player: {
    startingBalance: 500,
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
} as const;

export const xpForLevel = (level: number): number =>
  Math.floor(GAME_BALANCE.player.xpBase * Math.pow(GAME_BALANCE.player.xpGrowth, Math.max(0, level - 1)));
