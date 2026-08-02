import type { InventoryEntryId, LocationRef, RequirementExpression } from "./assets";
import type { InventoryLifecycleStatus } from "./inventory";

export * from "./assets";
export * from "./events";
export * from "./inventory";
export * from "./ownership";
export * from "./ownership-permissions";
export * from "./runtime";
export * from "./shop";
export * from "./transport";
export * from "./transport-condition";
export * from "./transport-domain-validation";
export * from "./transport-eligibility";
export * from "./transport-errors";
export * from "./transport-maintenance";
export * from "./transport-mileage";
export * from "./transport-pricing";
export * from "./transport-registry";
export * from "./transport-repair";
export * from "./transport-state-machine";
export * from "./transport-usage";
export * from "./transport-vehicle";
export * from "./unlocks";

export type EntityId = string;
export type TelegramUserId = number;
export type ISODateTime = string;

export type KnownItemCategory =
  | "home"
  | "bicycle"
  | "scooter"
  | "motorcycle"
  | "car"
  | "truck"
  | "ship"
  | "airplane"
  | "helicopter"
  | "yacht"
  | "business"
  | "pet"
  | "gift"
  | "jewelry"
  | "interior"
  | "ticket";

export type ItemCategory = KnownItemCategory | (string & {});

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";
export type AssetCondition = "new" | "good" | "worn" | "broken";
export type TransportKind =
  | "walk"
  | "bicycle"
  | "scooter"
  | "motorcycle"
  | "car"
  | "truck"
  | "ship"
  | "airplane"
  | "helicopter"
  | "yacht";

export type FuelType = "none" | "human" | "petrol" | "diesel" | "electric" | "hybrid" | "jet_fuel" | "marine_diesel";
export type LicenseType = "none" | "bicycle" | "motorcycle" | "car" | "truck" | "pilot" | "captain";

export interface TransportSpec {
  brand: string;
  model: string;
  country: string;
  year: number;
  horsepower: number;
  topSpeedKmh: number;
  fuelType: FuelType;
  maintenanceCost: number;
  insuranceCost: number;
  canWork: boolean;
  unlockedJobs: EntityId[];
  resalePrice: number;
  repairCost: number;
  requiredLicense: LicenseType;
  upgradeSupport: boolean;
  weightKg?: number;
  description?: string;
  defaultCondition?: AssetCondition;
  canSell?: boolean;
  canRepair?: boolean;
  passengerCapacity?: number;
  rangeKm?: number;
  dockRequirement?: string;
  airportRequirement?: string;
  businessUsage?: EntityId[];
}

export interface Requirement {
  level?: number;
  itemCategory?: ItemCategory;
  itemId?: EntityId;
  balance?: number;
  familyLevel?: number;
  expression?: RequirementExpression;
}

export interface CatalogItem {
  id: EntityId;
  category: ItemCategory;
  name: string;
  price: number;
  level: number;
  rarity?: Rarity;
  transportKind?: TransportKind;
  transport?: TransportSpec;
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

export interface RepairHistoryEntry {
  repairedAt: ISODateTime;
  cost: number;
  conditionBefore: AssetCondition;
  wearBefore: number;
  conditionAfter: AssetCondition;
  wearAfter: number;
}

export interface UpgradeHistoryEntry {
  upgradedAt: ISODateTime;
  upgradeId: EntityId;
  cost: number;
  note: string;
}

export interface InventoryEntry {
  instanceId: InventoryEntryId;
  itemId: EntityId;
  quantity: number;
  reservedQuantity?: number;
  acquiredAt: ISODateTime;
  acquiredBy: "purchase" | "gift" | "admin" | "reward" | "migration";
  sourceId?: EntityId;
  condition?: AssetCondition;
  currentValue?: number;
  purchasePrice?: number;
  wearLevel?: number;
  durability?: {
    current: number;
    maximum: number;
  };
  repairHistory?: RepairHistoryEntry[];
  upgradeHistory?: UpgradeHistoryEntry[];
  origin?: {
    type: string;
    referenceId?: string;
  };
  location?: LocationRef;
  lifecycleStatus?: InventoryLifecycleStatus;
  state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  rootInstanceId?: InventoryEntryId;
  parentInstanceId?: InventoryEntryId;
  version?: number;
  updatedAt?: ISODateTime;
}

export interface PlayerProfile {
  id: TelegramUserId;
  username?: string;
  firstName: string;
  balance: number;
  bankBalance: number;
  country: string;
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
  businessIds: EntityId[];
  petIds: EntityId[];
  settings: {
    blocked: boolean;
    locale: "ru";
    notifications: boolean;
  };
  dailyRewardClaimedAt?: ISODateTime;
  lastWorkedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
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
  weddingDate: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
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
  expiresAt: ISODateTime;
  createdAt: ISODateTime;
}

export interface EconomyLedgerEntry {
  id: EntityId;
  userId?: TelegramUserId;
  familyId?: EntityId;
  amount: number;
  reason: string;
  currency?: string;
  accountKind?: "player_cash" | "player_bank" | "family_capital";
  referenceType?: string;
  referenceId?: EntityId;
  idempotencyKey?: string;
  correlationId?: string;
  balanceAfter?: number;
  createdAt: ISODateTime;
}

export interface AppLog {
  id: EntityId;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
  createdAt: ISODateTime;
}

export interface Repository<T, ID extends string | number> {
  findById(id: ID): Promise<T | undefined>;
  save(entity: T): Promise<void>;
  delete(id: ID): Promise<void>;
  all(): Promise<T[]>;
}
