import type { EconomyLedgerEntry, Family, PlayerProfile } from "../domain/types";
import { createId } from "../utils/ids";

export class EconomyService {
  creditPlayer(player: PlayerProfile, amount: number, reason: string, ledger: EconomyLedgerEntry[], now: string): void {
    const normalized = this.normalizeAmount(amount);
    player.balance += normalized;
    player.updatedAt = now;
    ledger.push({ id: createId("ledger"), userId: player.id, amount: normalized, reason, createdAt: now });
  }

  debitPlayer(player: PlayerProfile, amount: number, reason: string, ledger: EconomyLedgerEntry[], now: string): void {
    const normalized = this.normalizeAmount(amount);

    if (player.balance < normalized) {
      throw new Error("Недостаточно средств");
    }

    player.balance -= normalized;
    player.updatedAt = now;
    ledger.push({ id: createId("ledger"), userId: player.id, amount: -normalized, reason, createdAt: now });
  }

  increaseFamilyCapital(family: Family, amount: number, reason: string, ledger: EconomyLedgerEntry[], now: string): void {
    const normalized = this.normalizeAmount(amount);
    family.capital += normalized;
    family.updatedAt = now;
    ledger.push({ id: createId("ledger"), familyId: family.id, amount: normalized, reason, createdAt: now });
  }

  private normalizeAmount(amount: number): number {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Сумма должна быть положительным целым числом");
    }

    return amount;
  }
}
