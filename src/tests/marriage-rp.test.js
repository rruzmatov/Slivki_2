const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatMarriageDetails,
  formatMarriageDuration,
  formatMarriageListDuration,
  formatMarriageListMessages,
  formatUntilAnniversary
} = require("../marriage-time");
const { RpPresentationSelector, buildRpText } = require("../rp-presentation");

function escapeHtmlForTest(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createMarriage(overrides = {}) {
  return {
    user1_id: 1001,
    user1_name: "Алиса",
    user2_id: 2002,
    user2_name: "Борис",
    married_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function renderMarriageList(marriages, options = {}) {
  return formatMarriageListMessages(marriages, {
    now: "2026-01-05T08:17:00.000Z",
    escapeHtml: escapeHtmlForTest,
    ...options
  }).join("\n");
}

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

test("marriage list shows 4 days, 8 hours and 17 minutes", () => {
  assert.match(renderMarriageList([createMarriage()]), /⏳ <b>Вместе:<\/b> 4 дня 8 часов 17 минут/);
});

test("marriage list uses singular duration forms", () => {
  assert.equal(
    formatMarriageListDuration("2026-01-01T00:00:00.000Z", "2026-01-02T01:01:00.000Z"),
    "1 день 1 час 1 минута"
  );
});

test("marriage list uses few duration forms", () => {
  assert.equal(
    formatMarriageListDuration("2026-01-01T00:00:00.000Z", "2026-01-03T02:02:00.000Z"),
    "2 дня 2 часа 2 минуты"
  );
});

test("marriage list uses many duration forms", () => {
  assert.equal(
    formatMarriageListDuration("2026-01-01T00:00:00.000Z", "2026-01-06T05:05:00.000Z"),
    "5 дней 5 часов 5 минут"
  );
});

test("marriage list shows only minutes for a duration under one hour", () => {
  assert.equal(
    formatMarriageListDuration("2026-01-01T00:00:00.000Z", "2026-01-01T00:37:00.000Z"),
    "37 минут"
  );
});

test("future marriage date becomes zero minutes and emits a diagnostic", () => {
  const diagnostics = [];
  const duration = formatMarriageListDuration(
    "2026-01-02T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
    (diagnostic) => diagnostics.push(diagnostic)
  );
  assert.equal(duration, "0 минут");
  assert.deepEqual(diagnostics, [{ code: "MARRIAGE_DATE_IN_FUTURE", marriedAt: "2026-01-02T00:00:00.000Z" }]);
});

test("marriage list escapes unsafe participant names", () => {
  const text = renderMarriageList([createMarriage({
    user1_name: "Алиса <Главная>",
    user2_name: "Борис & Компания"
  })]);
  assert.match(text, />Алиса &lt;Главная&gt;<\/a>/);
  assert.match(text, />Борис &amp; Компания<\/a>/);
  assert.doesNotMatch(text, /Алиса <Главная>|Борис & Компания/);
});

test("marriage list keeps Telegram IDs inside links instead of visible names", () => {
  const text = renderMarriageList([createMarriage({ user1_name: "ID:1001", user2_name: "ID:2002" })]);
  const visibleText = text.replace(/<[^>]+>/g, "");
  assert.match(text, /href="tg:\/\/user\?id=1001"/);
  assert.match(text, /href="tg:\/\/user\?id=2002"/);
  assert.doesNotMatch(visibleText, /ID:1001|ID:2002/);
  assert.match(visibleText, /Пользователь 💍 Пользователь/);
});

test("marriage list hides wedding date and anniversary countdown", () => {
  const text = renderMarriageList([createMarriage()]);
  assert.doesNotMatch(text, /Дата свадьбы|До годовщины|01\.01\.2026|2026-01-01/);
});

test("multiple marriages are separated by one empty line", () => {
  const text = renderMarriageList([
    createMarriage(),
    createMarriage({ user1_id: 3003, user1_name: "Вера", user2_id: 4004, user2_name: "Глеб" })
  ]);
  assert.match(text, /<b>1\.<\/b>[\s\S]+?<b>Вместе:<\/b> 4 дня 8 часов 17 минут\n\n<b>2\.<\/b>/);
  assert.match(text, /^💒 <b>Браки в этом чате<\/b>\n\n/);
  assert.match(text, /\n\n────────────$/);
});

test("large marriage lists are split only between complete HTML blocks", () => {
  const marriages = Array.from({ length: 120 }, (_, index) => createMarriage({
    user1_id: 10000 + index * 2,
    user1_name: `Участник <${index}> ${"А".repeat(100)}`,
    user2_id: 10001 + index * 2,
    user2_name: `Партнёр & ${index}`
  }));
  const messages = formatMarriageListMessages(marriages, {
    now: "2026-01-05T08:17:00.000Z",
    escapeHtml: escapeHtmlForTest
  });
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 3900));
  assert.ok(messages.every((message) => message.startsWith("💒 <b>Браки в этом чате</b>\n\n")));
  assert.ok(messages.every((message) => message.endsWith("\n\n────────────")));
  assert.equal(messages.join("\n").match(/<b>\d+\.<\/b>/g)?.length, marriages.length);
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
