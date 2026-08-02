import type { InventoryPersistentState } from "../../domain/inventory";
import type { OwnershipPersistentState } from "../../domain/ownership";
import type { RuntimePersistentState } from "../../domain/runtime";
import type { ShopPersistentState } from "../../domain/shop";
import type {
  AppLog,
  EconomyLedgerEntry,
  EntityId,
  Family,
  InventoryEntry,
  MarriageProposal,
  PlayerProfile
} from "../../domain/types";
import type { UnlockPersistentState } from "../../domain/unlocks";

export interface GameState {
  players: Record<string, PlayerProfile>;
  families: Record<EntityId, Family>;
  marriageProposals: Record<EntityId, MarriageProposal>;
  ledger: EconomyLedgerEntry[];
  logs: AppLog[];
  shop: ShopPersistentState;
  unlocks: UnlockPersistentState;
  inventory: InventoryPersistentState<InventoryEntry>;
  ownership: OwnershipPersistentState;
  runtime: RuntimePersistentState;
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
