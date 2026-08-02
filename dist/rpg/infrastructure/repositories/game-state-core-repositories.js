"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateOwnerDirectoryRepository = exports.GameStateLegacyInventoryProjectionRepository = exports.GameStateUnlockRepository = exports.GameStateStatsRepository = exports.GameStateAuditLogRepository = exports.GameStateEconomyRepository = exports.GameStateMarriageProposalRepository = exports.GameStateFamilyRepository = exports.GameStatePlayerRepository = void 0;
const assets_1 = require("../../domain/assets");
const errors_1 = require("../../domain/errors");
const detached_copy_1 = require("./detached-copy");
class GameStatePlayerRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async findById(id) { return (0, detached_copy_1.detached)(this.state.players[String(id)]); }
    async save(player) { this.state.players[String(player.id)] = (0, detached_copy_1.detached)(player); }
    async delete(id) { delete this.state.players[String(id)]; }
    async list() { return (0, detached_copy_1.detachedValues)(Object.values(this.state.players)); }
}
exports.GameStatePlayerRepository = GameStatePlayerRepository;
class GameStateFamilyRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async findById(id) { return (0, detached_copy_1.detached)(this.state.families[id]); }
    async save(family) { this.state.families[family.id] = (0, detached_copy_1.detached)(family); }
    async delete(id) { delete this.state.families[id]; }
    async list() { return (0, detached_copy_1.detachedValues)(Object.values(this.state.families)); }
}
exports.GameStateFamilyRepository = GameStateFamilyRepository;
class GameStateMarriageProposalRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async findById(id) { return (0, detached_copy_1.detached)(this.state.marriageProposals[id]); }
    async save(proposal) { this.state.marriageProposals[proposal.id] = (0, detached_copy_1.detached)(proposal); }
    async delete(id) { delete this.state.marriageProposals[id]; }
    async list() { return (0, detached_copy_1.detachedValues)(Object.values(this.state.marriageProposals)); }
}
exports.GameStateMarriageProposalRepository = GameStateMarriageProposalRepository;
class GameStateEconomyRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async getBalance(account) {
        if (account.kind === "family_capital") {
            const family = this.state.families[account.familyId];
            if (!family)
                throw new errors_1.DomainError("Семья не найдена", "FAMILY_NOT_FOUND");
            return family.capital;
        }
        const player = this.state.players[String(account.playerId)];
        if (!player)
            throw new errors_1.DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
        return account.kind === "player_cash" ? player.balance : player.bankBalance;
    }
    async setBalance(account, amount, now) {
        if (account.kind === "family_capital") {
            const family = this.state.families[account.familyId];
            if (!family)
                throw new errors_1.DomainError("Семья не найдена", "FAMILY_NOT_FOUND");
            family.capital = amount;
            family.updatedAt = now;
            return;
        }
        const player = this.state.players[String(account.playerId)];
        if (!player)
            throw new errors_1.DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
        if (account.kind === "player_cash")
            player.balance = amount;
        else
            player.bankBalance = amount;
        player.updatedAt = now;
    }
    async findLedgerByIdempotency(account, idempotencyKey) {
        return (0, detached_copy_1.detached)(this.state.ledger.find((entry) => entry.idempotencyKey === idempotencyKey && entry.accountKind === account.kind));
    }
    async appendLedger(entry) { this.state.ledger.push((0, detached_copy_1.detached)(entry)); }
    async listLedger(limit = 100) { return (0, detached_copy_1.detachedValues)(this.state.ledger.slice(-limit).reverse()); }
}
exports.GameStateEconomyRepository = GameStateEconomyRepository;
class GameStateAuditLogRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async append(log) { this.state.logs.push((0, detached_copy_1.detached)(log)); }
    async list(limit) { return (0, detached_copy_1.detachedValues)(this.state.logs.slice(-limit).reverse()); }
}
exports.GameStateAuditLogRepository = GameStateAuditLogRepository;
class GameStateStatsRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async get() { return { ...this.state.stats }; }
    async save(stats) { this.state.stats = { ...stats }; }
}
exports.GameStateStatsRepository = GameStateStatsRepository;
class GameStateUnlockRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async list(owner) {
        const key = owner ? (0, assets_1.ownerKey)(owner) : undefined;
        return (0, detached_copy_1.detachedValues)(Object.values(this.state.unlocks.records).filter((record) => !key || (0, assets_1.ownerKey)(record.owner) === key));
    }
    async findById(id) { return (0, detached_copy_1.detached)(this.state.unlocks.records[id]); }
    async save(record) { this.state.unlocks.records[record.id] = (0, detached_copy_1.detached)(record); }
    async delete(id) { delete this.state.unlocks.records[id]; }
    async getReconciledVersion(owner) { return this.state.unlocks.reconciledOwners[(0, assets_1.ownerKey)(owner)]; }
    async setReconciledVersion(owner, version) { this.state.unlocks.reconciledOwners[(0, assets_1.ownerKey)(owner)] = version; }
    async clearReconciledVersion(owner) { delete this.state.unlocks.reconciledOwners[(0, assets_1.ownerKey)(owner)]; }
}
exports.GameStateUnlockRepository = GameStateUnlockRepository;
class GameStateLegacyInventoryProjectionRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async load(owner) {
        if (owner.kind === "player")
            return (0, detached_copy_1.detachedValues)(this.state.players[String(owner.id)]?.inventory ?? []);
        if (owner.kind === "family")
            return (0, detached_copy_1.detachedValues)(this.state.families[String(owner.id)]?.inventory ?? []);
        return [];
    }
    async save(owner, entries, now) {
        if (owner.kind === "player") {
            const player = this.state.players[String(owner.id)];
            if (player) {
                player.inventory = (0, detached_copy_1.detachedValues)(entries);
                player.updatedAt = now;
            }
        }
        if (owner.kind === "family") {
            const family = this.state.families[String(owner.id)];
            if (family) {
                family.inventory = (0, detached_copy_1.detachedValues)(entries);
                family.updatedAt = now;
            }
        }
    }
    async updateAssetIndexes(owner, indexes, now) {
        if (owner.kind !== "player")
            return;
        const player = this.state.players[String(owner.id)];
        if (!player)
            return;
        Object.assign(player, indexes);
        player.updatedAt = now;
    }
}
exports.GameStateLegacyInventoryProjectionRepository = GameStateLegacyInventoryProjectionRepository;
class GameStateOwnerDirectoryRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async exists(owner) {
        if (owner.kind === "player")
            return Boolean(this.state.players[String(owner.id)]);
        if (owner.kind === "family")
            return Boolean(this.state.families[String(owner.id)]);
        return owner.kind === "system";
    }
    async actorControlsOwner(actor, owner) {
        if (!actor)
            return false;
        if (actor.kind === "admin" || actor.kind === "service" || actor.kind === "scheduler")
            return true;
        if (owner.kind === "player")
            return String(actor.id) === String(owner.id);
        if (owner.kind === "family")
            return this.state.families[String(owner.id)]?.partnerIds.includes(Number(actor.id)) ?? false;
        return false;
    }
}
exports.GameStateOwnerDirectoryRepository = GameStateOwnerDirectoryRepository;
