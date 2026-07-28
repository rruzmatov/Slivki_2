const fs = require("fs");

const DEFAULT_STARTING_BALANCE = 100;

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
    this.users = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.saveData({});
        return {};
      }

      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        this.saveData({});
        return {};
      }

      return Object.fromEntries(
        Object.entries(data)
          .filter(([userId, profile]) => /^\d+$/.test(userId) && profile && typeof profile === "object")
          .map(([userId, profile]) => [
            userId,
            {
              balance: Math.max(0, Math.floor(Number(profile.balance) || 0)),
              name: String(profile.name || `ID:${userId}`)
            }
          ])
      );
    } catch (error) {
      console.error("Load currency error:", error?.message || error);
      return {};
    }
  }

  saveData(data = this.users) {
    try {
      const tmpFile = `${this.filePath}.tmp`;
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
}

module.exports = {
  CurrencyStore,
  DEFAULT_STARTING_BALANCE
};
