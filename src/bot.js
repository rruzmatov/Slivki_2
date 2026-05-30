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
      { command: "admins", description: "👑 список администраторов" },
      { command: "slowmode", description: "🐢 задержка сообщений" },
      { command: "lock", description: "🔒 закрыть чат" },
      { command: "unlock", description: "🔓 открыть чат" },
      { command: "logs", description: "📋 логи админ-действий" },
      { command: "warn", description: "⚠️ предупреждение" },
      { command: "unwarn", description: "♻️ снять предупреждения" },
      { command: "mute", description: "🔇 мут" },
      { command: "unmute", description: "🔊 снять мут" },
      { command: "kick", description: "👢 кик" },
      { command: "ban", description: "🚫 бан" },
      { command: "unban", description: "✅ разбан" }
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
      messages: 0,
      warnings: 0
    });
  }

  const profile = users.get(id);
  profile.firstName = user.first_name || profile.firstName;
  profile.username = user.username || profile.username || "нет";

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

  chatUsers.get(chatId).add(profile.id);
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
  return "🍦 Сливки Бот\n\n" +
    "📋 Главное меню\n" +
    "👤 Профиль: /profile\n" +
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
    "• /profile — профиль пользователя\n\n" +
    "📌 Информация\n" +
    "• /menu — главное меню\n" +
    "• /commands — список команд\n" +
    "• /admins — список администраторов\n" +
    "• /slowmode 10 — задержка сообщений\n" +
    "• /lock — закрыть чат\n" +
    "• /unlock — открыть чат\n" +
    "• /logs — логи админ-действий\n\n" +
    "🛡 Модерация\n" +
    "• /warn — выдать предупреждение\n" +
    "• /unwarn — снять предупреждения\n" +
    "• /mute 10m — выдать мут\n" +
    "• /unmute — снять мут\n" +
    "• /kick — кикнуть пользователя\n" +
    "• /ban — забанить пользователя\n" +
    "• /unban — разбанить пользователя\n\n" +
    "🧩 Использование\n" +
    "↩️ Ответом на сообщение\n" +
    "🏷 Через @username\n" +
    "🆔 Через ID\n\n" +
    "✨ Примеры\n" +
    "/mute @username 10m\n" +
    "/warn ID\n" +
    "/kick @username";
}

function getGroupKeyboard() {
  return {
    reply_markup: {
      remove_keyboard: true
    }
  };
}

bot.onText(/\/start/, async (msg) => {
  getUser(msg.from);
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
            ]
          ]
        }
      }
    );
    return;
  }

  bot.sendMessage(
    msg.chat.id,
    "🍦 Сливки Бот успешно активирован!\n\n" + getGroupMenuText(),
    getGroupKeyboard()
  );
});

bot.onText(/\/menu/, (msg) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📋 Чтобы открыть меню команд, добавь меня в группу и напиши там /menu");
    return;
  }

  bot.sendMessage(msg.chat.id, getGroupMenuText(), getGroupKeyboard());
});

bot.onText(/\/help/, (msg) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(
      msg.chat.id,
      "ℹ️ Чтобы пользоваться командами, добавь меня в группу."
    );
    return;
  }

  bot.sendMessage(msg.chat.id, getGroupMenuText(), getGroupKeyboard());
});

bot.onText(/\/commands/, (msg) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📜 Добавь меня в группу, чтобы посмотреть команды.");
    return;
  }

  bot.sendMessage(msg.chat.id, getCommandsText(), getGroupKeyboard());
});

bot.onText(/\/profile/, async (msg) => {
  registerUserInChat(msg);

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
  } catch {}

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

bot.onText(/\/logs/, async (msg) => {
  registerUserInChat(msg);

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


// /lock and /unlock handlers
bot.onText(/\/lock/, async (msg) => {
  registerUserInChat(msg);

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

bot.onText(/\/admins/, async (msg) => {
  registerUserInChat(msg);

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
bot.onText(/\/slowmode(?:\s+(\d+))?/, async (msg, match) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /slowmode.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /slowmode.");
    return;
  }

  const seconds = Number(match[1]);

  if (!match[1]) {
    bot.sendMessage(
      msg.chat.id,
      "🐢 Использование:\n\n/slowmode 10 — задержка 10 секунд\n/slowmode 60 — задержка 1 минута\n/slowmode 0 — отключить slowmode"
    );
    return;
  }

  const allowedSlowModeValues = [0, 10, 30, 60, 300, 900, 3600];

  if (!allowedSlowModeValues.includes(seconds)) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Telegram поддерживает только эти значения:\n0, 10, 30, 60, 300, 900, 3600 секунд.\n\nПример: /slowmode 10"
    );
    return;
  }

  const botCanChangeSlowMode = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangeSlowMode) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу изменить slowmode.\n\nДай боту права администратора:\n✅ Блокировка пользователей / Ограничение участников"
    );
    return;
  }

  try {
    const permissions = await getChatPermissionsWithSlowMode(msg.chat.id, seconds);

    await bot.setChatPermissions(msg.chat.id, permissions);

    if (seconds === 0) {
      addAdminLog(msg.chat.id, "🐢 Отключил slowmode", msg.from, "Вся группа", "Задержка сообщений отключена.");
      bot.sendMessage(msg.chat.id, "✅ Slowmode отключён.");
    } else {
      addAdminLog(msg.chat.id, "🐢 Изменил slowmode", msg.from, "Вся группа", `Задержка: ${seconds} сек.`);
      bot.sendMessage(msg.chat.id, `🐢 Slowmode установлен: ${seconds} сек.`);
    }
  } catch (error) {
    console.error("Slowmode error:", error.message);

    bot.sendMessage(
      msg.chat.id,
      `⚠️ Не удалось изменить slowmode.\n\nПричина: ${error.message || "неизвестная ошибка"}\n\nПроверь, что группа является супергруппой, а у бота есть право ограничивать участников.`
    );
  }
});


bot.on("left_chat_member", (msg) => {
  if (!msg.left_chat_member) return;

  const name = getTelegramName(msg.left_chat_member);
  bot.sendMessage(msg.chat.id, `👋 ${name} покинул(а) группу`);
});

bot.on("my_chat_member", (update) => {
  const oldStatus = update.old_chat_member?.status;
  const newStatus = update.new_chat_member?.status;
  const chatId = update.chat.id;
  const adminName = getTelegramName(update.from);

  if (oldStatus !== "administrator" && newStatus === "administrator") {
    bot.sendMessage(
      chatId,
      `⛑ ${adminName} сделал(а) меня администратором группы.\n\nТеперь мне доступны функции модерации: warn, mute, unmute, kick, ban и unban.`
    );
  }
});

bot.onText(/\/warn/, async (msg) => {
  registerUserInChat(msg);

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
      bot.unbanChatMember(msg.chat.id, targetProfile.id, { only_if_banned: true }).catch(() => {});
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
    } catch {}
  }

  if (deletedCount === 0) {
    bot.sendMessage(msg.chat.id, "⚠️ Не получилось удалить сообщения. Проверь права администратора у бота.");
    return;
  }

  addAdminLog(msg.chat.id, "🧹 Очистил сообщения", msg.from, "Чат", `Удалено сообщений: ${deletedCount}`);
  bot.sendMessage(msg.chat.id, `🧹 Удалено сообщений: ${deletedCount}`);
});

bot.on("message", (msg) => {
  if (!msg.text) return;
  registerUserInChat(msg);
  if (isPrivateChat(msg)) return;
  if (msg.text.startsWith("/")) return;

  addActivity(msg.from);
});