const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SEND_PERMISSION_FIELDS,
  TelegramAdminOperationError,
  buildAdminDemotionRights,
  buildSafeAdminRights,
  changeTelegramAdmin,
  getFullPermissions,
  getMutedPermissions,
  getBotAdminCapabilities,
  isMemberMuted,
  isMuteApplied,
  isMuteLifted,
  isRightForbidden
} = require("../telegram-moderation");

const ACTOR_ID = 101;
const BOT_ID = 999;
const TARGET_ID = 202;
const CHAT = Object.freeze({ id: -100123, type: "supergroup", title: "Test" });

function createTelegramApi(options = {}) {
  const actorMember = options.actorMember || {
    status: "administrator",
    can_promote_members: true,
    user: { id: ACTOR_ID, is_bot: false }
  };
  const botMember = options.botMember || {
    status: "administrator",
    can_manage_chat: true,
    can_delete_messages: true,
    can_manage_video_chats: true,
    can_restrict_members: true,
    can_change_info: true,
    can_invite_users: true,
    can_pin_messages: true,
    can_manage_topics: true,
    can_manage_tags: true,
    can_promote_members: true,
    user: { id: BOT_ID, is_bot: true }
  };
  const targetBefore = options.targetBefore || {
    status: "member",
    user: { id: TARGET_ID, first_name: "Target", is_bot: false }
  };
  const targetAfter = options.targetAfter || {
    status: "administrator",
    can_be_edited: true,
    user: targetBefore.user
  };
  const calls = [];
  let targetReads = 0;
  const bot = {
    async getChatMember(chatId, userId) {
      calls.push({ method: "getChatMember", chatId, userId });
      if (Number(userId) === ACTOR_ID) return actorMember;
      if (Number(userId) === BOT_ID) return botMember;
      targetReads += 1;
      return targetReads === 1 ? targetBefore : targetAfter;
    },
    async promoteChatMember(chatId, userId, rights) {
      calls.push({ method: "promoteChatMember", chatId, userId, rights });
      if (options.promoteError) throw options.promoteError;
      return options.apiResult === undefined ? true : options.apiResult;
    }
  };
  return { bot, calls };
}

function adminOptions(api, overrides = {}) {
  return {
    bot: api,
    chat: CHAT,
    actorId: ACTOR_ID,
    targetId: TARGET_ID,
    botId: BOT_ID,
    ownerIds: [],
    promote: true,
    verificationDelayMs: 0,
    ...overrides
  };
}

async function expectAdminError(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof TelegramAdminOperationError);
    assert.equal(error.code, code);
    if (message) assert.equal(error.userMessage, message);
    return true;
  });
}

test("mute permissions block every Telegram content class and reactions", () => {
  const permissions = getMutedPermissions();
  for (const field of SEND_PERMISSION_FIELDS) assert.equal(permissions[field], false, field);
  assert.equal(permissions.can_react_to_messages, false);
  assert.equal(isMuteApplied({ status: "restricted", ...permissions }), true);
  assert.equal(isMemberMuted({ status: "restricted", ...permissions }), true);
});

test("full permissions lift message, media, sticker, link and reaction restrictions", () => {
  const permissions = getFullPermissions();
  for (const field of SEND_PERMISSION_FIELDS) assert.equal(permissions[field], true, field);
  assert.equal(permissions.can_react_to_messages, true);
  assert.equal(isMuteLifted({ status: "restricted", ...permissions }), true);
  assert.equal(isMemberMuted({ status: "restricted", ...permissions }), false);
});

test("promotion is rejected when the bot is not an administrator", async () => {
  const { bot, calls } = createTelegramApi({ botMember: { status: "member", user: { id: BOT_ID, is_bot: true } } });
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot)),
    "BOT_NOT_ADMIN",
    "Бот не является администратором этой группы."
  );
  assert.equal(calls.some((call) => call.method === "promoteChatMember"), false);
});

test("promotion is rejected when the bot lacks can_promote_members", async () => {
  const { bot, calls } = createTelegramApi({
    botMember: { status: "administrator", can_promote_members: false, user: { id: BOT_ID, is_bot: true } }
  });
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot)),
    "BOT_CANNOT_PROMOTE",
    "У бота нет права «Назначение администраторов»."
  );
  assert.equal(calls.some((call) => call.method === "promoteChatMember"), false);
});

test("promotion is rejected when the actor lacks promotion permission", async () => {
  const { bot, calls } = createTelegramApi({
    actorMember: { status: "member", user: { id: ACTOR_ID, is_bot: false } }
  });
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot)),
    "ACTOR_FORBIDDEN",
    "У вас нет права назначать или снимать администраторов."
  );
  assert.equal(calls.some((call) => call.method === "promoteChatMember"), false);
});

test("global owner may initiate an operation but still passes bot preflight", async () => {
  const { bot } = createTelegramApi({
    actorMember: { status: "member", user: { id: ACTOR_ID, is_bot: false } }
  });
  const result = await changeTelegramAdmin(adminOptions(bot, { ownerIds: [ACTOR_ID] }));
  assert.equal(result.changed, true);
});

test("global owner cannot bypass missing bot promotion permission", async () => {
  const { bot, calls } = createTelegramApi({
    actorMember: { status: "member", user: { id: ACTOR_ID, is_bot: false } },
    botMember: { status: "administrator", can_promote_members: false, user: { id: BOT_ID, is_bot: true } }
  });
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot, { ownerIds: [ACTOR_ID] })),
    "BOT_CANNOT_PROMOTE"
  );
  assert.equal(calls.some((call) => call.method === "promoteChatMember"), false);
});

test("target bot is rejected", async () => {
  const { bot } = createTelegramApi({
    targetBefore: { status: "member", user: { id: TARGET_ID, is_bot: true } }
  });
  await expectAdminError(changeTelegramAdmin(adminOptions(bot)), "TARGET_IS_BOT");
});

test("chat creator cannot be promoted", async () => {
  const { bot } = createTelegramApi({
    targetBefore: { status: "creator", user: { id: TARGET_ID, is_bot: false } }
  });
  await expectAdminError(changeTelegramAdmin(adminOptions(bot)), "TARGET_IS_CREATOR");
});

test("chat creator cannot be demoted", async () => {
  const { bot } = createTelegramApi({
    targetBefore: { status: "creator", user: { id: TARGET_ID, is_bot: false } }
  });
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot, { promote: false })),
    "TARGET_IS_CREATOR",
    "Нельзя снять права владельца группы."
  );
});

test("actor cannot change their own admin status", async () => {
  const { bot } = createTelegramApi();
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot, { targetId: ACTOR_ID })),
    "TARGET_IS_ACTOR"
  );
});

test("target must still be a member of the chat", async () => {
  const { bot } = createTelegramApi({
    targetBefore: { status: "left", user: { id: TARGET_ID, is_bot: false } }
  });
  await expectAdminError(changeTelegramAdmin(adminOptions(bot)), "TARGET_NOT_MEMBER");
});

test("promotion is idempotent for an existing administrator", async () => {
  const { bot, calls } = createTelegramApi({
    targetBefore: {
      status: "administrator",
      can_be_edited: true,
      user: { id: TARGET_ID, is_bot: false }
    }
  });
  const result = await changeTelegramAdmin(adminOptions(bot));
  assert.deepEqual({ changed: result.changed, message: result.message }, {
    changed: false,
    message: "Участник уже является администратором."
  });
  assert.equal(calls.some((call) => call.method === "promoteChatMember"), false);
});

test("successful promotion is verified through getChatMember", async () => {
  const { bot, calls } = createTelegramApi();
  const result = await changeTelegramAdmin(adminOptions(bot));
  assert.equal(result.changed, true);
  assert.equal(result.member.status, "administrator");
  assert.equal(calls.filter((call) => call.method === "getChatMember" && call.userId === TARGET_ID).length, 2);
  assert.equal(calls.filter((call) => call.method === "promoteChatMember").length, 1);
});

test("API success without verified administrator status fails", async () => {
  const { bot } = createTelegramApi({
    targetAfter: { status: "member", user: { id: TARGET_ID, is_bot: false } }
  });
  await expectAdminError(changeTelegramAdmin(adminOptions(bot)), "VERIFICATION_FAILED");
});

test("RIGHT_FORBIDDEN keeps Telegram diagnostics and requested rights", async () => {
  const telegramError = Object.assign(new Error("ETELEGRAM: 400 Bad Request: RIGHT_FORBIDDEN"), {
    response: { body: { error_code: 400, description: "Bad Request: RIGHT_FORBIDDEN" } }
  });
  const { bot } = createTelegramApi({ promoteError: telegramError });
  await assert.rejects(changeTelegramAdmin(adminOptions(bot)), (error) => {
    assert.equal(error.code, "RIGHT_FORBIDDEN");
    assert.equal(error.details.telegram.apiErrorCode, 400);
    assert.equal(error.details.telegram.apiDescription, "Bad Request: RIGHT_FORBIDDEN");
    assert.ok(error.details.requestedRights);
    assert.equal(isRightForbidden(error), true);
    return true;
  });
});

test("new administrator rights are a safe subset of bot rights", () => {
  const botMember = {
    can_manage_chat: true,
    can_delete_messages: false,
    can_manage_video_chats: true,
    can_restrict_members: false,
    can_change_info: true,
    can_invite_users: true,
    can_pin_messages: false,
    can_promote_members: true
  };
  const rights = buildSafeAdminRights(botMember, CHAT);
  for (const [permission, granted] of Object.entries(rights)) {
    if (granted) assert.equal(botMember[permission], true, permission);
  }
  assert.equal(rights.can_delete_messages, false);
  assert.equal(rights.can_pin_messages, false);
});

test("new administrator is never anonymous", () => {
  const rights = buildSafeAdminRights({ can_manage_chat: true }, CHAT);
  assert.equal(rights.is_anonymous, false);
});

test("new administrator never receives promotion permission", () => {
  const rights = buildSafeAdminRights({ can_promote_members: true }, CHAT);
  assert.equal(rights.can_promote_members, false);
});

test("supergroup promotion excludes topic, story and channel-only rights", () => {
  const rights = buildSafeAdminRights({
    can_manage_topics: true,
    can_post_stories: true,
    can_post_messages: true,
    can_manage_direct_messages: true
  }, { ...CHAT, is_forum: true });
  for (const permission of [
    "can_manage_topics",
    "can_post_stories",
    "can_edit_stories",
    "can_delete_stories",
    "can_post_messages",
    "can_edit_messages",
    "can_manage_direct_messages"
  ]) {
    assert.equal(Object.hasOwn(rights, permission), false, permission);
  }
});

test("successful demotion clears applicable rights and verifies normal status", async () => {
  const target = {
    status: "administrator",
    can_be_edited: true,
    user: { id: TARGET_ID, first_name: "Target", is_bot: false }
  };
  const { bot, calls } = createTelegramApi({
    targetBefore: target,
    targetAfter: { status: "member", user: target.user }
  });
  const result = await changeTelegramAdmin(adminOptions(bot, { promote: false }));
  assert.equal(result.changed, true);
  assert.equal(result.message, "С пользователя сняты права администратора.");
  const request = calls.find((call) => call.method === "promoteChatMember");
  assert.ok(request);
  assert.ok(Object.values(request.rights).every((value) => value === false));
  assert.equal(result.member.status, "member");
});

test("demotion is idempotent for a non-administrator", async () => {
  const { bot, calls } = createTelegramApi();
  const result = await changeTelegramAdmin(adminOptions(bot, { promote: false }));
  assert.deepEqual({ changed: result.changed, message: result.message }, {
    changed: false,
    message: "Участник не является администратором."
  });
  assert.equal(calls.some((call) => call.method === "promoteChatMember"), false);
});

test("supergroup demotion clears optional story permissions without channel rights", () => {
  const rights = buildAdminDemotionRights(CHAT);
  for (const permission of ["can_post_stories", "can_edit_stories", "can_delete_stories"]) {
    assert.equal(rights[permission], false, permission);
  }
  for (const permission of ["can_post_messages", "can_edit_messages", "can_manage_direct_messages"]) {
    assert.equal(Object.hasOwn(rights, permission), false, permission);
  }
});

test("uneditable administrator cannot be changed", async () => {
  const { bot } = createTelegramApi({
    targetBefore: {
      status: "administrator",
      can_be_edited: false,
      user: { id: TARGET_ID, is_bot: false }
    }
  });
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot, { promote: false })),
    "TARGET_NOT_EDITABLE"
  );
});

test("private chats are rejected before Telegram API calls", async () => {
  const { bot, calls } = createTelegramApi();
  await expectAdminError(
    changeTelegramAdmin(adminOptions(bot, { chat: { id: ACTOR_ID, type: "private" } })),
    "UNSUPPORTED_CHAT"
  );
  assert.equal(calls.length, 0);
});

test("diagnostic capabilities expose status, chat type and safe grantable rights", () => {
  const capabilities = getBotAdminCapabilities({
    status: "administrator",
    can_promote_members: true,
    can_delete_messages: true,
    can_manage_topics: true
  }, CHAT);
  assert.equal(capabilities.status, "administrator");
  assert.equal(capabilities.chatType, "supergroup");
  assert.equal(capabilities.canPromoteMembers, true);
  assert.deepEqual(capabilities.safeGrantableRights, ["can_delete_messages"]);
  assert.equal(capabilities.actualRights.can_manage_topics, true);
});
