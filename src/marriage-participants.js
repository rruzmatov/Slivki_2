const FALLBACK_USER_NAME = "Пользователь";
const DEFAULT_LOOKUP_CONCURRENCY = 4;

function getPreferredTelegramName(user) {
  const firstName = normalizeText(user?.first_name) || normalizeText(user?.firstName);
  const lastName = normalizeText(user?.last_name) || normalizeText(user?.lastName);
  if (firstName && !isPlaceholderName(firstName)) return [firstName, lastName].filter(Boolean).join(" ");

  const username = normalizeUsername(user?.username);
  return username ? `@${username}` : FALLBACK_USER_NAME;
}

function mergeTelegramIdentity(existing, incoming) {
  const userId = Number(incoming?.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TypeError("Telegram user identity requires a valid ID");
  }

  const telegramUpdate = Object.hasOwn(incoming, "first_name") || Object.hasOwn(incoming, "is_bot");
  const existingFirstName = normalizeText(existing?.firstName) || normalizeText(existing?.first_name);
  const existingLastName = normalizeText(existing?.lastName) || normalizeText(existing?.last_name);
  const firstName = telegramUpdate
    ? normalizeText(incoming.first_name) || existingFirstName || FALLBACK_USER_NAME
    : normalizeText(incoming.firstName) || existingFirstName || FALLBACK_USER_NAME;
  const lastName = telegramUpdate
    ? normalizeText(incoming.last_name)
    : normalizeText(incoming.lastName) || existingLastName;
  const username = telegramUpdate
    ? normalizeUsername(incoming.username) || "нет"
    : normalizeUsername(incoming.username) || normalizeUsername(existing?.username) || "нет";
  const isBot = telegramUpdate
    ? incoming.is_bot === true
    : incoming.isBot === true || existing?.isBot === true || existing?.is_bot === true;

  return {
    id: userId,
    firstName,
    lastName,
    username,
    isBot
  };
}

async function resolveMarriageParticipants(marriages, dependencies) {
  if (!Array.isArray(marriages)) throw new TypeError("Marriage list must be an array");
  validateDependencies(dependencies);

  const userIds = [...new Set(marriages.flatMap((marriage) => [marriage?.user1_id, marriage?.user2_id]))]
    .map(Number)
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0);
  const names = new Map();
  const unresolvedIds = [];

  for (const userId of userIds) {
    const storedUser = dependencies.getStoredUser(userId);
    const storedName = getPreferredTelegramName(storedUser);
    if (storedName !== FALLBACK_USER_NAME) {
      names.set(userId, storedName);
    } else {
      unresolvedIds.push(userId);
    }
  }

  await forEachWithConcurrency(
    unresolvedIds,
    normalizeConcurrency(dependencies.lookupConcurrency),
    async (userId) => {
      try {
        const member = await dependencies.getChatMember(dependencies.chatId, userId);
        if (!member?.user) throw new Error("Telegram chat member response has no user");
        const storedUser = dependencies.upsertUser(member.user) || member.user;
        const resolvedName = getPreferredTelegramName(storedUser);
        names.set(userId, resolvedName);
        if (resolvedName === FALLBACK_USER_NAME) {
          reportDiagnostic(dependencies.onDiagnostic, {
            code: "MARRIAGE_PARTICIPANT_NAME_MISSING",
            userId
          });
        }
      } catch (error) {
        names.set(userId, FALLBACK_USER_NAME);
        reportDiagnostic(dependencies.onDiagnostic, {
          code: "MARRIAGE_PARTICIPANT_LOOKUP_FAILED",
          userId,
          error
        });
      }
    }
  );

  return marriages.map((marriage) => ({
    ...marriage,
    user1_name: names.get(Number(marriage?.user1_id)) || FALLBACK_USER_NAME,
    user2_name: names.get(Number(marriage?.user2_id)) || FALLBACK_USER_NAME
  }));
}

async function forEachWithConcurrency(items, concurrency, callback) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await callback(item);
    }
  });
  await Promise.all(workers);
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeUsername(value) {
  const username = normalizeText(value).replace(/^@/, "");
  return username && username.toLowerCase() !== "нет" ? username : "";
}

function isPlaceholderName(value) {
  return value === FALLBACK_USER_NAME || /^ID:\d+$/i.test(value);
}

function normalizeConcurrency(value) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 10) : DEFAULT_LOOKUP_CONCURRENCY;
}

function validateDependencies(dependencies) {
  if (!dependencies || !Number.isSafeInteger(Number(dependencies.chatId))) {
    throw new TypeError("Marriage participant resolver requires a chat ID");
  }
  for (const dependency of ["getStoredUser", "getChatMember", "upsertUser"]) {
    if (typeof dependencies[dependency] !== "function") {
      throw new TypeError(`Marriage participant resolver requires ${dependency}`);
    }
  }
}

function reportDiagnostic(handler, diagnostic) {
  if (typeof handler === "function") handler(diagnostic);
}

module.exports = {
  FALLBACK_USER_NAME,
  getPreferredTelegramName,
  mergeTelegramIdentity,
  resolveMarriageParticipants
};
