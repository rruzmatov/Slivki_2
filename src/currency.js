const fs = require("fs");
const { backupCorruptJson } = require("./json-file-safety");

const DEFAULT_STARTING_BALANCE = 100;
const CURRENCY_STATE_VERSION = 1;
const OPERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPERATION_RECORDS = 5000;

function getUserName(user = {}) {
  const firstName = user.first_name || user.firstName || "";
  const lastName = user.last_name || user.lastName || "";
  const fullName = `${firstName} ${lastName}`.trim();

  return fullName || user.username || `ID:${user.id}`;
}

class CurrencyStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.startingBalance = Number(options.startingBalance) || DEFAULT_STARTING_BALANCE;
    const state = this.load();
    this.users = state.users;
    this.operations = state.operations;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { users: {}, operations: {} };
      }

      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));

      if (!data || typeof data !== "object" || Array.isArray(data)) return { users: {}, operations: {} };
      const sourceUsers = data.version === CURRENCY_STATE_VERSION && data.users && typeof data.users === "object"
        ? data.users
        : data;
      const users = Object.fromEntries(
        Object.entries(sourceUsers)
          .filter(([userId, profile]) => /^\d+$/.test(userId) && profile && typeof profile === "object")
          .map(([userId, profile]) => [
            userId,
            {
              balance: Math.max(0, Math.floor(Number(profile.balance) || 0)),
              name: String(profile.name || `ID:${userId}`)
            }
          ])
      );
      const operations = data.version === CURRENCY_STATE_VERSION && data.operations && typeof data.operations === "object"
        ? Object.fromEntries(Object.entries(data.operations).filter(([, operation]) => isValidOperation(operation)))
        : {};
      return { users, operations };
    } catch (error) {
      console.error("Load currency error:", error?.message || error);
      backupCorruptJson(this.filePath);
      return { users: {}, operations: {} };
    }
  }

  saveData() {
    try {
      const tmpFile = `${this.filePath}.tmp`;
      const data = { version: CURRENCY_STATE_VERSION, users: this.users, operations: this.operations };
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
      fs.renameSync(tmpFile, this.filePath);
      return true;
    } catch (error) {
      console.error("Save currency error:", error?.message || error);
      return false;
    }
  }

  ensureUser(user) {
    if (!user?.id) return null;

    const userId = String(user.id);
    const name = getUserName(user);

    if (!this.users[userId]) {
      this.users[userId] = {
        balance: this.startingBalance,
        name
      };
      this.saveData();
      return this.users[userId];
    }

    if (this.users[userId].name !== name) {
      this.users[userId].name = name;
      this.saveData();
    }

    return this.users[userId];
  }

  getBalance(user) {
    return this.ensureUser(user)?.balance || 0;
  }

  addBalance(user, amount) {
    const profile = this.ensureUser(user);
    if (!profile) return null;

    profile.balance = Math.max(0, Math.floor(profile.balance + Number(amount)));
    this.saveData();
    return profile.balance;
  }

  subtractBalance(user, amount) {
    const profile = this.ensureUser(user);
    if (!profile) return null;

    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (profile.balance < value) return null;

    profile.balance -= value;
    this.saveData();
    return profile.balance;
  }

  settleBet(user, input) {
    const operationId = String(input?.operationId || "").trim();
    const bet = Number(input?.bet);
    const multiplier = Number(input?.multiplier);
    if (!operationId) throw new Error("Bet operationId is required");
    const existing = this.operations[operationId];
    if (existing) {
      if (String(existing.userId) !== String(user?.id) || existing.bet !== bet) {
        throw new Error("Bet idempotency conflict");
      }
      return { ...existing, replayed: true };
    }
    if (!Number.isSafeInteger(bet) || bet <= 0 || !Number.isFinite(multiplier) || multiplier < 0) {
      throw new Error("Invalid bet settlement");
    }
    const profile = this.ensureUser(user);
    if (!profile || profile.balance < bet) return null;
    const payout = Math.floor(bet * multiplier);
    if (!Number.isSafeInteger(payout) || payout < 0) throw new Error("Invalid bet payout");
    const balanceBefore = profile.balance;
    const balanceAfter = balanceBefore - bet + payout;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) throw new Error("Invalid balance after bet");
    const operation = {
      operationId,
      userId: user.id,
      bet,
      multiplier,
      payout,
      won: multiplier > 0,
      balanceBefore,
      balanceAfter,
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
      createdAt: new Date().toISOString()
    };
    profile.balance = balanceAfter;
    this.operations[operationId] = operation;
    this.pruneOperations();
    if (!this.saveData()) {
      profile.balance = balanceBefore;
      delete this.operations[operationId];
      throw new Error("Currency storage write failed");
    }
    return { ...operation, replayed: false };
  }

  creditOnce(user, input) {
    const operationId = String(input?.operationId || "").trim();
    const amount = Number(input?.amount);
    if (!operationId || !Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid credit operation");
    const existing = this.operations[operationId];
    if (existing) {
      if (existing.type !== "credit" || String(existing.userId) !== String(user?.id) || existing.amount !== amount) {
        throw new Error("Credit idempotency conflict");
      }
      return { ...existing, replayed: true };
    }
    const profile = this.ensureUser(user);
    if (!profile) throw new Error("Currency user is required");
    const balanceBefore = profile.balance;
    const balanceAfter = balanceBefore + amount;
    if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) throw new Error("Invalid balance after credit");
    const operation = {
      operationId, type: "credit", userId: user.id, amount, balanceBefore, balanceAfter,
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
      createdAt: new Date().toISOString()
    };
    profile.balance = balanceAfter;
    this.operations[operationId] = operation;
    this.pruneOperations();
    if (!this.saveData()) {
      profile.balance = balanceBefore;
      delete this.operations[operationId];
      throw new Error("Currency storage write failed");
    }
    return { ...operation, replayed: false };
  }

  pruneOperations(now = Date.now()) {
    for (const [operationId, operation] of Object.entries(this.operations)) {
      if (Date.parse(operation.createdAt) < now - OPERATION_RETENTION_MS) delete this.operations[operationId];
    }
    const remaining = Object.entries(this.operations)
      .sort(([, left], [, right]) => String(left.createdAt).localeCompare(String(right.createdAt)));
    for (const [operationId] of remaining.slice(0, Math.max(0, remaining.length - MAX_OPERATION_RECORDS))) delete this.operations[operationId];
  }

  healthCheck() {
    const directory = require("node:path").dirname(this.filePath);
    try {
      fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
      return {
        ok: true,
        users: Object.keys(this.users).length,
        operations: Object.keys(this.operations).length,
        detail: `users=${Object.keys(this.users).length}; operations=${Object.keys(this.operations).length}`
      };
    } catch (error) {
      return { ok: false, users: 0, operations: 0, detail: error?.message || String(error) };
    }
  }
}

function isValidOperation(operation) {
  if (!operation || typeof operation !== "object" || typeof operation.operationId !== "string" ||
    !Number.isSafeInteger(operation.balanceAfter) || !Number.isFinite(Date.parse(operation.createdAt))) return false;
  return operation.type === "credit" ? Number.isSafeInteger(operation.amount) : Number.isSafeInteger(operation.bet);
}

module.exports = {
  CurrencyStore,
  DEFAULT_STARTING_BALANCE
};
