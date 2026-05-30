require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
  console.error("Ошибка: BOT_TOKEN не найден в файле .env");
  process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: true });

console.log("🍦 Сливки Бот запущен");

const users = new Map();
const chatUsers = new Map();
const chatRules = new Map();
const muteTimers = new Map();

let botUsername = "";

bot.getMe().then((me) => {
  botUsername = me.username;
});

const DEFAULT_RULES = `ОБЯЗАТЕЛЬНО‼️‼️‼️

К ознакомлению

Привет! После вступления в чат тебе нужно ознакомиться с правилами, чтобы избежать возможного бана, мута, кика и недопониманий.

Правила:

1.1 Запрещено обсуждать, отправлять, транслировать и пропагандировать незаконный, опасный, шокирующий и запрещённый контент.

1.2 Запрещены любые действия, сообщения и материалы, связанные с вовлечением несовершеннолетних в опасные или запрещённые темы.

1.3 Запрещены дискриминация, разжигание агрессии и негативные высказывания по этническому, социальному, расовому, национальному, религиозному или половому признаку.

1.4 Запрещены политические обсуждения в любом ключе.

1.5 Запрещено распространять личную информацию без согласия владельца.

1.6 Запрещена продажа и реклама аккаунтов, каналов, товаров, услуг, а также выпрашивание денежных средств.

1.7 Запрещены действия против развития чата, призывы покинуть чат и обман администрации.

1.8 Запрещены неадекватное поведение, чрезмерная агрессия, буллинг, оскорбления, токсичность и разжигание конфликтов.

1.9 Запрещено иметь второй аккаунт в чате, если первый аккаунт находится в бане.

1.10 Запрещено выдавать себя за другую личность.

1.11 Запрещены спам, флуд и КАПС в больших количествах.

1.12 Запрещены действия и сообщения, которые нарушают законодательство.

1.13 В чате запрещён ИИ-контент.

Вход только 16+.

Если нет ника, скрыт username или нет аватарки, заявка может быть отклонена.

После вступления в чат сразу отправь свой username с ИТД, иначе возможен кик.

Админы сливок в ИТД — обязательно подписаться.`;

async function setupBotCommands() {
  try {
    await bot.setMyCommands(
      [
        { command: "start", description: "🍦 Запустить бота" },
        { command: "menu", description: "📋 Открыть меню" },
        { command: "help", description: "ℹ️ Помощь" },
        { command: "profile", description: "👤 Профиль" },
        { command: "rules", description: "📌 Правила группы" },
        { command: "warn", description: "⚠️ Выдать предупреждение" },
        { command: "unwarn", description: "♻️ Снять предупреждения" },
        { command: "mute", description: "🔇 Замьютить пользователя" },
        { command: "unmute", description: "🔊 Снять мут" },
        { command: "ban", description: "🚫 Забанить пользователя" },
        { command: "unban", description: "✅ Разбанить пользователя" },
        { command: "clear", description: "🧹 Очистить сообщения" }
      ],
      { scope: { type: "all_group_chats" } }
    );

    await bot.setMyCommands(
      [
        { command: "start", description: "🍦 Добавить бота в группу" },
        { command: "rules", description: "📌 Создать правила" },
        { command: "help", description: "ℹ️ Помощь" }
      ],
      { scope: { type: "all_private_chats" } }
    );
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
  return "🍦 Меню Сливки Бот\n\n" +
    "👤 /profile — профиль пользователя\n" +
    "📌 /rules — правила группы\n" +
    "⚠️ /warn — предупреждение\n" +
    "♻️ /unwarn — снять предупреждения\n" +
    "🔇 /mute — мут пользователя\n" +
    "🔊 /unmute — снять мут\n" +
    "🚫 /ban — бан пользователя\n" +
    "✅ /unban — разбан пользователя\n" +
    "🧹 /clear — очистка сообщений";
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
      "🍦 Привет! Я «Сливки Бот»\n\nЧтобы активировать мои команды, добавь меня в группу и дай права администратора.\n\nВ группе доступны:\n\n👤 профиль пользователя;\n\n⛑ инструменты для модерации;\n\n⚠️ предупреждения пользователей;\n\n🔇 мут и снятие мута;\n\n🚫 бан и разбан участников;\n\n📋 удобное меню команд;\n\n📌 свои правила для группы;\n\n👋 уведомления о входе и выходе участников;",
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
      "ℹ️ Чтобы пользоваться командами, добавь меня в группу.\n\n📌 Для настройки правил напиши:\n/rules твой текст правил"
    );
    return;
  }

  bot.sendMessage(msg.chat.id, getGroupMenuText(), getGroupKeyboard());
});

bot.onText(/\/profile/, (msg) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /profile.");
    return;
  }

  const profile = getUser(msg.from);

  bot.sendMessage(
    msg.chat.id,
    `👤 Профиль пользователя\n\nИмя: ${profile.firstName}\nUsername: @${profile.username}\nID: ${profile.id}\nСообщений: ${profile.messages}\nПредупреждения: ${profile.warnings}/3`
  );
});

bot.onText(/\/rules(?:\s+([\s\S]+))?/, async (msg, match) => {
  const text = match[1];

  if (isPrivateChat(msg)) {
    if (!text) {
      bot.sendMessage(
        msg.chat.id,
        "📌 Чтобы создать правила, напиши:\n\n/rules текст правил\n\nПример:\n/rules 1. Не спамить\n2. Не оскорблять\n3. Соблюдать порядок"
      );
      return;
    }

    chatRules.set(msg.from.id, text);

    bot.sendMessage(
      msg.chat.id,
      "✅ Правила сохранены.\n\nТеперь добавь меня в группу или напиши /rules в группе, чтобы показать правила."
    );
    return;
  }

  registerUserInChat(msg);

  if (text) {
    const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

    if (!senderIsAdmin) {
      bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете менять правила.");
      return;
    }

    chatRules.set(msg.chat.id, text);
    bot.sendMessage(msg.chat.id, "✅ Правила группы сохранены.");
    return;
  }

  const rules = chatRules.get(msg.chat.id) || chatRules.get(msg.from.id) || DEFAULT_RULES;
  bot.sendMessage(msg.chat.id, `📌 Правила группы:\n\n${rules}`);
});

bot.on("new_chat_members", (msg) => {
  if (!msg.new_chat_members || msg.new_chat_members.length === 0) return;

  msg.new_chat_members.forEach((user) => {
    const name = getTelegramName(user);
    getUser(user);

    const welcomeText = `👋 ${name} вступил(а) в группу\n\n🐸 Привет ${name}!\n\n⚠️ Правила — обязательно ознакомиться 👁️\n\n⛔ Не забудь скинуть свой username и ИТД, иначе будем вынуждены кикнуть.\n\n📗 Нажми кнопку ниже и ознакомься с правилами.`;

    bot.sendMessage(msg.chat.id, welcomeText, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "⚡ ПОСМОТРЕТЬ ПРАВИЛА",
              callback_data: `show_rules:${msg.chat.id}`
            }
          ]
        ]
      }
    });
  });
});

bot.on("callback_query", (query) => {
  if (!query.data) return;

  if (query.data.startsWith("show_rules:")) {
    const chatId = Number(query.data.split(":")[1]);
    const rules = chatRules.get(chatId) || DEFAULT_RULES;

    bot.answerCallbackQuery(query.id);

    bot.sendMessage(
      query.message.chat.id,
      `📗 ОБЯЗАТЕЛЬНО‼️‼️‼️\n\nК ознакомлению\n\n${rules}`
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
      `⛑ ${adminName} сделал(а) меня администратором группы.\n\nТеперь мне доступны функции модерации: /warn, /mute, /unmute, /ban, /unban и /clear.`
    );
  }
});

bot.onText(/\/warn/, async (msg) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /warn.");
    return;
  }

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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
      bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} получил 3/3 предупреждений и был забанен.`);
    } catch {
      bot.sendMessage(msg.chat.id, `⚠️ ${getUserDisplayName(targetProfile)} получил 3/3 предупреждений, но я не смог забанить пользователя.`);
    }
    return;
  }

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

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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

    bot.sendMessage(msg.chat.id, `🔊 С пользователя ${getUserDisplayName(targetProfile)} снят мут.`);
  } catch {
    bot.sendMessage(msg.chat.id, "⚠️ Я не смог снять мут. Проверь права администратора у бота.");
  }
});

bot.onText(/\/ban/, async (msg) => {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /ban.");
    return;
  }

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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

  const senderIsAdmin = await isUserAdmin(msg.chat.id, msg.from.id);

  if (!senderIsAdmin) {
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

  bot.sendMessage(msg.chat.id, `🧹 Удалено сообщений: ${deletedCount}`);
});

bot.on("message", (msg) => {
  if (!msg.text) return;
  registerUserInChat(msg);
  if (isPrivateChat(msg)) return;
  if (msg.text.startsWith("/")) return;

  addActivity(msg.from);
});