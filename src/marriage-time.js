const DEFAULT_TIME_ZONE = "Asia/Tashkent";

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

function formatDurationMs(durationMs) {
  const totalMinutes = Math.floor(Math.max(0, durationMs) / 60000);
  if (totalMinutes < 1) return "меньше минуты";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [
    days > 0 ? `${days} ${plural(days, "день", "дня", "дней")}` : "",
    hours > 0 ? `${hours} ${plural(hours, "час", "часа", "часов")}` : "",
    minutes > 0 ? `${minutes} ${plural(minutes, "минута", "минуты", "минут")}` : ""
  ].filter(Boolean).join(" ");
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

module.exports = { formatMarriageDetails, formatMarriageDuration, formatUntilAnniversary, formatWeddingDate };
