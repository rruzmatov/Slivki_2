const SEND_PERMISSION_FIELDS = [
  "can_send_messages",
  "can_send_audios",
  "can_send_documents",
  "can_send_photos",
  "can_send_videos",
  "can_send_video_notes",
  "can_send_voice_notes",
  "can_send_polls",
  "can_send_other_messages",
  "can_add_web_page_previews"
];

const ADMIN_COMMON_RIGHT_FIELDS = Object.freeze([
  "can_manage_chat",
  "can_delete_messages",
  "can_manage_video_chats",
  "can_restrict_members",
  "can_change_info",
  "can_invite_users"
]);
const ADMIN_GROUP_RIGHT_FIELDS = Object.freeze([
  "can_pin_messages",
  "can_manage_tags"
]);
const ADMIN_STORY_RIGHT_FIELDS = Object.freeze([
  "can_post_stories",
  "can_edit_stories",
  "can_delete_stories"
]);
const ADMIN_PROMOTION_RIGHTS = Object.freeze({
  is_anonymous: false,
  can_promote_members: false
});
const ADMIN_DEMOTION_RIGHTS = Object.freeze({
  ...Object.fromEntries(ADMIN_COMMON_RIGHT_FIELDS.map((permission) => [permission, false])),
  ...Object.fromEntries(ADMIN_GROUP_RIGHT_FIELDS.map((permission) => [permission, false])),
  can_manage_topics: false,
  ...Object.fromEntries(ADMIN_STORY_RIGHT_FIELDS.map((permission) => [permission, false])),
  is_anonymous: false,
  can_promote_members: false
});

const SUPPORTED_ADMIN_CHAT_TYPES = new Set(["group", "supergroup"]);

class TelegramAdminOperationError extends Error {
  constructor(code, userMessage, details = {}, cause) {
    super(userMessage, cause ? { cause } : undefined);
    this.name = "TelegramAdminOperationError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}

function createAdminOperationError(code, userMessage, details = {}, cause) {
  return new TelegramAdminOperationError(code, userMessage, details, cause);
}

function isSupportedAdminChat(chat) {
  return SUPPORTED_ADMIN_CHAT_TYPES.has(chat?.type);
}

function isAdministrator(member) {
  return member?.status === "administrator" || member?.status === "creator";
}

function isPresentMember(member) {
  if (!member || member.status === "left" || member.status === "kicked") return false;
  return member.status !== "restricted" || member.is_member !== false;
}

function buildSafeAdminRights(botMember, chat) {
  const rights = { ...ADMIN_PROMOTION_RIGHTS };
  for (const permission of ADMIN_COMMON_RIGHT_FIELDS) {
    rights[permission] = botMember?.[permission] === true;
  }
  if (isSupportedAdminChat(chat)) {
    rights.can_pin_messages = botMember?.can_pin_messages === true;
  }
  return rights;
}

function buildAdminDemotionRights(chat) {
  const rights = {
    ...Object.fromEntries(ADMIN_COMMON_RIGHT_FIELDS.map((permission) => [permission, false])),
    is_anonymous: false,
    can_promote_members: false
  };
  if (isSupportedAdminChat(chat)) {
    for (const permission of ADMIN_GROUP_RIGHT_FIELDS) rights[permission] = false;
  }
  if (chat?.type === "supergroup") {
    if (chat?.is_forum === true) rights.can_manage_topics = false;
    for (const permission of ADMIN_STORY_RIGHT_FIELDS) rights[permission] = false;
  }
  return rights;
}

function getBotAdminCapabilities(botMember, chat) {
  const safeRights = buildSafeAdminRights(botMember, chat);
  const actualRightFields = [
    ...ADMIN_COMMON_RIGHT_FIELDS,
    ...ADMIN_GROUP_RIGHT_FIELDS,
    "can_manage_topics",
    ...ADMIN_STORY_RIGHT_FIELDS,
    "can_post_messages",
    "can_edit_messages",
    "can_manage_direct_messages",
    "can_promote_members"
  ];
  return {
    status: botMember?.status || "unknown",
    isAdministrator: isAdministrator(botMember),
    canPromoteMembers: botMember?.can_promote_members === true,
    chatType: chat?.type || "unknown",
    actualRights: Object.fromEntries(
      actualRightFields.map((permission) => [permission, botMember?.[permission] === true])
    ),
    safeRights,
    safeGrantableRights: Object.entries(safeRights)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission)
  };
}

function getTelegramApiErrorDetails(error) {
  const body = error?.response?.body || {};
  return {
    apiErrorCode: body.error_code || error?.response?.statusCode || null,
    apiDescription: body.description || error?.message || "неизвестная ошибка Telegram",
    transportCode: error?.code || null
  };
}

function isRightForbidden(error) {
  const details = error instanceof TelegramAdminOperationError
    ? error.details?.telegram || getTelegramApiErrorDetails(error.cause)
    : getTelegramApiErrorDetails(error);
  return /RIGHT_FORBIDDEN|not enough rights|not enough privileges/i.test(details?.apiDescription || "");
}

function getForbiddenRight(error) {
  const details = error instanceof TelegramAdminOperationError
    ? error.details?.telegram || getTelegramApiErrorDetails(error.cause)
    : getTelegramApiErrorDetails(error);
  const description = details?.apiDescription || "";
  const requestedRights = error instanceof TelegramAdminOperationError
    ? error.details?.requestedRights || {}
    : {};
  return Object.keys(requestedRights).find((permission) => description.includes(permission)) || null;
}

function isOwner(ownerIds, actorId) {
  return ownerIds.some((ownerId) => Number(ownerId) === Number(actorId));
}

function getDisplayName(user, fallbackId) {
  if (user?.username) return `@${user.username}`;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return fullName || String(user?.id || fallbackId);
}

function validateActor(actorMember, actorId, ownerIds) {
  if (isOwner(ownerIds, actorId)) return;
  if (actorMember?.status === "creator") return;
  if (actorMember?.status === "administrator" && actorMember.can_promote_members === true) return;
  throw createAdminOperationError(
    "ACTOR_FORBIDDEN",
    "У вас нет права назначать или снимать администраторов."
  );
}

function validateBot(botMember) {
  if (botMember?.status !== "administrator") {
    throw createAdminOperationError("BOT_NOT_ADMIN", "Бот не является администратором этой группы.");
  }
  if (botMember.can_promote_members !== true) {
    throw createAdminOperationError(
      "BOT_CANNOT_PROMOTE",
      "У бота нет права «Назначение администраторов»."
    );
  }
}

function validateTarget(targetMember, actorId, targetId, botId, promote) {
  if (Number(targetId) === Number(actorId)) {
    throw createAdminOperationError("TARGET_IS_ACTOR", "⛔ Нельзя изменить собственные права администратора.");
  }
  if (Number(targetId) === Number(botId)) {
    throw createAdminOperationError("TARGET_IS_BOT", "⛔ Бот не может изменить собственные права администратора.");
  }
  if (!isPresentMember(targetMember)) {
    throw createAdminOperationError("TARGET_NOT_MEMBER", "⛔ Пользователь не является участником этой группы.");
  }
  if (targetMember.user?.is_bot) {
    throw createAdminOperationError("TARGET_IS_BOT", "⛔ Нельзя назначать или снимать администратора у бота.");
  }
  if (targetMember.status === "creator") {
    throw createAdminOperationError(
      "TARGET_IS_CREATOR",
      promote ? "Нельзя назначить владельца группы администратором." : "Нельзя снять права владельца группы."
    );
  }
}

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function changeTelegramAdmin(options) {
  const {
    bot,
    chat,
    actorId,
    targetId,
    botId,
    ownerIds = [],
    promote,
    verificationDelayMs = 250
  } = options;

  if (!isSupportedAdminChat(chat)) {
    throw createAdminOperationError(
      "UNSUPPORTED_CHAT",
      "⚠️ Команда работает только в группах и супергруппах."
    );
  }

  const [actorMember, botMember, targetMember] = await Promise.all([
    bot.getChatMember(chat.id, actorId),
    bot.getChatMember(chat.id, botId),
    bot.getChatMember(chat.id, targetId)
  ]);
  validateActor(actorMember, actorId, ownerIds);
  validateBot(botMember);
  validateTarget(targetMember, actorId, targetId, botId, promote);

  if (promote && targetMember.status === "administrator") {
    return {
      changed: false,
      message: "Участник уже является администратором.",
      member: targetMember,
      requestedRights: null
    };
  }
  if (!promote && targetMember.status !== "administrator") {
    return {
      changed: false,
      message: "Участник не является администратором.",
      member: targetMember,
      requestedRights: null
    };
  }
  if (targetMember.status === "administrator" && targetMember.can_be_edited !== true) {
    throw createAdminOperationError(
      "TARGET_NOT_EDITABLE",
      "⛔ Telegram не разрешает боту изменять права этого администратора."
    );
  }

  const requestedRights = promote
    ? buildSafeAdminRights(botMember, chat)
    : buildAdminDemotionRights(chat);
  const capabilities = getBotAdminCapabilities(botMember, chat);
  let apiResult;
  try {
    apiResult = await bot.promoteChatMember(chat.id, targetId, requestedRights);
  } catch (error) {
    const telegram = getTelegramApiErrorDetails(error);
    const code = isRightForbidden(error) ? "RIGHT_FORBIDDEN" : "TELEGRAM_REJECTED";
    throw createAdminOperationError(
      code,
      code === "RIGHT_FORBIDDEN"
        ? "⚠️ Telegram отклонил одно из запрошенных прав администратора."
        : `⚠️ Telegram не выполнил изменение: ${telegram.apiDescription}`,
      { telegram, requestedRights, capabilities },
      error
    );
  }
  if (apiResult !== true) {
    throw createAdminOperationError(
      "TELEGRAM_UNCONFIRMED",
      "⚠️ Telegram API не подтвердил изменение прав администратора.",
      { apiResult, requestedRights, capabilities }
    );
  }

  await wait(verificationDelayMs);
  const verifiedMember = await bot.getChatMember(chat.id, targetId);
  const applied = promote ? isPromotionApplied(verifiedMember) : isDemotionApplied(verifiedMember);
  if (!applied) {
    throw createAdminOperationError(
      "VERIFICATION_FAILED",
      "⚠️ Telegram принял запрос, но фактический статус участника не изменился.",
      {
        requestedStatus: promote ? "administrator" : "member",
        actualStatus: verifiedMember?.status || "unknown",
        requestedRights,
        capabilities
      }
    );
  }

  return {
    changed: true,
    message: promote
      ? `${getDisplayName(verifiedMember.user, targetId)} назначен администратором.`
      : "С пользователя сняты права администратора.",
    member: verifiedMember,
    requestedRights
  };
}

function promoteTelegramAdmin(options) {
  return changeTelegramAdmin({ ...options, promote: true });
}

function demoteTelegramAdmin(options) {
  return changeTelegramAdmin({ ...options, promote: false });
}

function getMutedPermissions() {
  return {
    ...Object.fromEntries(SEND_PERMISSION_FIELDS.map((permission) => [permission, false])),
    can_react_to_messages: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function getFullPermissions() {
  return {
    ...Object.fromEntries(SEND_PERMISSION_FIELDS.map((permission) => [permission, true])),
    can_react_to_messages: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function isMemberMuted(member) {
  if (!member || member.status !== "restricted") return false;
  return SEND_PERMISSION_FIELDS.some((permission) => member[permission] === false) || member.can_react_to_messages === false;
}

function isMuteApplied(member) {
  if (!member || member.status !== "restricted") return false;
  const messagesBlocked = SEND_PERMISSION_FIELDS.every((permission) => member[permission] === false);
  const reactionsBlocked = member.can_react_to_messages !== true;
  return messagesBlocked && reactionsBlocked;
}

function isMuteLifted(member) {
  if (!member) return false;
  if (member.status === "member" || member.status === "administrator" || member.status === "creator") return true;
  if (member.status !== "restricted") return false;
  return SEND_PERMISSION_FIELDS.every((permission) => member[permission] !== false) && member.can_react_to_messages !== false;
}

function describeMemberRestrictions(member) {
  if (!member) return "Telegram не вернул состояние участника";
  const blocked = [...SEND_PERMISSION_FIELDS, "can_react_to_messages"]
    .filter((permission) => member[permission] === false);
  return blocked.length > 0
    ? `status=${member.status}; ограничения: ${blocked.join(", ")}`
    : `status=${member.status}; активные ограничения не обнаружены`;
}

function isPromotionApplied(member, requestedRights = ADMIN_PROMOTION_RIGHTS) {
  if (!member || member.status !== "administrator") return false;
  return Object.entries(requestedRights || {})
    .filter(([, expected]) => expected)
    .every(([permission]) => member[permission] === true);
}

function isDemotionApplied(member) {
  return Boolean(member && member.status !== "administrator" && member.status !== "creator");
}

module.exports = {
  ADMIN_COMMON_RIGHT_FIELDS,
  ADMIN_DEMOTION_RIGHTS,
  ADMIN_GROUP_RIGHT_FIELDS,
  ADMIN_PROMOTION_RIGHTS,
  ADMIN_STORY_RIGHT_FIELDS,
  SEND_PERMISSION_FIELDS,
  TelegramAdminOperationError,
  buildAdminDemotionRights,
  buildSafeAdminRights,
  changeTelegramAdmin,
  createAdminOperationError,
  demoteTelegramAdmin,
  describeMemberRestrictions,
  getBotAdminCapabilities,
  getForbiddenRight,
  getFullPermissions,
  getMutedPermissions,
  getTelegramApiErrorDetails,
  isAdministrator,
  isDemotionApplied,
  isMemberMuted,
  isMuteApplied,
  isMuteLifted,
  isPromotionApplied,
  isRightForbidden,
  isSupportedAdminChat,
  promoteTelegramAdmin
};
