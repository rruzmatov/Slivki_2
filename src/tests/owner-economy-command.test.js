const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CurrencyStore } = require("../currency");
const { OwnerEconomyCommandService, parseOwnerCoinGrant } = require("../owner-economy-command");

const OWNER_ID = 6006255869;

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-owner-economy-"));
  const currencyFile = path.join(directory, "currency.json");
  const currencyStore = new CurrencyStore(currencyFile, { startingBalance: 100 });
  const diagnostics = [];
  const service = new OwnerEconomyCommandService({
    currencyStore,
    ownerIds: [OWNER_ID],
    ownerIdsEnvironmentLoaded: true,
    logger: { info: (event, diagnostic) => diagnostics.push({ event, diagnostic }) }
  });
  return { currencyFile, currencyStore, diagnostics, service };
}

function message(text, overrides = {}) {
  return {
    message_id: 10,
    text,
    chat: { id: OWNER_ID, type: "private" },
    from: { id: OWNER_ID, first_name: "Owner" },
    ...overrides
  };
}

test("owner coin parser is case-insensitive and accepts supported Russian forms", () => {
  for (const [text, amount] of [
    ["дай мне 100 монет", 100],
    ["Дай мне 100000 монет", 100000],
    ["дай мне 10000 монету", 10000],
    ["дай мне 10000 монеты", 10000]
  ]) {
    assert.deepEqual(parseOwnerCoinGrant(text), { attempted: true, amount }, text);
  }
});

test("owner coin parser rejects invalid, zero and unsafe amounts", () => {
  assert.deepEqual(parseOwnerCoinGrant("обычное сообщение"), { attempted: false, amount: null });
  for (const text of ["дай мне монет", "дай мне 0 монет", "дай мне -5 монет", "дай мне 9007199254740992 монет"]) {
    assert.deepEqual(parseOwnerCoinGrant(text), { attempted: true, amount: null }, text);
  }
});

test("private owner grant credits the same CurrencyStore balance used by balance command", () => {
  const { currencyStore, diagnostics, service } = createFixture();
  const result = service.execute(message("Дай мне 100000 монет"));
  assert.equal(result.responseText, "✅ Начислено: 100 000 монет\n💰 Баланс: 100 100 монет");
  assert.equal(currencyStore.getBalance({ id: OWNER_ID, first_name: "Owner" }), 100100);
  assert.equal(result.operation.balanceBefore, 100);
  assert.equal(result.operation.balanceAfter, 100100);
  assert.equal(diagnostics.at(-1).diagnostic.selectedAccount, `currency_store:user:${OWNER_ID}`);
  assert.equal(diagnostics.at(-1).diagnostic.status, "applied");
});

test("owner grant is idempotent for the same Telegram message", () => {
  const { currencyStore, service } = createFixture();
  const input = message("дай мне 500 монет");
  const first = service.execute(input);
  const replay = service.execute(input);
  assert.equal(first.operation.replayed, false);
  assert.equal(replay.operation.replayed, true);
  assert.equal(currencyStore.getBalance(input.from), 600);
});

test("group attempts are ignored and diagnosed without changing balance", () => {
  const { currencyStore, diagnostics, service } = createFixture();
  const input = message("дай мне 1000 монет", { chat: { id: -1001, type: "supergroup" } });
  const result = service.execute(input);
  assert.equal(result.responseText, null);
  assert.equal(currencyStore.getBalance(input.from), 100);
  assert.deepEqual(diagnostics.at(-1).diagnostic, {
    chatType: "supergroup",
    fromId: OWNER_ID,
    ownerIdsLoaded: [OWNER_ID],
    ownerIdsEnvironmentLoaded: true,
    ownerMatched: true,
    parsedAmount: 1000,
    selectedAccount: `currency_store:user:${OWNER_ID}`,
    status: "ignored",
    ignoredReason: "chat_not_private"
  });
});

test("non-owner attempts are silently ignored and diagnosed", () => {
  const { currencyStore, diagnostics, service } = createFixture();
  const stranger = { id: 123456, first_name: "Player" };
  const input = message("дай мне 1000 монет", {
    chat: { id: stranger.id, type: "private" },
    from: stranger
  });
  const result = service.execute(input);
  assert.equal(result.responseText, null);
  assert.equal(currencyStore.getBalance(stranger), 100);
  assert.equal(diagnostics.at(-1).diagnostic.ownerMatched, false);
  assert.equal(diagnostics.at(-1).diagnostic.ignoredReason, "owner_not_matched");
});

test("invalid owner amount is ignored with complete diagnostics", () => {
  const { diagnostics, service } = createFixture();
  const result = service.execute(message("дай мне много монет"));
  assert.equal(result.responseText, null);
  assert.equal(diagnostics.at(-1).diagnostic.parsedAmount, null);
  assert.equal(diagnostics.at(-1).diagnostic.ignoredReason, "amount_not_parsed");
});

test("failed persistence rolls back owner balance and operation history", () => {
  const { currencyStore, diagnostics, service } = createFixture();
  currencyStore.ensureUser({ id: OWNER_ID, first_name: "Owner" });
  currencyStore.saveData = () => false;
  assert.throws(() => service.execute(message("дай мне 1000 монет")), /Currency storage write failed/);
  assert.equal(currencyStore.users[String(OWNER_ID)].balance, 100);
  assert.equal(Object.keys(currencyStore.operations).length, 0);
  assert.equal(diagnostics.at(-1).diagnostic.status, "failed");
});
