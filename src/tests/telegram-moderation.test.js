const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ADMIN_PROMOTION_RIGHTS,
  SEND_PERMISSION_FIELDS,
  getFullPermissions,
  getMutedPermissions,
  isDemotionApplied,
  isMemberMuted,
  isMuteApplied,
  isMuteLifted,
  isPromotionApplied
} = require("../telegram-moderation");

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

test("admin verification requires the requested rights and a real demotion", () => {
  assert.equal(isPromotionApplied({ status: "administrator", ...ADMIN_PROMOTION_RIGHTS }), true);
  assert.equal(isPromotionApplied({ status: "administrator", ...ADMIN_PROMOTION_RIGHTS, can_restrict_members: false }), false);
  assert.equal(isDemotionApplied({ status: "member" }), true);
  assert.equal(isDemotionApplied({ status: "administrator" }), false);
  assert.equal(isDemotionApplied({ status: "creator" }), false);
});
