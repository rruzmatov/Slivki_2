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

const ADMIN_PROMOTION_RIGHTS = Object.freeze({
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

const ADMIN_DEMOTION_RIGHTS = Object.freeze(
  Object.fromEntries(Object.keys(ADMIN_PROMOTION_RIGHTS).map((permission) => [permission, false]))
);

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

function isPromotionApplied(member) {
  if (!member || member.status !== "administrator") return false;
  return Object.entries(ADMIN_PROMOTION_RIGHTS)
    .filter(([, expected]) => expected)
    .every(([permission]) => member[permission] === true);
}

function isDemotionApplied(member) {
  return Boolean(member && member.status !== "administrator" && member.status !== "creator");
}

module.exports = {
  ADMIN_DEMOTION_RIGHTS,
  ADMIN_PROMOTION_RIGHTS,
  SEND_PERMISSION_FIELDS,
  describeMemberRestrictions,
  getFullPermissions,
  getMutedPermissions,
  isDemotionApplied,
  isMemberMuted,
  isMuteApplied,
  isMuteLifted,
  isPromotionApplied
};
