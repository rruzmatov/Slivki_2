import type { AccountRef, Money, OperationContext } from "../domain/assets";
import type { EconomyLedgerEntry, Family, PlayerProfile } from "../domain/types";
import { DomainError } from "../domain/errors";
import { createId } from "../utils/ids";
import type { EconomyRepository } from "./ports/game-repositories";

export interface EconomyMutationInput {
  account: AccountRef;
  amount: Money;
  reason: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
}

export interface EconomyOperation {
  ledgerEntryId: string;
  account: AccountRef;
  amount: Money;
  balanceAfter: Money;
  replayed: boolean;
}

export class EconomyService {
  constructor(private readonly repository: EconomyRepository) {}

  async creditPlayer(player: PlayerProfile, amount: number, reason: string, now: string): Promise<void> {
    await this.credit({
      account: { kind: "player_cash", playerId: player.id }, amount: { amount, currency: "SUM" }, reason,
      referenceType: "legacy_gameplay", referenceId: createId("economy_ref"), idempotencyKey: createId("economy_credit")
    }, legacyOperation(now, player.id));
    player.balance = (await this.getBalance({ kind: "player_cash", playerId: player.id })).amount;
    player.updatedAt = now;
  }

  async debitPlayer(player: PlayerProfile, amount: number, reason: string, now: string): Promise<void> {
    await this.debit({
      account: { kind: "player_cash", playerId: player.id }, amount: { amount, currency: "SUM" }, reason,
      referenceType: "legacy_gameplay", referenceId: createId("economy_ref"), idempotencyKey: createId("economy_debit")
    }, legacyOperation(now, player.id));
    player.balance = (await this.getBalance({ kind: "player_cash", playerId: player.id })).amount;
    player.updatedAt = now;
  }

  async increaseFamilyCapital(family: Family, amount: number, reason: string, now: string): Promise<void> {
    await this.credit({
      account: { kind: "family_capital", familyId: family.id }, amount: { amount, currency: "SUM" }, reason,
      referenceType: "legacy_gameplay", referenceId: createId("economy_ref"), idempotencyKey: createId("economy_credit")
    }, legacyOperation(now, family.id));
    family.capital = (await this.getBalance({ kind: "family_capital", familyId: family.id })).amount;
    family.updatedAt = now;
  }

  async getBalance(account: AccountRef): Promise<Money> {
    return { amount: await this.repository.getBalance(account), currency: "SUM" };
  }

  async debit(input: EconomyMutationInput, operation: OperationContext): Promise<EconomyOperation> {
    return this.mutateAccount(input, operation, -1);
  }

  async credit(input: EconomyMutationInput, operation: OperationContext): Promise<EconomyOperation> {
    return this.mutateAccount(input, operation, 1);
  }

  async transfer(
    from: AccountRef,
    to: AccountRef,
    amount: Money,
    reason: string,
    referenceId: string,
    idempotencyKey: string,
    operation: OperationContext
  ): Promise<{ debit: EconomyOperation; credit: EconomyOperation }> {
    if (accountKey(from) === accountKey(to)) throw new DomainError("Счета перевода должны отличаться", "ECONOMY_SAME_ACCOUNT");
    const debit = await this.debit({
      account: from,
      amount,
      reason,
      referenceType: "transfer",
      referenceId,
      idempotencyKey: `${idempotencyKey}:debit`
    }, operation);
    const credit = await this.credit({
      account: to,
      amount,
      reason,
      referenceType: "transfer",
      referenceId,
      idempotencyKey: `${idempotencyKey}:credit`
    }, operation);
    return { debit, credit };
  }

  private async mutateAccount(input: EconomyMutationInput, operation: OperationContext, direction: -1 | 1): Promise<EconomyOperation> {
    const amount = this.normalizeMoney(input.amount);
    const duplicate = await this.repository.findLedgerByIdempotency(input.account, input.idempotencyKey);
    if (duplicate) {
      return {
        ledgerEntryId: duplicate.id,
        account: input.account,
        amount: { amount, currency: input.amount.currency },
        balanceAfter: { amount: duplicate.balanceAfter ?? await this.repository.getBalance(input.account), currency: input.amount.currency },
        replayed: true
      };
    }

    const before = await this.repository.getBalance(input.account);
    const after = before + amount * direction;
    if (after < 0) throw new DomainError("Недостаточно средств", "ECONOMY_INSUFFICIENT_FUNDS");
    await this.repository.setBalance(input.account, after, operation.now);

    const entry: EconomyLedgerEntry = {
      id: createId("ledger"),
      ...(input.account.kind === "family_capital" ? { familyId: input.account.familyId } : { userId: input.account.playerId }),
      amount: amount * direction,
      reason: input.reason,
      currency: input.amount.currency,
      accountKind: input.account.kind,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      correlationId: operation.correlationId,
      balanceAfter: after,
      createdAt: operation.now
    };
    await this.repository.appendLedger(entry);
    return {
      ledgerEntryId: entry.id,
      account: input.account,
      amount: { amount, currency: input.amount.currency },
      balanceAfter: { amount: after, currency: input.amount.currency },
      replayed: false
    };
  }

  private normalizeMoney(money: Money): number {
    if (money.currency !== "SUM") throw new DomainError("Валюта счёта и операции не совпадает", "ECONOMY_CURRENCY_MISMATCH");
    return this.normalizeAmount(money.amount);
  }

  private normalizeAmount(amount: number): number {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Сумма должна быть положительным целым числом");
    }

    return amount;
  }
}

const accountKey = (account: AccountRef): string =>
  account.kind === "family_capital" ? `${account.kind}:${account.familyId}` : `${account.kind}:${account.playerId}`;

const legacyOperation = (now: string, actorId: string | number): OperationContext => {
  const requestId = createId("economy_operation");
  return {
    requestId,
    correlationId: requestId,
    now,
    actor: { kind: "service", id: `legacy:${actorId}` }
  };
};
