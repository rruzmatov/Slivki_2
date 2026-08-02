const PAY_COMMAND_PATTERN = /^\/pay(?:@[A-Za-z0-9_]{5,32})?(?:\s+([\s\S]+?))?\s*$/i;

class PaymentError extends Error {
  constructor(code, userMessage) {
    super(userMessage);
    this.name = "PaymentError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

function parsePayCommand(text) {
  const match = String(text || "").match(PAY_COMMAND_PATTERN);
  if (!match) throw new PaymentError("INVALID_FORMAT", "⚠️ Формат: /pay <сумма> [@username или Telegram ID].");
  const parts = String(match[1] || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    throw new PaymentError("INVALID_FORMAT", "⚠️ Формат: /pay <сумма> [@username или Telegram ID].");
  }
  if (!/^\d+$/.test(parts[0])) {
    throw new PaymentError("INVALID_AMOUNT", "⚠️ Сумма должна быть положительным целым числом.");
  }
  const amount = Number(parts[0]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PaymentError("INVALID_AMOUNT", "⚠️ Сумма должна быть положительным целым числом.");
  }
  return { amount, targetToken: parts[1] || null };
}

function formatCoins(amount) {
  return new Intl.NumberFormat("ru-RU").format(amount).replaceAll("\u00a0", " ");
}

function getPaymentUserName(user) {
  if (user?.username && user.username !== "нет") return `@${user.username}`;
  const fullName = [user?.first_name || user?.firstName, user?.last_name || user?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || `ID:${user?.id}`;
}

class PaymentService {
  constructor(currencyStore) {
    this.currencyStore = currencyStore;
  }

  transfer(input) {
    const { sender, receiver, amount, operationId, idempotencyKey, correlationId } = input;
    if (!receiver) throw new PaymentError("RECIPIENT_NOT_FOUND", "⚠️ Пользователь не найден.");
    if (Number(sender?.id) === Number(receiver.id)) {
      throw new PaymentError("SELF_TRANSFER", "⛔ Нельзя переводить монеты самому себе.");
    }
    if (sender?.is_bot === true || sender?.isBot === true || receiver.is_bot === true || receiver.isBot === true) {
      throw new PaymentError("BOT_RECIPIENT", "⛔ Нельзя переводить монеты ботам.");
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new PaymentError("INVALID_AMOUNT", "⚠️ Сумма должна быть положительным целым числом.");
    }

    const operation = this.currencyStore.transferOnce(sender, receiver, {
      operationId,
      idempotencyKey,
      correlationId,
      amount,
      metadata: { source: "telegram_pay" }
    });
    if (!operation) {
      throw new PaymentError(
        "INSUFFICIENT_BALANCE",
        `💰 Недостаточно монет. Ваш баланс: ${formatCoins(this.currencyStore.getBalance(sender))} монет.`
      );
    }

    const amountText = formatCoins(amount);
    return {
      operation,
      senderText: [
        "✅ Перевод выполнен",
        "",
        "Получатель:",
        getPaymentUserName(receiver),
        "",
        "Сумма:",
        `${amountText} монет`,
        "",
        "Новый баланс:",
        `${formatCoins(operation.senderBalanceAfter)} монет`
      ].join("\n"),
      receiverText: [
        `💸 Вам перевели ${amountText} монет.`,
        "",
        "От:",
        getPaymentUserName(sender),
        "",
        "Баланс:",
        `${formatCoins(operation.receiverBalanceAfter)} монет`
      ].join("\n")
    };
  }
}

module.exports = {
  PAY_COMMAND_PATTERN,
  PaymentError,
  PaymentService,
  formatCoins,
  getPaymentUserName,
  parsePayCommand
};
