require("dotenv").config();

const path = require("path");
const { Telegraf } = require("telegraf");
const Database = require("better-sqlite3");

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
  console.error("Ошибка: BOT_TOKEN не найден в файле .env");
  process.exit(1);
}

const bot = new Telegraf(botToken);
const db = new Database(path.join(__dirname, "..", "database.sqlite"));

db.exec(`
CREATE TABLE IF NOT EXISTS chat_users (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  first_name TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, user_id)
);
`);

const saveChatUserStmt = db.prepare(`
INSERT INTO chat_users (chat_id, user_id, username, first_name, updated_at)
VALUES (@chatId, @userId, @username, @firstName, CURRENT_TIMESTAMP)
ON CONFLICT(chat_id, user_id) DO UPDATE SET
  username = excluded.username,
  first_name = excluded.first_name,
  updated_at = CURRENT_TIMESTAMP
`);

const getChatUsersStmt = db.prepare(`
SELECT chat_id, user_id, username, first_name
FROM chat_users
WHERE chat_id = ?
`);

const IRIS_NAME_RE = /(^|[^\p{L}\p{N}_])ирис([^\p{L}\p{N}_]|$)/iu;
const IRIS_QUESTION_RE = /(?:^|[^\p{L}\p{N}_])кто\s+(.+?)[?!.\s]*$/iu;
const SELF_PICK_CHANCE = 0.1;

const replyTemplates = [
  "Я думаю, что {name} — это {question}",
  "Ясно вижу, что {name} {question}",
  "Я уверен, что {name} {question}"
];

function isGroupChat(ctx) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeQuestion(rawQuestion) {
  return String(rawQuestion || "")
    .replace(/(^|[^\p{L}\p{N}_])ирис([^\p{L}\p{N}_]|$)/giu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.,;:]+$/g, "")
    .trim();
}

function parseIrisQuestion(text) {
  if (!IRIS_NAME_RE.test(text)) return null;

  const match = text.match(IRIS_QUESTION_RE);
  if (!match) return null;

  const question = normalizeQuestion(match[1]);
  return question || null;
}

function saveChatUser(ctx) {
  if (!isGroupChat(ctx)) return;
  if (!ctx.from || ctx.from.is_bot) return;

  saveChatUserStmt.run({
    chatId: ctx.chat.id,
    userId: ctx.from.id,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || "Пользователь"
  });
}

function getMention(user) {
  if (user.username) {
    return `@${escapeHtml(user.username)}`;
  }

  const firstName = escapeHtml(user.first_name || "Пользователь");
  return `<a href="tg://user?id=${user.user_id}">${firstName}</a>`;
}

function pickRandomUser(users, authorId) {
  if (users.length === 0) return null;

  const author = users.find((user) => Number(user.user_id) === Number(authorId));

  if (author && Math.random() < SELF_PICK_CHANCE) {
    return author;
  }

  const candidates = users.filter((user) => Number(user.user_id) !== Number(authorId));
  const pool = candidates.length > 0 ? candidates : users;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildIrisReply(user, question) {
  const template = replyTemplates[Math.floor(Math.random() * replyTemplates.length)];

  return template
    .replace("{name}", getMention(user))
    .replace("{question}", escapeHtml(question));
}

bot.use(async (ctx, next) => {
  if (ctx.message?.text) {
    try {
      saveChatUser(ctx);
    } catch (error) {
      console.error("Ошибка сохранения участника:", error);
    }
  }

  return next();
});

bot.on("text", async (ctx) => {
  if (!isGroupChat(ctx)) return;
  if (!ctx.from || ctx.from.is_bot) return;

  const question = parseIrisQuestion(ctx.message.text);
  if (!question) return;

  try {
    const users = getChatUsersStmt.all(ctx.chat.id);
    const pickedUser = pickRandomUser(users, ctx.from.id);

    if (!pickedUser) {
      await ctx.reply(
        "Пока не из кого выбрать. Пусть участники напишут пару сообщений в чат.",
        { reply_parameters: { message_id: ctx.message.message_id } }
      );
      return;
    }

    const replyText = buildIrisReply(pickedUser, question);

    await ctx.reply(replyText, {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message.message_id }
    });

    console.log(`Ирис: chat=${ctx.chat.id}, author=${ctx.from.id}, picked=${pickedUser.user_id}, question="${question}"`);
  } catch (error) {
    console.error("Ошибка обработки Ирис-вопроса:", error);
    await ctx.reply(
      "Не смог заглянуть в базу участников. Попробуй позже.",
      { reply_parameters: { message_id: ctx.message.message_id } }
    );
  }
});

bot.catch((error, ctx) => {
  console.error(`Ошибка Telegraf update=${ctx.update?.update_id}:`, error);
});

bot.launch()
  .then(() => console.log("СЛИВКИ: Ирис-бот запущен"))
  .catch((error) => {
    console.error("Ошибка запуска Ирис-бота:", error);
    process.exit(1);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
