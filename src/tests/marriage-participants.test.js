const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FALLBACK_USER_NAME,
  getPreferredTelegramName,
  mergeTelegramIdentity,
  resolveMarriageParticipants
} = require("../marriage-participants");

function createMarriage(overrides = {}) {
  return {
    user1_id: 1001,
    user1_name: FALLBACK_USER_NAME,
    user2_id: 2002,
    user2_name: FALLBACK_USER_NAME,
    married_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("Telegram name priority prefers full name, first name and then username", () => {
  assert.equal(getPreferredTelegramName({ first_name: "Ahrorbek", last_name: "Ruzmatov", username: "rruzmatov" }), "Ahrorbek Ruzmatov");
  assert.equal(getPreferredTelegramName({ firstName: "Шохруххон", username: "shoh" }), "Шохруххон");
  assert.equal(getPreferredTelegramName({ firstName: "Пользователь", username: "known_user" }), "@known_user");
  assert.equal(getPreferredTelegramName({ username: "known_user" }), "@known_user");
  assert.equal(getPreferredTelegramName(null), FALLBACK_USER_NAME);
});

test("Telegram update replaces changed name and removes stale optional identity fields", () => {
  const identity = mergeTelegramIdentity(
    { id: 1001, firstName: "Старое имя", lastName: "Старая фамилия", username: "old_name", isBot: false },
    { id: 1001, first_name: "Новое имя", is_bot: false }
  );
  assert.deepEqual(identity, {
    id: 1001,
    firstName: "Новое имя",
    lastName: "",
    username: "нет",
    isBot: false
  });
  assert.equal(
    mergeTelegramIdentity({ id: 2002, first_name: "Legacy name" }, { id: 2002, is_bot: false }).firstName,
    "Legacy name"
  );
});

test("marriage participants use complete names from local users storage without Telegram calls", async () => {
  const storedUsers = new Map([
    [1001, { id: 1001, firstName: "Ahrorbek", lastName: "Ruzmatov", username: "rruzmatov" }],
    [2002, { id: 2002, first_name: "Шохруххон", username: "shoh" }]
  ]);
  let apiCalls = 0;
  const [marriage] = await resolveMarriageParticipants([createMarriage()], {
    chatId: -1001,
    getStoredUser: (userId) => storedUsers.get(userId),
    getChatMember: async () => {
      apiCalls += 1;
      throw new Error("Telegram API should not be called");
    },
    upsertUser: () => null
  });
  assert.equal(marriage.user1_name, "Ahrorbek Ruzmatov");
  assert.equal(marriage.user2_name, "Шохруххон");
  assert.equal(apiCalls, 0);
});

test("missing local participants are resolved through Telegram and persisted", async () => {
  const storedUsers = new Map();
  const apiCalls = [];
  const [marriage] = await resolveMarriageParticipants([createMarriage()], {
    chatId: -1001,
    getStoredUser: (userId) => storedUsers.get(userId),
    getChatMember: async (chatId, userId) => {
      apiCalls.push([chatId, userId]);
      return {
        user: userId === 1001
          ? { id: userId, first_name: "Ahrorbek", is_bot: false }
          : { id: userId, first_name: "Шохруххон", last_name: "Абдуллаев", is_bot: false }
      };
    },
    upsertUser: (telegramUser) => {
      const profile = mergeTelegramIdentity(storedUsers.get(telegramUser.id), telegramUser);
      storedUsers.set(telegramUser.id, profile);
      return profile;
    }
  });
  assert.equal(marriage.user1_name, "Ahrorbek");
  assert.equal(marriage.user2_name, "Шохруххон Абдуллаев");
  assert.deepEqual(apiCalls, [[-1001, 1001], [-1001, 2002]]);
  assert.equal(storedUsers.get(1001).firstName, "Ahrorbek");
  assert.equal(storedUsers.get(2002).lastName, "Абдуллаев");
});

test("a Telegram rename stored from a new update is immediately used by the marriage list", async () => {
  const oldProfile = { id: 1001, firstName: "Старое имя", lastName: "", username: "old", isBot: false };
  const renamedProfile = mergeTelegramIdentity(oldProfile, {
    id: 1001,
    first_name: "Новое имя",
    last_name: "Новая фамилия",
    username: "new_name",
    is_bot: false
  });
  const storedUsers = new Map([
    [1001, renamedProfile],
    [2002, { id: 2002, firstName: "Партнёр", username: "partner" }]
  ]);
  const [marriage] = await resolveMarriageParticipants([createMarriage()], {
    chatId: -1001,
    getStoredUser: (userId) => storedUsers.get(userId),
    getChatMember: async () => {
      throw new Error("Telegram API should not be called");
    },
    upsertUser: () => null
  });
  assert.equal(marriage.user1_name, "Новое имя Новая фамилия");
  assert.doesNotMatch(marriage.user1_name, /Старое/);
});

test("the fallback name is used only when storage and Telegram lookup both fail", async () => {
  const diagnostics = [];
  const [marriage] = await resolveMarriageParticipants([createMarriage()], {
    chatId: -1001,
    getStoredUser: () => null,
    getChatMember: async () => {
      throw new Error("member unavailable");
    },
    upsertUser: () => null,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  assert.equal(marriage.user1_name, FALLBACK_USER_NAME);
  assert.equal(marriage.user2_name, FALLBACK_USER_NAME);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every(({ code }) => code === "MARRIAGE_PARTICIPANT_LOOKUP_FAILED"));
});
