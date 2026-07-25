import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import type { GameState } from "../../domain/types";

const inventoryEntrySchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().positive(),
  acquiredAt: z.string()
});

const playerSchema = z.object({
  id: z.number().int(),
  username: z.string().optional(),
  firstName: z.string(),
  balance: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  xp: z.number().int().nonnegative(),
  energy: z.number().int().nonnegative(),
  jobId: z.string().optional(),
  familyId: z.string().optional(),
  inventory: z.array(inventoryEntrySchema),
  achievements: z.array(z.string()),
  skills: z.record(z.string(), z.number()),
  transportIds: z.array(z.string()),
  homeIds: z.array(z.string()),
  petIds: z.array(z.string()),
  settings: z.object({
    blocked: z.boolean(),
    locale: z.literal("ru"),
    notifications: z.boolean()
  }),
  dailyRewardClaimedAt: z.string().optional(),
  lastWorkedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const familySchema = z.object({
  id: z.string(),
  partnerIds: z.tuple([z.number().int(), z.number().int()]),
  love: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  xp: z.number().int().nonnegative(),
  capital: z.number().int().nonnegative(),
  title: z.string(),
  inventory: z.array(inventoryEntrySchema),
  achievements: z.array(z.string()),
  travelIds: z.array(z.string()),
  stats: z.object({
    jobsCompleted: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
    travels: z.number().int().nonnegative(),
    giftsSent: z.number().int().nonnegative(),
    totalEarned: z.number().int().nonnegative(),
    totalSpent: z.number().int().nonnegative()
  }),
  weddingDate: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const gameStateSchema: z.ZodType<GameState> = z.object({
  players: z.record(z.string(), playerSchema),
  families: z.record(z.string(), familySchema),
  marriageProposals: z.record(z.string(), z.object({
    id: z.string(),
    proposerId: z.number().int(),
    targetId: z.number().int(),
    chatId: z.number().int(),
    expiresAt: z.string(),
    createdAt: z.string()
  })),
  ledger: z.array(z.object({
    id: z.string(),
    userId: z.number().int().optional(),
    familyId: z.string().optional(),
    amount: z.number().int(),
    reason: z.string(),
    createdAt: z.string()
  })),
  logs: z.array(z.object({
    id: z.string(),
    level: z.union([z.literal("info"), z.literal("warn"), z.literal("error")]),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string()
  })),
  stats: z.object({
    commandsHandled: z.number().int().nonnegative(),
    purchases: z.number().int().nonnegative(),
    marriages: z.number().int().nonnegative(),
    jobsCompleted: z.number().int().nonnegative(),
    travels: z.number().int().nonnegative(),
    dailyRewards: z.number().int().nonnegative(),
    adminActions: z.number().int().nonnegative()
  })
});

export const createEmptyGameState = (): GameState => ({
  players: {},
  families: {},
  marriageProposals: {},
  ledger: [],
  logs: [],
  stats: {
    commandsHandled: 0,
    purchases: 0,
    marriages: 0,
    jobsCompleted: 0,
    travels: 0,
    dailyRewards: 0,
    adminActions: 0
  }
});

export class JsonGameDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<GameState> {
    await this.ensureFile();
    const raw = await fs.readFile(this.filePath, "utf8");

    try {
      return gameStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
      await fs.rename(this.filePath, corruptPath);
      const emptyState = createEmptyGameState();
      await this.write(emptyState);
      throw new Error(`RPG JSON storage is corrupted. Backup moved to ${corruptPath}. ${String(error)}`);
    }
  }

  async transaction<T>(handler: (state: GameState) => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      const state = await this.read();
      const result = await handler(state);
      gameStateSchema.parse(state);
      await this.write(state);
      return result;
    } finally {
      release();
    }
  }

  private async ensureFile(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.write(createEmptyGameState());
    }
  }

  private async write(state: GameState): Promise<void> {
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(state, null, 2)}\n`;

    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, this.filePath);
  }
}
