import type { TransactionScope } from "./ports/unit-of-work";
import type { EconomyService } from "./economy-service";
import type { InventoryService } from "./inventory-service";
import type { InventoryQueryService } from "./inventory-query-service";
import type { OwnershipService } from "./ownership-service";
import type { PlayerService } from "./player-service";
import type { RequirementEvaluator } from "./requirement-evaluator";
import type { ShopService } from "./shop-service";
import type { UnlockService } from "./unlock-service";
import type { TransactionSchedulerService } from "./transaction-scheduler-service";

export interface TransactionServices {
  playerService: PlayerService;
  economyService: EconomyService;
  ownershipService: OwnershipService;
  inventoryService: InventoryService;
  inventoryQueryService: InventoryQueryService;
  unlockService: UnlockService;
  requirementEvaluator: RequirementEvaluator;
  shopService: ShopService;
  transactionScheduler: TransactionSchedulerService;
}

export interface TransactionServiceScopeFactory {
  create(scope: TransactionScope): TransactionServices;
}

export type GameTransactionContext = TransactionScope & TransactionServices;
