"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonUnitOfWorkManager = void 0;
const transaction_event_collector_1 = require("../../application/transaction-event-collector");
const game_state_inventory_repository_1 = require("../repositories/game-state-inventory-repository");
const game_state_ownership_repository_1 = require("../repositories/game-state-ownership-repository");
const game_state_shop_repository_1 = require("../repositories/game-state-shop-repository");
const game_state_core_repositories_1 = require("../repositories/game-state-core-repositories");
const game_state_runtime_repositories_1 = require("../repositories/game-state-runtime-repositories");
const outbox_delivery_policy_1 = require("../../application/outbox-delivery-policy");
class JsonUnitOfWorkManager {
    database;
    schemas;
    eventBus;
    clock;
    constructor(database, schemas, eventBus, clock) {
        this.database = database;
        this.schemas = schemas;
        this.eventBus = eventBus;
        this.clock = clock;
    }
    async execute(work, options = {}) {
        const transaction = await this.database.transaction(async (state) => {
            const scope = this.createScope(state);
            const result = await work(scope);
            await scope.eventCollector.flush();
            return { result, events: [...scope.eventCollector.events()] };
        });
        if (options.publishEvents !== false)
            await this.publishCommitted(transaction.events);
        return transaction.result;
    }
    createScope(state) {
        const events = new game_state_runtime_repositories_1.GameStateEventRepository(state);
        return {
            players: new game_state_core_repositories_1.GameStatePlayerRepository(state),
            families: new game_state_core_repositories_1.GameStateFamilyRepository(state),
            proposals: new game_state_core_repositories_1.GameStateMarriageProposalRepository(state),
            economy: new game_state_core_repositories_1.GameStateEconomyRepository(state),
            auditLogs: new game_state_core_repositories_1.GameStateAuditLogRepository(state),
            stats: new game_state_core_repositories_1.GameStateStatsRepository(state),
            unlocks: new game_state_core_repositories_1.GameStateUnlockRepository(state),
            inventory: new game_state_inventory_repository_1.GameStateInventoryRepository(state),
            ownership: new game_state_ownership_repository_1.GameStateOwnershipRepository(state),
            shop: new game_state_shop_repository_1.GameStateShopRepository(state),
            events,
            scheduler: new game_state_runtime_repositories_1.GameStateSchedulerRepository(state),
            retention: new game_state_runtime_repositories_1.GameStateRetentionRepository(state),
            legacyInventory: new game_state_core_repositories_1.GameStateLegacyInventoryProjectionRepository(state),
            ownerDirectory: new game_state_core_repositories_1.GameStateOwnerDirectoryRepository(state),
            eventCollector: new transaction_event_collector_1.TransactionEventCollector(this.schemas, events)
        };
    }
    async publishCommitted(events) {
        for (const event of events) {
            try {
                this.schemas.validate("event", event.eventType, event.eventVersion, event.payload);
                await this.eventBus.publish(event);
                await this.updateDelivery(event.eventId, "published");
            }
            catch (error) {
                await this.updateDelivery(event.eventId, "failed", error);
            }
        }
    }
    async updateDelivery(eventId, status, error) {
        await this.database.transaction(async (state) => {
            const record = state.runtime.outbox[eventId];
            if (!record)
                return;
            if (status === "published") {
                (0, outbox_delivery_policy_1.markOutboxPublished)(record, this.clock.now());
            }
            else {
                (0, outbox_delivery_policy_1.markOutboxFailed)(record, error, this.clock.now());
            }
        });
    }
}
exports.JsonUnitOfWorkManager = JsonUnitOfWorkManager;
