const assert = require("node:assert/strict");
const test = require("node:test");
const { formatMarriageDetails, formatMarriageDuration, formatUntilAnniversary } = require("../marriage-time");
const { RpPresentationSelector, buildRpText } = require("../rp-presentation");

test("marriage duration includes days, hours and minutes", () => {
  const marriedAt = "2026-01-01T00:00:00.000Z";
  const now = "2026-01-03T07:34:00.000Z";
  assert.equal(formatMarriageDuration(marriedAt, now), "2 дня 7 часов 34 минуты");
  assert.equal(formatMarriageDuration(marriedAt, "2026-01-01T05:12:00.000Z"), "5 часов 12 минут");
  assert.equal(formatMarriageDuration(marriedAt, "2026-01-01T00:18:00.000Z"), "18 минут");
  const details = formatMarriageDetails(marriedAt, now);
  assert.match(details, /Дата свадьбы:/);
  assert.match(details, /До годовщины:/);
  assert.equal(formatUntilAnniversary(marriedAt, "2026-12-31T23:00:00.000Z"), "1 час");
});

test("RP selector avoids immediate text and Premium Emoji repetition", () => {
  let index = 0;
  const selector = new RpPresentationSelector((length) => index++ % length);
  const firstEmoji = selector.choose(["premium-1", "premium-2", "premium-1"], "emoji");
  const secondEmoji = selector.choose(["premium-1", "premium-2"], "emoji");
  assert.notEqual(firstEmoji, secondEmoji);
  const firstText = buildRpText(selector, "action", "Аня", "обняла", "Бориса");
  const secondText = buildRpText(selector, "action", "Аня", "обняла", "Бориса");
  assert.notEqual(firstText, secondText);
  assert.match(firstText, /Аня/);
  assert.match(firstText, /Бориса/);
});
