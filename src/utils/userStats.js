const fs = require("fs");
const path = require("path");

const USER_STATS_FILE = path.join(
  __dirname,
  "..",
  "data",
  "user-stats.json"
);

/**
 * Создаёт папку и JSON-файл, если они ещё не существуют.
 */
function ensureUserStatsFile() {
  const dataDirectory = path.dirname(USER_STATS_FILE);

  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }

  if (!fs.existsSync(USER_STATS_FILE)) {
    fs.writeFileSync(
      USER_STATS_FILE,
      JSON.stringify({}, null, 2),
      "utf8"
    );
  }
}

/**
 * Загружает всю статистику пользователей.
 */
function loadUserStats() {
  ensureUserStatsFile();

  try {
    const fileContent = fs.readFileSync(USER_STATS_FILE, "utf8");

    if (!fileContent.trim()) {
      return {};
    }

    const parsedData = JSON.parse(fileContent);

    if (
      typeof parsedData !== "object" ||
      parsedData === null ||
      Array.isArray(parsedData)
    ) {
      console.error(
        "user-stats.json имеет неправильную структуру. Используется пустой объект."
      );

      return {};
    }

    return parsedData;
  } catch (error) {
    console.error(
      "Ошибка при чтении user-stats.json:",
      error.message
    );

    return {};
  }
}

/**
 * Сохраняет всю статистику пользователей в JSON.
 */
function saveUserStats(allStats) {
  ensureUserStatsFile();

  try {
    fs.writeFileSync(
      USER_STATS_FILE,
      JSON.stringify(allStats, null, 2),
      "utf8"
    );

    return true;
  } catch (error) {
    console.error(
      "Ошибка при сохранении user-stats.json:",
      error.message
    );

    return false;
  }
}

/**
 * Создаёт пустую статистику для нового пользователя.
 */
function createDefaultUserStats(user = {}) {
  const now = Date.now();

  return {
    telegramId: user.id ? String(user.id) : null,
    firstName: user.first_name || "",
    lastName: user.last_name || "",
    username: user.username || "",

    messages: 0,
    commands: 0,
    rpActions: 0,

    gameWins: 0,
    gameLosses: 0,

    casinoGames: 0,
    casinoWins: 0,
    casinoLosses: 0,

    quizAnswers: 0,
    quizCorrectAnswers: 0,

    warnsReceived: 0,
    mutesReceived: 0,
    bansReceived: 0,

    reputation: 0,

    registeredAt: now,
    lastActiveAt: now
  };
}

/**
 * Возвращает статистику пользователя.
 * Если статистики ещё нет — создаёт её.
 */
function getOrCreateUserStats(user) {
  if (!user || !user.id) {
    throw new Error(
      "getOrCreateUserStats: не передан пользователь или user.id"
    );
  }

  const allStats = loadUserStats();
  const userId = String(user.id);

  if (!allStats[userId]) {
    allStats[userId] = createDefaultUserStats(user);
  }

  // Обновляем данные Telegram, потому что имя и username могут измениться.
  allStats[userId].telegramId = userId;
  allStats[userId].firstName = user.first_name || "";
  allStats[userId].lastName = user.last_name || "";
  allStats[userId].username = user.username || "";
  allStats[userId].lastActiveAt = Date.now();

  saveUserStats(allStats);

  return allStats[userId];
}

/**
 * Частично обновляет статистику пользователя.
 *
 * Пример:
 * updateUserStats(user, {
 *   messages: 100,
 *   reputation: 5
 * });
 */
function updateUserStats(user, updates = {}) {
  if (!user || !user.id) {
    throw new Error(
      "updateUserStats: не передан пользователь или user.id"
    );
  }

  const allStats = loadUserStats();
  const userId = String(user.id);

  if (!allStats[userId]) {
    allStats[userId] = createDefaultUserStats(user);
  }

  allStats[userId] = {
    ...allStats[userId],
    ...updates,

    telegramId: userId,
    firstName: user.first_name || allStats[userId].firstName || "",
    lastName: user.last_name || allStats[userId].lastName || "",
    username: user.username || allStats[userId].username || "",
    lastActiveAt: Date.now()
  };

  saveUserStats(allStats);

  return allStats[userId];
}

/**
 * Увеличивает определённый счётчик.
 *
 * Пример:
 * incrementUserStat(user, "messages");
 * incrementUserStat(user, "reputation", 5);
 */
function incrementUserStat(user, fieldName, amount = 1) {
  if (!user || !user.id) {
    throw new Error(
      "incrementUserStat: не передан пользователь или user.id"
    );
  }

  const allStats = loadUserStats();
  const userId = String(user.id);

  if (!allStats[userId]) {
    allStats[userId] = createDefaultUserStats(user);
  }

  const currentValue = Number(allStats[userId][fieldName]) || 0;
  const incrementAmount = Number(amount) || 0;

  allStats[userId][fieldName] =
    currentValue + incrementAmount;

  allStats[userId].telegramId = userId;
  allStats[userId].firstName =
    user.first_name || allStats[userId].firstName || "";
  allStats[userId].lastName =
    user.last_name || allStats[userId].lastName || "";
  allStats[userId].username =
    user.username || allStats[userId].username || "";
  allStats[userId].lastActiveAt = Date.now();

  saveUserStats(allStats);

  return allStats[userId];
}

/**
 * Получает статистику только по Telegram ID.
 * Ничего не создаёт, если пользователя нет.
 */
function getUserStatsById(telegramId) {
  if (!telegramId) {
    return null;
  }

  const allStats = loadUserStats();
  const userId = String(telegramId);

  return allStats[userId] || null;
}

module.exports = {
  loadUserStats,
  saveUserStats,
  createDefaultUserStats,
  getOrCreateUserStats,
  updateUserStats,
  incrementUserStat,
  getUserStatsById
};