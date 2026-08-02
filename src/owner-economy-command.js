const OWNER_COIN_GRANT_PREFIX = /^дай\s+мне(?:\s|$)/i;
const OWNER_COIN_GRANT_PATTERN = /^дай\s+мне\s+(\d+)\s+монет(?:у|ы)?\s*$/i;
const OWNER_ECONOMY_DIAGNOSTIC_EVENT = "owner_economy_command";

function parseOwnerCoinGrant(text) {
  const value = String(text || "").trim();
  if (!OWNER_COIN_GRANT_PREFIX.test(value)) return { attempted: false, amount: null };
  const match = value.match(OWNER_COIN_GRANT_PATTERN);
  if (!match) return { attempted: true, amount: null };
  const amount = Number(match[1]);
  return {
    attempted: true,
    amount: Number.isSafeInteger(amount) && amount > 0 ? amount : null
  };
}

function formatCoins(amount) {
  return new Intl.NumberFormat("ru-RU").format(amount).replaceAll("\u00a0", " ");
}

class OwnerEconomyCommandService {
  constructor(options) {
    this.currencyStore = options.currencyStore;
    this.ownerIds = Array.from(new Set((options.ownerIds || []).map(Number).filter(Number.isSafeInteger)));
    this.ownerIdsEnvironmentLoaded = options.ownerIdsEnvironmentLoaded === true;
    this.logger = options.logger || console;
  }

  execute(message) {
    const parsed = parseOwnerCoinGrant(message?.text);
    if (!parsed.attempted) return { handled: false, responseText: null };

    const fromId = Number(message?.from?.id);
    const ownerMatched = this.ownerIds.includes(fromId);
    const selectedAccount = Number.isSafeInteger(fromId) ? `currency_store:user:${fromId}` : null;
    const diagnostic = {
      chatType: message?.chat?.type || "unknown",
      fromId: Number.isSafeInteger(fromId) ? fromId : null,
      ownerIdsLoaded: [...this.ownerIds],
      ownerIdsEnvironmentLoaded: this.ownerIdsEnvironmentLoaded,
      ownerMatched,
      parsedAmount: parsed.amount,
      selectedAccount
    };

    if (message?.chat?.type !== "private") {
      this.logDiagnostic({ ...diagnostic, status: "ignored", ignoredReason: "chat_not_private" });
      return { handled: true, responseText: null };
    }
    if (!ownerMatched) {
      this.logDiagnostic({ ...diagnostic, status: "ignored", ignoredReason: "owner_not_matched" });
      return { handled: true, responseText: null };
    }
    if (parsed.amount === null) {
      this.logDiagnostic({ ...diagnostic, status: "ignored", ignoredReason: "amount_not_parsed" });
      return { handled: true, responseText: null };
    }

    const operationId = `owner-coin-grant:${message.chat.id}:${message.message_id}`;
    try {
      const operation = this.currencyStore.creditOnce(message.from, {
        operationId,
        amount: parsed.amount,
        metadata: {
          reason: "owner_grant",
          currency: "coins",
          actorId: fromId,
          selectedAccount
        }
      });
      this.logDiagnostic({
        ...diagnostic,
        status: operation.replayed ? "replayed" : "applied",
        ignoredReason: null,
        operationId,
        balanceAfter: operation.balanceAfter
      });
      return {
        handled: true,
        responseText: [
          `✅ Начислено: ${formatCoins(parsed.amount)} монет`,
          `💰 Баланс: ${formatCoins(operation.balanceAfter)} монет`
        ].join("\n"),
        operation
      };
    } catch (error) {
      this.logDiagnostic({
        ...diagnostic,
        status: "failed",
        ignoredReason: null,
        operationId,
        error: error?.message || String(error)
      });
      throw error;
    }
  }

  logDiagnostic(diagnostic) {
    this.logger.info(OWNER_ECONOMY_DIAGNOSTIC_EVENT, diagnostic);
  }
}

module.exports = {
  OWNER_COIN_GRANT_PATTERN,
  OWNER_ECONOMY_DIAGNOSTIC_EVENT,
  OwnerEconomyCommandService,
  formatCoins,
  parseOwnerCoinGrant
};
