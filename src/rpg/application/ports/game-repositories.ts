import type { AccountRef, ActorRef, OwnerRef } from "../../domain/assets";
import type {
  AppLog,
  EconomyLedgerEntry,
  Family,
  InventoryEntry,
  MarriageProposal,
  PlayerProfile,
  TelegramUserId
} from "../../domain/types";
import type { UnlockRecord } from "../../domain/unlocks";

export interface PlayerRepository {
  findById(id: TelegramUserId): Promise<PlayerProfile | undefined>;
  save(player: PlayerProfile): Promise<void>;
  delete(id: TelegramUserId): Promise<void>;
  list(): Promise<PlayerProfile[]>;
}

export interface FamilyRepository {
  findById(id: string): Promise<Family | undefined>;
  save(family: Family): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<Family[]>;
}

export interface MarriageProposalRepository {
  findById(id: string): Promise<MarriageProposal | undefined>;
  save(proposal: MarriageProposal): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<MarriageProposal[]>;
}

export interface EconomyRepository {
  getBalance(account: AccountRef): Promise<number>;
  setBalance(account: AccountRef, amount: number, now: string): Promise<void>;
  findLedgerByIdempotency(account: AccountRef, idempotencyKey: string): Promise<EconomyLedgerEntry | undefined>;
  appendLedger(entry: EconomyLedgerEntry): Promise<void>;
  listLedger(limit?: number): Promise<EconomyLedgerEntry[]>;
}

export interface AuditLogRepository {
  append(log: AppLog): Promise<void>;
  list(limit: number): Promise<AppLog[]>;
}

export interface GameStats {
  commandsHandled: number;
  purchases: number;
  marriages: number;
  jobsCompleted: number;
  travels: number;
  dailyRewards: number;
  adminActions: number;
}

export interface StatsRepository {
  get(): Promise<GameStats>;
  save(stats: GameStats): Promise<void>;
}

export interface UnlockRepository {
  list(owner?: OwnerRef): Promise<UnlockRecord[]>;
  findById(id: string): Promise<UnlockRecord | undefined>;
  save(record: UnlockRecord): Promise<void>;
  delete(id: string): Promise<void>;
  getReconciledVersion(owner: OwnerRef): Promise<number | undefined>;
  setReconciledVersion(owner: OwnerRef, version: number): Promise<void>;
  clearReconciledVersion(owner: OwnerRef): Promise<void>;
}

export interface LegacyInventoryProjectionRepository {
  load(owner: OwnerRef): Promise<InventoryEntry[]>;
  save(owner: OwnerRef, entries: readonly InventoryEntry[], now: string): Promise<void>;
  updateAssetIndexes(owner: OwnerRef, indexes: {
    transportIds: string[];
    homeIds: string[];
    businessIds: string[];
    petIds: string[];
  }, now: string): Promise<void>;
}

export interface OwnerDirectoryRepository {
  exists(owner: OwnerRef): Promise<boolean>;
  actorControlsOwner(actor: ActorRef | undefined, owner: OwnerRef): Promise<boolean>;
}
