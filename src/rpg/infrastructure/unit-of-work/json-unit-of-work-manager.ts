import type { UnitOfWorkManager, TransactionScope } from "../../application/ports/unit-of-work";
import type { SchemaRegistry } from "../../application/schema-registry";
import { TransactionEventCollector } from "../../application/transaction-event-collector";
import type { EventBus } from "../../application/event-bus";
import type { DomainEvent } from "../../domain/events";
import { GameStateInventoryRepository } from "../repositories/game-state-inventory-repository";
import { GameStateOwnershipRepository } from "../repositories/game-state-ownership-repository";
import { GameStateShopRepository } from "../repositories/game-state-shop-repository";
import {
  GameStateAuditLogRepository,
  GameStateEconomyRepository,
  GameStateFamilyRepository,
  GameStateLegacyInventoryProjectionRepository,
  GameStateMarriageProposalRepository,
  GameStateOwnerDirectoryRepository,
  GameStatePlayerRepository,
  GameStateStatsRepository,
  GameStateUnlockRepository
} from "../repositories/game-state-core-repositories";
import {
  GameStateEventRepository,
  GameStateRetentionRepository,
  GameStateSchedulerRepository
} from "../repositories/game-state-runtime-repositories";
import type { JsonGameDatabase } from "../storage/json-game-database";
import type { GameState } from "../storage/game-state";
import type { Clock } from "../../application/ports/clock";
import { markOutboxFailed, markOutboxPublished } from "../../application/outbox-delivery-policy";

export class JsonUnitOfWorkManager implements UnitOfWorkManager {
  constructor(
    private readonly database: JsonGameDatabase,
    private readonly schemas: SchemaRegistry,
    private readonly eventBus: EventBus,
    private readonly clock: Clock
  ) {}

  async execute<T>(work: (scope: TransactionScope) => Promise<T>, options: { publishEvents?: boolean } = {}): Promise<T> {
    const transaction = await this.database.transaction(async (state) => {
      const scope = this.createScope(state);
      const result = await work(scope);
      await scope.eventCollector.flush();
      return { result, events: [...scope.eventCollector.events()] };
    });
    if (options.publishEvents !== false) await this.publishCommitted(transaction.events);
    return transaction.result;
  }

  private createScope(state: GameState): TransactionScope {
    const events = new GameStateEventRepository(state);
    return {
      players: new GameStatePlayerRepository(state),
      families: new GameStateFamilyRepository(state),
      proposals: new GameStateMarriageProposalRepository(state),
      economy: new GameStateEconomyRepository(state),
      auditLogs: new GameStateAuditLogRepository(state),
      stats: new GameStateStatsRepository(state),
      unlocks: new GameStateUnlockRepository(state),
      inventory: new GameStateInventoryRepository(state),
      ownership: new GameStateOwnershipRepository(state),
      shop: new GameStateShopRepository(state),
      events,
      scheduler: new GameStateSchedulerRepository(state),
      retention: new GameStateRetentionRepository(state),
      legacyInventory: new GameStateLegacyInventoryProjectionRepository(state),
      ownerDirectory: new GameStateOwnerDirectoryRepository(state),
      eventCollector: new TransactionEventCollector(this.schemas, events)
    };
  }

  private async publishCommitted(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      try {
        this.schemas.validate("event", event.eventType, event.eventVersion, event.payload);
        await this.eventBus.publish(event);
        await this.updateDelivery(event.eventId, "published");
      } catch (error) {
        await this.updateDelivery(event.eventId, "failed", error);
      }
    }
  }

  private async updateDelivery(eventId: string, status: "published" | "failed", error?: unknown): Promise<void> {
    await this.database.transaction(async (state) => {
      const record = state.runtime.outbox[eventId];
      if (!record) return;
      if (status === "published") {
        markOutboxPublished(record, this.clock.now());
      }
      else {
        markOutboxFailed(record, error, this.clock.now());
      }
    });
  }
}
