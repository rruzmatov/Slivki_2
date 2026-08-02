"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EconomyService = void 0;
const errors_1 = require("../domain/errors");
const ids_1 = require("../utils/ids");
class EconomyService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async creditPlayer(player, amount, reason, now) {
        await this.credit({
            account: { kind: "player_cash", playerId: player.id }, amount: { amount, currency: "SUM" }, reason,
            referenceType: "legacy_gameplay", referenceId: (0, ids_1.createId)("economy_ref"), idempotencyKey: (0, ids_1.createId)("economy_credit")
        }, legacyOperation(now, player.id));
        player.balance = (await this.getBalance({ kind: "player_cash", playerId: player.id })).amount;
        player.updatedAt = now;
    }
    async debitPlayer(player, amount, reason, now) {
        await this.debit({
            account: { kind: "player_cash", playerId: player.id }, amount: { amount, currency: "SUM" }, reason,
            referenceType: "legacy_gameplay", referenceId: (0, ids_1.createId)("economy_ref"), idempotencyKey: (0, ids_1.createId)("economy_debit")
        }, legacyOperation(now, player.id));
        player.balance = (await this.getBalance({ kind: "player_cash", playerId: player.id })).amount;
        player.updatedAt = now;
    }
    async increaseFamilyCapital(family, amount, reason, now) {
        await this.credit({
            account: { kind: "family_capital", familyId: family.id }, amount: { amount, currency: "SUM" }, reason,
            referenceType: "legacy_gameplay", referenceId: (0, ids_1.createId)("economy_ref"), idempotencyKey: (0, ids_1.createId)("economy_credit")
        }, legacyOperation(now, family.id));
        family.capital = (await this.getBalance({ kind: "family_capital", familyId: family.id })).amount;
        family.updatedAt = now;
    }
    async getBalance(account) {
        return { amount: await this.repository.getBalance(account), currency: "SUM" };
    }
    async debit(input, operation) {
        return this.mutateAccount(input, operation, -1);
    }
    async credit(input, operation) {
        return this.mutateAccount(input, operation, 1);
    }
    async transfer(from, to, amount, reason, referenceId, idempotencyKey, operation) {
        if (accountKey(from) === accountKey(to))
            throw new errors_1.DomainError("Счета перевода должны отличаться", "ECONOMY_SAME_ACCOUNT");
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
    async mutateAccount(input, operation, direction) {
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
        if (after < 0)
            throw new errors_1.DomainError("Недостаточно средств", "ECONOMY_INSUFFICIENT_FUNDS");
        await this.repository.setBalance(input.account, after, operation.now);
        const entry = {
            id: (0, ids_1.createId)("ledger"),
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
    normalizeMoney(money) {
        if (money.currency !== "SUM")
            throw new errors_1.DomainError("Валюта счёта и операции не совпадает", "ECONOMY_CURRENCY_MISMATCH");
        return this.normalizeAmount(money.amount);
    }
    normalizeAmount(amount) {
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            throw new Error("Сумма должна быть положительным целым числом");
        }
        return amount;
    }
}
exports.EconomyService = EconomyService;
const accountKey = (account) => account.kind === "family_capital" ? `${account.kind}:${account.familyId}` : `${account.kind}:${account.playerId}`;
const legacyOperation = (now, actorId) => {
    const requestId = (0, ids_1.createId)("economy_operation");
    return {
        requestId,
        correlationId: requestId,
        now,
        actor: { kind: "service", id: `legacy:${actorId}` }
    };
};
