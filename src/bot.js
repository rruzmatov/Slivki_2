require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const botToken = process.env.BOT_TOKEN;
const ownerIds = (process.env.OWNER_IDS || "")

  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isInteger(id));

if (!botToken) {
  console.error("Ошибка: BOT_TOKEN не найден в файле .env");
  process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: true });

console.log("🍦 Сливки Бот запущен");

const users = new Map();
const chatUsers = new Map();
const muteTimers = new Map();
const adminLogs = new Map();

const pendingMarriages = new Map();
const supportUsers = new Set();

const chatRules = new Map();
const waitingRulesInput = new Set();
const autoKickSettings = new Map();
const userLeftHistory = new Map();
const joinLeaveSettings = new Map();

const fs = require("fs");
const path = require("path");

const STATS_FILE = path.join(__dirname, "stats.json");
const CHATS_FILE = path.join(__dirname, "chats.json");
const USERS_FILE = path.join(__dirname, "users.json");
const MARRIAGES_FILE = path.join(__dirname, "marriages.json");

const stats = loadStats();
const chatInfo = loadChatInfo();
const marriages = loadMarriages();
const savedUsers = loadUsers();

for (const [id, user] of savedUsers) {
  users.set(id, user);
}

console.log("Users file:", USERS_FILE);
console.log("Saved users loaded:", users.size);

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));

    return new Map(
      Object.entries(data).map(([id, user]) => [Number(id), user])
    );
  } catch (error) {
    console.error("Load users error:", error.message);
    return new Map();
  }
}

function saveUsers() {
  try {
    const data = Object.fromEntries(users);
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Save users error:", error.message);
  }
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
  } catch {
    return {
      messagesToday: 0,
      chatMessagesToday: {},
      lastResetDate: getTashkentDateInfo().date
    };
  }
}

function saveStats() {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

function loadChatInfo() {
  try {
    if (!fs.existsSync(CHATS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));

    return new Map(
      Object.entries(data).map(([chatId, info]) => [Number(chatId), info])
    );
  } catch (error) {
    console.error("Load chats error:", error.message);
    return new Map();
  }
}

function saveChatInfo() {
  try {
    const data = Object.fromEntries(chatInfo);
    fs.writeFileSync(CHATS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Save chats error:", error.message);
  }
}

function loadMarriages() {
  try {
    if (!fs.existsSync(MARRIAGES_FILE)) {
      fs.writeFileSync(MARRIAGES_FILE, "{}", "utf8");
      return new Map();
    }

    const fileContent = fs.readFileSync(MARRIAGES_FILE, "utf8").trim();

    if (!fileContent) {
      fs.writeFileSync(MARRIAGES_FILE, "{}", "utf8");
      return new Map();
    }

    const data = JSON.parse(fileContent);

    return new Map(
      Object.entries(data).map(([chatId, chatMarriages]) => [Number(chatId), chatMarriages])
    );
  } catch (error) {
    console.error("Load marriages error:", error.message);
    fs.writeFileSync(MARRIAGES_FILE, "{}", "utf8");
    return new Map();
  }
}

function saveMarriages() {
  try {
    const data = Object.fromEntries(marriages);
    fs.writeFileSync(MARRIAGES_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Save marriages error:", error.message);
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


const commandSettings = new Map([
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
  ["partner", true]
]);

let botUsername = "";

bot.getMe().then((me) => {
  botUsername = me.username;
});


async function setupBotCommands() {
  try {
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

    const privateCommands = [
      { command: "start", description: "🍦 добавить бота в группу" }
    ];

    await bot.deleteMyCommands();
    await bot.deleteMyCommands({ scope: { type: "all_group_chats" } });
    await bot.deleteMyCommands({ scope: { type: "all_chat_administrators" } });
    await bot.deleteMyCommands({ scope: { type: "all_private_chats" } });

    await bot.setMyCommands(groupCommands, { scope: { type: "all_group_chats" } });
    await bot.setMyCommands(groupCommands, { scope: { type: "all_chat_administrators" } });
    await bot.setMyCommands(privateCommands, { scope: { type: "all_private_chats" } });
  } catch (error) {
    console.error("Ошибка меню команд:", error.message);
  }
}

setupBotCommands();

function getUser(user) {
  const id = user.id;

  if (!users.has(id)) {
    users.set(id, {
      id,
      firstName: user.first_name || "Пользователь",
      username: user.username || "нет",
      isBot: user.is_bot === true,
      messages: 0,
      warnings: 0
    });
  }

  const profile = users.get(id);
  profile.firstName = user.first_name || profile.firstName;
  profile.username = user.username || profile.username || "нет";
  profile.isBot = user.is_bot === true;

  saveUsers();

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

  // --- Add users array to chatInfo and update it
  const info = chatInfo.get(chatId);

  if (!Array.isArray(info.users)) {
    info.users = [];
  }

  if (!info.users.includes(profile.id)) {
    info.users.push(profile.id);
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
    joinLeaveSettings.set(chatId, {
      joins: true,
      leaves: true,
      leaveMinMessages: 0
    });
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
    date: formatDateTime(),
    action,
    admin: getTelegramName(adminUser),
    target: targetText,
    details
  });

  if (logs.length > 50) {
    logs.length = 50;
  }
}

function getAdminLogsText(chatId) {
  const logs = adminLogs.get(chatId) || [];

  if (logs.length === 0) {
    return "📋 Логи пока пустые.";
  }

  return "📋 Последние админ-действия:\n\n" + logs
    .slice(0, 15)
    .map((log, index) => {
      const detailsText = log.details ? `\n   📝 ${log.details}` : "";

      return `${index + 1}. ${log.action}\n   🕒 ${log.date}\n   👮 Админ: ${log.admin}\n   👤 Цель: ${log.target}${detailsText}`;
    })
    .join("\n\n");
}

bot.onText(/\/stats/, async (msg) => {
  registerUserInChat(msg);

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
  const shouldReset = current.hour === 23 && current.minute >= 59;

  if (shouldReset && stats.lastResetDate !== current.date) {
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
    console.error("Stats count error:", error.message);
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

function getCommandSettingsKeyboard() {
  const rows = Array.from(commandSettings.keys()).map((commandName) => [
    {
      text: `/${commandName} — ${getCommandStatus(commandName)}`,
      callback_data: `toggle_command:${commandName}`
    }
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

function getAdminCommandsText() {
  return "⚙️ УПРАВЛЕНИЕ КОМАНДАМИ\n\n" +
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
  bot.sendMessage(msg.chat.id, `⛔ Команда /${commandName} сейчас выключена владельцем бота.`);
}

function ensureCommandEnabled(msg, commandName) {
  if (isCommandEnabled(commandName)) return true;

  if (isOwner(msg.from?.id)) return true;

  replyCommandDisabled(msg, commandName);
  return false;
}

async function canUseAdminCommands(chatId, userId) {
  if (isOwner(userId)) return true;
  return isUserAdmin(chatId, userId);
}

// Check if the bot has rights to change slowmode in the chat
async function canBotChangeSlowMode(chatId) {
  try {
    const me = await bot.getMe();
    const botMember = await bot.getChatMember(chatId, me.id);

    return (
      botMember.status === "administrator" &&
      botMember.can_restrict_members === true
    );
  } catch {
    return false;
  }
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
  return "📋 Главное меню\n" +
    "👤 Профиль: /profile\n" +
    "🏆 Топ: /top\n" +
    "🛡 Модерация: /commands\n\n" +
    "✨ Быстрые действия\n" +
    "⚠️ /warn — предупреждение\n" +
    "🔇 /mute 10m — мут\n" +
    "👢 /kick — кик\n" +
    "🚫 /ban — бан\n\n" +
    "📜 Полный список команд: /commands";
}

function getCommandsText() {
  return "📜 Commands • Список команд\n\n" +
    "👤 Пользователь\n" +
    "• /profile — профиль пользователя\n" +
    "• /top — топ активных участников\n\n" +
    "📌 Информация\n" +
    "• /menu — главное меню\n" +
    "• /commands — список команд\n" +
    "• /admins — список администраторов\n" +
    "• /slowmode 10 — задержка сообщений\n" +
    "• /lock — закрыть чат\n" +
    "• /unlock — открыть чат\n" +
    "• +чат / -чат — открыть или закрыть чат\n" +
    "• +топик / -топик — открыть или закрыть текущий топик\n" +
    "• /logs — логи админ-действий\n" +
    "• /stats — статистика группы\n" +
    "• /settitle Название — изменить название чата\n" +
    "• /setdescription Текст — изменить описание чата\n" +
    "• /invite — получить ссылку-приглашение\n" +
    "• /id — ID пользователя или сообщения\n" +
    "• /chatinfo — информация о группе\n" +
    "• /rules — правила группы\n" +
    "• /setrules — установить правила\n" +
    "• /resetlinks — сбросить ссылки\n" +
    "• /autokick — автокик после выхода участника\n" +
    "• Сетка +тг админ [должность] @username/ID — выдать админку во всех известных чатах\n" +
    "• +входы / -входы — уведомления о входах\n" +
    "• +выходы / -выходы — уведомления о выходах\n" +
    "• +входы-выходы / -входы-выходы — оба типа уведомлений\n" +
    "• +выходы {число} — порог сообщений для уведомлений о выходе\n\n" +
    "🛡 Модерация\n" +
    "• /warn — выдать предупреждение\n" +
    "• /unwarn — снять предупреждения\n" +
    "• /mute 10m — выдать мут\n" +
    "• /unmute — снять мут\n" +
    "• /kick — кикнуть пользователя\n" +
    "• /ban — забанить пользователя\n" +
    "• /unban — разбанить пользователя\n" +
    "• /pin или !пин — закрепить сообщение\n" +
    "• /unpin или !анпин — открепить сообщение\n" +
    "• смс ид — узнать ID сообщения\n\n" +
    "💍 Игровые функции\n" +
    "• /brak или брак — предложить игровой брак\n" +
    "• /razvod или развод — оформить игровой развод\n" +
    "• /partner или /партнер — показать вторую половинку\n\n" +
    "🧩 Использование\n" +
    "↩️ Ответом на сообщение\n" +
    "🏷 Через @username\n" +
    "🆔 Через ID\n\n" +
    "✨ Примеры\n" +
    "/mute @username 10m\n" +
    "/warn ID\n" +
    "/kick @username";
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

bot.onText(/\/start/, async (msg) => {
  getUser(msg.from);
  if (!ensureCommandEnabled(msg, "start")) return;
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    if (!botUsername) {
      const me = await bot.getMe();
      botUsername = me.username;
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

bot.onText(/\/admin/, (msg) => {
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

    await bot.answerCallbackQuery(query.id);
    return;
  }
  if (data.startsWith("marriage_accept:") || data.startsWith("marriage_decline:")) {
    const [action, proposalId] = data.split(":");
    const proposal = pendingMarriages.get(proposalId);

    if (!proposal) {
      await bot.answerCallbackQuery(query.id, {
        text: "⏳ Предложение уже устарело.",
        show_alert: true
      });
      return;
    }

    if (Number(userId) !== Number(proposal.secondUserId)) {
      await bot.answerCallbackQuery(query.id, {
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

      await bot.answerCallbackQuery(query.id, { text: "Вы отказались." });
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

      await bot.answerCallbackQuery(query.id, { text: "Брак не оформлен." });
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

    await bot.answerCallbackQuery(query.id, { text: "Брак подтверждён!" });
    return;
  }

  if (!data.startsWith("admin_") && !data.startsWith("toggle_command:")) return;

  if (!isOwner(userId)) {
    await bot.answerCallbackQuery(query.id, {
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
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "admin_close") {
    await bot.deleteMessage(chatId, messageId).catch(() => { });
    await bot.answerCallbackQuery(query.id, { text: "Админ-панель закрыта" });
    return;
  }

  if (data === "admin_commands") {
    await bot.editMessageText(getAdminCommandsText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getCommandSettingsKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "admin_stats") {
    await bot.editMessageText(await getAdminStatsText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "admin_logs") {
    await bot.editMessageText(getAdminLogsText(chatId), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "admin_moderation") {
    await bot.editMessageText(getAdminModerationText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "admin_users") {
    await bot.editMessageText(getAdminUsersText(chatId), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith("toggle_command:")) {
    const commandName = data.replace("toggle_command:", "");

    if (!commandSettings.has(commandName)) {
      await bot.answerCallbackQuery(query.id, {
        text: "Команда не найдена",
        show_alert: true
      });
      return;
    }

    commandSettings.set(commandName, !isCommandEnabled(commandName));

    await bot.answerCallbackQuery(query.id, {
      text: `/${commandName}: ${getCommandStatus(commandName)}`
    });

    await bot.editMessageText(getAdminCommandsText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getCommandSettingsKeyboard()
    });
  }
});

bot.onText(/\/menu/, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "menu")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📋 Чтобы открыть меню команд, добавь меня в группу и напиши там /menu");
    return;
  }

  bot.sendMessage(msg.chat.id, getMainMenuText());
});

bot.onText(/\/help/, (msg) => {
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

bot.onText(/\/commands/, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "commands")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📜 Добавь меня в группу, чтобы посмотреть команды.");
    return;
  }

  bot.sendMessage(msg.chat.id, getCommandsText(), getGroupKeyboard());
});

bot.onText(/\/profile/, async (msg) => {
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
  } catch { }

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
bot.onText(/\/top/, (msg) => {
  registerUserInChat(msg);

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


bot.onText(/\/logs/, async (msg) => {
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

bot.onText(/\/(partner|партнер)/i, (msg) => {
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
bot.onText(/\/lock/, async (msg) => {
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
    console.error("Lock error:", error.message);
    bot.sendMessage(
      msg.chat.id,
      `⚠️ Не удалось закрыть чат.\n\nПричина: ${error.message || "неизвестная ошибка"}`
    );
  }
});


bot.onText(/\/unlock/, async (msg) => {
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
    console.error("Unlock error:", error.message);
    bot.sendMessage(
      msg.chat.id,
      `⚠️ Не удалось открыть чат.\n\nПричина: ${error.message || "неизвестная ошибка"}`
    );
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
    bot.sendMessage(msg.chat.id, "⚠️ Не получилось изменить права чата.");
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
    bot.sendMessage(msg.chat.id, "⚠️ Не получилось изменить топик. Проверь, что это форум-группа и у бота есть права управления темами.");
  }
});

bot.onText(/\/admins/, async (msg) => {
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
  } catch {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Не получилось получить список администраторов. Проверь, что бот добавлен в группу."
    );
  }
});

// /slowmode command handler
bot.onText(/\/slowmode(?:\s+(.+))?/i, async (msg, match) => {
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

  const value = (match[1] || "").trim();

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
      "⚠️ У бота нет прав администратора."
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
    console.error(error);

    bot.sendMessage(
      msg.chat.id,
      "⚠️ Не удалось изменить slowmode."
    );
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
      addAdminLog(msg.chat.id, "🚫 Автобан за выходы", { id: bot.id, first_name: "Сливки Бот" }, name, `Выходов: ${history.length}/${setting.count}`);
    } else {
      await bot.banChatMember(msg.chat.id, leftUser.id, {
        until_date: Math.floor(Date.now() / 1000) + 40
      });

      setTimeout(() => {
        bot.unbanChatMember(msg.chat.id, leftUser.id, { only_if_banned: true }).catch(() => { });
      }, 1000);

      bot.sendMessage(msg.chat.id, `👢 ${name} кикнут за частые выходы из чата.`);
      addAdminLog(msg.chat.id, "👢 Автокик за выходы", { id: bot.id, first_name: "Сливки Бот" }, name, `Выходов: ${history.length}/${setting.count}`);
    }

    userLeftHistory.delete(key);
  } catch (error) {
    bot.sendMessage(msg.chat.id, "⚠️ Автокик не сработал. Проверь, что бот админ и может банить участников.");
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
    bot.sendMessage(msg.chat.id, settings.joins ? "✅ Входы включены." : "❌ Входы отключены.");
    return;
  }

  if (type === "выходы") {
    settings.leaves = sign === "+";

    if (count !== null) {
      settings.leaveMinMessages = count;
      settings.leaves = true;
      bot.sendMessage(msg.chat.id, `✅ Выходы включены.\nПорог: ${count} сообщений.`);
      return;
    }

    bot.sendMessage(msg.chat.id, settings.leaves ? "✅ Выходы включены." : "❌ Выходы отключены.");
    return;
  }

  const enabled = sign === "+";
  settings.joins = enabled;
  settings.leaves = enabled;

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
    bot.sendMessage(msg.chat.id, "✅ Автокик выключен.");
    return;
  }

  if (["on", "вкл"].includes(value)) {
    autoKickSettings.set(msg.chat.id, {
      enabled: true,
      count: 3,
      time: 60,
      action: "kick"
    });

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

  autoKickSettings.set(msg.chat.id, {
    enabled: true,
    count,
    time,
    action: ["бан", "ban"].includes(action) ? "ban" : "kick"
  });

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
      type: update.chat.type
    });
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

bot.onText(/\/warn/, async (msg) => {
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

  if (targetProfile.id === msg.from.id) {
    bot.sendMessage(msg.chat.id, "⛔ Нельзя выдать предупреждение самому себе.");
    return;
  }

  targetProfile.warnings += 1;

  if (targetProfile.warnings >= 3) {
    try {
      await bot.banChatMember(msg.chat.id, targetProfile.id);
      addAdminLog(msg.chat.id, "🚫 Автобан за 3 предупреждения", msg.from, getUserDisplayName(targetProfile), "Пользователь получил 3/3 предупреждений.");
      bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} получил 3/3 предупреждений и был забанен.`);
    } catch {
      bot.sendMessage(msg.chat.id, `⚠️ ${getUserDisplayName(targetProfile)} получил 3/3 предупреждений, но я не смог забанить пользователя.`);
    }
    return;
  }

  addAdminLog(msg.chat.id, "⚠️ Выдал предупреждение", msg.from, getUserDisplayName(targetProfile), `Предупреждения: ${targetProfile.warnings}/3`);

  bot.sendMessage(
    msg.chat.id,
    `⚠️ ${getUserDisplayName(targetProfile)} получил предупреждение.\n\nПредупреждения: ${targetProfile.warnings}/3`
  );
});

bot.onText(/\/unwarn/, async (msg) => {
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

  addAdminLog(msg.chat.id, "♻️ Снял предупреждения", msg.from, getUserDisplayName(targetProfile), "Предупреждения: 0/3");

  bot.sendMessage(
    msg.chat.id,
    `♻️ У пользователя ${getUserDisplayName(targetProfile)} сняты все предупреждения.\n\nПредупреждения: 0/3`
  );
});

bot.onText(/\/mute/, async (msg) => {
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

  if (targetProfile.id === msg.from.id) {
    bot.sendMessage(msg.chat.id, "⛔ Нельзя замьютить самого себя.");
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

    const timer = setTimeout(async () => {
      try {
        await bot.restrictChatMember(msg.chat.id, targetProfile.id, {
          permissions: getFullPermissions()
        });

        muteTimers.delete(timerKey);
        bot.sendMessage(msg.chat.id, `🔊 С пользователя ${getUserDisplayName(targetProfile)} снят mute, время закончилось.`);
      } catch {
        muteTimers.delete(timerKey);
        bot.sendMessage(msg.chat.id, `⚠️ Время mute для ${getUserDisplayName(targetProfile)} закончилось, но я не смог автоматически снять мут. Проверь права администратора у бота.`);
      }
    }, duration.seconds * 1000);

    muteTimers.set(timerKey, timer);
  } catch {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не смог замьютить пользователя. Проверь, что бот админ и у него есть право ограничивать участников."
    );
  }
});

bot.onText(/\/unmute/, async (msg) => {
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
  } catch {
    bot.sendMessage(msg.chat.id, "⚠️ Я не смог снять мут. Проверь права администратора у бота.");
  }
});

bot.onText(/\/(kick|cick)/, async (msg) => {
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

  if (targetProfile.id === msg.from.id) {
    bot.sendMessage(msg.chat.id, "⛔ Нельзя кикнуть самого себя.");
    return;
  }

  try {
    await bot.banChatMember(msg.chat.id, targetProfile.id, {
      until_date: Math.floor(Date.now() / 1000) + 40
    });

    setTimeout(() => {
      bot.unbanChatMember(msg.chat.id, targetProfile.id, { only_if_banned: true }).catch(() => { });
    }, 1000);

    addAdminLog(msg.chat.id, "👢 Кикнул", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `👢 ${getUserDisplayName(targetProfile)} был(а) кикнут(а) из группы.`);
  } catch {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не смог кикнуть пользователя. Проверь, что бот админ и у него есть право банить участников. Также бот не может кикнуть админа или владельца группы."
    );
  }
});

bot.onText(/\/ban/, async (msg) => {
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

  if (targetProfile.id === msg.from.id) {
    bot.sendMessage(msg.chat.id, "⛔ Нельзя забанить самого себя.");
    return;
  }

  try {
    await bot.banChatMember(msg.chat.id, targetProfile.id);
    addAdminLog(msg.chat.id, "🚫 Забанил", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} был забанен.`);
  } catch {
    bot.sendMessage(msg.chat.id, "⚠️ Я не смог забанить пользователя. Проверь права администратора у бота.");
  }
});

bot.onText(/\/unban/, async (msg) => {
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

  try {
    await bot.unbanChatMember(msg.chat.id, userId, { only_if_banned: true });

    if (targetProfile) {
      targetProfile.warnings = 0;
    }

    const targetText = targetProfile ? getUserDisplayName(targetProfile) : "ID:" + userId;
    addAdminLog(msg.chat.id, "✅ Разбанил", msg.from, targetText);
    bot.sendMessage(msg.chat.id, `✅ Пользователь ${targetProfile ? getUserDisplayName(targetProfile) : "с ID " + userId} разбанен.`);
  } catch {
    bot.sendMessage(msg.chat.id, "⚠️ Я не смог разбанить пользователя. Проверь права администратора у бота.");
  }
});

bot.onText(/\/(clear|claer)(?:\s+(\d+))?/, async (msg, match) => {
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

  const fromMessageId = Math.max(1, msg.message_id - count);
  const toMessageId = msg.message_id - 1;
  let deletedCount = 0;

  for (let messageId = fromMessageId; messageId <= toMessageId; messageId++) {
    try {
      await bot.deleteMessage(msg.chat.id, messageId);
      deletedCount += 1;
    } catch { }
  }

  if (deletedCount === 0) {
    bot.sendMessage(msg.chat.id, "⚠️ Не получилось удалить сообщения. Проверь права администратора у бота.");
    return;
  }

  addAdminLog(msg.chat.id, "🧹 Очистил сообщения", msg.from, "Чат", `Удалено сообщений: ${deletedCount}`);
  bot.sendMessage(msg.chat.id, `🧹 Удалено сообщений: ${deletedCount}`);
});

bot.onText(/^(?:\/pin|!пин|!pin)(?:\s+(\d+))?$/i, async (msg, match) => {
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

  try {
    await bot.pinChatMessage(msg.chat.id, targetMessageId, {
      disable_notification: false
    });

    addAdminLog(msg.chat.id, "📌 Закрепил сообщение", msg.from, `ID:${targetMessageId}`);
    bot.sendMessage(msg.chat.id, `📌 Сообщение закреплено.\nID: ${targetMessageId}`);
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Не получилось закрепить сообщение. Проверь, что бот админ и у него есть право закреплять сообщения."
    );
  }
});

bot.onText(/^(?:\/unpin|!анпин|!unpin)(?:\s+(\d+))?$/i, async (msg, match) => {
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
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Не получилось открепить сообщение. Проверь, что бот админ и у него есть право закреплять сообщения."
    );
  }
});

bot.on("message", (msg) => {
  if (!msg.text) return;
  registerUserInChat(msg);
  if (isPrivateChat(msg)) return;

  if (msg.text.match(/^(?:сливки\s+брак|брак|\/brak)(?:\s+(.+))?$/i) && !ensureCommandEnabled(msg, "brak")) {
    return;
  }

  if (msg.text.match(/^(?:сливки\s+развод|развод|\/razvod)$/i) && !ensureCommandEnabled(msg, "razvod")) {
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
  saveUsers();
  saveChatInfo();

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
    } catch {}
  }

  await bot.sendMessage(
    msg.chat.id,
    "✅ Ваше сообщение отправлено в поддержку."
  );
});