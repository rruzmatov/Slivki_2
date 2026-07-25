export type EntityId = string;
export type TelegramUserId = number;
export type ISODateTime = string;

export type ItemCategory =
  | "home"
  | "bicycle"
  | "scooter"
  | "motorcycle"
  | "car"
  | "airplane"
  | "helicopter"
  | "yacht"
  | "pet"
  | "gift"
  | "jewelry"
  | "interior"
  | "ticket";

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";
export type TransportKind = "walk" | "bicycle" | "scooter" | "motorcycle" | "car" | "airplane" | "helicopter" | "yacht";

export interface Requirement {
  level?: number;
  itemCategory?: ItemCategory;
  itemId?: EntityId;
  balance?: number;
  familyLevel?: number;
}

export interface CatalogItem {
  id: EntityId;
  category: ItemCategory;
  name: string;
  price: number;
  level: number;
  rarity?: Rarity;
  transportKind?: TransportKind;
  assetValue: number;
  requirements?: Requirement[];
  metadata?: Record<string, string | number | boolean>;
}

export interface Job {
  id: EntityId;
  title: string;
  minLevel: number;
  energyCost: number;
  payout: number;
  xp: number;
  cooldownSeconds: number;
  requirements?: Requirement[];
}

export interface Achievement {
  id: EntityId;
  title: string;
  description: string;
  xp: number;
  reward: number;
}

export interface TravelLocation {
  id: EntityId;
  name: string;
  price: number;
  xp: number;
  love: number;
  requirements: Requirement[];
}

export interface InventoryEntry {
  itemId: EntityId;
  quantity: number;
  acquiredAt: string;
}

export interface PlayerProfile {
  id: TelegramUserId;
  username?: string;
  firstName: string;
  balance: number;
  level: number;
  xp: number;
  energy: number;
  jobId?: EntityId;
  familyId?: EntityId;
  inventory: InventoryEntry[];
  achievements: EntityId[];
  skills: Record<string, number>;
  transportIds: EntityId[];
  homeIds: EntityId[];
  petIds: EntityId[];
  settings: {
    blocked: boolean;
    locale: "ru";
    notifications: boolean;
  };
  dailyRewardClaimedAt?: string;
  lastWorkedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Family {
  id: EntityId;
  partnerIds: [TelegramUserId, TelegramUserId];
  love: number;
  level: number;
  xp: number;
  capital: number;
  title: string;
  inventory: InventoryEntry[];
  achievements: EntityId[];
  travelIds: EntityId[];
  stats: {
    jobsCompleted: number;
    purchases: number;
    travels: number;
    giftsSent: number;
    totalEarned: number;
    totalSpent: number;
  };
  weddingDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Quest {
  id: EntityId;
  title: string;
  description: string;
  xp: number;
  reward: number;
  requirements?: Requirement[];
}

export interface MarriageProposal {
  id: EntityId;
  proposerId: TelegramUserId;
  targetId: TelegramUserId;
  chatId: number;
  expiresAt: string;
  createdAt: string;
}

export interface EconomyLedgerEntry {
  id: EntityId;
  userId?: TelegramUserId;
  familyId?: EntityId;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface AppLog {
  id: EntityId;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface GameState {
  players: Record<string, PlayerProfile>;
  families: Record<EntityId, Family>;
  marriageProposals: Record<EntityId, MarriageProposal>;
  ledger: EconomyLedgerEntry[];
  logs: AppLog[];
  stats: {
    commandsHandled: number;
    purchases: number;
    marriages: number;
    jobsCompleted: number;
    travels: number;
    dailyRewards: number;
    adminActions: number;
  };
}

export interface Repository<T, ID extends string | number> {
  findById(id: ID): Promise<T | undefined>;
  save(entity: T): Promise<void>;
  delete(id: ID): Promise<void>;
  all(): Promise<T[]>;
}
