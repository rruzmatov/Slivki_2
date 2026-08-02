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
} from "../../application/ports/game-repositories";
import { ownerKey, type AccountRef, type ActorRef, type OwnerRef } from "../../domain/assets";
import { DomainError } from "../../domain/errors";
import type { AppLog, EconomyLedgerEntry, Family, InventoryEntry, MarriageProposal, PlayerProfile } from "../../domain/types";
import type { GameState } from "../storage/game-state";
import type { UnlockRecord } from "../../domain/unlocks";
import { detached, detachedValues } from "./detached-copy";

export class GameStatePlayerRepository implements PlayerRepository {
  constructor(private readonly state: GameState) {}
  async findById(id: number): Promise<PlayerProfile | undefined> { return detached(this.state.players[String(id)]); }
  async save(player: PlayerProfile): Promise<void> { this.state.players[String(player.id)] = detached(player); }
  async delete(id: number): Promise<void> { delete this.state.players[String(id)]; }
  async list(): Promise<PlayerProfile[]> { return detachedValues(Object.values(this.state.players)); }
}

export class GameStateFamilyRepository implements FamilyRepository {
  constructor(private readonly state: GameState) {}
  async findById(id: string): Promise<Family | undefined> { return detached(this.state.families[id]); }
  async save(family: Family): Promise<void> { this.state.families[family.id] = detached(family); }
  async delete(id: string): Promise<void> { delete this.state.families[id]; }
  async list(): Promise<Family[]> { return detachedValues(Object.values(this.state.families)); }
}

export class GameStateMarriageProposalRepository implements MarriageProposalRepository {
  constructor(private readonly state: GameState) {}
  async findById(id: string): Promise<MarriageProposal | undefined> { return detached(this.state.marriageProposals[id]); }
  async save(proposal: MarriageProposal): Promise<void> { this.state.marriageProposals[proposal.id] = detached(proposal); }
  async delete(id: string): Promise<void> { delete this.state.marriageProposals[id]; }
  async list(): Promise<MarriageProposal[]> { return detachedValues(Object.values(this.state.marriageProposals)); }
}

export class GameStateEconomyRepository implements EconomyRepository {
  constructor(private readonly state: GameState) {}

  async getBalance(account: AccountRef): Promise<number> {
    if (account.kind === "family_capital") {
      const family = this.state.families[account.familyId];
      if (!family) throw new DomainError("Семья не найдена", "FAMILY_NOT_FOUND");
      return family.capital;
    }
    const player = this.state.players[String(account.playerId)];
    if (!player) throw new DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
    return account.kind === "player_cash" ? player.balance : player.bankBalance;
  }

  async setBalance(account: AccountRef, amount: number, now: string): Promise<void> {
    if (account.kind === "family_capital") {
      const family = this.state.families[account.familyId];
      if (!family) throw new DomainError("Семья не найдена", "FAMILY_NOT_FOUND");
      family.capital = amount;
      family.updatedAt = now;
      return;
    }
    const player = this.state.players[String(account.playerId)];
    if (!player) throw new DomainError("Игрок не найден", "PLAYER_NOT_FOUND");
    if (account.kind === "player_cash") player.balance = amount;
    else player.bankBalance = amount;
    player.updatedAt = now;
  }

  async findLedgerByIdempotency(account: AccountRef, idempotencyKey: string): Promise<EconomyLedgerEntry | undefined> {
    return detached(this.state.ledger.find((entry) => entry.idempotencyKey === idempotencyKey && entry.accountKind === account.kind));
  }
  async appendLedger(entry: EconomyLedgerEntry): Promise<void> { this.state.ledger.push(detached(entry)); }
  async listLedger(limit = 100): Promise<EconomyLedgerEntry[]> { return detachedValues(this.state.ledger.slice(-limit).reverse()); }
}

export class GameStateAuditLogRepository implements AuditLogRepository {
  constructor(private readonly state: GameState) {}
  async append(log: AppLog): Promise<void> { this.state.logs.push(detached(log)); }
  async list(limit: number): Promise<AppLog[]> { return detachedValues(this.state.logs.slice(-limit).reverse()); }
}

export class GameStateStatsRepository implements StatsRepository {
  constructor(private readonly state: GameState) {}
  async get() { return { ...this.state.stats }; }
  async save(stats: GameState["stats"]): Promise<void> { this.state.stats = { ...stats }; }
}

export class GameStateUnlockRepository implements UnlockRepository {
  constructor(private readonly state: GameState) {}
  async list(owner?: OwnerRef): Promise<UnlockRecord[]> {
    const key = owner ? ownerKey(owner) : undefined;
    return detachedValues(Object.values(this.state.unlocks.records).filter((record) => !key || ownerKey(record.owner) === key));
  }
  async findById(id: string): Promise<UnlockRecord | undefined> { return detached(this.state.unlocks.records[id]); }
  async save(record: UnlockRecord): Promise<void> { this.state.unlocks.records[record.id] = detached(record); }
  async delete(id: string): Promise<void> { delete this.state.unlocks.records[id]; }
  async getReconciledVersion(owner: OwnerRef): Promise<number | undefined> { return this.state.unlocks.reconciledOwners[ownerKey(owner)]; }
  async setReconciledVersion(owner: OwnerRef, version: number): Promise<void> { this.state.unlocks.reconciledOwners[ownerKey(owner)] = version; }
  async clearReconciledVersion(owner: OwnerRef): Promise<void> { delete this.state.unlocks.reconciledOwners[ownerKey(owner)]; }
}

export class GameStateLegacyInventoryProjectionRepository implements LegacyInventoryProjectionRepository {
  constructor(private readonly state: GameState) {}
  async load(owner: OwnerRef): Promise<InventoryEntry[]> {
    if (owner.kind === "player") return detachedValues(this.state.players[String(owner.id)]?.inventory ?? []);
    if (owner.kind === "family") return detachedValues(this.state.families[String(owner.id)]?.inventory ?? []);
    return [];
  }
  async save(owner: OwnerRef, entries: readonly InventoryEntry[], now: string): Promise<void> {
    if (owner.kind === "player") {
      const player = this.state.players[String(owner.id)];
      if (player) { player.inventory = detachedValues(entries); player.updatedAt = now; }
    }
    if (owner.kind === "family") {
      const family = this.state.families[String(owner.id)];
      if (family) { family.inventory = detachedValues(entries); family.updatedAt = now; }
    }
  }
  async updateAssetIndexes(owner: OwnerRef, indexes: { transportIds: string[]; homeIds: string[]; businessIds: string[]; petIds: string[] }, now: string): Promise<void> {
    if (owner.kind !== "player") return;
    const player = this.state.players[String(owner.id)];
    if (!player) return;
    Object.assign(player, indexes);
    player.updatedAt = now;
  }
}

export class GameStateOwnerDirectoryRepository implements OwnerDirectoryRepository {
  constructor(private readonly state: GameState) {}
  async exists(owner: OwnerRef): Promise<boolean> {
    if (owner.kind === "player") return Boolean(this.state.players[String(owner.id)]);
    if (owner.kind === "family") return Boolean(this.state.families[String(owner.id)]);
    return owner.kind === "system";
  }
  async actorControlsOwner(actor: ActorRef | undefined, owner: OwnerRef): Promise<boolean> {
    if (!actor) return false;
    if (actor.kind === "admin" || actor.kind === "service" || actor.kind === "scheduler") return true;
    if (owner.kind === "player") return String(actor.id) === String(owner.id);
    if (owner.kind === "family") return this.state.families[String(owner.id)]?.partnerIds.includes(Number(actor.id)) ?? false;
    return false;
  }
}
