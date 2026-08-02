const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CurrencyStore } = require("../currency");
const { PaymentError, PaymentService, parsePayCommand } = require("../payment-service");

function createPaymentFixture(startingBalance = 100) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-pay-"));
  const store = new CurrencyStore(path.join(directory, "currency.json"), { startingBalance });
  return { service: new PaymentService(store), store };
}

const sender = { id: 1, first_name: "Sender", username: "sender", is_bot: false };
const receiver = { id: 2, firstName: "Receiver", username: "receiver", isBot: false };

function transferInput(overrides = {}) {
  return {
    sender,
    receiver,
    amount: 40,
    operationId: "pay:-100:5",
    idempotencyKey: "pay:-100:5",
    correlationId: "pay:-100:5",
    ...overrides
  };
}

function expectPaymentError(action, code) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof PaymentError);
    assert.equal(error.code, code);
    return true;
  });
}

test("pay parser supports reply, username and Telegram ID forms", () => {
  assert.deepEqual(parsePayCommand("/pay 1000"), { amount: 1000, targetToken: null });
  assert.deepEqual(parsePayCommand("/pay 1000 @receiver"), { amount: 1000, targetToken: "@receiver" });
  assert.deepEqual(parsePayCommand("/pay 1000 123456789"), { amount: 1000, targetToken: "123456789" });
  assert.deepEqual(parsePayCommand("/pay@slivki_bot 1000 @receiver"), { amount: 1000, targetToken: "@receiver" });
});

test("pay parser rejects zero, negative, fractional and unsafe amounts", () => {
  for (const command of ["/pay 0 @receiver", "/pay -1 @receiver", "/pay 1.5 @receiver", "/pay 9007199254740992 @receiver"]) {
    expectPaymentError(() => parsePayCommand(command), "INVALID_AMOUNT");
  }
});

test("payment service transfers the shared currency balance and formats receipts", () => {
  const { service, store } = createPaymentFixture();
  const result = service.transfer(transferInput());
  assert.equal(store.getBalance(sender), 60);
  assert.equal(store.getBalance(receiver), 140);
  assert.match(result.senderText, /✅ Перевод выполнен/);
  assert.match(result.senderText, /@receiver/);
  assert.match(result.senderText, /Новый баланс:\n60 монет/);
  assert.match(result.receiverText, /💸 Вам перевели 40 монет\./);
  assert.match(result.receiverText, /@sender/);
  assert.match(result.receiverText, /Баланс:\n140 монет/);
});

test("payment service rejects self-transfers", () => {
  const { service } = createPaymentFixture();
  expectPaymentError(() => service.transfer(transferInput({ receiver: { ...receiver, id: sender.id } })), "SELF_TRANSFER");
});

test("payment service rejects bot recipients", () => {
  const { service } = createPaymentFixture();
  expectPaymentError(() => service.transfer(transferInput({ receiver: { ...receiver, isBot: true } })), "BOT_RECIPIENT");
});

test("payment service rejects an unknown recipient", () => {
  const { service } = createPaymentFixture();
  expectPaymentError(() => service.transfer(transferInput({ receiver: null })), "RECIPIENT_NOT_FOUND");
});

test("payment service rejects an insufficient balance without partial credit", () => {
  const { service, store } = createPaymentFixture();
  expectPaymentError(() => service.transfer(transferInput({ amount: 101 })), "INSUFFICIENT_BALANCE");
  assert.equal(store.getBalance(sender), 100);
  assert.equal(store.getBalance(receiver), 100);
});

test("payment replay does not transfer funds twice", () => {
  const { service, store } = createPaymentFixture();
  const first = service.transfer(transferInput());
  const replay = service.transfer(transferInput());
  assert.equal(first.operation.replayed, false);
  assert.equal(replay.operation.replayed, true);
  assert.equal(store.getBalance(sender), 60);
  assert.equal(store.getBalance(receiver), 140);
});
