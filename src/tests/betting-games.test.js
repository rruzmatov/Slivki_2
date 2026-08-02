const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { playCasino, playDice } = require("../betting-games");
const { CurrencyStore } = require("../currency");

test("dice and casino use an unbiased 50/50 decision", () => {
  const rounds = 100_000;
  let diceWins = 0;
  let casinoWins = 0;
  for (let index = 0; index < rounds; index += 1) {
    if (playDice().won) diceWins += 1;
    if (playCasino().won) casinoWins += 1;
  }
  assert.ok(diceWins / rounds > 0.49 && diceWins / rounds < 0.51, `dice=${diceWins / rounds}`);
  assert.ok(casinoWins / rounds > 0.49 && casinoWins / rounds < 0.51, `casino=${casinoWins / rounds}`);
});

test("game visuals always agree with the fair outcome", () => {
  const lose = () => 0;
  const win = () => 1;
  assert.deepEqual(playDice(lose), { roll: 1, won: false, multiplier: 0 });
  assert.deepEqual(playDice(win), { roll: 5, won: true, multiplier: 2 });
  assert.equal(new Set(playCasino(win).slots).size, 1);
  assert.equal(new Set(playCasino(lose).slots).size, 3);
});

test("bet settlement is atomic, non-negative and idempotent across restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-currency-"));
  const file = path.join(directory, "currency.json");
  const user = { id: 42, first_name: "Player" };
  const store = new CurrencyStore(file, { startingBalance: 100 });
  const first = store.settleBet(user, {
    operationId: "round-1", bet: 30, multiplier: 2, metadata: { won: true, roll: 6 }
  });
  assert.equal(first.balanceBefore, 100);
  assert.equal(first.balanceAfter, 130);
  assert.equal(store.getBalance(user), 130);
  const replay = store.settleBet(user, {
    operationId: "round-1", bet: 30, multiplier: 0, metadata: { won: false, roll: 1 }
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.balanceAfter, 130);
  assert.equal(store.getBalance(user), 130);

  const restarted = new CurrencyStore(file, { startingBalance: 100 });
  const persistedReplay = restarted.settleBet(user, { operationId: "round-1", bet: 30, multiplier: 0 });
  assert.equal(persistedReplay.replayed, true);
  assert.equal(restarted.getBalance(user), 130);
  assert.equal(restarted.settleBet(user, { operationId: "too-large", bet: 131, multiplier: 2 }), null);
  assert.equal(restarted.getBalance(user), 130);
});

test("currency transfer is atomic, persisted and idempotent across restart", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-transfer-"));
  const file = path.join(directory, "currency.json");
  const sender = { id: 10, first_name: "Sender" };
  const receiver = { id: 20, first_name: "Receiver" };
  const store = new CurrencyStore(file, { startingBalance: 100 });
  const first = store.transferOnce(sender, receiver, {
    operationId: "pay:chat:1",
    idempotencyKey: "pay:chat:1",
    correlationId: "pay:chat:1",
    amount: 30
  });
  assert.equal(first.senderBalanceBefore, 100);
  assert.equal(first.senderBalanceAfter, 70);
  assert.equal(first.receiverBalanceBefore, 100);
  assert.equal(first.receiverBalanceAfter, 130);

  const restarted = new CurrencyStore(file, { startingBalance: 100 });
  const replay = restarted.transferOnce(sender, receiver, {
    operationId: "pay:chat:1",
    idempotencyKey: "pay:chat:1",
    correlationId: "pay:chat:1",
    amount: 30
  });
  assert.equal(replay.replayed, true);
  assert.equal(restarted.getBalance(sender), 70);
  assert.equal(restarted.getBalance(receiver), 130);
  assert.equal(restarted.operations["pay:chat:1"].reason, "transfer");
});

test("failed currency transfer persistence restores both balances and history", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-transfer-rollback-"));
  const file = path.join(directory, "currency.json");
  const sender = { id: 10, first_name: "Sender" };
  const receiver = { id: 20, first_name: "Receiver" };
  const store = new CurrencyStore(file, { startingBalance: 100 });
  store.ensureUser(sender);
  store.ensureUser(receiver);
  store.saveData = () => false;
  assert.throws(() => store.transferOnce(sender, receiver, {
    operationId: "pay:rollback",
    idempotencyKey: "pay:rollback",
    correlationId: "pay:rollback",
    amount: 25
  }), /Currency storage write failed/);
  assert.equal(store.users["10"].balance, 100);
  assert.equal(store.users["20"].balance, 100);
  assert.equal(store.operations["pay:rollback"], undefined);
});
