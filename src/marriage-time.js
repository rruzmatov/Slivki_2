const DEFAULT_TIME_ZONE = "Asia/Tashkent";
const MAX_MARRIAGE_LIST_MESSAGE_LENGTH = 3900;
const MAX_MARRIAGE_DISPLAY_NAME_LENGTH = 80;

function formatMarriageDuration(marriedAt, now = Date.now()) {
  const start = Date.parse(marriedAt);
  const end = normalizeNow(now);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "дата неизвестна";
  return formatDurationMs(Math.max(0, end - start));
}

function formatWeddingDate(marriedAt, timeZone = DEFAULT_TIME_ZONE) {
  const timestamp = Date.parse(marriedAt);
  if (!Number.isFinite(timestamp)) return "дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatUntilAnniversary(marriedAt, now = Date.now()) {
  const start = new Date(marriedAt);
  const current = new Date(normalizeNow(now));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(current.getTime())) return "дата неизвестна";
  let anniversary = anniversaryForYear(start, current.getUTCFullYear());
  if (anniversary.getTime() <= current.getTime()) anniversary = anniversaryForYear(start, current.getUTCFullYear() + 1);
  return formatDurationMs(anniversary.getTime() - current.getTime());
}

function formatMarriageDetails(marriedAt, now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  return [
    `💍 Вместе: ${formatMarriageDuration(marriedAt, now)}`,
    `📅 Дата свадьбы: ${formatWeddingDate(marriedAt, timeZone)}`,
    `🎉 До годовщины: ${formatUntilAnniversary(marriedAt, now)}`
  ].join("\n");
}

function formatMarriageListMessages(marriages, options = {}) {
  if (!Array.isArray(marriages)) throw new TypeError("Marriage list must be an array");
  if (typeof options.escapeHtml !== "function") throw new TypeError("Marriage list HTML escaper is required");
  if (marriages.length === 0) return [];

  const maxMessageLength = normalizeMessageLength(options.maxMessageLength);
  const now = options.now ?? Date.now();
  const blocks = marriages
    .map((marriage, index) => formatMarriageListBlock(marriage, index, now, options))
    .filter(Boolean);
  const messages = [];
  let currentBlocks = [];

  for (const block of blocks) {
    const candidate = renderMarriageListMessage([...currentBlocks, block]);
    if (candidate.length > maxMessageLength && currentBlocks.length > 0) {
      messages.push(renderMarriageListMessage(currentBlocks));
      currentBlocks = [block];
      continue;
    }
    currentBlocks.push(block);
  }

  if (currentBlocks.length > 0) messages.push(renderMarriageListMessage(currentBlocks));
  return messages;
}

function formatMarriageListBlock(marriage, index, now, options) {
  const firstUserId = normalizeTelegramUserId(marriage?.user1_id);
  const secondUserId = normalizeTelegramUserId(marriage?.user2_id);
  if (!firstUserId || !secondUserId) {
    reportMarriageDiagnostic(options.onDiagnostic, {
      code: "INVALID_MARRIAGE_PARTICIPANT",
      marriageIndex: index,
      user1Id: marriage?.user1_id ?? null,
      user2Id: marriage?.user2_id ?? null
    });
    return null;
  }

  const duration = formatMarriageListDuration(marriage?.married_at, now, (diagnostic) => {
    reportMarriageDiagnostic(options.onDiagnostic, {
      ...diagnostic,
      marriageIndex: index,
      user1Id: firstUserId,
      user2Id: secondUserId
    });
  });
  const firstName = options.escapeHtml(normalizeMarriageDisplayName(marriage?.user1_name));
  const secondName = options.escapeHtml(normalizeMarriageDisplayName(marriage?.user2_name));

  return [
    `<b>${index + 1}.</b> <a href="tg://user?id=${firstUserId}">${firstName}</a> 💍 <a href="tg://user?id=${secondUserId}">${secondName}</a>`,
    `⏳ <b>Вместе:</b> ${duration}`
  ].join("\n");
}

function formatMarriageListDuration(marriedAt, now = Date.now(), onDiagnostic) {
  const start = Date.parse(marriedAt);
  const end = normalizeNow(now);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    reportMarriageDiagnostic(onDiagnostic, { code: "INVALID_MARRIAGE_DATE", marriedAt: marriedAt ?? null });
    return "0 минут";
  }
  if (start > end) {
    reportMarriageDiagnostic(onDiagnostic, { code: "MARRIAGE_DATE_IN_FUTURE", marriedAt });
    return "0 минут";
  }

  const { days, hours, minutes } = getDurationParts(end - start);
  if (days > 0) {
    return [
      formatDurationUnit(days, "день", "дня", "дней"),
      formatDurationUnit(hours, "час", "часа", "часов"),
      formatDurationUnit(minutes, "минута", "минуты", "минут")
    ].join(" ");
  }
  if (hours > 0) {
    return [
      formatDurationUnit(hours, "час", "часа", "часов"),
      formatDurationUnit(minutes, "минута", "минуты", "минут")
    ].join(" ");
  }
  return formatDurationUnit(minutes, "минута", "минуты", "минут");
}

function formatDurationMs(durationMs) {
  const { totalMinutes, days, hours, minutes } = getDurationParts(durationMs);
  if (totalMinutes < 1) return "меньше минуты";
  return [
    days > 0 ? formatDurationUnit(days, "день", "дня", "дней") : "",
    hours > 0 ? formatDurationUnit(hours, "час", "часа", "часов") : "",
    minutes > 0 ? formatDurationUnit(minutes, "минута", "минуты", "минут") : ""
  ].filter(Boolean).join(" ");
}

function getDurationParts(durationMs) {
  const totalMinutes = Math.floor(Math.max(0, durationMs) / 60000);
  return {
    totalMinutes,
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60
  };
}

function formatDurationUnit(value, one, few, many) {
  return `${value} ${plural(value, one, few, many)}`;
}

function normalizeTelegramUserId(value) {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

function normalizeMarriageDisplayName(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const displayName = !normalized || /^ID:\d+$/i.test(normalized) ? "Пользователь" : normalized;
  const characters = Array.from(displayName);
  if (characters.length <= MAX_MARRIAGE_DISPLAY_NAME_LENGTH) return displayName;
  return `${characters.slice(0, MAX_MARRIAGE_DISPLAY_NAME_LENGTH - 1).join("")}…`;
}

function normalizeMessageLength(value) {
  if (!Number.isSafeInteger(value)) return MAX_MARRIAGE_LIST_MESSAGE_LENGTH;
  return Math.min(MAX_MARRIAGE_LIST_MESSAGE_LENGTH, Math.max(512, value));
}

function renderMarriageListMessage(blocks) {
  return ["💒 <b>Браки в этом чате</b>", "", blocks.join("\n\n"), "", "────────────"].join("\n");
}

function reportMarriageDiagnostic(handler, diagnostic) {
  if (typeof handler === "function") handler(diagnostic);
}

function anniversaryForYear(start, year) {
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const candidate = new Date(Date.UTC(year, month, day, start.getUTCHours(), start.getUTCMinutes()));
  if (candidate.getUTCMonth() !== month) return new Date(Date.UTC(year, month + 1, 0, start.getUTCHours(), start.getUTCMinutes()));
  return candidate;
}

function normalizeNow(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string") return Date.parse(now);
  return Number(now);
}

function plural(value, one, few, many) {
  const lastTwo = Math.abs(value) % 100;
  const lastOne = Math.abs(value) % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (lastOne === 1) return one;
  if (lastOne >= 2 && lastOne <= 4) return few;
  return many;
}

module.exports = {
  formatMarriageDetails,
  formatMarriageDuration,
  formatMarriageListDuration,
  formatMarriageListMessages,
  formatUntilAnniversary,
  formatWeddingDate
};
