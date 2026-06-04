require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const botToken = process.env.BOT_TOKEN;
const ownerIds = (process.env.OWNER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map((id) => Number(id))
  .filter((id) => Number.isSafeInteger(id));

if (!botToken) {
  console.error("Ошибка: BOT_TOKEN не найден в файле .env");
  process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: true });

const PREMIUM_EMOJI_FILE = path.join(__dirname, "premium-emojis.json");
const savedPremiumEmojiIds = loadPremiumEmojiIds();
const RP_PREMIUM_EMOJI = {
  ...(savedPremiumEmojiIds.rp && typeof savedPremiumEmojiIds.rp === "object" ? savedPremiumEmojiIds.rp : {})
};
const RP_COMMAND_PREMIUM_EMOJI = {
  ...(savedPremiumEmojiIds.rpCommands && typeof savedPremiumEmojiIds.rpCommands === "object" ? savedPremiumEmojiIds.rpCommands : {})
};
let rpCommandsReady = false;

// Возвращает custom_emoji_id из .env или сохранённого JSON.
// Формат env: PREMIUM_EMOJI_MENU_ID=1234567890123456789
function getPremiumEmojiId(key) {
  const envKey = `PREMIUM_EMOJI_${key.toUpperCase()}_ID`;
  return process.env[envKey] || savedPremiumEmojiIds[key] || "";
}

// Единое хранилище premium emoji ID. Если значение пустое, бот оставляет обычный emoji.
const PREMIUM_EMOJI = {
  menu: getPremiumEmojiId("menu"),
  commands: getPremiumEmojiId("commands"),
  profile: getPremiumEmojiId("profile"),
  stats: getPremiumEmojiId("stats"),
  admin: getPremiumEmojiId("admin"),
  warn: getPremiumEmojiId("warn"),
  mute: getPremiumEmojiId("mute"),
  ban: getPremiumEmojiId("ban"),
  kick: getPremiumEmojiId("kick"),
  lock: getPremiumEmojiId("lock"),
  unlock: getPremiumEmojiId("unlock"),
  hug: getPremiumEmojiId("hug"),
  kiss: getPremiumEmojiId("kiss"),
  hit: getPremiumEmojiId("hit"),
  kill: getPremiumEmojiId("kill"),
  shield: getPremiumEmojiId("shield"),
  dragon: getPremiumEmojiId("dragon"),
  rocket: getPremiumEmojiId("rocket"),
  success: getPremiumEmojiId("success"),
  error: getPremiumEmojiId("error"),
  top: getPremiumEmojiId("top"),
  rules: getPremiumEmojiId("rules"),
  logs: getPremiumEmojiId("logs"),
  info: getPremiumEmojiId("info"),
  id: getPremiumEmojiId("id"),
  gift: getPremiumEmojiId("gift"),
  game: getPremiumEmojiId("game"),
  dice: getPremiumEmojiId("dice"),
  heart: getPremiumEmojiId("heart"),
  premium: getPremiumEmojiId("premium")
};

// Обычные emoji, которые показываются в тексте и заменяются на premium через entities,
// если для соответствующего ключа заполнен PREMIUM_EMOJI[key].
const PREMIUM_EMOJI_FALLBACK = {
  menu: "📋",
  commands: "📜",
  profile: "👤",
  stats: "📊",
  admin: "⚙️",
  warn: "⚠️",
  mute: "🔇",
  ban: "🚫",
  kick: "👢",
  lock: "🔒",
  unlock: "🔓",
  hug: "🫂",
  kiss: "💋",
  hit: "👊",
  kill: "🎭",
  shield: "🛡️",
  dragon: "🐉",
  rocket: "🚀",
  success: "✅",
  error: "❌",
  top: "🏆",
  rules: "📖",
  logs: "📋",
  info: "ℹ️",
  id: "🆔",
  gift: "🎁",
  game: "🎮",
  dice: "🎲",
  heart: "❤️",
  premium: "💎"
};

const originalSendMessage = bot.sendMessage.bind(bot);
const originalEditMessageText = bot.editMessageText.bind(bot);

// Загружает сохранённые custom_emoji_id из src/premium-emojis.json.
// Этот файл можно заполнить вручную или через команду /emojiid.
function loadPremiumEmojiIds() {
  try {
    if (!fs.existsSync(PREMIUM_EMOJI_FILE)) {
      return {};
    }

    const data = JSON.parse(fs.readFileSync(PREMIUM_EMOJI_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {};
    }

    return data;
  } catch (error) {
    console.error("Load premium emoji ids error:", getErrorMessage(error));
    return {};
  }
}

// Сохраняет текущие custom_emoji_id, чтобы после перезапуска бот продолжал использовать premium emoji.
function savePremiumEmojiIds() {
  const data = {};

  for (const [key, id] of Object.entries(PREMIUM_EMOJI)) {
    if (id) {
      data[key] = id;
    }
  }

  if (Object.keys(RP_PREMIUM_EMOJI).length > 0) {
    data.rp = { ...RP_PREMIUM_EMOJI };
  }

  if (Object.keys(RP_COMMAND_PREMIUM_EMOJI).length > 0) {
    data.rpCommands = { ...RP_COMMAND_PREMIUM_EMOJI };
  }

  writeJsonFile(PREMIUM_EMOJI_FILE, data, "Save premium emoji ids");
}

// Запоминает premium ID для всех RP-команд с таким же обычным emoji.
// Это покрывает все RP-действия, а не только ключевые hug/kiss/hit/kill.
function rememberRpPremiumEmojiId(emoji, customEmojiId) {
  if (!emoji || !customEmojiId) return false;

  const changed = RP_PREMIUM_EMOJI[emoji] !== customEmojiId;
  RP_PREMIUM_EMOJI[emoji] = customEmojiId;

  if (rpCommandsReady) {
    syncRpCommandEmojiIds();
  }

  return changed;
}

// Запоминает premium ID для одной конкретной RP-команды.
// Использование: ответить /emojiid обнять на сообщение с premium emoji.
function rememberRpCommandPremiumEmojiId(commandName, customEmojiId) {
  if (!commandName || !customEmojiId || !RP_COMMANDS[commandName]) return false;

  const changed = RP_COMMAND_PREMIUM_EMOJI[commandName] !== customEmojiId;
  RP_COMMAND_PREMIUM_EMOJI[commandName] = customEmojiId;

  if (rpCommandsReady) {
    syncRpCommandEmojiIds();
  }

  return changed;
}

// Достаёт все custom_emoji entities из text/caption сообщения Telegram.
function getCustomEmojiIdsFromMessage(message) {
  const text = message?.text || message?.caption || "";
  const entities = message?.entities || message?.caption_entities || [];

  return entities
    .filter((entity) => entity.type === "custom_emoji" && entity.custom_emoji_id)
    .map((entity) => ({
      emoji: text.slice(entity.offset, entity.offset + entity.length),
      customEmojiId: entity.custom_emoji_id
    }));
}

function extractCustomEmojiEntities(msg) {
  if (!msg) return [];

  const sources = [
    { text: msg.text, entities: msg.entities },
    { text: msg.caption, entities: msg.caption_entities }
  ];

  return sources.flatMap(({ text, entities }) => {
    if (!text || !Array.isArray(entities)) return [];

    return entities
      .filter((entity) => entity.type === "custom_emoji" && entity.custom_emoji_id)
      .map((entity) => ({
        emoji: text.slice(entity.offset, entity.offset + entity.length),
        customEmojiId: entity.custom_emoji_id,
        offset: entity.offset,
        length: entity.length
      }));
  });
}

// Если пользователь прислал premium emoji, который совпадает с нашим fallback emoji,
// бот автоматически запоминает его custom_emoji_id для соответствующего ключа.
function rememberPremiumEmojiIdsFromMessage(msg) {
  const customEmojiEntities = extractCustomEmojiEntities(msg);
  if (customEmojiEntities.length === 0) return;

  let changed = false;

  for (const entity of customEmojiEntities) {
    if (rememberRpPremiumEmojiId(entity.emoji, entity.customEmojiId)) {
      changed = true;
      console.log(`RP premium emoji learned: ${entity.emoji} -> ${entity.customEmojiId}`);
    }

    const matched = Object.entries(PREMIUM_EMOJI_FALLBACK)
      .find(([, emoji]) => emoji === entity.emoji);

    if (!matched) continue;

    const [key] = matched;

    if (!PREMIUM_EMOJI[key]) {
      PREMIUM_EMOJI[key] = entity.customEmojiId;
      syncRpCommandEmojiIds();
      changed = true;
      console.log(`Premium emoji learned: ${key} -> ${entity.customEmojiId}`);
    }
  }

  if (changed) {
    savePremiumEmojiIds();
  }
}

// Создаёт объект emoji/id из ключа PREMIUM_EMOJI.
function getPremiumEmojiItem(key) {
  return {
    key,
    emoji: PREMIUM_EMOJI_FALLBACK[key] || "",
    id: PREMIUM_EMOJI[key] || ""
  };
}

// Возвращает все premium emoji в формате, удобном для buildPremiumEntities.
function getAllPremiumEmojiItems() {
  return Object.keys(PREMIUM_EMOJI).map(getPremiumEmojiItem);
}

// Нормализует входные emoji-описания: ключи, RP-команды или готовые { emoji, id }.
function normalizePremiumEmojiItem(item) {
  if (typeof item === "string") return getPremiumEmojiItem(item);
  if (item?.emoji && item?.id !== undefined) return item;
  if (item?.emoji && item?.customEmojiId !== undefined) {
    return {
      emoji: item.emoji,
      id: item.customEmojiId
    };
  }
  return null;
}

// Оставляет только те emoji, у которых есть и fallback emoji, и custom_emoji_id.
function getPremiumEmojiItems(emojiItems = getAllPremiumEmojiItems()) {
  return emojiItems
    .map(normalizePremiumEmojiItem)
    .filter((item) => item?.emoji && item?.id);
}

function entityOverlaps(entity, entities = []) {
  const start = entity.offset;
  const end = entity.offset + entity.length;

  return entities.some((existing) => {
    const existingStart = existing.offset;
    const existingEnd = existing.offset + existing.length;
    return start < existingEnd && end > existingStart;
  });
}

// Находит emoji в тексте и строит Telegram MessageEntity custom_emoji для каждого найденного premium emoji.
function buildPremiumEntities(text, emojiItems) {
  const entities = [];

  for (const item of getPremiumEmojiItems(emojiItems)) {
    let offset = String(text).indexOf(item.emoji);

    while (offset !== -1) {
      const entity = {
        type: "custom_emoji",
        offset,
        length: item.emoji.length,
        custom_emoji_id: item.id
      };

      if (!entityOverlaps(entity, entities)) {
        entities.push(entity);
      }

      offset = String(text).indexOf(item.emoji, offset + item.emoji.length);
    }
  }

  return entities;
}

// Добавляет icon_custom_emoji_id в inline-кнопки, когда Bot API и заполненный premium id это поддерживают.
function applyPremiumInlineKeyboardIcons(replyMarkup, emojiItems = getAllPremiumEmojiItems()) {
  if (!replyMarkup?.inline_keyboard) return replyMarkup;

  return {
    ...replyMarkup,
    inline_keyboard: replyMarkup.inline_keyboard.map((row) => {
      return row.map((button) => {
        const premium = getPremiumEmojiItems(emojiItems).find((item) => {
          return typeof button.text === "string" && button.text.includes(item.emoji);
        });

        if (!premium) return button;

        const textWithoutEmoji = button.text.replace(premium.emoji, "").trim();

        return {
          ...button,
          text: textWithoutEmoji || button.text,
          icon_custom_emoji_id: premium.id
        };
      });
    })
  };
}

// Собирает options для отправки/редактирования сообщения с premium entities и premium-иконками кнопок.
function buildPremiumMessageOptions(text, emojiItems, options = {}) {
  const nextOptions = {
    ...options,
    reply_markup: applyPremiumInlineKeyboardIcons(options.reply_markup, emojiItems)
  };

  if (nextOptions.parse_mode) {
    return nextOptions;
  }

  const existingEntities = Array.isArray(nextOptions.entities) ? nextOptions.entities : [];
  const premiumEntities = buildPremiumEntities(text, emojiItems)
    .filter((entity) => !entityOverlaps(entity, existingEntities));
  const entities = existingEntities.concat(premiumEntities);

  if (entities.length > 0) {
    nextOptions.entities = entities;
  }

  return nextOptions;
}

// Отправляет сообщение с premium emoji entities и автоматически откатывается на обычный текст при ошибке.
async function sendPremiumMessage(chatId, text, emojiItems, options = {}) {
  const premiumOptions = buildPremiumMessageOptions(text, emojiItems, options);

  try {
    return await originalSendMessage(chatId, text, premiumOptions);
  } catch (error) {
    console.error("Premium message error:", getErrorMessage(error));
    return originalSendMessage(chatId, text, options);
  }
}

// Редактирует сообщение с тем же premium-слоем, что и sendPremiumMessage.
async function editPremiumMessageText(text, options = {}) {
  const premiumOptions = buildPremiumMessageOptions(text, getAllPremiumEmojiItems(), options);

  try {
    return await originalEditMessageText(text, premiumOptions);
  } catch (error) {
    console.error("Premium edit message error:", getErrorMessage(error));
    return originalEditMessageText(text, options);
  }
}

bot.sendMessage = (chatId, text, options = {}) => {
  return sendPremiumMessage(chatId, text, getAllPremiumEmojiItems(), options);
};

bot.editMessageText = (text, options = {}) => {
  return editPremiumMessageText(text, options);
};

bot.on("message", (msg) => {
  rememberPremiumEmojiIdsFromMessage(msg);
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", getErrorMessage(error));
});

bot.on("webhook_error", (error) => {
  console.error("Webhook error:", getErrorMessage(error));
});

console.log("🍦 Сливки Бот запущен");

const users = new Map();
const chatUsers = new Map();
const muteTimers = new Map();
let adminLogs = new Map();
let botId = null;

const pendingMarriages = new Map();
const supportUsers = new Set();

const chatRules = new Map();
const waitingRulesInput = new Set();
const autoKickSettings = new Map();
const userLeftHistory = new Map();
const joinLeaveSettings = new Map();

const STATS_FILE = path.join(__dirname, "stats.json");
const CHATS_FILE = path.join(__dirname, "chats.json");
const USERS_FILE = path.join(__dirname, "users.json");
const MARRIAGES_FILE = path.join(__dirname, "marriages.json");
const COMMAND_SETTINGS_FILE = path.join(__dirname, "command-settings.json");
const ADMIN_LOGS_FILE = path.join(__dirname, "admin-logs.json");
const CHAT_SETTINGS_FILE = path.join(__dirname, "chat-settings.json");

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const MAX_SAFE_REPLY_LENGTH = 3900;
const MAX_MUTE_SECONDS = 365 * 24 * 60 * 60;
const MAX_NODE_TIMER_MS = 2147483647;

const DEFAULT_JOIN_LEAVE_SETTINGS = {
  joins: true,
  leaves: true,
  leaveMinMessages: 0
};

const stats = loadStats();
const chatInfo = loadChatInfo();
const marriages = loadMarriages();
const savedUsers = loadUsers();
adminLogs = loadAdminLogs();
const savedChatSettings = loadChatSettings();

for (const [id, user] of savedUsers) {
  users.set(id, user);
}

for (const [chatId, info] of chatInfo) {
  if (Array.isArray(info.users)) {
    chatUsers.set(chatId, new Set(info.users.map(Number).filter(Number.isFinite)));
  }
}

for (const [chatId, rules] of savedChatSettings.rules) {
  chatRules.set(chatId, rules);
}

for (const [chatId, settings] of savedChatSettings.autoKickSettings) {
  autoKickSettings.set(chatId, settings);
}

for (const [chatId, settings] of savedChatSettings.joinLeaveSettings) {
  joinLeaveSettings.set(chatId, settings);
}

console.log("Users file:", USERS_FILE);
console.log("Saved users loaded:", users.size);

function getErrorMessage(error) {
  return (
    error?.response?.body?.description ||
    error?.message ||
    "неизвестная ошибка"
  );
}

function writeJsonFile(filePath, data, label) {
  try {
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpFile, filePath);
    return true;
  } catch (error) {
    console.error(`${label} error:`, getErrorMessage(error));
    return false;
  }
}

function truncateTelegramText(text) {
  const value = String(text);

  if (value.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
    return value;
  }

  return value.slice(0, MAX_SAFE_REPLY_LENGTH) + "\n\n…сообщение сокращено";
}

async function sendMessageSafe(chatId, text, options = {}, context = "sendMessage") {
  try {
    return await bot.sendMessage(chatId, truncateTelegramText(text), options);
  } catch (error) {
    console.error(`${context} error:`, getErrorMessage(error));
    return null;
  }
}

async function answerCallbackSafe(queryId, options = {}) {
  try {
    return await bot.answerCallbackQuery(queryId, options);
  } catch (error) {
    console.error("answerCallbackQuery error:", getErrorMessage(error));
    return null;
  }
}

function normalizeJoinLeaveSettings(settings = {}) {
  return {
    joins: settings.joins !== false,
    leaves: settings.leaves !== false,
    leaveMinMessages: Number.isInteger(Number(settings.leaveMinMessages))
      ? Math.max(0, Number(settings.leaveMinMessages))
      : DEFAULT_JOIN_LEAVE_SETTINGS.leaveMinMessages
  };
}

function normalizeAutoKickSetting(setting) {
  if (!setting || typeof setting !== "object") return null;

  const count = Number(setting.count);
  const time = Number(setting.time);
  const action = setting.action === "ban" ? "ban" : "kick";

  if (!Number.isInteger(count) || count < 1) return null;
  if (!Number.isInteger(time) || time < 1) return null;

  return {
    enabled: setting.enabled === true,
    count,
    time,
    action
  };
}

function loadChatSettings() {
  try {
    if (!fs.existsSync(CHAT_SETTINGS_FILE)) {
      return {
        rules: new Map(),
        autoKickSettings: new Map(),
        joinLeaveSettings: new Map()
      };
    }

    const data = JSON.parse(fs.readFileSync(CHAT_SETTINGS_FILE, "utf8"));
    const rules = new Map();
    const loadedAutoKickSettings = new Map();
    const loadedJoinLeaveSettings = new Map();

    if (data?.rules && typeof data.rules === "object" && !Array.isArray(data.rules)) {
      for (const [chatId, text] of Object.entries(data.rules)) {
        const numericChatId = Number(chatId);

        if (Number.isFinite(numericChatId) && typeof text === "string" && text.trim()) {
          rules.set(numericChatId, text.trim());
        }
      }
    }

    if (data?.autoKickSettings && typeof data.autoKickSettings === "object" && !Array.isArray(data.autoKickSettings)) {
      for (const [chatId, setting] of Object.entries(data.autoKickSettings)) {
        const numericChatId = Number(chatId);
        const normalized = normalizeAutoKickSetting(setting);

        if (Number.isFinite(numericChatId) && normalized) {
          loadedAutoKickSettings.set(numericChatId, normalized);
        }
      }
    }

    if (data?.joinLeaveSettings && typeof data.joinLeaveSettings === "object" && !Array.isArray(data.joinLeaveSettings)) {
      for (const [chatId, setting] of Object.entries(data.joinLeaveSettings)) {
        const numericChatId = Number(chatId);

        if (Number.isFinite(numericChatId)) {
          loadedJoinLeaveSettings.set(numericChatId, normalizeJoinLeaveSettings(setting));
        }
      }
    }

    return {
      rules,
      autoKickSettings: loadedAutoKickSettings,
      joinLeaveSettings: loadedJoinLeaveSettings
    };
  } catch (error) {
    console.error("Load chat settings error:", getErrorMessage(error));
    return {
      rules: new Map(),
      autoKickSettings: new Map(),
      joinLeaveSettings: new Map()
    };
  }
}

function saveChatSettings() {
  writeJsonFile(
    CHAT_SETTINGS_FILE,
    {
      rules: Object.fromEntries(chatRules),
      autoKickSettings: Object.fromEntries(autoKickSettings),
      joinLeaveSettings: Object.fromEntries(joinLeaveSettings)
    },
    "Save chat settings"
  );
}

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .map(([id, user]) => [Number(id), user])
        .filter(([id, user]) => Number.isFinite(id) && user && typeof user === "object")
    );
  } catch (error) {
    console.error("Load users error:", getErrorMessage(error));
    return new Map();
  }
}

function saveUsers() {
  writeJsonFile(USERS_FILE, Object.fromEntries(users), "Save users");
}

function loadAdminLogs() {
  try {
    if (!fs.existsSync(ADMIN_LOGS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(ADMIN_LOGS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .filter(([, logs]) => Array.isArray(logs))
        .map(([chatId, logs]) => [Number(chatId), logs.slice(0, 50)])
        .filter(([chatId]) => Number.isFinite(chatId))
    );
  } catch (error) {
    console.error("Load admin logs error:", getErrorMessage(error));
    return new Map();
  }
}

function saveAdminLogs() {
  writeJsonFile(ADMIN_LOGS_FILE, Object.fromEntries(adminLogs), "Save admin logs");
}

function getTashkentDateInfo() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) {
      return {
        messagesToday: 0,
        chatMessagesToday: {},
        lastResetDate: getTashkentDateInfo().date
      };
    }

    const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

    return {
      messagesToday: Number(data.messagesToday) || 0,
      chatMessagesToday: data.chatMessagesToday && typeof data.chatMessagesToday === "object" ? data.chatMessagesToday : {},
      lastResetDate: data.lastResetDate || getTashkentDateInfo().date
    };
  } catch (error) {
    console.error("Load stats error:", getErrorMessage(error));
    return {
      messagesToday: 0,
      chatMessagesToday: {},
      lastResetDate: getTashkentDateInfo().date
    };
  }
}

function saveStats() {
  writeJsonFile(STATS_FILE, stats, "Save stats");
}

function loadChatInfo() {
  try {
    if (!fs.existsSync(CHATS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .map(([chatId, info]) => [Number(chatId), info])
        .filter(([chatId, info]) => Number.isFinite(chatId) && info && typeof info === "object")
    );
  } catch (error) {
    console.error("Load chats error:", getErrorMessage(error));
    return new Map();
  }
}

function saveChatInfo() {
  writeJsonFile(CHATS_FILE, Object.fromEntries(chatInfo), "Save chats");
}

function loadMarriages() {
  try {
    if (!fs.existsSync(MARRIAGES_FILE)) {
      writeJsonFile(MARRIAGES_FILE, {}, "Init marriages");
      return new Map();
    }

    const fileContent = fs.readFileSync(MARRIAGES_FILE, "utf8").trim();

    if (!fileContent) {
      writeJsonFile(MARRIAGES_FILE, {}, "Init marriages");
      return new Map();
    }

    const data = JSON.parse(fileContent);

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .map(([chatId, chatMarriages]) => [Number(chatId), chatMarriages])
        .filter(([chatId, chatMarriages]) => Number.isFinite(chatId) && chatMarriages && typeof chatMarriages === "object" && !Array.isArray(chatMarriages))
    );
  } catch (error) {
    console.error("Load marriages error:", getErrorMessage(error));
    writeJsonFile(MARRIAGES_FILE, {}, "Reset marriages");
    return new Map();
  }
}

function saveMarriages() {
  writeJsonFile(MARRIAGES_FILE, Object.fromEntries(marriages), "Save marriages");
}

function writeCommandSettings(settings) {
  writeJsonFile(COMMAND_SETTINGS_FILE, Object.fromEntries(settings), "Save command settings");
}

function loadCommandSettings() {
  const settings = new Map(DEFAULT_COMMAND_SETTINGS);

  try {
    if (!fs.existsSync(COMMAND_SETTINGS_FILE)) {
      writeCommandSettings(settings);
      return settings;
    }

    const data = JSON.parse(fs.readFileSync(COMMAND_SETTINGS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      writeCommandSettings(settings);
      return settings;
    }

    for (const [commandName] of DEFAULT_COMMAND_SETTINGS) {
      if (typeof data[commandName] === "boolean") {
        settings.set(commandName, data[commandName]);
      }
    }

    writeCommandSettings(settings);
  } catch (error) {
    console.error("Load command settings error:", getErrorMessage(error));
  }

  return settings;
}

function saveCommandSettings() {
  try {
    writeCommandSettings(commandSettings);
  } catch (error) {
    console.error("Save command settings error:", getErrorMessage(error));
  }
}

function getChatMarriages(chatId) {
  if (!marriages.has(chatId)) {
    marriages.set(chatId, {});
  }

  return marriages.get(chatId);
}

function getMarriagePartnerId(chatId, userId) {
  const chatMarriages = getChatMarriages(chatId);
  const partnerId = chatMarriages[userId];
  return partnerId ? Number(partnerId) : null;
}

function setMarriage(chatId, firstUserId, secondUserId) {
  const chatMarriages = getChatMarriages(chatId);
  chatMarriages[firstUserId] = secondUserId;
  chatMarriages[secondUserId] = firstUserId;
  saveMarriages();
}

function removeMarriage(chatId, userId) {
  const chatMarriages = getChatMarriages(chatId);
  const partnerId = chatMarriages[userId];

  if (!partnerId) return null;

  delete chatMarriages[userId];
  delete chatMarriages[partnerId];
  saveMarriages();

  return Number(partnerId);
}

function createMarriageProposal(chatId, firstUserId, secondUserId, percent) {
  const proposalId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  pendingMarriages.set(proposalId, {
    chatId,
    firstUserId,
    secondUserId,
    percent
  });

  setTimeout(() => {
    pendingMarriages.delete(proposalId);
  }, 10 * 60 * 1000);

  return proposalId;
}

const RP_COMMANDS = {
  "удар": { emoji: PREMIUM_EMOJI_FALLBACK.hit, customEmojiId: PREMIUM_EMOJI.hit, actionText: "ударил" },
  "ударить": { emoji: PREMIUM_EMOJI_FALLBACK.hit, customEmojiId: PREMIUM_EMOJI.hit, actionText: "ударил" },
  "убить": { emoji: PREMIUM_EMOJI_FALLBACK.kill, customEmojiId: PREMIUM_EMOJI.kill, actionText: "убил" },
  "пнуть": { emoji: "🦵", customEmojiId: PREMIUM_EMOJI.kick, actionText: "пнул" },
  "толкнуть": { emoji: "🤜", customEmojiId: "", actionText: "толкнул" },
  "обнять": { emoji: PREMIUM_EMOJI_FALLBACK.hug, customEmojiId: PREMIUM_EMOJI.hug, actionText: "обнял" },
  "поцеловать": { emoji: PREMIUM_EMOJI_FALLBACK.kiss, customEmojiId: PREMIUM_EMOJI.kiss, actionText: "поцеловал" },
  "погладить": { emoji: "🐱", customEmojiId: "", actionText: "погладил" },
  "укусить": { emoji: "😈", customEmojiId: "", actionText: "укусил" },
  "ущипнуть": { emoji: "👌", customEmojiId: "", actionText: "ущипнул" },
  "защитить": { emoji: PREMIUM_EMOJI_FALLBACK.shield, customEmojiId: PREMIUM_EMOJI.shield, actionText: "защитил" },
  "спасти": { emoji: PREMIUM_EMOJI_FALLBACK.heart, customEmojiId: PREMIUM_EMOJI.heart, actionText: "спас" },
  "поддержать": { emoji: "🤝", customEmojiId: "", actionText: "поддержал" },
  "похвалить": { emoji: "🌟", customEmojiId: "", actionText: "похвалил" },
  "накормить": { emoji: "🍽️", customEmojiId: "", actionText: "накормил" },
  "напоить": { emoji: "🥤", customEmojiId: "", actionText: "напоил" },
  "угостить": { emoji: "🍬", customEmojiId: "", actionText: "угостил" },
  "подарить": { emoji: PREMIUM_EMOJI_FALLBACK.gift, customEmojiId: PREMIUM_EMOJI.gift, actionText: "подарил подарок" },
  "рассмешить": { emoji: "😂", customEmojiId: "", actionText: "рассмешил" },
  "развеселить": { emoji: "🥳", customEmojiId: "", actionText: "развеселил" },
  "удивить": { emoji: "😲", customEmojiId: "", actionText: "удивил" },
  "напугать": { emoji: "👻", customEmojiId: "", actionText: "напугал" },
  "разозлить": { emoji: "😡", customEmojiId: "", actionText: "разозлил" },
  "простить": { emoji: "🕊️", customEmojiId: "", actionText: "простил" },
  "поздравить": { emoji: "🎉", customEmojiId: "", actionText: "поздравил" },
  "пожать руку": { emoji: "🤝", customEmojiId: "", actionText: "пожал руку" },
  "дать пять": { emoji: "🙏", customEmojiId: "", actionText: "дал пять" },
  "дать леща": { emoji: "🐟", customEmojiId: "", actionText: "дал леща" },
  "дать подзатыльник": { emoji: "👋", customEmojiId: "", actionText: "дал подзатыльник" },
  "дать пендель": { emoji: "🦵", customEmojiId: "", actionText: "дал пендель" },
  "облить водой": { emoji: "💧", customEmojiId: "", actionText: "облил водой" },
  "закидать помидорами": { emoji: "🍅", customEmojiId: "", actionText: "закидал помидорами" },
  "ударить рыбой": { emoji: "🐟", customEmojiId: "", actionText: "ударил рыбой" },
  "кинуть тапок": { emoji: "🩴", customEmojiId: "", actionText: "кинул тапок" },
  "кинуть подушку": { emoji: "🛏️", customEmojiId: "", actionText: "кинул подушку" },
  "кинуть банан": { emoji: "🍌", customEmojiId: "", actionText: "кинул банан" },
  "кинуть арбуз": { emoji: "🍉", customEmojiId: "", actionText: "кинул арбуз" },
  "разбудить": { emoji: "⏰", customEmojiId: "", actionText: "разбудил" },
  "усыпить": { emoji: "😴", customEmojiId: "", actionText: "усыпил" },
  "заморозить": { emoji: "🧊", customEmojiId: "", actionText: "заморозил" },
  "поджечь": { emoji: "🔥", customEmojiId: "", actionText: "поджёг" },
  "заколдовать": { emoji: "🪄", customEmojiId: "", actionText: "заколдовал" },
  "благословить": { emoji: "✨", customEmojiId: "", actionText: "благословил" },
  "проклясть": { emoji: "🧿", customEmojiId: "", actionText: "проклял" },
  "превратить": { emoji: "🐸", customEmojiId: "", actionText: "превратил" },
  "телепортировать": { emoji: "🌀", customEmojiId: "", actionText: "телепортировал" },
  "воскресить": { emoji: "💫", customEmojiId: "", actionText: "воскресил" },
  "призвать дракона": { emoji: PREMIUM_EMOJI_FALLBACK.dragon, customEmojiId: PREMIUM_EMOJI.dragon, actionText: "призвал дракона" },
  "призвать феникса": { emoji: "🔥", customEmojiId: "", actionText: "призвал феникса" },
  "призвать хомяков": { emoji: "🐹", customEmojiId: "", actionText: "призвал хомяков" },
  "призвать пингвинов": { emoji: "🐧", customEmojiId: "", actionText: "призвал пингвинов" },
  "призвать курицу": { emoji: "🐔", customEmojiId: "", actionText: "призвал курицу" },
  "призвать уток": { emoji: "🦆", customEmojiId: "", actionText: "призвал уток" },
  "атаковать": { emoji: "⚔️", customEmojiId: "", actionText: "атаковал" },
  "контратаковать": { emoji: "🗡️", customEmojiId: "", actionText: "контратаковал" },
  "обезоружить": { emoji: "🛡️", customEmojiId: "", actionText: "обезоружил" },
  "оглушить": { emoji: "💥", customEmojiId: "", actionText: "оглушил" },
  "перехитрить": { emoji: "🧠", customEmojiId: "", actionText: "перехитрил" },
  "победить": { emoji: "🏆", customEmojiId: "", actionText: "победил" },
  "добить": { emoji: "🎯", customEmojiId: "", actionText: "добил" },
  "выгнать": { emoji: "🚪", customEmojiId: "", actionText: "выгнал" },
  "прогнать": { emoji: "👋", customEmojiId: "", actionText: "прогнал" },
  "арестовать": { emoji: "🚓", customEmojiId: "", actionText: "арестовал" },
  "допросить": { emoji: "🔎", customEmojiId: "", actionText: "допросил" },
  "наградить": { emoji: "🏅", customEmojiId: "", actionText: "наградил" },
  "короновать": { emoji: "👑", customEmojiId: "", actionText: "короновал" },
  "сделать легендой": { emoji: "🏆", customEmojiId: "", actionText: "сделал легендой" },
  "сделать сигмой": { emoji: "🗿", customEmojiId: "", actionText: "сделал сигмой" },
  "сделать альфой": { emoji: "🐺", customEmojiId: "", actionText: "сделал альфой" },
  "сделать npc": { emoji: "🤖", customEmojiId: "", actionText: "сделал NPC" },
  "сделать миллионером": { emoji: "💸", customEmojiId: "", actionText: "сделал миллионером" },
  "обанкротить": { emoji: "📉", customEmojiId: "", actionText: "обанкротил" },
  "отправить в космос": { emoji: PREMIUM_EMOJI_FALLBACK.rocket, customEmojiId: PREMIUM_EMOJI.rocket, actionText: "отправил в космос" },
  "отправить в minecraft": { emoji: "⛏️", customEmojiId: "", actionText: "отправил в Minecraft" },
  "отправить в roblox": { emoji: "🎮", customEmojiId: "", actionText: "отправил в Roblox" },
  "отправить на работу": { emoji: "💼", customEmojiId: "", actionText: "отправил на работу" },
  "отправить учиться": { emoji: "📚", customEmojiId: "", actionText: "отправил учиться" },
  "отправить мыть посуду": { emoji: "🧽", customEmojiId: "", actionText: "отправил мыть посуду" },
  "отправить за хлебом": { emoji: "🍞", customEmojiId: "", actionText: "отправил за хлебом" },
  "лишить вайфая": { emoji: "📵", customEmojiId: "", actionText: "лишил вайфая" },
  "лишить печеньки": { emoji: "🍪", customEmojiId: "", actionText: "лишил печеньки" },
  "подарить цветы": { emoji: "💐", customEmojiId: "", actionText: "подарил цветы" },
  "подарить шоколадку": { emoji: "🍫", customEmojiId: "", actionText: "подарил шоколадку" },
  "подарить кофе": { emoji: "☕", customEmojiId: "", actionText: "подарил кофе" },
  "подарить чай": { emoji: "🍵", customEmojiId: "", actionText: "подарил чай" },
  "подарить мороженое": { emoji: "🍦", customEmojiId: "", actionText: "подарил мороженое" },
  "подарить удачу": { emoji: "🍀", customEmojiId: "", actionText: "подарил удачу" },
  "подарить улыбку": { emoji: "😊", customEmojiId: "", actionText: "подарил улыбку" },
  "согреть": { emoji: "🔥", customEmojiId: "", actionText: "согрел" },
  "охладить": { emoji: "❄️", customEmojiId: "", actionText: "охладил" },
  "обидеть": { emoji: "💔", customEmojiId: "", actionText: "обидел" },
  "отомстить": { emoji: "😈", customEmojiId: "", actionText: "отомстил" },
  "помириться": { emoji: "🤝", customEmojiId: "", actionText: "помирился с" },
  "подружиться": { emoji: "👯", customEmojiId: "", actionText: "подружился с" },
  "пригласить гулять": { emoji: "🚶", customEmojiId: "", actionText: "пригласил гулять" },
  "пригласить в кино": { emoji: "🎬", customEmojiId: "", actionText: "пригласил в кино" },
  "станцевать": { emoji: "💃", customEmojiId: "", actionText: "станцевал для" },
  "похитить": { emoji: "🛸", customEmojiId: "", actionText: "похитил" },
  "освободить": { emoji: "🗝️", customEmojiId: "", actionText: "освободил" },
  "поймать": { emoji: "🎣", customEmojiId: "", actionText: "поймал" },
  "спрятать": { emoji: "📦", customEmojiId: "", actionText: "спрятал" },
  "найти": { emoji: "🔍", customEmojiId: "", actionText: "нашёл" },
  "выдать алмаз": { emoji: "💎", customEmojiId: "", actionText: "выдал алмаз" },
  "выдать платину": { emoji: "🏅", customEmojiId: "", actionText: "выдал платину" },
  "выдать легендарный лут": { emoji: "🧰", customEmojiId: "", actionText: "выдал легендарный лут" }
};

// Синхронизирует RP-команды с PREMIUM_EMOJI после загрузки env/JSON или автообучения через /emojiid.
function syncRpCommandEmojiIds() {
  for (const [commandName, commandData] of Object.entries(RP_COMMANDS)) {
    const matched = Object.entries(PREMIUM_EMOJI_FALLBACK)
      .find(([, emoji]) => emoji === commandData.emoji);
    const commandEmojiId = RP_COMMAND_PREMIUM_EMOJI[commandName] || "";
    const rpEmojiId = RP_PREMIUM_EMOJI[commandData.emoji] || "";

    if (!matched) {
      commandData.customEmojiId = commandEmojiId || rpEmojiId || commandData.customEmojiId || "";
      continue;
    }

    const [key] = matched;
    commandData.customEmojiId = commandEmojiId || rpEmojiId || PREMIUM_EMOJI[key] || commandData.customEmojiId || "";
  }
}

rpCommandsReady = true;
syncRpCommandEmojiIds();

// Возвращает имена RP-команд, которые используют указанный emoji.
function getRpCommandNamesByEmoji(emoji) {
  return Object.entries(RP_COMMANDS)
    .filter(([, commandData]) => commandData.emoji === emoji)
    .map(([commandName]) => commandName);
}

const RP_REPLY_HINT = [
  "🎭 Ответь на сообщение пользователя и напиши:",
  "ударить",
  "обнять",
  "поцеловать",
  "убить"
].join("\n");

// Отправляет RP-действие. Если customEmojiId заполнен, первый emoji в сообщении
// отправляется через Telegram MessageEntity custom_emoji; иначе уходит обычный emoji.
async function sendRpActionMessage(msg, commandData) {
  const userName = getTelegramName(msg.from);
  const targetName = getTelegramName(msg.reply_to_message.from);
  const emoji = commandData.emoji || "🎲";
  const text = `${emoji} | ${userName} ${commandData.actionText} ${targetName}`;
  const customEmojiId = commandData.customEmojiId || "";

  console.log("Premium emoji:", customEmojiId);

  if (customEmojiId) {
    try {
      await originalSendMessage(msg.chat.id, text, {
        entities: [
          {
            type: "custom_emoji",
            offset: 0,
            length: emoji.length,
            custom_emoji_id: customEmojiId
          }
        ],
        reply_to_message_id: msg.message_id
      });
      return;
    } catch (error) {
      console.error("RP premium emoji error:", getErrorMessage(error));
    }
  }

  await originalSendMessage(msg.chat.id, text, {
    reply_to_message_id: msg.message_id
  });
}


const DEFAULT_COMMAND_SETTINGS = [
  ["start", true],
  ["menu", true],
  ["commands", true],
  ["profile", true],
  ["top", true],
  ["admins", true],
  ["slowmode", true],
  ["lock", true],
  ["unlock", true],
  ["chat", true],
  ["topic", true],
  ["logs", true],
  ["stats", true],
  ["warn", true],
  ["unwarn", true],
  ["mute", true],
  ["unmute", true],
  ["kick", true],
  ["ban", true],
  ["unban", true],
  ["clear", true],
  ["pin", true],
  ["unpin", true],
  ["messageid", true],
  ["emojiid", true],
  ["settitle", true],
  ["setdescription", true],
  ["invite", true],
  ["id", true],
  ["chatinfo", true],
  ["rules", true],
  ["setrules", true],
  ["resetlinks", true],
  ["autokick", true],
  ["tgadmin", true],
  ["joinleave", true],
  ["brak", true],
  ["razvod", true],
  ["partner", true],
  ["action", true]
];

const commandSettings = loadCommandSettings();

const groupCommands = [
  { command: "start", description: "🍦 запуск бота" },
  { command: "menu", description: "📋 меню" },
  { command: "commands", description: "📜 все команды" },
  { command: "profile", description: "👤 профиль" },
  { command: "top", description: "🏆 топ активных" },
  { command: "admins", description: "👑 список администраторов" },
  { command: "slowmode", description: "🐢 задержка сообщений" },
  { command: "lock", description: "🔒 закрыть чат" },
  { command: "unlock", description: "🔓 открыть чат" },
  { command: "chat", description: "💬 +чат / -чат" },
  { command: "topic", description: "🧵 +топик / -топик" },
  { command: "logs", description: "📋 логи админ-действий" },
  { command: "stats", description: "📊 статистика" },
  { command: "warn", description: "⚠️ предупреждение" },
  { command: "unwarn", description: "♻️ снять предупреждения" },
  { command: "mute", description: "🔇 мут" },
  { command: "unmute", description: "🔊 снять мут" },
  { command: "kick", description: "👢 кик" },
  { command: "ban", description: "🚫 бан" },
  { command: "unban", description: "✅ разбан" },
  { command: "pin", description: "📌 закрепить сообщение" },
  { command: "unpin", description: "📍 открепить сообщение" },
  { command: "emojiid", description: "💎 получить ID premium emoji" },
  { command: "settitle", description: "✏️ изменить название чата" },
  { command: "setdescription", description: "📝 описание чата" },
  { command: "invite", description: "🔗 ссылка на чат" },
  { command: "id", description: "🆔 информация об ID" },
  { command: "chatinfo", description: "ℹ️ информация о чате" },
  { command: "rules", description: "📜 правила группы" },
  { command: "setrules", description: "✍️ установить правила" },
  { command: "resetlinks", description: "♻️ сбросить ссылки" },
  { command: "autokick", description: "👢 автокик после выхода" },
  { command: "tgadmin", description: "👮 сетка +тг админ" },
  { command: "joinleave", description: "👋 +входы / +выходы" },
  { command: "brak", description: "💍 Брак" },
  { command: "razvod", description: "💔 Развод" },
  { command: "partner", description: "💞 Вторая половинка" }
];

let botUsername = "";

bot.getMe().then((me) => {
  botUsername = me.username;
  botId = me.id;
}).catch((error) => {
  console.error("getMe error:", getErrorMessage(error));
});


async function setupBotCommands() {
  try {
    const privateCommands = [
      { command: "start", description: "🍦 добавить бота в группу" }
    ];
    const enabledGroupCommands = groupCommands.filter(({ command }) => isCommandEnabled(command));

    await bot.deleteMyCommands();
    await bot.deleteMyCommands({ scope: { type: "all_group_chats" } });
    await bot.deleteMyCommands({ scope: { type: "all_chat_administrators" } });
    await bot.deleteMyCommands({ scope: { type: "all_private_chats" } });

    await bot.setMyCommands(enabledGroupCommands, { scope: { type: "all_group_chats" } });
    await bot.setMyCommands(enabledGroupCommands, { scope: { type: "all_chat_administrators" } });
    await bot.setMyCommands(privateCommands, { scope: { type: "all_private_chats" } });
  } catch (error) {
    console.error("Ошибка меню команд:", getErrorMessage(error));
  }
}

setupBotCommands();

function getUser(user) {
  const id = user.id;
  let changed = false;

  if (!users.has(id)) {
    users.set(id, {
      id,
      firstName: user.first_name || "Пользователь",
      username: user.username || "нет",
      isBot: user.is_bot === true,
      messages: 0,
      warnings: 0
    });
    changed = true;
  }

  const profile = users.get(id);
  const firstName = user.first_name || profile.firstName || "Пользователь";
  const username = user.username || profile.username || "нет";
  const isBot = user.is_bot === true;

  if (profile.firstName !== firstName) {
    profile.firstName = firstName;
    changed = true;
  }

  if (profile.username !== username) {
    profile.username = username;
    changed = true;
  }

  if (profile.isBot !== isBot) {
    profile.isBot = isBot;
    changed = true;
  }

  if (typeof profile.messages !== "number") {
    profile.messages = Number(profile.messages) || 0;
    changed = true;
  }

  if (typeof profile.warnings !== "number") {
    profile.warnings = Number(profile.warnings) || 0;
    changed = true;
  }

  if (changed) {
    saveUsers();
  }

  return profile;
}

function isPrivateChat(msg) {
  return msg.chat.type === "private";
}

function registerUserInChat(msg) {
  if (!msg.from || !msg.chat) return;
  if (isPrivateChat(msg)) return;

  const profile = getUser(msg.from);
  const chatId = msg.chat.id;

  if (!chatUsers.has(chatId)) {
    chatUsers.set(chatId, new Set());
  }

  if (!chatInfo.has(chatId)) {
    chatInfo.set(chatId, {
      joinedAt: formatDateTime(),
      title: msg.chat.title || "Группа",
      type: msg.chat.type,
      users: []
    });
  }

  chatUsers.get(chatId).add(profile.id);

  const info = chatInfo.get(chatId);
  let changed = false;

  if (info.title !== (msg.chat.title || "Группа")) {
    info.title = msg.chat.title || "Группа";
    changed = true;
  }

  if (info.type !== msg.chat.type) {
    info.type = msg.chat.type;
    changed = true;
  }

  if (!Array.isArray(info.users)) {
    info.users = [];
    changed = true;
  }

  if (!info.users.includes(profile.id)) {
    info.users.push(profile.id);
    changed = true;
  }

  if (changed) {
    saveChatInfo();
  }
}

function getTelegramName(user) {
  if (!user) return "Пользователь";
  if (user.username) return `@${user.username}`;
  if (user.id) return `ID:${user.id}`;
  return user.first_name || "Пользователь";
}

function getUserDisplayName(profile) {
  if (profile.username && profile.username !== "нет") {
    return `@${profile.username}`;
  }
  return profile.firstName || `ID:${profile.id}`;
}

function getJoinLeaveSettings(chatId) {
  if (!joinLeaveSettings.has(chatId)) {
    joinLeaveSettings.set(chatId, { ...DEFAULT_JOIN_LEAVE_SETTINGS });
    saveChatSettings();
    return joinLeaveSettings.get(chatId);
  }

  const current = joinLeaveSettings.get(chatId);
  const normalized = normalizeJoinLeaveSettings(current);

  if (
    current.joins !== normalized.joins ||
    current.leaves !== normalized.leaves ||
    current.leaveMinMessages !== normalized.leaveMinMessages
  ) {
    joinLeaveSettings.set(chatId, normalized);
    saveChatSettings();
  }

  return joinLeaveSettings.get(chatId);
}

function getStatusLabel(status) {
  if (status === "creator") return "Владелец";
  if (status === "administrator") return "Админ";
  if (status === "member") return "Участник";
  if (status === "restricted") return "Ограничен";
  if (status === "left") return "Покинул группу";
  if (status === "kicked") return "Забанен";
  return "Неизвестно";
}

function getUserTag(user) {
  if (!user) return "Неизвестно";
  if (user.username) return `@${user.username}`;
  return `ID:${user.id}`;
}

function getFullName(user) {
  if (!user) return "Пользователь";
  const firstName = user.first_name || "";
  const lastName = user.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || "Пользователь";
}

function formatUnixDate(unixTime) {
  if (!unixTime) return "Telegram не показывает";

  const date = new Date(unixTime * 1000);
  const months = [
    "янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек"
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day} ${month} ${year} г., ${hours}:${minutes}`;
}

function formatDateTime(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function addAdminLog(chatId, action, adminUser, targetText, details = "") {
  if (!adminLogs.has(chatId)) {
    adminLogs.set(chatId, []);
  }

  const logs = adminLogs.get(chatId);

  logs.unshift({
    createdAt: new Date().toISOString(),
    date: formatDateTime(),
    action,
    admin: getTelegramName(adminUser),
    target: targetText,
    details
  });

  if (logs.length > 50) {
    logs.length = 50;
  }

  saveAdminLogs();
}

function getChatTitle(chatId) {
  const info = chatInfo.get(Number(chatId));
  return info?.title || `ID:${chatId}`;
}

function formatAdminLogs(logs, options = {}) {
  return logs
    .slice(0, 15)
    .map((log, index) => {
      const chatText = options.showChat ? `\n   💬 Чат: ${getChatTitle(log.chatId)}` : "";
      const detailsText = log.details ? `\n   📝 ${log.details}` : "";

      return `${index + 1}. ${log.action}${chatText}\n   🕒 ${log.date}\n   👮 Админ: ${log.admin}\n   👤 Цель: ${log.target}${detailsText}`;
    })
    .join("\n\n");
}

function getAdminLogsText(chatId) {
  const logs = adminLogs.get(chatId) || [];

  if (logs.length === 0) {
    return "📋 Логи пока пустые.";
  }

  return "📋 Последние админ-действия:\n\n" + formatAdminLogs(logs);
}

function getAllAdminLogsText() {
  const logs = Array.from(adminLogs.entries())
    .flatMap(([chatId, chatLogs]) => chatLogs.map((log) => ({ ...log, chatId })))
    .sort((first, second) => {
      const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
      const secondTime = second.createdAt ? new Date(second.createdAt).getTime() : 0;
      return secondTime - firstTime;
    });

  if (logs.length === 0) {
    return "📋 Логи пока пустые.";
  }

  return "📋 Последние админ-действия во всех группах:\n\n" + formatAdminLogs(logs, { showChat: true });
}

bot.onText(/^\/stats(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "stats")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /stats.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете смотреть статистику.");
    return;
  }

  bot.sendMessage(msg.chat.id, await getStatsText(msg.chat.id));
});

function findUserByUsername(username) {
  const cleanUsername = username.replace("@", "").toLowerCase();

  return Array.from(users.values()).find((user) => {
    return (
      user.username &&
      user.username !== "нет" &&
      user.username.toLowerCase() === cleanUsername
    );
  });
}

function resetDailyStatsIfNeeded() {
  const current = getTashkentDateInfo();

  if (stats.lastResetDate !== current.date) {
    stats.messagesToday = 0;
    stats.chatMessagesToday = {};
    stats.lastResetDate = current.date;
    saveStats();
  }
}

async function getStatsText(chatId) {
  resetDailyStatsIfNeeded();

  let totalUsers = 0;

  try {
    totalUsers = await bot.getChatMemberCount(chatId);
  } catch (error) {
    console.error("Stats count error:", getErrorMessage(error));
    totalUsers = chatUsers.has(chatId) ? chatUsers.get(chatId).size : users.size;
  }

  const seenUsersInThisGroup = chatUsers.has(chatId) ? chatUsers.get(chatId).size : 0;
  const messagesInThisGroup = stats.chatMessagesToday?.[chatId] || 0;

  return (
    "«СЛИВКИ»\n" +
    "📊 СТАТИСТИКА ГРУППЫ\n\n" +
    `👥 Участников в этой группе: ${totalUsers}\n\n` +
    `👤 Пользователей, которых бот видел в этой группе: ${seenUsersInThisGroup}\n\n` +
    `💬 Сообщений сегодня в этой группе: ${messagesInThisGroup}`
  );
}

async function getAdminStatsText() {
  resetDailyStatsIfNeeded();

  return (
    "🍦 АДМИН-СТАТИСТИКА СЛИВКИ\n\n" +
    `🤖 Всего групп, где есть бот: ${chatInfo.size}\n\n` +
    `👤 Всего пользователей, которых видел бот: ${users.size}\n\n` +
    `💬 Всего сообщений сегодня: ${stats.messagesToday}`
  );
}

function resolveTargetProfile(msg) {
  if (msg.reply_to_message && msg.reply_to_message.from) {
    const targetProfile = getUser(msg.reply_to_message.from);
    registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });
    return targetProfile;
  }

  const parts = msg.text.trim().split(/\s+/);
  const target = parts[1];

  if (!target) return null;

  const cleanTarget = target.replace("@", "");

  if (/^\d+$/.test(cleanTarget)) {
    const userId = Number(cleanTarget);

    return users.get(userId) || {
      id: userId,
      firstName: `ID:${userId}`,
      username: "нет",
      messages: 0,
      warnings: 0
    };
  }

  return findUserByUsername(cleanTarget) || null;
}

function getCommandArgs(msg) {
  return (msg.text || "").trim().split(/\s+/).slice(1).join(" ").trim();
}

function resolveTargetIdentity(msg, argsText = getCommandArgs(msg)) {
  if (msg.reply_to_message?.from) {
    const profile = getUser(msg.reply_to_message.from);
    registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });

    return {
      userId: profile.id,
      profile,
      token: String(profile.id),
      displayName: getUserDisplayName(profile)
    };
  }

  const parts = argsText.split(/\s+/).filter(Boolean);
  const token = (
    parts.find((part) => part.startsWith("@") || /^\d+$/.test(part)) ||
    parts.find((part) => /^[A-Za-z0-9_]{5,32}$/.test(part))
  );

  if (!token) return null;

  const cleanToken = token.replace("@", "");

  if (/^\d+$/.test(cleanToken)) {
    const userId = Number(cleanToken);
    const profile = users.get(userId) || {
      id: userId,
      firstName: `ID:${userId}`,
      username: "нет",
      messages: 0,
      warnings: 0
    };

    return {
      userId,
      profile,
      token,
      displayName: getUserDisplayName(profile)
    };
  }

  const profile = findUserByUsername(cleanToken);

  if (!profile) return null;

  return {
    userId: profile.id,
    profile,
    token,
    displayName: getUserDisplayName(profile)
  };
}

async function isUserAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

function isOwner(userId) {
  return ownerIds.includes(Number(userId));
}

function isCommandEnabled(commandName) {
  return commandSettings.get(commandName) !== false;
}

function getCommandStatus(commandName) {
  return isCommandEnabled(commandName) ? "ON ✅" : "OFF ❌";
}

const COMMAND_SETTINGS_PAGE_SIZE = 8;

function getCommandSettingsPageCount() {
  return Math.max(1, Math.ceil(commandSettings.size / COMMAND_SETTINGS_PAGE_SIZE));
}

function getSafeCommandSettingsPage(page = 0) {
  return Math.min(
    Math.max(Number(page) || 0, 0),
    getCommandSettingsPageCount() - 1
  );
}

function getAdminPanelText() {
  return "🍦 АДМИН-ПАНЕЛЬ СЛИВКИ\n\n" +
    "📊 Статистика\n" +
    "⚙️ Команды\n" +
    "📜 Логи\n" +
    "🛡 Модерация\n" +
    "👥 Пользователи\n\n" +
    "❌ Закрыть";
}

function getAdminPanelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Статистика", callback_data: "admin_stats" }],
        [{ text: "⚙️ Команды", callback_data: "admin_commands" }],
        [{ text: "📜 Логи", callback_data: "admin_logs" }],
        [{ text: "🛡 Модерация", callback_data: "admin_moderation" }],
        [{ text: "👥 Пользователи", callback_data: "admin_users" }],
        [{ text: "❌ Закрыть", callback_data: "admin_close" }]
      ]
    }
  };
}

function getCommandSettingsKeyboard(page = 0) {
  const safePage = getSafeCommandSettingsPage(page);
  const pageCount = getCommandSettingsPageCount();
  const prevPage = safePage === 0 ? pageCount - 1 : safePage - 1;
  const nextPage = safePage === pageCount - 1 ? 0 : safePage + 1;
  const commandNames = Array.from(commandSettings.keys()).slice(
    safePage * COMMAND_SETTINGS_PAGE_SIZE,
    safePage * COMMAND_SETTINGS_PAGE_SIZE + COMMAND_SETTINGS_PAGE_SIZE
  );

  const rows = commandNames.map((commandName) => [
    {
      text: `/${commandName} — ${getCommandStatus(commandName)}`,
      callback_data: `toggle_command:${commandName}:${safePage}`
    }
  ]);

  rows.push([
    { text: "⬅️", callback_data: `admin_commands_page:${prevPage}` },
    { text: `📄 ${safePage + 1}/${pageCount}`, callback_data: `admin_commands_page:${safePage}` },
    { text: "➡️", callback_data: `admin_commands_page:${nextPage}` }
  ]);

  rows.push([{ text: "🔙 Назад", callback_data: "admin_back" }]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function getBackKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Назад", callback_data: "admin_back" }]
      ]
    }
  };
}

function getAdminCommandsText(page = 0) {
  const safePage = getSafeCommandSettingsPage(page);
  const pageCount = getCommandSettingsPageCount();

  return `⚙️ УПРАВЛЕНИЕ КОМАНДАМИ • ${safePage + 1}/${pageCount}\n\n` +
    "Нажми на команду, чтобы включить или выключить её.\n\n" +
    "✅ ON — команда работает\n" +
    "❌ OFF — команда выключена";
}

function getAdminModerationText() {
  return "🛡 МОДЕРАЦИЯ\n\n" +
    "⚠️ /warn — выдать предупреждение\n" +
    "♻️ /unwarn — снять предупреждения\n" +
    "🔇 /mute — выдать мут\n" +
    "🔊 /unmute — снять мут\n" +
    "👢 /kick — кикнуть пользователя\n" +
    "🚫 /ban — забанить пользователя\n" +
    "✅ /unban — разбанить пользователя\n" +
    "🐢 /slowmode — задержка сообщений\n" +
    "🔒 /lock — закрыть чат\n" +
    "🔓 /unlock — открыть чат\n" +
    "🧹 /clear — очистить сообщения";
}

function getAdminUsersText(chatId) {
  const groupUsers = chatUsers.has(chatId) ? chatUsers.get(chatId).size : 0;

  return "👥 ПОЛЬЗОВАТЕЛИ И ГРУППЫ\n\n" +
    `🤖 Групп, где есть бот: ${chatInfo.size}\n` +
    `👤 Всего пользователей, которых видел бот: ${users.size}\n` +
    `👥 Пользователей в этой группе, которых видел бот: ${groupUsers}\n\n` +
    "ℹ️ Telegram не отдаёт боту полный список пользователей. Бот показывает тех, кого уже видел.";
}

function replyCommandDisabled(msg, commandName) {
  bot.sendMessage(
    msg.chat.id,
    [
      "🔕 Функция временно выключена",
      "",
      `🍦 Команда /${commandName} сейчас недоступна.`,
      "👮 Админ отключил её на время.",
      "",
      "✨ Попробуй позже."
    ].join("\n")
  );
}

function ensureCommandEnabled(msg, commandName) {
  if (isCommandEnabled(commandName)) return true;

  replyCommandDisabled(msg, commandName);
  return false;
}

async function ensureGroupAdminCommand(msg, commandName, options = {}) {
  registerUserInChat(msg);

  if (!ensureCommandEnabled(msg, commandName)) return false;

  if (isPrivateChat(msg)) {
    await sendMessageSafe(
      msg.chat.id,
      options.privateText || `👤 Добавь меня в группу, чтобы пользоваться командой /${commandName}.`
    );
    return false;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    await sendMessageSafe(
      msg.chat.id,
      options.noAccessText || `⛔ Вы не админ, поэтому не можете пользоваться командой /${commandName}.`
    );
    return false;
  }

  return true;
}

async function canUseAdminCommands(chatId, userId) {
  if (isOwner(userId)) return true;
  return isUserAdmin(chatId, userId);
}

async function getBotIdentity() {
  if (botId) return { id: botId, username: botUsername };

  const me = await bot.getMe();
  botId = me.id;
  botUsername = me.username || botUsername;

  return me;
}

function hasBotAdminPermission(botMember, permission) {
  if (botMember.status === "creator") return true;
  if (botMember.status !== "administrator") return false;
  return botMember[permission] === true;
}

async function canBotUsePermission(chatId, permission) {
  try {
    const me = await getBotIdentity();
    const botMember = await bot.getChatMember(chatId, me.id);
    return hasBotAdminPermission(botMember, permission);
  } catch (error) {
    console.error(`Bot permission check error (${permission}):`, getErrorMessage(error));
    return false;
  }
}

async function canBotChangeSlowMode(chatId) {
  return canBotUsePermission(chatId, "can_restrict_members");
}

function getTelegramFailureReason(error) {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes("not enough rights") || lower.includes("have no rights") || lower.includes("need administrator rights")) {
    return "У бота не хватает нужных прав администратора.";
  }

  if (lower.includes("user is an administrator") || lower.includes("can't restrict chat owner") || lower.includes("can't remove chat owner")) {
    return "Telegram не разрешает применять это действие к владельцу или администратору.";
  }

  if (lower.includes("message to delete not found") || lower.includes("message can't be deleted")) {
    return "Telegram не дал удалить это сообщение: оно уже удалено, слишком старое или у бота нет права удаления.";
  }

  if (lower.includes("chat not found")) {
    return "Чат не найден или бот больше не состоит в нём.";
  }

  if (lower.includes("bot was blocked")) {
    return "Пользователь заблокировал бота, поэтому личное сообщение отправить нельзя.";
  }

  if (lower.includes("too many requests") || lower.includes("retry after")) {
    return "Telegram временно ограничил частоту запросов. Повтори действие чуть позже.";
  }

  return `Ответ Telegram: ${message}`;
}

function getActionErrorText(actionText, error, hint = "") {
  const parts = [
    `⚠️ Не удалось ${actionText}.`,
    "",
    getTelegramFailureReason(error)
  ];

  if (hint) {
    parts.push("", hint);
  }

  return parts.join("\n");
}

function getBotPermissionText(actionText, permissionText) {
  return [
    `⚠️ Не могу ${actionText}.`,
    "",
    "Боту нужны права администратора:",
    `✅ ${permissionText}`
  ].join("\n");
}

async function ensureBotPermission(msg, permission, permissionText, actionText) {
  const allowed = await canBotUsePermission(msg.chat.id, permission);

  if (allowed) return true;

  await sendMessageSafe(
    msg.chat.id,
    getBotPermissionText(actionText, permissionText),
    {},
    `missingBotPermission:${permission}`
  );
  return false;
}

async function ensureModeratableTarget(msg, targetProfile, actionText) {
  if (targetProfile.id === msg.from.id) {
    return `⛔ Нельзя ${actionText} самого себя.`;
  }

  try {
    await getBotIdentity();
  } catch (error) {
    console.error("Bot identity check error:", getErrorMessage(error));
  }

  if (botId && targetProfile.id === botId) {
    return `⛔ Нельзя ${actionText} самого бота.`;
  }

  const targetIsAdmin = await isUserAdmin(msg.chat.id, targetProfile.id);

  if (targetIsAdmin) {
    return `⛔ Нельзя ${actionText} администратора или владельца группы. Telegram не даст выполнить это действие.`;
  }

  return null;
}

async function getChatPermissionsWithSlowMode(chatId, seconds) {
  try {
    const chat = await bot.getChat(chatId);
    const currentPermissions = chat.permissions || {};

    return {
      can_send_messages: currentPermissions.can_send_messages !== false,
      can_send_audios: currentPermissions.can_send_audios !== false,
      can_send_documents: currentPermissions.can_send_documents !== false,
      can_send_photos: currentPermissions.can_send_photos !== false,
      can_send_videos: currentPermissions.can_send_videos !== false,
      can_send_video_notes: currentPermissions.can_send_video_notes !== false,
      can_send_voice_notes: currentPermissions.can_send_voice_notes !== false,
      can_send_polls: currentPermissions.can_send_polls !== false,
      can_send_other_messages: currentPermissions.can_send_other_messages !== false,
      can_add_web_page_previews: currentPermissions.can_add_web_page_previews !== false,
      can_change_info: currentPermissions.can_change_info === true,
      can_invite_users: currentPermissions.can_invite_users !== false,
      can_pin_messages: currentPermissions.can_pin_messages === true,
      can_manage_topics: currentPermissions.can_manage_topics === true,
      slow_mode_delay: seconds
    };
  } catch {
    return {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_change_info: false,
      can_invite_users: true,
      can_pin_messages: false,
      can_manage_topics: false,
      slow_mode_delay: seconds
    };
  }
}

async function getCurrentSlowModeDelay(chatId) {
  try {
    const chat = await bot.getChat(chatId);
    return chat.slow_mode_delay || 0;
  } catch {
    return 0;
  }
}

function getLockedChatPermissions(slowModeDelay = 0) {
  return {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false,
    slow_mode_delay: slowModeDelay
  };
}

function getUnlockedChatPermissions(slowModeDelay = 0) {
  return {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false,
    slow_mode_delay: slowModeDelay
  };
}

function addActivity(user) {
  const profile = getUser(user);
  profile.messages += 1;
  saveUsers();
  return profile;
}

function parseMuteDuration(text) {
  const parts = text.trim().split(/\s+/);
  const durationPart = parts.find((part, index) => {
    return index > 0 && /^\d+(s|m|d)$/i.test(part);
  });

  if (!durationPart) return null;

  const match = durationPart.match(/^(\d+)(s|m|d)$/i);
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isInteger(value) || value < 1) return null;

  if (unit === "s") return { seconds: value, label: `${value} секунд` };
  if (unit === "m") return { seconds: value * 60, label: `${value} минут` };
  if (unit === "d") return { seconds: value * 24 * 60 * 60, label: `${value} дней` };

  return null;
}

function getMutedPermissions() {
  return {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function getFullPermissions() {
  return {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function getGroupMenuText() {
  return "✅ Я так рад, что меня добавили!\n\n" +
    "Пока я признаю команды только админов этого чата.\n\n" +
    "⚙️ Со списком всех команд можно ознакомиться в нашей статье.\n\n" +
    "⚪️ В целях безопасности от спама в чате по умолчанию установлен лимит одновременных инвайтов в 30 человек.\n\n" +
    "— Если вы хотите изменить этот лимит, введите:\n" +
    "инвайты {число}\n\n" +
    "Где число может быть 0 — это отключит лимит.\n\n" +
    "Остались вопросы? Можете обратиться в наш официальный чат.";
}

function getMainMenuText() {
  const menuItems = [
    ["profile", "👤 Профиль: /profile"],
    ["top", "🏆 Топ: /top"],
    ["commands", "🛡 Модерация: /commands"]
  ]
    .filter(([commandName]) => isCommandEnabled(commandName))
    .map(([, text]) => text);

  const quickActions = [
    ["warn", "⚠️ /warn — предупреждение"],
    ["mute", "🔇 /mute 10m — мут"],
    ["kick", "👢 /kick — кик"],
    ["ban", "🚫 /ban — бан"]
  ]
    .filter(([commandName]) => isCommandEnabled(commandName))
    .map(([, text]) => text);

  const sections = ["📋 Главное меню"];

  if (menuItems.length > 0) {
    sections.push(menuItems.join("\n"));
  }

  if (quickActions.length > 0) {
    sections.push("✨ Быстрые действия\n" + quickActions.join("\n"));
  }

  if (isCommandEnabled("commands")) {
    sections.push("📜 Полный список команд: /commands");
  }

  return sections.join("\n\n");
}


const COMMANDS_PAGES = [
  {
    title: "📜 Список команд • 1/4",
    subtitle: "🍦 Основные команды",
    commands: [
      { setting: "menu", sticker: "📋", command: "/menu", description: "главное меню" },
      { setting: "commands", sticker: "📜", command: "/commands", description: "красивый список команд" },
      { setting: "menu", sticker: "🆘", command: "/help", description: "как пользоваться командами" },
      { setting: "profile", sticker: "👤", command: "/profile", description: "профиль пользователя" },
      { setting: "top", sticker: "🏆", command: "/top", description: "топ активных участников" },
      { setting: "admins", sticker: "👑", command: "/admins", description: "список администраторов" },
      { setting: "stats", sticker: "📊", command: "/stats", description: "статистика группы" },
      { setting: "logs", sticker: "📋", command: "/logs", description: "логи админ-действий" },
      { setting: "id", sticker: "🆔", command: "/id", description: "ID пользователя или сообщения" },
      { setting: "emojiid", sticker: "💎", command: "/emojiid", description: "ID Premium Emoji из ответа" },
      { setting: "chatinfo", sticker: "ℹ️", command: "/chatinfo", description: "информация о группе" }
    ]
  },
  {
    title: "🛡 Модерация • 2/4",
    subtitle: "⚔️ Команды для админов",
    commands: [
      { setting: "warn", sticker: "⚠️", command: "/warn", description: "выдать предупреждение" },
      { setting: "unwarn", sticker: "♻️", command: "/unwarn", description: "снять предупреждения" },
      { setting: "mute", sticker: "🔇", command: "/mute 10m", description: "выдать мут" },
      { setting: "unmute", sticker: "🔊", command: "/unmute", description: "снять мут" },
      { setting: "kick", sticker: "👢", command: "/kick", description: "кикнуть пользователя" },
      { setting: "ban", sticker: "🚫", command: "/ban", description: "забанить пользователя" },
      { setting: "unban", sticker: "✅", command: "/unban", description: "разбанить пользователя" },
      { setting: "clear", sticker: "🧹", command: "/clear 10", description: "удалить сообщения" },
      { setting: "pin", sticker: "📌", command: "/pin или !пин", description: "закрепить сообщение" },
      { setting: "unpin", sticker: "📍", command: "/unpin или !анпин", description: "открепить сообщение" }
    ]
  },
  {
    title: "⚙️ Настройки • 3/4",
    subtitle: "🔧 Управление группой",
    commands: [
      { setting: "slowmode", sticker: "🐢", command: "/slowmode 10s", description: "задержка сообщений" },
      { setting: "lock", sticker: "🔒", command: "/lock", description: "закрыть чат" },
      { setting: "unlock", sticker: "🔓", command: "/unlock", description: "открыть чат" },
      { setting: "chat", sticker: "💬", command: "+чат / -чат", description: "открыть или закрыть чат" },
      { setting: "topic", sticker: "🧵", command: "+топик / -топик", description: "открыть или закрыть топик" },
      { setting: "settitle", sticker: "✏️", command: "/settitle", description: "изменить название чата" },
      { setting: "setdescription", sticker: "📝", command: "/setdescription", description: "изменить описание чата" },
      { setting: "invite", sticker: "🔗", command: "/invite", description: "получить ссылку-приглашение" },
      { setting: "rules", sticker: "📖", command: "/rules", description: "правила группы" },
      { setting: "setrules", sticker: "✍️", command: "/setrules", description: "установить правила" }
    ]
  },
  {
    title: "🎮 Дополнительно • 4/4",
    subtitle: "💎 Игры и полезные функции",
    commands: [
      { setting: "resetlinks", sticker: "♻️", command: "/resetlinks", description: "сбросить ссылки" },
      { setting: "autokick", sticker: "👢", command: "/autokick", description: "автокик после выхода" },
      { setting: "tgadmin", sticker: "👮", command: "+тг админ", description: "выдать админку в чатах" },
      { setting: "joinleave", sticker: "👋", command: "+входы / -входы", description: "уведомления о входах" },
      { setting: "joinleave", sticker: "🚪", command: "+выходы / -выходы", description: "уведомления о выходах" },
      { setting: "joinleave", sticker: "🔔", command: "+входы-выходы", description: "включить оба уведомления" },
      { setting: "brak", sticker: "💍", command: "/brak или брак", description: "игровой брак" },
      { setting: "razvod", sticker: "💔", command: "/razvod или развод", description: "игровой развод" },
      { setting: "partner", sticker: "💞", command: "/partner", description: "показать вторую половинку" },
      { setting: "action", sticker: "🎭", command: "ударить / обнять / убить", description: "ролевые действия ответом" },
      { sticker: "🎲", command: "сливки шанс", description: "рандомная вероятность" }
    ]
  }
];

function getVisibleCommands(pageData) {
  return pageData.commands.filter((item) => {
    return !item.setting || isCommandEnabled(item.setting);
  });
}

function getCommandsText(page = 0) {
  const safePage = Math.min(Math.max(Number(page) || 0, 0), COMMANDS_PAGES.length - 1);
  const pageData = COMMANDS_PAGES[safePage];
  const visibleCommands = getVisibleCommands(pageData);

  const commandsText = visibleCommands
    .map((item, index) => {
      const number = String(index + 1).padStart(2, "0");
      return `${number}. ${item.sticker} ${item.command}\n    └ ${item.description}`;
    })
    .join("\n\n") || "На этой странице все команды выключены.";

  return [
    "🍦 СЛИВКИ БОТ",
    pageData.title,
    pageData.subtitle,
    "",
    commandsText,
    "",
    "🧩 Как использовать:",
    "↩️ ответом на сообщение",
    "🏷 через @username",
    "🆔 через ID пользователя",
    "",
    "✨ Пример: /mute @username 10m"
  ].join("\n");
}

function getCommandsKeyboard(page = 0) {
  const safePage = Math.min(Math.max(Number(page) || 0, 0), COMMANDS_PAGES.length - 1);
  const prevPage = safePage === 0 ? COMMANDS_PAGES.length - 1 : safePage - 1;
  const nextPage = safePage === COMMANDS_PAGES.length - 1 ? 0 : safePage + 1;

  return {
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        COMMANDS_PAGES.map((_, index) => ({
          text: safePage === index ? `🔘 ${index + 1}` : `⚪️ ${index + 1}`,
          callback_data: `commands_page:${index}`
        })),
        [
          { text: "⬅️", callback_data: `commands_page:${prevPage}` },
          { text: `📄 ${safePage + 1}/${COMMANDS_PAGES.length}`, callback_data: `commands_page:${safePage}` },
          { text: "➡️", callback_data: `commands_page:${nextPage}` }
        ],
        [{ text: "❌ Закрыть", callback_data: "commands_close" }]
      ]
    }
  };
}

function getHelpText() {
  return "🆘 Как пользоваться командами\n\n" +
    "✅ Самый удобный способ — ответом на сообщение пользователя.\n\n" +
    "1️⃣ Ответом на сообщение\n" +
    "Нажми на сообщение пользователя → Ответить → напиши команду:\n\n" +
    "/warn — выдать предупреждение\n" +
    "/mute 10m — дать мут на 10 минут\n" +
    "/unmute — снять мут\n" +
    "/kick — кикнуть из группы\n" +
    "/ban — забанить\n\n" +
    "/pin — закрепить сообщение\n" +
    "/unpin — открепить сообщение\n" +
    "смс ид — узнать ID сообщения\n\n" +
    "2️⃣ Через username\n" +
    "Если у пользователя есть username:\n\n" +
    "/warn @username\n" +
    "/mute @username 10m\n" +
    "/ban @username\n\n" +
    "⚠️ Важно: через @username команда работает только если бот уже видел этого пользователя в группе.\n\n" +
    "3️⃣ Через Telegram ID\n" +
    "Если знаешь ID пользователя:\n\n" +
    "/warn 123456789\n" +
    "/mute 123456789 10m\n" +
    "/ban 123456789\n\n" +
    "📌 Закрепление сообщений\n" +
    "Ответь на сообщение и напиши:\n" +
    "/pin или !пин\n\n" +
    "Или закрепи по ID сообщения:\n" +
    "/pin 1234 или !пин 1234\n\n" +
    "Чтобы узнать ID сообщения, ответь на него текстом:\n" +
    "смс ид\n\n" +
    "Открепить сообщение:\n" +
    "/unpin или !анпин\n\n" +
    "⏰ Формат времени для мута\n" +
    "1s — 1 секунда\n" +
    "1m — 1 минута\n" +
    "1d — 1 день\n\n" +
    "Примеры:\n" +
    "/mute 10m\n" +
    "/mute @username 1d\n\n" +
    "📋 Полный список команд: /commands\n" +
    "📌 Главное меню: /menu";
}


function getGroupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📜 Статья с командами", url: "https://t.me/slivki_bot" }],
        [{ text: "💬 Официальный чат", url: "https://t.me/slivki_chat" }]
      ]
    }
  };
}

function getRandomPercent() {
  return Math.floor(Math.random() * 100) + 1;
}

function parseProbabilityQuestion(text) {
  const cleanText = text.trim();
  const match = cleanText.match(/^(?:сливки\s+)?(?:вероятность|шанс|про)\s*(?:того\s*)?(?:что\s*)?(.+)$/i);

  if (!match) return null;

  const question = match[1].trim();

  if (!question) return null;

  return question;
}

function getMarriagePercent() {
  return Math.floor(Math.random() * 101);
}

bot.onText(/^\/start(?:@\w+)?(?:\s|$)/i, async (msg) => {
  getUser(msg.from);
  if (!ensureCommandEnabled(msg, "start")) return;
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    if (!botUsername) {
      try {
        const me = await getBotIdentity();
        botUsername = me.username;
      } catch (error) {
        console.error("Start getMe error:", getErrorMessage(error));
        bot.sendMessage(msg.chat.id, "⚠️ Не удалось получить данные бота. Попробуй позже.");
        return;
      }
    }

    bot.sendMessage(
      msg.chat.id,
      "🍦 Привет! Я «Сливки Бот»\n\nЧтобы активировать мои команды, добавь меня в группу и дай права администратора.\n\nВ группе доступны:\n\n👤 профиль пользователя;\n\n⛑ инструменты для модерации;\n\n⚠️ предупреждения пользователей;\n\n🔇 мут и снятие мута;\n\n🚫 бан и разбан участников;\n\n📋 удобное меню команд;\n\n👋 уведомления о входе и выходе участников;",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "➕ Добавить в группу",
                url: `https://t.me/${botUsername}?startgroup=true`
              }
            ],
            [
              {
                text: "💬 Поддержка",
                callback_data: "support_open"
              }
            ]
          ]
        }
      }
    );
    return;
  }

  bot.sendMessage(
    msg.chat.id,
    getGroupMenuText(),
    getGroupKeyboard()
  );
});

bot.onText(/^\/admin(?:@\w+)?(?:\s|$)/i, (msg) => {
  getUser(msg.from);

  if (!isPrivateChat(msg)) return;

  if (!isOwner(msg.from.id)) {
    bot.sendMessage(msg.chat.id, "⛔ У вас нет доступа к админ-панели.");
    return;
  }

  bot.sendMessage(msg.chat.id, getAdminPanelText(), getAdminPanelKeyboard());
});

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const userId = query.from?.id;

  if (data === "support_open") {
    supportUsers.add(userId);

    await bot.sendMessage(
      query.message.chat.id,
      "💬 Напишите ваше сообщение. Оно будет отправлено владельцу бота."
    );

    await answerCallbackSafe(query.id);
    return;
  }
  if (data.startsWith("marriage_accept:") || data.startsWith("marriage_decline:")) {
    const [action, proposalId] = data.split(":");
    const proposal = pendingMarriages.get(proposalId);

    if (!proposal) {
      await answerCallbackSafe(query.id, {
        text: "⏳ Предложение уже устарело.",
        show_alert: true
      });
      return;
    }

    if (Number(userId) !== Number(proposal.secondUserId)) {
      await answerCallbackSafe(query.id, {
        text: "⛔ Это предложение не для вас.",
        show_alert: true
      });
      return;
    }

    const firstUser = users.get(proposal.firstUserId);
    const secondUser = users.get(proposal.secondUserId);

    const firstName = firstUser ? getUserDisplayName(firstUser) : `ID:${proposal.firstUserId}`;
    const secondName = secondUser ? getUserDisplayName(secondUser) : `ID:${proposal.secondUserId}`;

    if (action === "marriage_decline") {
      pendingMarriages.delete(proposalId);

      await bot.editMessageText(
        `💔 ПРЕДЛОЖЕНИЕ ОТКЛОНЕНО\n\n${secondName} отказался(ась) от игрового брака с ${firstName}.`,
        {
          chat_id: proposal.chatId,
          message_id: query.message.message_id
        }
      );

      await answerCallbackSafe(query.id, { text: "Вы отказались." });
      return;
    }

    if (
      getMarriagePartnerId(proposal.chatId, proposal.firstUserId) ||
      getMarriagePartnerId(proposal.chatId, proposal.secondUserId)
    ) {
      pendingMarriages.delete(proposalId);

      await bot.editMessageText(
        "💍 Брак не оформлен. Кто-то из участников уже состоит в игровом браке.",
        {
          chat_id: proposal.chatId,
          message_id: query.message.message_id
        }
      );

      await answerCallbackSafe(query.id, { text: "Брак не оформлен." });
      return;
    }

    setMarriage(proposal.chatId, proposal.firstUserId, proposal.secondUserId);
    pendingMarriages.delete(proposalId);

    await bot.editMessageText(
      `💍 БРАК ПОДТВЕРЖДЁН!\n\n👤 Первая половинка: ${firstName}\n💞 Вторая половинка: ${secondName}\n\n❤️ Совместимость: ${proposal.percent}%\n\n🍦 Сливки официально подтверждает этот союз!`,
      {
        chat_id: proposal.chatId,
        message_id: query.message.message_id
      }
    );

    await answerCallbackSafe(query.id, { text: "Брак подтверждён!" });
    return;
  }

  if (data.startsWith("commands_page:")) {
    if (!isCommandEnabled("commands")) {
      await answerCallbackSafe(query.id, {
        text: "Команда /commands сейчас выключена",
        show_alert: true
      });
      return;
    }

    const page = Number(data.split(":")[1]) || 0;

    try {
      await bot.editMessageText(getCommandsText(page), {
        chat_id: chatId,
        message_id: messageId,
        ...getCommandsKeyboard(page)
      });
    } catch (error) {
      if (!getErrorMessage(error).includes("message is not modified")) {
        console.error("Commands page edit error:", getErrorMessage(error));
      }
    }

    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "commands_close") {
    await bot.deleteMessage(chatId, messageId).catch((error) => {
      console.error("Commands close delete error:", getErrorMessage(error));
    });
    await answerCallbackSafe(query.id, { text: "Список команд закрыт" });
    return;
  }

  if (!data.startsWith("admin_") && !data.startsWith("toggle_command:")) return;

  if (!isOwner(userId)) {
    await answerCallbackSafe(query.id, {
      text: "⛔ Нет доступа",
      show_alert: true
    });
    return;
  }

  if (data === "admin_back") {
    await bot.editMessageText(getAdminPanelText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getAdminPanelKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_close") {
    await bot.deleteMessage(chatId, messageId).catch((error) => {
      console.error("Admin close delete error:", getErrorMessage(error));
    });
    await answerCallbackSafe(query.id, { text: "Админ-панель закрыта" });
    return;
  }

  if (data === "admin_commands") {
    await bot.editMessageText(getAdminCommandsText(0), {
      chat_id: chatId,
      message_id: messageId,
      ...getCommandSettingsKeyboard(0)
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data.startsWith("admin_commands_page:")) {
    const page = Number(data.split(":")[1]) || 0;

    try {
      await bot.editMessageText(getAdminCommandsText(page), {
        chat_id: chatId,
        message_id: messageId,
        ...getCommandSettingsKeyboard(page)
      });
    } catch (error) {
      if (!getErrorMessage(error).includes("message is not modified")) {
        console.error("Admin commands page edit error:", getErrorMessage(error));
      }
    }

    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_stats") {
    await bot.editMessageText(await getAdminStatsText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_logs") {
    const logsText = query.message?.chat?.type === "private"
      ? getAllAdminLogsText()
      : getAdminLogsText(chatId);

    await bot.editMessageText(logsText, {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_moderation") {
    await bot.editMessageText(getAdminModerationText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_users") {
    await bot.editMessageText(getAdminUsersText(chatId), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data.startsWith("toggle_command:")) {
    const [, commandName, pageValue] = data.split(":");
    const page = Number(pageValue) || 0;

    if (!commandSettings.has(commandName)) {
      await answerCallbackSafe(query.id, {
        text: "Команда не найдена",
        show_alert: true
      });
      return;
    }

    commandSettings.set(commandName, !isCommandEnabled(commandName));
    saveCommandSettings();

    await answerCallbackSafe(query.id, {
      text: `/${commandName}: ${getCommandStatus(commandName)}`
    });

    await setupBotCommands();

    await bot.editMessageText(getAdminCommandsText(page), {
      chat_id: chatId,
      message_id: messageId,
      ...getCommandSettingsKeyboard(page)
    });
  }
});

bot.onText(/^\/menu(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "menu")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📋 Чтобы открыть меню команд, добавь меня в группу и напиши там /menu");
    return;
  }

  bot.sendMessage(msg.chat.id, getMainMenuText());
});

bot.onText(/^\/help(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "menu")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(
      msg.chat.id,
      "ℹ️ Чтобы пользоваться командами, добавь меня в группу."
    );
    return;
  }

  bot.sendMessage(msg.chat.id, getHelpText());
});

bot.onText(/^\/commands(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "commands")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📜 Добавь меня в группу, чтобы посмотреть команды.");
    return;
  }

  bot.sendMessage(msg.chat.id, getCommandsText(0), getCommandsKeyboard(0)).catch((error) => {
    console.error("Commands send error:", getErrorMessage(error));
  });
});

bot.onText(/^\/profile(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "profile")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /profile.");
    return;
  }

  const targetUser = msg.reply_to_message?.from || msg.from;
  const profile = getUser(targetUser);

  let memberStatus = "unknown";
  let joinedDate = "Telegram не показывает";

  try {
    const member = await bot.getChatMember(msg.chat.id, targetUser.id);
    memberStatus = member.status;
    joinedDate = formatUnixDate(member.joined_date);
  } catch (error) {
    console.error("Profile member info error:", getErrorMessage(error));
  }

  const usernameText = targetUser.username ? `@${targetUser.username}` : "Отсутствует";
  const tagText = getUserTag(targetUser);
  const statusText = getStatusLabel(memberStatus);
  const fullName = getFullName(targetUser);

  const profileText =
    `🍦 «СЛИВКИ» • профиль пользователя\n\n` +
    `🆔 ID: ${targetUser.id}\n` +
    `🔎 Хэштег: #id${targetUser.id}\n\n` +
    `👤 Имя: ${fullName}\n` +
    `🌐 Username: ${usernameText}\n` +
    `🏷 Тег: ${tagText}\n\n` +
    `👀 Статус в группе: ${statusText}\n` +
    `↘️ Вступил(а): ${joinedDate}\n\n` +
    `💬 Сообщений: ${profile.messages}\n` +
    `⚠️ Предупреждения: ${profile.warnings}/3`;

  bot.sendMessage(msg.chat.id, profileText);
});

// /top command handler
bot.onText(/^\/top(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "top")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "🏆 Добавь меня в группу, чтобы посмотреть топ участников.");
    return;
  }

  const info = chatInfo.get(msg.chat.id);

  if (!info || !Array.isArray(info.users) || info.users.length === 0) {
    bot.sendMessage(msg.chat.id, "🏆 Пока недостаточно данных для топа.");
    return;
  }

  const topUsers = info.users
    .map((userId) => users.get(userId))
    .filter(Boolean)
    .filter((user) => !user.isBot)
    .sort((a, b) => (b.messages || 0) - (a.messages || 0))
    .slice(0, 10);

  if (topUsers.length === 0) {
    bot.sendMessage(msg.chat.id, "🏆 Пока нет активных участников.");
    return;
  }

  const text = "🏆 ТОП АКТИВНЫХ УЧАСТНИКОВ\n\n" + topUsers
    .map((user, index) => `${index + 1}. ${getUserDisplayName(user)} — ${user.messages || 0} сообщений`)
    .join("\n");

  bot.sendMessage(msg.chat.id, text);
});


bot.onText(/^\/logs(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "logs")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /logs.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете смотреть логи.");
    return;
  }

  bot.sendMessage(msg.chat.id, getAdminLogsText(msg.chat.id));
});

bot.onText(/^\/emojiid(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);

  const sourceMessage = msg.reply_to_message || msg;
  const customEmojis = getCustomEmojiIdsFromMessage(sourceMessage);

  if (customEmojis.length === 0) {
    bot.sendMessage(
      msg.chat.id,
      [
        "💎 <b>Premium Emoji ID не найден</b>",
        "",
        "1️⃣ Отправь Premium Emoji в чат.",
        "2️⃣ Ответь на него командой <b>/emojiid</b>.",
        "3️⃣ Я покажу <code>custom_emoji_id</code>."
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_to_message_id: msg.message_id
      }
    );
    return;
  }

  const text = customEmojis
    .map((item, index) => {
      console.log("Premium emoji:", item.customEmojiId);
      return `${index + 1}. ${item.emoji}\n<code>${item.customEmojiId}</code>`;
    })
    .join("\n\n");

  bot.sendMessage(
    msg.chat.id,
    "💎 <b>Найденные Premium Emoji ID:</b>\n\n" + text,
    {
      parse_mode: "HTML",
      reply_to_message_id: msg.message_id
    }
  );
});

bot.onText(/^\/id(?:@\w+)?(?:\s+(.+))?$/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "id")) return;

  const targetUser = msg.reply_to_message?.from || msg.from;
  const targetMessageId = msg.reply_to_message?.message_id || msg.message_id;
  const user = getUser(targetUser);

  const text = [
    "🆔 ID информация",
    "",
    `👤 Пользователь: ${getUserDisplayName(user)}`,
    `🆔 User ID: ${targetUser.id}`,
    `💬 Chat ID: ${msg.chat.id}`,
    `🧾 Message ID: ${targetMessageId}`
  ].join("\n");

  bot.sendMessage(msg.chat.id, text, { reply_to_message_id: msg.message_id });
});

bot.onText(/^\/chatinfo(?:@\w+)?$/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "chatinfo")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "ℹ️ Команда /chatinfo работает в группе.");
    return;
  }

  let chat = msg.chat;
  let memberCount = "не удалось получить";

  try {
    chat = await bot.getChat(msg.chat.id);
  } catch (error) {
    console.error("Chat info getChat error:", getErrorMessage(error));
  }

  try {
    memberCount = await bot.getChatMemberCount(msg.chat.id);
  } catch (error) {
    console.error("Chat info member count error:", getErrorMessage(error));
  }

  const info = chatInfo.get(msg.chat.id);
  const seenUsers = Array.isArray(info?.users) ? info.users.length : 0;
  const description = chat.description ? `\n📝 Описание: ${chat.description}` : "";

  bot.sendMessage(
    msg.chat.id,
    [
      "ℹ️ Информация о группе",
      "",
      `💬 Название: ${chat.title || "без названия"}`,
      `🆔 Chat ID: ${msg.chat.id}`,
      `🏷 Тип: ${chat.type || msg.chat.type}`,
      `👥 Участников: ${memberCount}`,
      `👤 Бот видел пользователей: ${seenUsers}`,
      `📅 Бот добавлен: ${info?.joinedAt || "неизвестно"}${description}`
    ].join("\n")
  );
});

bot.onText(/^\/rules(?:@\w+)?$/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "rules")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📜 Правила работают отдельно для каждой группы.");
    return;
  }

  const rules = chatRules.get(msg.chat.id);

  if (!rules) {
    bot.sendMessage(
      msg.chat.id,
      "📜 Правила группы пока не установлены.\n\nАдмин может установить их командой:\n/setrules текст правил"
    );
    return;
  }

  bot.sendMessage(msg.chat.id, `📜 Правила группы:\n\n${rules}`);
});

bot.onText(/^\/setrules(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "setrules", {
    privateText: "📜 Добавь меня в группу, чтобы настраивать правила.",
    noAccessText: "⛔ Только админы могут менять правила группы."
  })) {
    return;
  }

  const rawText = (match[1] || "").trim();
  const replyText = (msg.reply_to_message?.text || msg.reply_to_message?.caption || "").trim();
  const rulesText = rawText || replyText;

  if (["off", "выкл", "удалить", "reset", "сброс"].includes(rulesText.toLowerCase())) {
    chatRules.delete(msg.chat.id);
    saveChatSettings();
    addAdminLog(msg.chat.id, "📜 Удалил правила", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, "✅ Правила группы удалены.");
    return;
  }

  if (!rulesText) {
    waitingRulesInput.add(`${msg.chat.id}:${msg.from.id}`);
    bot.sendMessage(
      msg.chat.id,
      "📜 Отправь следующим сообщением текст правил.\n\nЧтобы удалить правила: /setrules off"
    );
    return;
  }

  if (rulesText.length > 3500) {
    bot.sendMessage(msg.chat.id, "⚠️ Правила слишком длинные. Сократи текст до 3500 символов.");
    return;
  }

  chatRules.set(msg.chat.id, rulesText);
  saveChatSettings();
  addAdminLog(msg.chat.id, "📜 Обновил правила", msg.from, "Группа");
  bot.sendMessage(msg.chat.id, "✅ Правила группы обновлены.\n\nПосмотреть: /rules");
});

bot.onText(/^\/settitle(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "settitle", {
    privateText: "✏️ Добавь меня в группу, чтобы менять название.",
    noAccessText: "⛔ Только админы могут менять название группы."
  })) {
    return;
  }

  const title = (match[1] || "").trim();

  if (!title) {
    bot.sendMessage(msg.chat.id, "✏️ Укажи новое название.\n\nПример:\n/settitle Новый чат");
    return;
  }

  if (title.length > 255) {
    bot.sendMessage(msg.chat.id, "⚠️ Название слишком длинное. Максимум 255 символов.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_change_info", "Изменение информации группы", "изменить название")) {
    return;
  }

  try {
    await bot.setChatTitle(msg.chat.id, title);
    const info = chatInfo.get(msg.chat.id);

    if (info) {
      info.title = title;
      saveChatInfo();
    }

    addAdminLog(msg.chat.id, "✏️ Изменил название", msg.from, "Группа", title);
    bot.sendMessage(msg.chat.id, `✅ Название группы изменено:\n${title}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить название", error));
  }
});

bot.onText(/^\/setdescription(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "setdescription", {
    privateText: "📝 Добавь меня в группу, чтобы менять описание.",
    noAccessText: "⛔ Только админы могут менять описание группы."
  })) {
    return;
  }

  const description = (match[1] || msg.reply_to_message?.text || msg.reply_to_message?.caption || "").trim();

  if (!description) {
    bot.sendMessage(msg.chat.id, "📝 Укажи новое описание.\n\nПример:\n/setdescription Описание группы");
    return;
  }

  if (description.length > 255) {
    bot.sendMessage(msg.chat.id, "⚠️ Описание слишком длинное. Telegram принимает до 255 символов.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_change_info", "Изменение информации группы", "изменить описание")) {
    return;
  }

  try {
    await bot.setChatDescription(msg.chat.id, description);
    addAdminLog(msg.chat.id, "📝 Изменил описание", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, "✅ Описание группы обновлено.");
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить описание", error));
  }
});

bot.onText(/^\/invite(?:@\w+)?$/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "invite", {
    privateText: "🔗 Добавь меня в группу, чтобы получать ссылку-приглашение.",
    noAccessText: "⛔ Только админы могут получать ссылку-приглашение."
  })) {
    return;
  }

  if (!await ensureBotPermission(msg, "can_invite_users", "Приглашение пользователей", "создать ссылку-приглашение")) {
    return;
  }

  try {
    const link = await bot.exportChatInviteLink(msg.chat.id);
    bot.sendMessage(msg.chat.id, `🔗 Ссылка-приглашение:\n${link}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("создать ссылку-приглашение", error));
  }
});

bot.onText(/^\/resetlinks(?:@\w+)?$/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "resetlinks", {
    privateText: "♻️ Добавь меня в группу, чтобы сбрасывать ссылки.",
    noAccessText: "⛔ Только админы могут сбрасывать ссылки-приглашения."
  })) {
    return;
  }

  if (!await ensureBotPermission(msg, "can_invite_users", "Приглашение пользователей", "сбросить ссылку-приглашение")) {
    return;
  }

  try {
    const link = await bot.exportChatInviteLink(msg.chat.id);
    addAdminLog(msg.chat.id, "♻️ Сбросил ссылку", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, `✅ Основная ссылка сброшена.\n\nНовая ссылка:\n${link}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("сбросить ссылку-приглашение", error));
  }
});

bot.onText(/^(?:сетка\s+)?([+-])\s*тг\s+админ(?:\s+(.+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "tgadmin")) return;

  if (!isOwner(msg.from.id)) {
    bot.sendMessage(msg.chat.id, "⛔ Эту команду может использовать только владелец бота.");
    return;
  }

  const sign = match[1];
  const args = (match[2] || "").trim();
  const target = resolveTargetIdentity(msg, args);

  if (!target) {
    bot.sendMessage(
      msg.chat.id,
      "👮 Укажи пользователя ответом на сообщение, через @username или ID.\n\nПример:\n+тг админ @username\n-тг админ 123456789"
    );
    return;
  }

  const targetToken = target.token;
  const title = args
    .split(/\s+/)
    .filter((part) => part && part !== targetToken)
    .join(" ")
    .trim();

  const chatIds = isPrivateChat(msg) ? Array.from(chatInfo.keys()) : [msg.chat.id];
  let successCount = 0;
  const failed = [];

  for (const chatId of chatIds) {
    try {
      const canPromote = await canBotUsePermission(chatId, "can_promote_members");

      if (!canPromote) {
        failed.push(`${getChatTitle(chatId)} — нет права назначать админов`);
        continue;
      }

      if (sign === "+") {
        await bot.promoteChatMember(chatId, target.userId, {
          can_manage_chat: true,
          can_delete_messages: true,
          can_restrict_members: true,
          can_invite_users: true,
          can_pin_messages: true,
          can_manage_topics: true,
          can_promote_members: false,
          can_change_info: false,
          can_manage_video_chats: true
        });

        if (title) {
          await bot.setChatAdministratorCustomTitle(chatId, target.userId, title.slice(0, 16)).catch((error) => {
            console.error("Set admin title error:", getErrorMessage(error));
          });
        }

        addAdminLog(chatId, "👮 Выдал тг админа", msg.from, target.displayName, title ? `Должность: ${title}` : "");
      } else {
        await bot.promoteChatMember(chatId, target.userId, {
          can_manage_chat: false,
          can_delete_messages: false,
          can_restrict_members: false,
          can_invite_users: false,
          can_pin_messages: false,
          can_manage_topics: false,
          can_promote_members: false,
          can_change_info: false,
          can_manage_video_chats: false
        });

        addAdminLog(chatId, "👮 Снял тг админа", msg.from, target.displayName);
      }

      successCount += 1;
    } catch (error) {
      failed.push(`${getChatTitle(chatId)} — ${getTelegramFailureReason(error)}`);
    }
  }

  const actionText = sign === "+" ? "выдачи админки" : "снятия админки";
  const result = [
    `👮 Результат ${actionText}:`,
    "",
    `✅ Успешно: ${successCount}`,
    `⚠️ Ошибок: ${failed.length}`
  ];

  if (failed.length > 0) {
    result.push("", failed.slice(0, 8).join("\n"));
  }

  bot.sendMessage(msg.chat.id, result.join("\n"));
});

bot.onText(/^\/(partner|партнер)(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "partner")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "💞 Добавь меня в группу, чтобы пользоваться командой /partner.");
    return;
  }

  const partnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);

  if (!partnerId) {
    bot.sendMessage(msg.chat.id, "💔 У тебя пока нет игровой второй половинки.");
    return;
  }

  const partner = users.get(partnerId);
  const partnerName = partner ? getUserDisplayName(partner) : `ID:${partnerId}`;

  bot.sendMessage(
    msg.chat.id,
    `💞 Твоя игровая вторая половинка: ${partnerName}`,
    { reply_to_message_id: msg.message_id }
  );
});

// /lock and /unlock handlers
bot.onText(/^\/lock(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "lock")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /lock.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /lock.");
    return;
  }

  const botCanChangePermissions = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangePermissions) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу закрыть чат.\n\nДай боту права администратора:\n✅ Блокировка пользователей / Ограничение участников"
    );
    return;
  }

  try {
    const slowModeDelay = await getCurrentSlowModeDelay(msg.chat.id);
    await bot.setChatPermissions(msg.chat.id, getLockedChatPermissions(slowModeDelay));
    addAdminLog(msg.chat.id, "🔒 Закрыл чат", msg.from, "Вся группа", "Обычные участники больше не могут писать.");
    bot.sendMessage(msg.chat.id, "🔒 Чат закрыт. Обычные участники больше не могут писать.");
  } catch (error) {
    console.error("Lock error:", getErrorMessage(error));
    bot.sendMessage(msg.chat.id, getActionErrorText("закрыть чат", error));
  }
});


bot.onText(/^\/unlock(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unlock")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /unlock.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /unlock.");
    return;
  }

  const botCanChangePermissions = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangePermissions) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу открыть чат.\n\nДай боту права администратора:\n✅ Блокировка пользователей / Ограничение участников"
    );
    return;
  }

  try {
    const slowModeDelay = await getCurrentSlowModeDelay(msg.chat.id);
    await bot.setChatPermissions(msg.chat.id, getUnlockedChatPermissions(slowModeDelay));
    addAdminLog(msg.chat.id, "🔓 Открыл чат", msg.from, "Вся группа", "Обычные участники снова могут писать.");
    bot.sendMessage(msg.chat.id, "🔓 Чат открыт. Обычные участники снова могут писать.");
  } catch (error) {
    console.error("Unlock error:", getErrorMessage(error));
    bot.sendMessage(msg.chat.id, getActionErrorText("открыть чат", error));
  }
});

// +чат / -чат
bot.onText(/^([+-])\s*(?:чат|chat)$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "chat")) return;

  if (isPrivateChat(msg)) return;

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут открывать или закрывать чат.");
    return;
  }

  const botCanChangePermissions = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangePermissions) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу изменить права чата. Дай боту права администратора на ограничение участников."
    );
    return;
  }

  try {
    const slowModeDelay = await getCurrentSlowModeDelay(msg.chat.id);

    if (match[1] === "-") {
      await bot.setChatPermissions(msg.chat.id, getLockedChatPermissions(slowModeDelay));
      addAdminLog(msg.chat.id, "🔒 Закрыл чат", msg.from, "Вся группа", "Команда -чат");
      bot.sendMessage(msg.chat.id, "🔒 Чат закрыт. Обычные участники больше не могут писать.");
      return;
    }

    await bot.setChatPermissions(msg.chat.id, getUnlockedChatPermissions(slowModeDelay));
    addAdminLog(msg.chat.id, "🔓 Открыл чат", msg.from, "Вся группа", "Команда +чат");
    bot.sendMessage(msg.chat.id, "🔓 Чат открыт. Обычные участники снова могут писать.");
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить права чата", error));
  }
});

// +топик / -топик
bot.onText(/^([+-])\s*(?:топик|topic)$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "topic")) return;

  if (isPrivateChat(msg)) return;

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут открывать или закрывать топики.");
    return;
  }

  if (!msg.message_thread_id) {
    bot.sendMessage(msg.chat.id, "🧵 Эта команда работает только внутри топика/темы.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_manage_topics", "Управление темами", "изменить топик")) {
    return;
  }

  try {
    if (match[1] === "-") {
      await bot.closeForumTopic(msg.chat.id, msg.message_thread_id);
      addAdminLog(msg.chat.id, "🔒 Закрыл топик", msg.from, `Topic:${msg.message_thread_id}`, "Команда -топик");
      bot.sendMessage(msg.chat.id, "🔒 Топик закрыт. Обычные участники больше не могут писать в этой теме.", {
        message_thread_id: msg.message_thread_id
      });
      return;
    }

    await bot.reopenForumTopic(msg.chat.id, msg.message_thread_id);
    addAdminLog(msg.chat.id, "🔓 Открыл топик", msg.from, `Topic:${msg.message_thread_id}`, "Команда +топик");
    bot.sendMessage(msg.chat.id, "🔓 Топик открыт. Участники снова могут писать в этой теме.", {
      message_thread_id: msg.message_thread_id
    });
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText(
        "изменить топик",
        error,
        "Проверь, что это форум-группа и команда отправлена внутри темы."
      )
    );
  }
});

bot.onText(/^\/admins(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "admins")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👑 Добавь меня в группу, чтобы посмотреть список администраторов.");
    return;
  }

  try {
    const admins = await bot.getChatAdministrators(msg.chat.id);

    if (!admins || admins.length === 0) {
      bot.sendMessage(msg.chat.id, "👑 Администраторы не найдены.");
      return;
    }

    const adminsText = admins
      .map((admin, index) => {
        const user = admin.user;
        const name = getFullName(user);
        const username = user.username ? `@${user.username}` : `ID:${user.id}`;
        const role = admin.status === "creator" ? "👑 Владелец" : "⛑ Админ";

        return `${index + 1}. ${role}\n   👤 ${name}\n   🏷 ${username}`;
      })
      .join("\n\n");

    bot.sendMessage(msg.chat.id, `👑 Список администраторов:\n\n${adminsText}`);
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText("получить список администраторов", error)
    );
  }
});

// /slowmode command handler
bot.onText(/^\/slowmode(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
  registerUserInChat(msg);

  if (!ensureCommandEnabled(msg, "slowmode")) return;

  if (isPrivateChat(msg)) {
    return bot.sendMessage(
      msg.chat.id,
      "👤 Добавь меня в группу, чтобы пользоваться командой /slowmode."
    );
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(
    msg.chat.id,
    msg.from.id
  );

  if (!senderCanUseAdminCommands) {
    return bot.sendMessage(
      msg.chat.id,
      "⛔ Вы не админ."
    );
  }

  const value = (match[1] || "").trim().toLowerCase();

  if (!value) {
    return bot.sendMessage(
      msg.chat.id,
      `🐢 Использование:

/slowmode 10s — 10 секунд
/slowmode 30s — 30 секунд
/slowmode 1m — 1 минута
/slowmode 5m — 5 минут
/slowmode 15m — 15 минут
/slowmode 1h — 1 час
/slowmode 0 — отключить

👤 Для пользователя:

/mute @username 10m
/mute @username 1d`
    );
  }

  if (value.includes("@")) {
    return bot.sendMessage(
      msg.chat.id,
      `⚠️ Slowmode работает только на весь чат.

Для пользователя используй:

/mute @username 10m
/mute @username 1d`
    );
  }

  let seconds = 0;

  if (value === "0") {
    seconds = 0;
  } else if (value === "10s") {
    seconds = 10;
  } else if (value === "30s") {
    seconds = 30;
  } else if (value === "1m") {
    seconds = 60;
  } else if (value === "5m") {
    seconds = 300;
  } else if (value === "15m") {
    seconds = 900;
  } else if (value === "1h") {
    seconds = 3600;
  } else {
    return bot.sendMessage(
      msg.chat.id,
      `⚠️ Telegram поддерживает только:

0
10s
30s
1m
5m
15m
1h

Пример:
/slowmode 5m`
    );
  }

  const botCanChangeSlowMode = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangeSlowMode) {
    return bot.sendMessage(
      msg.chat.id,
      getBotPermissionText("изменить slowmode", "Блокировка пользователей / Ограничение участников")
    );
  }

  try {
    const permissions = await getChatPermissionsWithSlowMode(
      msg.chat.id,
      seconds
    );

    await bot.setChatPermissions(
      msg.chat.id,
      permissions
    );

    if (seconds === 0) {
      addAdminLog(
        msg.chat.id,
        "🐢 Отключил slowmode",
        msg.from,
        "Вся группа"
      );

      return bot.sendMessage(
        msg.chat.id,
        "✅ Slowmode отключён."
      );
    }

    addAdminLog(
      msg.chat.id,
      "🐢 Изменил slowmode",
      msg.from,
      "Вся группа",
      `${seconds} сек`
    );

    bot.sendMessage(
      msg.chat.id,
      `🐢 Slowmode установлен: ${value}`
    );
  } catch (error) {
    console.error("Slowmode error:", getErrorMessage(error));
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить slowmode", error));
  }
});


bot.on("left_chat_member", async (msg) => {
  if (!msg.left_chat_member) return;

  const leftUser = msg.left_chat_member;
  const name = getTelegramName(leftUser);
  const setting = autoKickSettings.get(msg.chat.id);

  const notifySettings = getJoinLeaveSettings(msg.chat.id);
  const leftProfile = users.get(leftUser.id);
  const leftMessages = leftProfile?.messages || 0;

  if (notifySettings.leaves && leftMessages >= notifySettings.leaveMinMessages) {
    bot.sendMessage(msg.chat.id, `👋 ${name} покинул(а) группу`);
  }

  if (!setting || setting.enabled !== true) return;
  if (leftUser.is_bot) return;

  const key = `${msg.chat.id}:${leftUser.id}`;
  const now = Date.now();
  const timeLimitMs = setting.time * 1000;

  const history = (userLeftHistory.get(key) || []).filter((time) => now - time <= timeLimitMs);
  history.push(now);
  userLeftHistory.set(key, history);

  if (history.length < setting.count) return;

  try {
    if (setting.action === "ban") {
      await bot.banChatMember(msg.chat.id, leftUser.id);
      bot.sendMessage(msg.chat.id, `🚫 ${name} забанен за частые выходы из чата.`);
      addAdminLog(msg.chat.id, "🚫 Автобан за выходы", { id: botId || 0, first_name: "Сливки Бот" }, name, `Выходов: ${history.length}/${setting.count}`);
    } else {
      await bot.banChatMember(msg.chat.id, leftUser.id, {
        until_date: Math.floor(Date.now() / 1000) + 40
      });

      setTimeout(() => {
        bot.unbanChatMember(msg.chat.id, leftUser.id, { only_if_banned: true }).catch((error) => {
          console.error("Autokick temporary unban error:", getErrorMessage(error));
        });
      }, 1000);

      bot.sendMessage(msg.chat.id, `👢 ${name} кикнут за частые выходы из чата.`);
      addAdminLog(msg.chat.id, "👢 Автокик за выходы", { id: botId || 0, first_name: "Сливки Бот" }, name, `Выходов: ${history.length}/${setting.count}`);
    }

    userLeftHistory.delete(key);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("выполнить автокик", error));
  }
});

bot.on("new_chat_members", (msg) => {
  if (!Array.isArray(msg.new_chat_members) || msg.new_chat_members.length === 0) return;
  if (isPrivateChat(msg)) return;

  const notifySettings = getJoinLeaveSettings(msg.chat.id);

  for (const member of msg.new_chat_members) {
    getUser(member);
    registerUserInChat({ chat: msg.chat, from: member });

    if (notifySettings.joins) {
      bot.sendMessage(msg.chat.id, `👋 ${getTelegramName(member)} присоединился(ась) к группе`);
    }
  }
});

bot.onText(/^([+-])\s*(входы|выходы|входы-выходы)(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "joinleave")) return;

  if (isPrivateChat(msg)) return;

  const isAdmin = await canUseAdminCommands(msg.chat.id, msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут настраивать входы и выходы.");
    return;
  }

  const settings = getJoinLeaveSettings(msg.chat.id);
  const sign = match[1];
  const type = match[2].toLowerCase();
  const count = match[3] ? Number(match[3]) : null;

  if (type === "входы") {
    settings.joins = sign === "+";
    saveChatSettings();
    bot.sendMessage(msg.chat.id, settings.joins ? "✅ Входы включены." : "❌ Входы отключены.");
    return;
  }

  if (type === "выходы") {
    settings.leaves = sign === "+";

    if (count !== null) {
      settings.leaveMinMessages = count;
      settings.leaves = true;
      saveChatSettings();
      bot.sendMessage(msg.chat.id, `✅ Выходы включены.\nПорог: ${count} сообщений.`);
      return;
    }

    saveChatSettings();
    bot.sendMessage(msg.chat.id, settings.leaves ? "✅ Выходы включены." : "❌ Выходы отключены.");
    return;
  }

  const enabled = sign === "+";
  settings.joins = enabled;
  settings.leaves = enabled;
  saveChatSettings();

  bot.sendMessage(
    msg.chat.id,
    enabled ? "✅ Входы и выходы включены." : "❌ Входы и выходы отключены."
  );
});

bot.onText(/^(?:\/autokick|автокик)(?:\s+(.*))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "autokick")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👢 Добавь меня в группу, чтобы пользоваться автокиком.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут настраивать автокик.");
    return;
  }

  const value = (match[1] || "").trim().toLowerCase();

  if (!value) {
    const current = autoKickSettings.get(msg.chat.id);

    if (!current || current.enabled !== true) {
      bot.sendMessage(
        msg.chat.id,
        "👢 Автокик выключен.\n\nИспользование:\nавтокик 3 60 кик\nавтокик 3 60 бан\n/autokick off\n\nГде:\n3 — количество выходов\n60 — время в секундах\nкик или бан — наказание"
      );
      return;
    }

    bot.sendMessage(
      msg.chat.id,
      `👢 Автокик включён.\n\nВыходов: ${current.count}\nВремя: ${current.time} сек.\nНаказание: ${current.action === "ban" ? "бан" : "кик"}`
    );
    return;
  }

  if (["off", "выкл", "0"].includes(value)) {
    autoKickSettings.delete(msg.chat.id);
    saveChatSettings();
    bot.sendMessage(msg.chat.id, "✅ Автокик выключен.");
    return;
  }

  if (["on", "вкл"].includes(value)) {
    if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "включить автокик")) {
      return;
    }

    autoKickSettings.set(msg.chat.id, {
      enabled: true,
      count: 3,
      time: 60,
      action: "kick"
    });
    saveChatSettings();

    bot.sendMessage(msg.chat.id, "✅ Автокик включён.\n\nПо умолчанию: 3 выхода за 60 секунд → кик.");
    return;
  }

  const parts = value.split(/\s+/);
  const count = Number(parts[0]);
  const time = Number(parts[1]);
  const action = parts[2];

  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(time) || time < 1 || !["кик", "kick", "бан", "ban"].includes(action)) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Неверный формат.\n\nПример:\nавтокик 3 60 кик\nавтокик 3 60 бан\n\nГде 3 — количество выходов, 60 — секунды."
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "включить автокик")) {
    return;
  }

  autoKickSettings.set(msg.chat.id, {
    enabled: true,
    count,
    time,
    action: ["бан", "ban"].includes(action) ? "ban" : "kick"
  });
  saveChatSettings();

  bot.sendMessage(
    msg.chat.id,
    `✅ Автокик настроен.\n\nЕсли участник выйдет ${count} раз за ${time} сек., будет: ${["бан", "ban"].includes(action) ? "бан" : "кик"}.`
  );
});

bot.on("my_chat_member", (update) => {
  const oldStatus = update.old_chat_member?.status;
  const newStatus = update.new_chat_member?.status;
  const chatId = update.chat.id;
  const adminName = getTelegramName(update.from);

  if (["member", "administrator"].includes(newStatus) && !chatInfo.has(chatId)) {
    chatInfo.set(chatId, {
      joinedAt: formatDateTime(),
      title: update.chat.title || "Группа",
      type: update.chat.type,
      users: []
    });
    saveChatInfo();
  } else if (["member", "administrator"].includes(newStatus) && chatInfo.has(chatId)) {
    const info = chatInfo.get(chatId);
    info.title = update.chat.title || info.title || "Группа";
    info.type = update.chat.type || info.type;
    if (!Array.isArray(info.users)) info.users = [];
    saveChatInfo();
  }

  if (["left", "kicked"].includes(newStatus)) {
    chatInfo.delete(chatId);
    chatUsers.delete(chatId);
    saveChatInfo();
  }

  if (["member", "administrator"].includes(newStatus) && !["member", "administrator"].includes(oldStatus)) {
    bot.sendMessage(chatId, getGroupMenuText(), getGroupKeyboard());
  }

  if (oldStatus !== "administrator" && newStatus === "administrator") {
    bot.sendMessage(
      chatId,
      `⛑ ${adminName} сделал(а) меня администратором группы.\n\nТеперь мне доступны функции модерации: warn, mute, unmute, kick, ban и unban.`
    );
  }
});

bot.onText(/^\/warn(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "warn")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /warn.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /warn.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Чтобы выдать предупреждение, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /warn\n2. Напиши /warn @username\n3. Напиши /warn ID\n\nВажно: /warn @username работает только если бот уже видел этого пользователя в группе после запуска. Самый надёжный способ — ответить /warn на сообщение пользователя."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "предупредить");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  targetProfile.warnings += 1;
  saveUsers();

  if (targetProfile.warnings >= 3) {
    try {
      if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "забанить за 3 предупреждения")) {
        return;
      }

      await bot.banChatMember(msg.chat.id, targetProfile.id);
      addAdminLog(msg.chat.id, "🚫 Автобан за 3 предупреждения", msg.from, getUserDisplayName(targetProfile), "Пользователь получил 3/3 предупреждений.");
      bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} получил 3/3 предупреждений и был забанен.`);
    } catch (error) {
      bot.sendMessage(
        msg.chat.id,
        `${getActionErrorText("забанить пользователя за 3 предупреждения", error)}\n\n⚠️ Предупреждение сохранено: 3/3.`
      );
    }
    return;
  }

  addAdminLog(msg.chat.id, "⚠️ Выдал предупреждение", msg.from, getUserDisplayName(targetProfile), `Предупреждения: ${targetProfile.warnings}/3`);

  bot.sendMessage(
    msg.chat.id,
    `⚠️ ${getUserDisplayName(targetProfile)} получил предупреждение.\n\nПредупреждения: ${targetProfile.warnings}/3`
  );
});

bot.onText(/^\/unwarn(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unwarn")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /unwarn.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /unwarn.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "♻️ Чтобы снять предупреждения, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /unwarn\n2. Напиши /unwarn @username\n3. Напиши /unwarn ID"
    );
    return;
  }

  targetProfile.warnings = 0;
  saveUsers();

  addAdminLog(msg.chat.id, "♻️ Снял предупреждения", msg.from, getUserDisplayName(targetProfile), "Предупреждения: 0/3");

  bot.sendMessage(
    msg.chat.id,
    `♻️ У пользователя ${getUserDisplayName(targetProfile)} сняты все предупреждения.\n\nПредупреждения: 0/3`
  );
});

bot.onText(/^\/mute(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "mute")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /mute.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /mute.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "🔇 Чтобы замьютить пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /mute 10m\n2. Напиши /mute @username 10m\n3. Напиши /mute ID 10m\n\nФормат времени:\n1s — 1 секунда\n1m — 1 минута\n1d — 1 день\n\nВажно: /mute @username работает только если бот уже видел этого пользователя в группе после запуска."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "замьютить");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  const duration = parseMuteDuration(msg.text);

  if (!duration) {
    bot.sendMessage(
      msg.chat.id,
      "⛔ Неверный формат времени.\n\n🔇 Формат времени:\n1s — 1 секунда\n1m — 1 минута\n1d — 1 день\n\nПример:\n/mute 10m\n/mute 1d"
    );
    return;
  }

  if (duration.seconds > MAX_MUTE_SECONDS) {
    bot.sendMessage(msg.chat.id, "⛔ Максимальный срок мута — 365 дней.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "замьютить пользователя")) {
    return;
  }

  const untilDate = Math.floor(Date.now() / 1000) + duration.seconds;
  const timerKey = `${msg.chat.id}:${targetProfile.id}`;

  try {
    await bot.restrictChatMember(msg.chat.id, targetProfile.id, {
      until_date: untilDate,
      permissions: getMutedPermissions()
    });

    if (muteTimers.has(timerKey)) {
      clearTimeout(muteTimers.get(timerKey));
    }

    addAdminLog(msg.chat.id, "🔇 Замьютил", msg.from, getUserDisplayName(targetProfile), `Время: ${duration.label}`);
    bot.sendMessage(msg.chat.id, `🔇 ${getUserDisplayName(targetProfile)} на mute на ${duration.label}`);

    const timerMs = duration.seconds * 1000;

    if (timerMs <= MAX_NODE_TIMER_MS) {
      const timer = setTimeout(async () => {
        try {
          await bot.restrictChatMember(msg.chat.id, targetProfile.id, {
            permissions: getFullPermissions()
          });

          muteTimers.delete(timerKey);
          bot.sendMessage(msg.chat.id, `🔊 С пользователя ${getUserDisplayName(targetProfile)} снят mute, время закончилось.`);
        } catch (error) {
          muteTimers.delete(timerKey);
          bot.sendMessage(msg.chat.id, getActionErrorText("автоматически снять мут", error));
        }
      }, timerMs);

      muteTimers.set(timerKey, timer);
    }
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText("замьютить пользователя", error)
    );
  }
});

bot.onText(/^\/unmute(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unmute")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /unmute.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /unmute.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "🔊 Чтобы снять мут, ответь на сообщение пользователя командой /unmute или напиши /unmute @username."
    );
    return;
  }

  const timerKey = `${msg.chat.id}:${targetProfile.id}`;

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "снять мут")) {
    return;
  }

  try {
    await bot.restrictChatMember(msg.chat.id, targetProfile.id, {
      permissions: getFullPermissions()
    });

    if (muteTimers.has(timerKey)) {
      clearTimeout(muteTimers.get(timerKey));
      muteTimers.delete(timerKey);
    }

    addAdminLog(msg.chat.id, "🔊 Снял мут", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `🔊 С пользователя ${getUserDisplayName(targetProfile)} снят мут.`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("снять мут", error));
  }
});

bot.onText(/^\/(kick|cick)(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "kick")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /kick.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /kick.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "👢 Чтобы кикнуть пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /kick\n2. Напиши /kick @username\n3. Напиши /kick ID\n\nВажно: /kick @username работает только если бот уже видел этого пользователя в группе после запуска. Самый надёжный способ — ответить /kick на сообщение пользователя."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "кикнуть");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "кикнуть пользователя")) {
    return;
  }

  try {
    await bot.banChatMember(msg.chat.id, targetProfile.id, {
      until_date: Math.floor(Date.now() / 1000) + 40
    });

    setTimeout(() => {
      bot.unbanChatMember(msg.chat.id, targetProfile.id, { only_if_banned: true }).catch((error) => {
        console.error("Kick temporary unban error:", getErrorMessage(error));
      });
    }, 1000);

    addAdminLog(msg.chat.id, "👢 Кикнул", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `👢 ${getUserDisplayName(targetProfile)} был(а) кикнут(а) из группы.`);
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText("кикнуть пользователя", error)
    );
  }
});

bot.onText(/^\/ban(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "ban")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /ban.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /ban.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "🚫 Чтобы забанить пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /ban\n2. Напиши /ban @username\n3. Напиши /ban ID\n\nВажно: /ban @username работает только если бот уже видел этого пользователя в группе после запуска. Самый надёжный способ — ответить /ban на сообщение пользователя."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "забанить");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "забанить пользователя")) {
    return;
  }

  try {
    await bot.banChatMember(msg.chat.id, targetProfile.id);
    addAdminLog(msg.chat.id, "🚫 Забанил", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} был забанен.`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("забанить пользователя", error));
  }
});

bot.onText(/^\/unban(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unban")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /unban.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /unban.");
    return;
  }

  let targetProfile = null;
  let userId = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    targetProfile = getUser(msg.reply_to_message.from);
    userId = targetProfile.id;
  } else {
    const parts = msg.text.trim().split(/\s+/);
    const target = parts[1];

    if (target) {
      const cleanTarget = target.replace("@", "");

      if (/^\d+$/.test(cleanTarget)) {
        userId = Number(cleanTarget);
        targetProfile = users.get(userId) || null;
      } else {
        targetProfile = findUserByUsername(cleanTarget);
        if (targetProfile) userId = targetProfile.id;
      }
    }
  }

  if (!userId) {
    bot.sendMessage(
      msg.chat.id,
      "✅ Чтобы разбанить пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /unban\n2. Напиши /unban @username\n3. Напиши /unban ID\n\nВажно: /unban @username работает только если бот уже видел этого пользователя в группе. Если не сработало — используй ID."
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "разбанить пользователя")) {
    return;
  }

  try {
    await bot.unbanChatMember(msg.chat.id, userId, { only_if_banned: true });

    if (targetProfile) {
      targetProfile.warnings = 0;
      saveUsers();
    }

    const targetText = targetProfile ? getUserDisplayName(targetProfile) : "ID:" + userId;
    addAdminLog(msg.chat.id, "✅ Разбанил", msg.from, targetText);
    bot.sendMessage(msg.chat.id, `✅ Пользователь ${targetProfile ? getUserDisplayName(targetProfile) : "с ID " + userId} разбанен.`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("разбанить пользователя", error));
  }
});

bot.onText(/^\/(clear|claer)(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "clear")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /clear.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /clear.");
    return;
  }

  if (!match[2]) {
    bot.sendMessage(
      msg.chat.id,
      "🧹 Укажите количество сообщений для удаления.\n\nПример:\n/clear 10 — удалить последние 10 сообщений\n/clear 20 — удалить последние 20 сообщений"
    );
    return;
  }

  const count = Number(match[2]);

  if (!Number.isInteger(count) || count < 1) {
    bot.sendMessage(
      msg.chat.id,
      "🧹 Используй команду так:\n\n/clear — удалить последнее сообщение\n/clear 10 — удалить последние 10 сообщений\n/clear 20 — удалить последние 20 сообщений"
    );
    return;
  }

  if (count > 100) {
    bot.sendMessage(msg.chat.id, "⚠️ За один раз можно удалить максимум 100 сообщений.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_delete_messages", "Удаление сообщений", "удалить сообщения")) {
    return;
  }

  const fromMessageId = Math.max(1, msg.message_id - count);
  const toMessageId = msg.message_id - 1;
  let deletedCount = 0;
  let lastDeleteError = null;

  for (let messageId = fromMessageId; messageId <= toMessageId; messageId++) {
    try {
      await bot.deleteMessage(msg.chat.id, messageId);
      deletedCount += 1;
    } catch (error) {
      lastDeleteError = error;
    }
  }

  if (deletedCount === 0) {
    bot.sendMessage(
      msg.chat.id,
      lastDeleteError
        ? getActionErrorText("удалить сообщения", lastDeleteError)
        : "⚠️ Не получилось удалить сообщения."
    );
    return;
  }

  addAdminLog(msg.chat.id, "🧹 Очистил сообщения", msg.from, "Чат", `Удалено сообщений: ${deletedCount}`);
  bot.sendMessage(msg.chat.id, `🧹 Удалено сообщений: ${deletedCount}`);
});

bot.onText(/^(?:\/pin(?:@\w+)?|!пин|!pin)(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "pin")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📌 Добавь меня в группу, чтобы пользоваться закреплением сообщений.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете закреплять сообщения.");
    return;
  }

  let targetMessageId = null;

  if (msg.reply_to_message) {
    targetMessageId = msg.reply_to_message.message_id;
  } else if (match[1]) {
    targetMessageId = Number(match[1]);
  }

  if (!targetMessageId) {
    bot.sendMessage(
      msg.chat.id,
      "📌 Чтобы закрепить сообщение, ответь на него командой /pin или !пин.\n\nТакже можно по ID:\n/pin 1234\n!пин 1234\n\nЧтобы узнать ID, ответь на сообщение текстом: смс ид"
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_pin_messages", "Закрепление сообщений", "закрепить сообщение")) {
    return;
  }

  try {
    await bot.pinChatMessage(msg.chat.id, targetMessageId, {
      disable_notification: false
    });

    addAdminLog(msg.chat.id, "📌 Закрепил сообщение", msg.from, `ID:${targetMessageId}`);
    bot.sendMessage(msg.chat.id, `📌 Сообщение закреплено.\nID: ${targetMessageId}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("закрепить сообщение", error));
  }
});

bot.onText(/^(?:\/unpin(?:@\w+)?|!анпин|!unpin)(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unpin")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📍 Добавь меня в группу, чтобы пользоваться откреплением сообщений.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете откреплять сообщения.");
    return;
  }

  const targetMessageId = msg.reply_to_message ? msg.reply_to_message.message_id : match[1] ? Number(match[1]) : null;

  if (!await ensureBotPermission(msg, "can_pin_messages", "Закрепление сообщений", "открепить сообщение")) {
    return;
  }

  try {
    if (targetMessageId) {
      await bot.unpinChatMessage(msg.chat.id, { message_id: targetMessageId });
      addAdminLog(msg.chat.id, "📍 Открепил сообщение", msg.from, `ID:${targetMessageId}`);
      bot.sendMessage(msg.chat.id, `📍 Сообщение откреплено.\nID: ${targetMessageId}`);
      return;
    }

    await bot.unpinChatMessage(msg.chat.id);
    addAdminLog(msg.chat.id, "📍 Открепил последнее закреплённое сообщение", msg.from, "Чат");
    bot.sendMessage(msg.chat.id, "📍 Последнее закреплённое сообщение откреплено.");
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("открепить сообщение", error));
  }
});

bot.on("message", async (msg) => {
  if (!msg.text) return;
  registerUserInChat(msg);
  if (isPrivateChat(msg)) return;

  const rulesInputKey = `${msg.chat.id}:${msg.from.id}`;

  if (waitingRulesInput.has(rulesInputKey)) {
    waitingRulesInput.delete(rulesInputKey);

    const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

    if (!senderCanUseAdminCommands) {
      bot.sendMessage(msg.chat.id, "⛔ Только админы могут менять правила группы.");
      return;
    }

    const rulesText = msg.text.trim();

    if (rulesText.length > 3500) {
      bot.sendMessage(msg.chat.id, "⚠️ Правила слишком длинные. Сократи текст до 3500 символов.");
      return;
    }

    chatRules.set(msg.chat.id, rulesText);
    saveChatSettings();
    addAdminLog(msg.chat.id, "📜 Обновил правила", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, "✅ Правила группы обновлены.\n\nПосмотреть: /rules");
    return;
  }

  if (msg.text.match(/^(?:сливки\s+брак|брак|\/brak)(?:\s+(.+))?$/i) && !ensureCommandEnabled(msg, "brak")) {
    return;
  }

  if (msg.text.match(/^(?:сливки\s+развод|развод|\/razvod)$/i) && !ensureCommandEnabled(msg, "razvod")) {
    return;
  }

  const commandText = (msg.text || "").trim().toLowerCase();
  const commandData = RP_COMMANDS[commandText];

  if (commandData) {
    if (!ensureCommandEnabled(msg, "action")) return;

    if (!msg.reply_to_message?.from) {
      bot.sendMessage(
        msg.chat.id,
        RP_REPLY_HINT,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });
    await sendRpActionMessage(msg, commandData);
    return;
  }

  if (/^(?:смс\s*ид|sms\s*id|message\s*id)$/i.test(msg.text.trim())) {
    if (!ensureCommandEnabled(msg, "messageid")) return;

    const targetMessageId = msg.reply_to_message ? msg.reply_to_message.message_id : msg.message_id;

    bot.sendMessage(
      msg.chat.id,
      `🧾 ID сообщения: ${targetMessageId}`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  if (!chatInfo.has(msg.chat.id)) {
    chatInfo.set(msg.chat.id, {
      joinedAt: formatDateTime(),
      title: msg.chat.title || "Группа",
      type: msg.chat.type,
      users: []
    });
    saveChatInfo();
  }

  resetDailyStatsIfNeeded();
  addActivity(msg.from);
  stats.messagesToday += 1;

  if (!stats.chatMessagesToday || typeof stats.chatMessagesToday !== "object") {
    stats.chatMessagesToday = {};
  }

  stats.chatMessagesToday[msg.chat.id] = (stats.chatMessagesToday[msg.chat.id] || 0) + 1;
  saveStats();

  const probabilityQuestion = parseProbabilityQuestion(msg.text);

  if (probabilityQuestion) {
    const percent = getRandomPercent();
    bot.sendMessage(
      msg.chat.id,
      `🎲 Вероятность того, что ${probabilityQuestion}: ${percent}%`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  // --- "сливки брак" feature
  const marriageMatch = msg.text.match(/^(?:сливки\s+брак|брак|\/brak)(?:\s+(.+))?$/i);

  if (marriageMatch) {
    const percent = getMarriagePercent();
    const info = chatInfo.get(msg.chat.id);
    const userName = getTelegramName(msg.from);
    const currentPartnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);

    if (currentPartnerId) {
      const currentPartner = users.get(currentPartnerId);
      const currentPartnerName = currentPartner ? getUserDisplayName(currentPartner) : `ID:${currentPartnerId}`;

      bot.sendMessage(
        msg.chat.id,
        `💍 ${userName} уже состоит в игровом браке.\n\n💞 Вторая половинка: ${currentPartnerName}\n\nЧтобы отменить: напиши "развод" или /razvod`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    let partnerId = null;
    let partnerName = "";

    if (msg.reply_to_message?.from) {
      const partnerProfile = getUser(msg.reply_to_message.from);
      registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });
      partnerId = partnerProfile.id;
      partnerName = getUserDisplayName(partnerProfile);
    } else if (marriageMatch[1]) {
      const targetText = marriageMatch[1].trim();
      const cleanTarget = targetText.replace("@", "");
      const foundUser = findUserByUsername(cleanTarget);

      if (foundUser) {
        partnerId = foundUser.id;
        partnerName = getUserDisplayName(foundUser);
      } else {
        partnerName = targetText;
      }
    } else if (info && Array.isArray(info.users) && info.users.length > 0) {
      const availableUsers = info.users.filter((userId) => {
        const profile = users.get(userId);
        return userId !== msg.from.id && !profile?.isBot && !getMarriagePartnerId(msg.chat.id, userId);
      });

      if (availableUsers.length > 0) {
        partnerId = availableUsers[Math.floor(Math.random() * availableUsers.length)];
        const randomUser = users.get(partnerId);
        partnerName = randomUser ? getUserDisplayName(randomUser) : `ID:${partnerId}`;
      }
    }

    if (!partnerName || !partnerId) {
      bot.sendMessage(
        msg.chat.id,
        "💍 Пока не нашёл свободную пару для брака. Пусть участники напишут пару сообщений в группе.",
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    if (partnerId === msg.from.id) {
      bot.sendMessage(
        msg.chat.id,
        "💍 Самого себя выбрать нельзя.",
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    const partnerProfileForCheck = users.get(partnerId);

    if (partnerProfileForCheck?.isBot) {
      bot.sendMessage(
        msg.chat.id,
        "💍 Ботов нельзя выбирать для брака.",
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    if (getMarriagePartnerId(msg.chat.id, partnerId)) {
      bot.sendMessage(
        msg.chat.id,
        `💍 ${partnerName} уже состоит в игровом браке.`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    const proposalId = createMarriageProposal(msg.chat.id, msg.from.id, partnerId, percent);

    bot.sendMessage(
      msg.chat.id,
      `💍 ПРЕДЛОЖЕНИЕ БРАКА\n\n👤 ${userName} предлагает игровой брак пользователю ${partnerName}.\n\n❤️ Совместимость: ${percent}%\n\n${partnerName}, примите предложение?`,
      {
        reply_to_message_id: msg.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Принять", callback_data: `marriage_accept:${proposalId}` },
              { text: "❌ Отказаться", callback_data: `marriage_decline:${proposalId}` }
            ]
          ]
        }
      }
    );

    return;
  }

  const divorceMatch = msg.text.match(/^(?:сливки\s+развод|развод|\/razvod)$/i);

  if (divorceMatch) {
    const partnerId = removeMarriage(msg.chat.id, msg.from.id);

    if (!partnerId) {
      bot.sendMessage(
        msg.chat.id,
        "💔 У тебя пока нет игрового брака.",
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    const partner = users.get(partnerId);
    const partnerName = partner ? getUserDisplayName(partner) : `ID:${partnerId}`;

    bot.sendMessage(
      msg.chat.id,
      `💔 Игровой брак расторгнут.\n\n${getTelegramName(msg.from)} и ${partnerName} больше не вместе.`,
      { reply_to_message_id: msg.message_id }
    );
    return;
  }
});

bot.on("message", async (msg) => {
  if (!isPrivateChat(msg)) return;
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;
  if (!supportUsers.has(msg.from.id)) return;

  supportUsers.delete(msg.from.id);

  const sender = getTelegramName(msg.from);

  for (const ownerId of ownerIds) {
    try {
      await bot.sendMessage(
        ownerId,
        `📩 Новое обращение в поддержку\n\n👤 От: ${sender}\n🆔 ID: ${msg.from.id}\n\n💬 Сообщение:\n${msg.text}`
      );
    } catch (error) {
      console.error(`Support forward error (${ownerId}):`, getErrorMessage(error));
    }
  }

  await bot.sendMessage(
    msg.chat.id,
    "✅ Ваше сообщение отправлено в поддержку."
  );
});
