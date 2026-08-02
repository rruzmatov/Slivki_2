import type { InventoryRepository } from "./inventory-repository";
import type { OwnershipRepository } from "./ownership-repository";
import type { ShopRepository } from "./shop-repository";
import type { EventRepository } from "./event-repository";
import type { SchedulerRepository } from "./scheduler-repository";
import type { RetentionRepository } from "./retention-repository";
import type {
  AuditLogRepository,
  EconomyRepository,
  FamilyRepository,
  LegacyInventoryProjectionRepository,
  MarriageProposalRepository,
  OwnerDirectoryRepository,
  PlayerRepository,
  StatsRepository,
  UnlockRepository
} from "./game-repositories";
import type { TransactionEventCollector } from "../transaction-event-collector";

export interface TransactionScope {
  players: PlayerRepository;
  families: FamilyRepository;
  proposals: MarriageProposalRepository;
  economy: EconomyRepository;
  auditLogs: AuditLogRepository;
  stats: StatsRepository;
  unlocks: UnlockRepository;
  inventory: InventoryRepository;
  ownership: OwnershipRepository;
  shop: ShopRepository;
  events: EventRepository;
  scheduler: SchedulerRepository;
  retention: RetentionRepository;
  legacyInventory: LegacyInventoryProjectionRepository;
  ownerDirectory: OwnerDirectoryRepository;
  eventCollector: TransactionEventCollector;
}

export interface UnitOfWorkManager {
  execute<T>(work: (scope: TransactionScope) => Promise<T>, options?: { publishEvents?: boolean }): Promise<T>;
}
