const NUKE_CONFIRM_TEXT = "CONFIRM";
const NUKE_CALLBACK_PREFIX = "nuke:";
const NUKE_DELAY_MIN_MS = 300;
const NUKE_DELAY_MAX_MS = 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomNukeDelay() {
  return NUKE_DELAY_MIN_MS + Math.floor(Math.random() * (NUKE_DELAY_MAX_MS - NUKE_DELAY_MIN_MS + 1));
}

function getTelegramUserName(user, fallback = "ID") {
  if (!user) return fallback;
  if (user.username) return `@${user.username}`;

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  return user.id ? `${user.id}` : fallback;
}

function getProfileName(profile, fallback = "ID") {
  if (!profile) return fallback;
  if (profile.username && profile.username !== "нет") return `@${profile.username}`;

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  return profile.id ? `${profile.id}` : fallback;
}

function isCreator(member) {
  return member?.status === "creator";
}

function isAdministrator(member) {
  return member?.status === "administrator";
}

function getNukeKey(chatId) {
  return String(chatId);
}

class NukeService {
  constructor(options) {
    this.bot = options.bot;
    this.ownerIds = options.ownerIds;
    this.getBotIdentity = options.getBotIdentity;
    this.canBotUsePermission = options.canBotUsePermission;
    this.getKnownChatUserIds = options.getKnownChatUserIds;
    this.getStoredUser = options.getStoredUser;
    this.getChatTitle = options.getChatTitle;
    this.addAdminLog = options.addAdminLog;
    this.getErrorMessage = options.getErrorMessage;
    this.runningChats = new Set();
  }

  isOwner(userId) {
    return this.ownerIds.includes(Number(userId));
  }

  isRunning(chatId) {
    return this.runningChats.has(getNukeKey(chatId));
  }

  getWarningText() {
    return [
      "━━━━━━━━━━━━━━━━━━",
      "☢️ NUKE PROTOCOL",
      "",
      "Вы собираетесь выполнить полную очистку группы.",
      "",
      "Будут удалены:",
      "",
      "👤 Все пользователи, которых бот имеет право удалить.",
      "",
      "🤖 Все боты.",
      "",
      "👮 Администраторы (если Telegram позволяет их снять и удалить).",
      "",
      "⚠️ После запуска отменить действие невозможно.",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "Для подтверждения отправьте:",
      "",
      "/nuke CONFIRM"
    ].join("\n");
  }

  getEmergencyAlertText(chatTitle) {
    return [
      "━━━━━━━━━━━━━━━━━━",
      "🚨 EMERGENCY ALERT",
      "",
      "Вы были удалены из группы.",
      "",
      "📌 Группа:",
      "",
      chatTitle,
      "",
      "Бот всё ещё находится внутри группы.",
      "",
      "Запустить Emergency NUKE?",
      "━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  getEmergencyConfirmText() {
    return [
      "━━━━━━━━━━━━━━━━━━",
      "⚠️ Последнее предупреждение.",
      "",
      "Будут удалены все пользователи, которых бот имеет право удалить.",
      "",
      "Действие необратимо.",
      "━━━━━━━━━━━━━━━━━━"
    ].join("\n");
  }

  getEmergencyKeyboard(chatId) {
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: "☢️ Запустить NUKE", callback_data: `${NUKE_CALLBACK_PREFIX}emergency:${chatId}` }],
          [{ text: "❌ Отмена", callback_data: `${NUKE_CALLBACK_PREFIX}cancel:${chatId}` }]
        ]
      }
    };
  }

  getEmergencyConfirmKeyboard(chatId) {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Да", callback_data: `${NUKE_CALLBACK_PREFIX}confirm:${chatId}` },
            { text: "❌ Нет", callback_data: `${NUKE_CALLBACK_PREFIX}cancel:${chatId}` }
          ]
        ]
      }
    };
  }

  async sendManualWarning(msg) {
    if (!this.isOwner(msg.from?.id)) return;
    if (msg.chat?.type === "private") {
      await this.bot.sendMessage(msg.chat.id, "⚠️ /nuke нельзя запускать в личных сообщениях.");
      return;
    }

    await this.bot.sendMessage(msg.chat.id, this.getWarningText(), {
      reply_parameters: { message_id: msg.message_id }
    });
  }

  async confirmManualNuke(msg, confirmText) {
    if (!this.isOwner(msg.from?.id)) return;

    if (String(confirmText || "").trim().toUpperCase() !== NUKE_CONFIRM_TEXT) {
      await this.sendManualWarning(msg);
      return;
    }

    const validation = await this.validateCanRun(msg.chat, msg.from.id);

    if (!validation.ok) {
      await this.bot.sendMessage(msg.chat.id, validation.message, {
        reply_parameters: { message_id: msg.message_id }
      });
      return;
    }

    const progressMessage = await this.bot.sendMessage(msg.chat.id, "☢️ Запускаю NUKE...", {
      reply_parameters: { message_id: msg.message_id }
    });

    await this.run({
      chat: msg.chat,
      progressChatId: msg.chat.id,
      progressMessageId: progressMessage.message_id,
      initiator: msg.from,
      mode: "manual"
    });
  }

  async startEmergencyNuke(query, chatId) {
    if (!this.isOwner(query.from?.id)) return false;

    const chat = await this.getChatForNuke(chatId);
    const validation = await this.validateCanRun(chat, query.from.id);

    if (!validation.ok) {
      await this.bot.sendMessage(query.message.chat.id, validation.message);
      return true;
    }

    const progressMessage = await this.bot.sendMessage(query.message.chat.id, "☢️ Запускаю NUKE...");

    await this.run({
      chat,
      progressChatId: query.message.chat.id,
      progressMessageId: progressMessage.message_id,
      initiator: query.from,
      mode: "emergency"
    });

    return true;
  }

  async validateCanRun(chat, ownerId) {
    if (!this.ownerIds.length) {
      return { ok: false, message: "⚠️ OWNER_ID не настроен. NUKE недоступен." };
    }

    if (!this.isOwner(ownerId)) {
      return { ok: false, message: "" };
    }

    if (!chat || chat.type === "private") {
      return { ok: false, message: "⚠️ NUKE нельзя запускать в личных сообщениях." };
    }

    if (chat.type !== "supergroup") {
      return { ok: false, message: "⚠️ NUKE доступен только в супергруппах." };
    }

    if (this.isRunning(chat.id)) {
      return { ok: false, message: "⚠️ NUKE уже выполняется в этой группе." };
    }

    const botMember = await this.getBotMember(chat.id);

    if (!botMember || (!isAdministrator(botMember) && !isCreator(botMember))) {
      return { ok: false, message: "⚠️ Бот должен быть администратором группы." };
    }

    if (!isCreator(botMember) && botMember.can_restrict_members !== true) {
      return { ok: false, message: "⚠️ У бота нет права Ban Users / Блокировка пользователей." };
    }

    return { ok: true };
  }

  async getChatForNuke(chatId) {
    try {
      return await this.bot.getChat(Number(chatId));
    } catch {
      return {
        id: Number(chatId),
        type: "unknown",
        title: this.getChatTitle(Number(chatId))
      };
    }
  }

  async getBotMember(chatId) {
    try {
      const me = await this.getBotIdentity();
      return this.bot.getChatMember(chatId, me.id);
    } catch {
      return null;
    }
  }

  async run(context) {
    const chatId = context.chat.id;
    const key = getNukeKey(chatId);
    const startedAt = Date.now();
    const state = {
      users: 0,
      bots: 0,
      admins: 0,
      skipped: 0,
      errors: [],
      processedUserIds: new Set()
    };

    this.runningChats.add(key);

    try {
      await this.updateProgress(context, state);
      await this.processAdministrators(context, state);
      await this.processKnownMembers(context, state);
      await this.sendCompleteReport(context, state, startedAt);

      this.addAdminLog(
        chatId,
        "☢️ NUKE завершён",
        context.initiator,
        "Группа",
        `Пользователей: ${state.users}, ботов: ${state.bots}, админов: ${state.admins}, ошибок: ${state.errors.length}`
      );
    } finally {
      this.runningChats.delete(key);
    }
  }

  async processAdministrators(context, state) {
    const chatId = context.chat.id;
    const me = await this.getBotIdentity();
    let admins = [];

    try {
      admins = await this.bot.getChatAdministrators(chatId);
    } catch (error) {
      this.addError(state, "Не удалось получить список администраторов", error);
      await this.updateProgress(context, state);
      return;
    }

    for (const member of admins) {
      const user = member.user;
      const name = getTelegramUserName(user);

      if (!user || isCreator(member) || user.id === me.id) {
        state.skipped += 1;
        continue;
      }

      try {
        await this.demoteAdmin(chatId, user.id);
        await this.updateProgress(context, state);
        await sleep(getRandomNukeDelay());

        await this.banUser(chatId, user.id);
        state.admins += 1;
        state.processedUserIds.add(user.id);
      } catch (error) {
        state.skipped += 1;
        this.addError(state, `${name}: не удалось снять или удалить администратора`, error);
      }

      await this.updateProgress(context, state);
      await sleep(getRandomNukeDelay());
    }
  }

  async processKnownMembers(context, state) {
    const chatId = context.chat.id;
    const me = await this.getBotIdentity();
    const knownUserIds = this.getKnownChatUserIds(chatId)
      .map(Number)
      .filter((userId) => Number.isFinite(userId));
    const uniqueUserIds = Array.from(new Set(knownUserIds));

    for (const userId of uniqueUserIds) {
      if (state.processedUserIds.has(userId)) {
        continue;
      }

      if (userId === me.id || this.isOwner(userId)) {
        state.skipped += 1;
        continue;
      }

      let member = null;

      try {
        member = await this.bot.getChatMember(chatId, userId);
      } catch (error) {
        state.skipped += 1;
        this.addError(state, `${this.getKnownName(userId)}: участник недоступен`, error);
        continue;
      }

      if (!member || ["left", "kicked"].includes(member.status)) {
        state.skipped += 1;
        continue;
      }

      if (isCreator(member) || isAdministrator(member)) {
        continue;
      }

      try {
        await this.banUser(chatId, userId);
        state.processedUserIds.add(userId);

        if (member.user?.is_bot || this.getStoredUser(userId)?.isBot) {
          state.bots += 1;
        } else {
          state.users += 1;
        }
      } catch (error) {
        state.skipped += 1;
        this.addError(state, `${this.getMemberName(member, userId)}: не удалось удалить`, error);
      }

      await this.updateProgress(context, state);
      await sleep(getRandomNukeDelay());
    }
  }

  async demoteAdmin(chatId, userId) {
    const result = await this.bot.promoteChatMember(chatId, userId, {
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

    if (result === false) {
      throw new Error("Telegram API не подтвердил снятие администратора");
    }
  }

  async banUser(chatId, userId) {
    const result = await this.bot.banChatMember(chatId, userId);

    if (result === false) {
      throw new Error("Telegram API не подтвердил удаление пользователя");
    }
  }

  addError(state, text, error) {
    const errorText = this.getErrorMessage(error);
    state.errors.push(`❌ ${text}: ${errorText}`);
  }

  getKnownName(userId) {
    return getProfileName(this.getStoredUser(userId), `${userId}`);
  }

  getMemberName(member, userId) {
    return getTelegramUserName(member?.user, this.getKnownName(userId));
  }

  getProgressText(state) {
    return [
      "☢️ Выполняю очистку...",
      "",
      "━━━━━━━━━━━━━━",
      "",
      `👤 Пользователей: ${state.users}`,
      "",
      `🤖 Ботов: ${state.bots}`,
      "",
      `👮 Администраторов: ${state.admins}`,
      "",
      `⚠️ Ошибок: ${state.errors.length}`
    ].join("\n");
  }

  async updateProgress(context, state) {
    try {
      await this.bot.editMessageText(this.getProgressText(state), {
        chat_id: context.progressChatId,
        message_id: context.progressMessageId
      });
    } catch (error) {
      if (!this.getErrorMessage(error).includes("message is not modified")) {
        console.error("Nuke progress edit error:", this.getErrorMessage(error));
      }
    }
  }

  async sendCompleteReport(context, state, startedAt) {
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const report = [
      "━━━━━━━━━━━━━━━━━━",
      "☢️ NUKE COMPLETE",
      "",
      `👤 Пользователей удалено: ${state.users}`,
      "",
      `🤖 Ботов удалено: ${state.bots}`,
      "",
      `👮 Администраторов удалено: ${state.admins}`,
      "",
      `⚠️ Пропущено: ${state.skipped}`,
      "",
      `❌ Ошибок: ${state.errors.length}`,
      "",
      `⏱ Время выполнения: ${durationSeconds} сек.`,
      "━━━━━━━━━━━━━━━━━━"
    ];

    report.push("", "ℹ️ Обработаны только пользователи, которых бот видел или получил через Telegram API.");

    if (state.errors.length > 0) {
      report.push("", "Первые ошибки:", state.errors.slice(0, 10).join("\n"));
    }

    await this.bot.sendMessage(context.progressChatId, report.join("\n"));
  }
}

module.exports = {
  NukeService,
  NUKE_CALLBACK_PREFIX
};
