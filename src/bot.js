require("dotenv").config();

const { TelegramBot } = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const { randomBytes } = require("node:crypto");
const familySystem = require("./family-system");
const loveQuotes = require("./love-quotes");
const { NukeService } = require("./nuke-service");
const EmergencyNukeService = require("./emergency-nuke-service");
const { CurrencyStore } = require("./currency");
const { OwnerEconomyCommandService, parseOwnerCoinGrant } = require("./owner-economy-command");
const { PaymentError, PaymentService, parsePayCommand } = require("./payment-service");
const { parseBet, playDice, playCasino } = require("./betting-games");
const { CATEGORY_LABELS, DIFFICULTY_LABELS, QuizManager, QUIZ_REWARD } = require("./quiz");
const { formatMarriageDetails, formatMarriageListMessages } = require("./marriage-time");
const { getPreferredTelegramName, mergeTelegramIdentity, resolveMarriageParticipants } = require("./marriage-participants");
const { RpPresentationSelector, buildRpText } = require("./rp-presentation");
const { TagCallController } = require("./tag-call-controller");
const { DeferredJsonWriter } = require("./deferred-json-writer");
const { backupCorruptJson } = require("./json-file-safety");
const { BugReportStore } = require("./bug-report-store");
const {
  check: diagnosticCheck,
  formatDiagnostics,
  inspectJsonFiles,
  inspectPremiumEmoji,
  inspectRpgArchitecture,
  inspectRpgRuntime,
  inspectStorage
} = require("./diagnostics");
const {
  TelegramAdminOperationError,
  changeTelegramAdmin,
  describeMemberRestrictions,
  getBotAdminCapabilities,
  getForbiddenRight,
  getFullPermissions,
  getMutedPermissions,
  isMemberMuted,
  isMuteApplied,
  isMuteLifted,
  isRightForbidden
} = require("./telegram-moderation");
const {
  getOrCreateUserStats,
  incrementUserStat,
  updateUserStats,
  getUserStatsById
} = require("./utils/userStats");

const botToken = process.env.BOT_TOKEN;

const DEFAULT_OWNER_IDS = [6006255869, 8101022024];
const ownerIdsEnvironmentLoaded = Boolean(process.env.OWNER_IDS?.trim());
const ownerIds = Array.from(new Set([
  ...DEFAULT_OWNER_IDS,
  ...(process.env.OWNER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id))
]));

const {
  RandomPicksService,
  registerRandomPickCommands
} = require("./commands/random-picks");

if (!botToken) {
  console.error("Ошибка: BOT_TOKEN не найден в файле .env");
  process.exit(1);
}

const MAX_RUNTIME_ERRORS = 200;
const MAX_CALLBACK_CACHE = 10000;
const MAX_SUPPORT_SESSIONS = 5000;
const MAX_PENDING_MARRIAGES = 10000;
const CALLBACK_RETENTION_MS = 10 * 60 * 1000;
const runtimeErrors = [];
const processedCallbackQueries = new Map();
let callbackHandlerCount = 0;

process.on("uncaughtException", (err) => {
  recordRuntimeError("uncaughtException", err);
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  recordRuntimeError("unhandledRejection", err);
  console.error("UNHANDLED REJECTION:", err);
});

process.on("SIGTERM", () => {
  console.log("Получен SIGTERM от Railway");
});

process.on("SIGINT", () => {
  console.log("Получен SIGINT");
});

const bot = new TelegramBot(botToken, { polling: true });
const originalOn = bot.on.bind(bot);

bot.on = (eventName, callback) => {
  if (eventName !== "callback_query") {
    return originalOn(eventName, async (...args) => {
      try {
        return await callback(...args);
      } catch (error) {
        const update = args[0];
        const correlationId = recordRuntimeError(`telegram.${eventName}`, error, {
          chatId: update?.chat?.id,
          messageId: update?.message_id,
          userId: update?.from?.id
        });
        console.error(`Telegram event error ${eventName} (${correlationId}):`, getErrorMessage(error));
        return null;
      }
    });
  }
  callbackHandlerCount += 1;
  return originalOn(eventName, async (query, ...args) => {
    const now = Date.now();
    for (const [queryId, completedAt] of processedCallbackQueries) {
      if (completedAt < now - CALLBACK_RETENTION_MS) processedCallbackQueries.delete(queryId);
    }
    if (query?.id && processedCallbackQueries.has(query.id)) {
      await bot.answerCallbackQuery(query.id, { text: "Этот запрос уже обработан." }).catch(() => { });
      return null;
    }
    if (query?.id) processedCallbackQueries.set(query.id, now);
    while (processedCallbackQueries.size > MAX_CALLBACK_CACHE) {
      processedCallbackQueries.delete(processedCallbackQueries.keys().next().value);
    }
    try {
      return await callback(query, ...args);
    } catch (error) {
      if (query?.id) processedCallbackQueries.delete(query.id);
      const correlationId = recordRuntimeError("callback_query", error, {
        callbackData: query?.data,
        chatId: query?.message?.chat?.id,
        messageId: query?.message?.message_id,
        userId: query?.from?.id
      });
      console.error(`Callback error (${correlationId}):`, getErrorMessage(error));
      if (query?.id) {
        await bot.answerCallbackQuery(query.id, {
          text: `Ошибка обработки. Код: ${correlationId}`.slice(0, 180),
          show_alert: true
        }).catch(() => { });
      }
      return null;
    }
  });
};

const UNKNOWN_COMMAND_TEXT = "❓ Такой команды нет. Напиши /commands, чтобы увидеть список всех команд.";
const HANDLER_ERROR_TEXT = "⚠️ Что-то пошло не так. Попробуй ещё раз чуть позже.";
const registeredOnTextRegexes = [];
const manualSlashCommandRegexes = [
  /^(?:сливки\s+брак|брак|\/brak)(?:\s+(.+))?$/i,
  /^(?:сливки\s+развод|развод|\/razvod)$/i
];
const originalOnText = bot.onText.bind(bot);

bot.on("polling_error", (error) => {
  recordRuntimeError("polling_error", error);
  console.error("Polling error:", getErrorMessage(error));
});

function regexMatches(regexp, text) {
  regexp.lastIndex = 0;
  return regexp.test(text);
}

function isKnownSlashCommand(text, msg = null) {
  const value = String(text || "").trim();

  if (!value.startsWith("/")) return false;

  return registeredOnTextRegexes.some((regexp) => regexMatches(regexp, value)) ||
    (!msg || !isPrivateChat(msg)) && manualSlashCommandRegexes.some((regexp) => regexMatches(regexp, value));
}

function isSlashCommandMessage(msg) {
  return typeof msg?.text === "string" && msg.text.startsWith("/");
}

async function replyHandlerError(msg) {
  if (!msg?.chat?.id) return;

  await bot.sendMessage(
    msg.chat.id,
    HANDLER_ERROR_TEXT,
    { reply_parameters: { message_id: msg.message_id } }
  ).catch(() => { });
}

async function isCommandAddressedToThisBot(username) {
  if (!username) return true;

  if (!botUsername) {
    try {
      const me = await getBotIdentity();
      botUsername = me.username;
    } catch (error) {
      console.error("Command target getMe error:", getErrorMessage(error));
      return false;
    }
  }

  return String(username).toLowerCase() === String(botUsername || "").toLowerCase();
}

// Достаёт @username из команды, если он указан явно: /cmd@botname
function getCommandTargetUsername(text) {
  const match = String(text || "").trim().match(/^\/[A-Za-z0-9_]+@([A-Za-z0-9_]{5,32})/);
  return match ? match[1] : null;
}

// Решает, стоит ли вообще реагировать на неизвестную команду.
async function shouldReportUnknownCommand(msg) {
  const targetUsername = getCommandTargetUsername(msg.text);

  if (targetUsername) {
    return isCommandAddressedToThisBot(targetUsername);
  }

  return isPrivateChat(msg);
}

// Единая защита всех bot.onText-хендлеров от тихих падений.
bot.onText = (regexp, callback) => {
  registeredOnTextRegexes.push(regexp);

  return originalOnText(regexp, async (...args) => {
    const msg = args[0];

    try {
      return await callback(...args);
    } catch (error) {
      const correlationId = recordRuntimeError("onText", error, {
        commandPattern: String(regexp), chatId: msg?.chat?.id, messageId: msg?.message_id, userId: msg?.from?.id
      });
      console.error(`Ошибка в обработчике ${regexp} (${correlationId}):`, getErrorMessage(error));
      await replyHandlerError(msg);
      return null;
    }
  });
};

const PREMIUM_EMOJI_FILE = path.join(__dirname, "premium-emojis.json");
const savedPremiumEmojiIds = loadPremiumEmojiIds();
const RP_PREMIUM_EMOJI = {
  ...(savedPremiumEmojiIds.rp && typeof savedPremiumEmojiIds.rp === "object" ? savedPremiumEmojiIds.rp : {})
};
const RP_COMMAND_PREMIUM_EMOJI = {
  ...(savedPremiumEmojiIds.rpCommands && typeof savedPremiumEmojiIds.rpCommands === "object" ? savedPremiumEmojiIds.rpCommands : {})
};
let rpCommandsReady = false;

// Возвращает custom_emoji_id из .env или сохранённого JSON.
// Формат env: PREMIUM_EMOJI_MENU_ID=1234567890123456789
function getPremiumEmojiId(key) {
  const envKey = `PREMIUM_EMOJI_${key.toUpperCase()}_ID`;
  return process.env[envKey] || savedPremiumEmojiIds[key] || "";
}

// Единое хранилище premium emoji ID. Если значение пустое, бот оставляет обычный emoji.
const PREMIUM_EMOJI = {
  menu: getPremiumEmojiId("menu"),
  commands: getPremiumEmojiId("commands"),
  profile: getPremiumEmojiId("profile"),
  stats: getPremiumEmojiId("stats"),
  admin: getPremiumEmojiId("admin"),
  warn: getPremiumEmojiId("warn"),
  mute: getPremiumEmojiId("mute"),
  ban: getPremiumEmojiId("ban"),
  kick: getPremiumEmojiId("kick"),
  lock: getPremiumEmojiId("lock"),
  unlock: getPremiumEmojiId("unlock"),
  hug: getPremiumEmojiId("hug"),
  kiss: getPremiumEmojiId("kiss"),
  hit: getPremiumEmojiId("hit"),
  kill: getPremiumEmojiId("kill"),
  shield: getPremiumEmojiId("shield"),
  dragon: getPremiumEmojiId("dragon"),
  rocket: getPremiumEmojiId("rocket"),
  praise: getPremiumEmojiId("praise"),
  success: getPremiumEmojiId("success"),
  error: getPremiumEmojiId("error"),
  top: getPremiumEmojiId("top"),
  rules: getPremiumEmojiId("rules"),
  logs: getPremiumEmojiId("logs"),
  info: getPremiumEmojiId("info"),
  id: getPremiumEmojiId("id"),
  gift: getPremiumEmojiId("gift"),
  game: getPremiumEmojiId("game"),
  dice: getPremiumEmojiId("dice"),
  heart: getPremiumEmojiId("heart"),
  premium: getPremiumEmojiId("premium"),
  rp_tolknut: getPremiumEmojiId("rp_tolknut"),
  rp_pogladit: getPremiumEmojiId("rp_pogladit"),
  rp_ukusit: getPremiumEmojiId("rp_ukusit"),
  rp_uschipnut: getPremiumEmojiId("rp_uschipnut"),
  rp_podderzhat: getPremiumEmojiId("rp_podderzhat"),
  rp_nakormit: getPremiumEmojiId("rp_nakormit"),
  rp_napoit: getPremiumEmojiId("rp_napoit"),
  rp_ugostit: getPremiumEmojiId("rp_ugostit"),
  rp_rassmeshit: getPremiumEmojiId("rp_rassmeshit"),
  rp_razveselit: getPremiumEmojiId("rp_razveselit"),
  rp_udivit: getPremiumEmojiId("rp_udivit"),
  rp_napugat: getPremiumEmojiId("rp_napugat"),
  rp_razozlit: getPremiumEmojiId("rp_razozlit"),
  rp_prostit: getPremiumEmojiId("rp_prostit"),
  rp_pozdravit: getPremiumEmojiId("rp_pozdravit"),
  rp_pozhat_ruku: getPremiumEmojiId("rp_pozhat_ruku"),
  rp_dat_pyat: getPremiumEmojiId("rp_dat_pyat"),
  rp_dat_lescha: getPremiumEmojiId("rp_dat_lescha"),
  rp_dat_podzatylnik: getPremiumEmojiId("rp_dat_podzatylnik"),
  rp_dat_pendel: getPremiumEmojiId("rp_dat_pendel"),
  rp_oblit_vodoy: getPremiumEmojiId("rp_oblit_vodoy"),
  rp_zakidat_pomidorami: getPremiumEmojiId("rp_zakidat_pomidorami"),
  rp_udarit_ryboy: getPremiumEmojiId("rp_udarit_ryboy"),
  rp_kinut_tapok: getPremiumEmojiId("rp_kinut_tapok"),
  rp_kinut_podushku: getPremiumEmojiId("rp_kinut_podushku"),
  rp_kinut_banan: getPremiumEmojiId("rp_kinut_banan"),
  rp_kinut_arbuz: getPremiumEmojiId("rp_kinut_arbuz"),
  rp_razbudit: getPremiumEmojiId("rp_razbudit"),
  rp_usypit: getPremiumEmojiId("rp_usypit"),
  rp_zamorozit: getPremiumEmojiId("rp_zamorozit"),
  rp_podzhech: getPremiumEmojiId("rp_podzhech"),
  rp_zakoldovat: getPremiumEmojiId("rp_zakoldovat"),
  rp_blagoslovit: getPremiumEmojiId("rp_blagoslovit"),
  rp_proklyast: getPremiumEmojiId("rp_proklyast"),
  rp_prevratit: getPremiumEmojiId("rp_prevratit"),
  rp_teleportirovat: getPremiumEmojiId("rp_teleportirovat"),
  rp_voskresit: getPremiumEmojiId("rp_voskresit"),
  rp_prizvat_feniksa: getPremiumEmojiId("rp_prizvat_feniksa"),
  rp_prizvat_homyakov: getPremiumEmojiId("rp_prizvat_homyakov"),
  rp_prizvat_pingvinov: getPremiumEmojiId("rp_prizvat_pingvinov"),
  rp_prizvat_kuritsu: getPremiumEmojiId("rp_prizvat_kuritsu"),
  rp_prizvat_utok: getPremiumEmojiId("rp_prizvat_utok"),
  rp_atakovat: getPremiumEmojiId("rp_atakovat"),
  rp_kontratakovat: getPremiumEmojiId("rp_kontratakovat"),
  rp_obezoruzhit: getPremiumEmojiId("rp_obezoruzhit"),
  rp_oglushit: getPremiumEmojiId("rp_oglushit"),
  rp_perehitrit: getPremiumEmojiId("rp_perehitrit"),
  rp_pobedit: getPremiumEmojiId("rp_pobedit"),
  rp_dobit: getPremiumEmojiId("rp_dobit"),
  rp_vygnat: getPremiumEmojiId("rp_vygnat"),
  rp_prognat: getPremiumEmojiId("rp_prognat"),
  rp_arestovat: getPremiumEmojiId("rp_arestovat"),
  rp_doprosit: getPremiumEmojiId("rp_doprosit"),
  rp_nagradit: getPremiumEmojiId("rp_nagradit"),
  rp_koronovat: getPremiumEmojiId("rp_koronovat"),
  rp_sdelat_legendoy: getPremiumEmojiId("rp_sdelat_legendoy"),
  rp_sdelat_sigmoy: getPremiumEmojiId("rp_sdelat_sigmoy"),
  rp_sdelat_alfoy: getPremiumEmojiId("rp_sdelat_alfoy"),
  rp_sdelat_npc: getPremiumEmojiId("rp_sdelat_npc"),
  rp_sdelat_millionerom: getPremiumEmojiId("rp_sdelat_millionerom"),
  rp_obankrotit: getPremiumEmojiId("rp_obankrotit"),
  rp_otpravit_v_minecraft: getPremiumEmojiId("rp_otpravit_v_minecraft"),
  rp_otpravit_v_roblox: getPremiumEmojiId("rp_otpravit_v_roblox"),
  rp_otpravit_na_rabotu: getPremiumEmojiId("rp_otpravit_na_rabotu"),
  rp_otpravit_uchitsya: getPremiumEmojiId("rp_otpravit_uchitsya"),
  rp_otpravit_myt_posudu: getPremiumEmojiId("rp_otpravit_myt_posudu"),
  rp_otpravit_za_hlebom: getPremiumEmojiId("rp_otpravit_za_hlebom"),
  rp_lishit_vayfaya: getPremiumEmojiId("rp_lishit_vayfaya"),
  rp_lishit_pechenki: getPremiumEmojiId("rp_lishit_pechenki"),
  rp_podarit_tsvety: getPremiumEmojiId("rp_podarit_tsvety"),
  rp_podarit_shokoladku: getPremiumEmojiId("rp_podarit_shokoladku"),
  rp_podarit_kofe: getPremiumEmojiId("rp_podarit_kofe"),
  rp_podarit_chay: getPremiumEmojiId("rp_podarit_chay"),
  rp_podarit_morozhenoe: getPremiumEmojiId("rp_podarit_morozhenoe"),
  rp_podarit_udachu: getPremiumEmojiId("rp_podarit_udachu"),
  rp_podarit_ulybku: getPremiumEmojiId("rp_podarit_ulybku"),
  rp_sogret: getPremiumEmojiId("rp_sogret"),
  rp_ohladit: getPremiumEmojiId("rp_ohladit"),
  rp_obidet: getPremiumEmojiId("rp_obidet"),
  rp_otomstit: getPremiumEmojiId("rp_otomstit"),
  rp_pomiritsya: getPremiumEmojiId("rp_pomiritsya"),
  rp_podruzhitsya: getPremiumEmojiId("rp_podruzhitsya"),
  rp_priglasit_gulyat: getPremiumEmojiId("rp_priglasit_gulyat"),
  rp_priglasit_v_kino: getPremiumEmojiId("rp_priglasit_v_kino"),
  rp_stantsevat: getPremiumEmojiId("rp_stantsevat"),
  rp_pohitit: getPremiumEmojiId("rp_pohitit"),
  rp_osvobodit: getPremiumEmojiId("rp_osvobodit"),
  rp_poymat: getPremiumEmojiId("rp_poymat"),
  rp_spryatat: getPremiumEmojiId("rp_spryatat"),
  rp_nayti: getPremiumEmojiId("rp_nayti"),
  rp_vydat_almaz: getPremiumEmojiId("rp_vydat_almaz"),
  rp_vydat_platinu: getPremiumEmojiId("rp_vydat_platinu"),
  rp_vydat_legendarnyy_lut: getPremiumEmojiId("rp_vydat_legendarnyy_lut")
};

// Обычные emoji, которые показываются в тексте и заменяются на premium через entities,
// если для соответствующего ключа заполнен PREMIUM_EMOJI[key].
const PREMIUM_EMOJI_FALLBACK = {
  menu: "📋",
  commands: "📜",
  profile: "👤",
  stats: "📊",
  admin: "⚙️",
  warn: "⚠️",
  mute: "🔇",
  ban: "🚫",
  kick: "🦵",
  lock: "🔒",
  unlock: "🔓",
  hug: "🤗",
  kiss: "💋",
  hit: "👊",
  kill: "🎭",
  shield: "🛡️",
  dragon: "🐉",
  rocket: "🚀",
  praise: "🌟",
  success: "✅",
  error: "❌",
  top: "🏆",
  rules: "📖",
  logs: "📋",
  info: "ℹ️",
  id: "🆔",
  gift: "🎁",
  game: "🎮",
  dice: "🎲",
  heart: "❤️",
  premium: "💎",
  rp_tolknut: "🤜",
  rp_pogladit: "🐱",
  rp_ukusit: "😈",
  rp_uschipnut: "👌",
  rp_podderzhat: "🤝",
  rp_nakormit: "🍽️",
  rp_napoit: "🥤",
  rp_ugostit: "🍬",
  rp_rassmeshit: "😂",
  rp_razveselit: "🥳",
  rp_udivit: "😲",
  rp_napugat: "👻",
  rp_razozlit: "😡",
  rp_prostit: "🕊️",
  rp_pozdravit: "🎉",
  rp_pozhat_ruku: "🤝",
  rp_dat_pyat: "🙏",
  rp_dat_lescha: "🐟",
  rp_dat_podzatylnik: "👋",
  rp_dat_pendel: "🦵",
  rp_oblit_vodoy: "💧",
  rp_zakidat_pomidorami: "🍅",
  rp_udarit_ryboy: "🐟",
  rp_kinut_tapok: "🩴",
  rp_kinut_podushku: "🛏️",
  rp_kinut_banan: "🍌",
  rp_kinut_arbuz: "🍉",
  rp_razbudit: "⏰",
  rp_usypit: "😴",
  rp_zamorozit: "🧊",
  rp_podzhech: "🔥",
  rp_zakoldovat: "🪄",
  rp_blagoslovit: "✨",
  rp_proklyast: "🧿",
  rp_prevratit: "🐸",
  rp_teleportirovat: "🌀",
  rp_voskresit: "💫",
  rp_prizvat_feniksa: "🔥",
  rp_prizvat_homyakov: "🐹",
  rp_prizvat_pingvinov: "🐧",
  rp_prizvat_kuritsu: "🐔",
  rp_prizvat_utok: "🦆",
  rp_atakovat: "⚔️",
  rp_kontratakovat: "🗡️",
  rp_obezoruzhit: "🛡️",
  rp_oglushit: "💥",
  rp_perehitrit: "🧠",
  rp_pobedit: "🏆",
  rp_dobit: "🎯",
  rp_vygnat: "🚪",
  rp_prognat: "👋",
  rp_arestovat: "🚓",
  rp_doprosit: "🔎",
  rp_nagradit: "🏅",
  rp_koronovat: "👑",
  rp_sdelat_legendoy: "🏆",
  rp_sdelat_sigmoy: "🗿",
  rp_sdelat_alfoy: "🐺",
  rp_sdelat_npc: "🤖",
  rp_sdelat_millionerom: "💸",
  rp_obankrotit: "📉",
  rp_otpravit_v_minecraft: "⛏️",
  rp_otpravit_v_roblox: "🎮",
  rp_otpravit_na_rabotu: "💼",
  rp_otpravit_uchitsya: "📚",
  rp_otpravit_myt_posudu: "🧽",
  rp_otpravit_za_hlebom: "🍞",
  rp_lishit_vayfaya: "📵",
  rp_lishit_pechenki: "🍪",
  rp_podarit_tsvety: "💐",
  rp_podarit_shokoladku: "🍫",
  rp_podarit_kofe: "☕",
  rp_podarit_chay: "🍵",
  rp_podarit_morozhenoe: "🍦",
  rp_podarit_udachu: "🍀",
  rp_podarit_ulybku: "😊",
  rp_sogret: "🔥",
  rp_ohladit: "❄️",
  rp_obidet: "💔",
  rp_otomstit: "😈",
  rp_pomiritsya: "🤝",
  rp_podruzhitsya: "👯",
  rp_priglasit_gulyat: "🚶",
  rp_priglasit_v_kino: "🎬",
  rp_stantsevat: "💃",
  rp_pohitit: "🛸",
  rp_osvobodit: "🗝️",
  rp_poymat: "🎣",
  rp_spryatat: "📦",
  rp_nayti: "🔍",
  rp_vydat_almaz: "💎",
  rp_vydat_platinu: "🏅",
  rp_vydat_legendarnyy_lut: "🧰"
};

const originalSendMessage = bot.sendMessage.bind(bot);
const originalEditMessageText = bot.editMessageText.bind(bot);

// Загружает сохранённые custom_emoji_id из src/premium-emojis.json.
// Этот файл можно заполнить вручную или через команду /emojiid.
function loadPremiumEmojiIds() {
  try {
    if (!fs.existsSync(PREMIUM_EMOJI_FILE)) {
      return {};
    }

    const data = JSON.parse(fs.readFileSync(PREMIUM_EMOJI_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {};
    }

    return data;
  } catch (error) {
    console.error("Load premium emoji ids error:", getErrorMessage(error));
    return {};
  }
}

// Сохраняет текущие custom_emoji_id, чтобы после перезапуска бот продолжал использовать premium emoji.
function savePremiumEmojiIds() {
  const data = {};

  for (const [key, id] of Object.entries(PREMIUM_EMOJI)) {
    if (id) {
      data[key] = id;
    }
  }

  if (Object.keys(RP_PREMIUM_EMOJI).length > 0) {
    data.rp = { ...RP_PREMIUM_EMOJI };
  }

  if (Object.keys(RP_COMMAND_PREMIUM_EMOJI).length > 0) {
    data.rpCommands = { ...RP_COMMAND_PREMIUM_EMOJI };
  }

  writeJsonFile(PREMIUM_EMOJI_FILE, data, "Save premium emoji ids");
}

// Запоминает premium ID для всех RP-команд с таким же обычным emoji.
// Это покрывает все RP-действия, а не только ключевые hug/kiss/hit/kill.
function rememberRpPremiumEmojiId(emoji, customEmojiId) {
  if (!emoji || !customEmojiId) return false;

  const changed = RP_PREMIUM_EMOJI[emoji] !== customEmojiId;
  RP_PREMIUM_EMOJI[emoji] = customEmojiId;

  if (rpCommandsReady) {
    syncRpCommandEmojiIds();
  }

  return changed;
}

// Запоминает premium ID для одной конкретной RP-команды.
// Использование: ответить /emojiid обнять на сообщение с premium emoji.
function rememberRpCommandPremiumEmojiId(commandName, customEmojiId) {
  if (!commandName || !customEmojiId || !RP_COMMANDS[commandName]) return false;

  const changed = RP_COMMAND_PREMIUM_EMOJI[commandName] !== customEmojiId;
  RP_COMMAND_PREMIUM_EMOJI[commandName] = customEmojiId;

  if (rpCommandsReady) {
    syncRpCommandEmojiIds();
  }

  return changed;
}

// Достаёт все custom_emoji entities из text/caption сообщения Telegram.
function getCustomEmojiIdsFromMessage(message) {
  const text = message?.text || message?.caption || "";
  const entities = message?.entities || message?.caption_entities || [];

  return entities
    .filter((entity) => entity.type === "custom_emoji" && entity.custom_emoji_id)
    .map((entity) => ({
      emoji: text.slice(entity.offset, entity.offset + entity.length),
      customEmojiId: entity.custom_emoji_id
    }));
}

function extractCustomEmojiEntities(msg) {
  if (!msg) return [];

  const sources = [
    { text: msg.text, entities: msg.entities },
    { text: msg.caption, entities: msg.caption_entities }
  ];

  return sources.flatMap(({ text, entities }) => {
    if (!text || !Array.isArray(entities)) return [];

    return entities
      .filter((entity) => entity.type === "custom_emoji" && entity.custom_emoji_id)
      .map((entity) => ({
        emoji: text.slice(entity.offset, entity.offset + entity.length),
        customEmojiId: entity.custom_emoji_id,
        offset: entity.offset,
        length: entity.length
      }));
  });
}

// Если пользователь прислал premium emoji, который совпадает с нашим fallback emoji,
// бот автоматически запоминает его custom_emoji_id для соответствующего ключа.
function rememberPremiumEmojiIdsFromMessage(msg) {
  const customEmojiEntities = extractCustomEmojiEntities(msg);
  if (customEmojiEntities.length === 0) return;

  let changed = false;

  for (const entity of customEmojiEntities) {
    if (rememberRpPremiumEmojiId(entity.emoji, entity.customEmojiId)) {
      changed = true;
      console.log(`RP premium emoji learned: ${entity.emoji} -> ${entity.customEmojiId}`);
    }

    const matched = Object.entries(PREMIUM_EMOJI_FALLBACK)
      .find(([, emoji]) => emoji === entity.emoji);

    if (!matched) continue;

    const [key] = matched;

    if (PREMIUM_EMOJI[key] !== entity.customEmojiId) {
      PREMIUM_EMOJI[key] = entity.customEmojiId;
      syncRpCommandEmojiIds();
      changed = true;
      console.log(`Premium emoji learned: ${key} -> ${entity.customEmojiId}`);
    }
  }

  if (changed) {
    savePremiumEmojiIds();
  }
}

// Создаёт объект emoji/id из ключа PREMIUM_EMOJI.
function getPremiumEmojiItem(key) {
  return {
    key,
    emoji: PREMIUM_EMOJI_FALLBACK[key] || "",
    id: PREMIUM_EMOJI[key] || ""
  };
}

// Возвращает все premium emoji в формате, удобном для buildPremiumEntities.
function getAllPremiumEmojiItems() {
  return Object.keys(PREMIUM_EMOJI).map(getPremiumEmojiItem);
}

// Нормализует входные emoji-описания: ключи, RP-команды или готовые { emoji, id }.
function normalizePremiumEmojiItem(item) {
  if (typeof item === "string") return getPremiumEmojiItem(item);
  if (item?.emoji && item?.id !== undefined) return item;
  if (item?.emoji && item?.customEmojiId !== undefined) {
    return {
      emoji: item.emoji,
      id: item.customEmojiId
    };
  }
  return null;
}

// Оставляет только те emoji, у которых есть и fallback emoji, и custom_emoji_id.
function getPremiumEmojiItems(emojiItems = getAllPremiumEmojiItems()) {
  return emojiItems
    .map(normalizePremiumEmojiItem)
    .filter((item) => item?.emoji && item?.id);
}

function entityOverlaps(entity, entities = []) {
  const start = entity.offset;
  const end = entity.offset + entity.length;

  return entities.some((existing) => {
    const existingStart = existing.offset;
    const existingEnd = existing.offset + existing.length;
    return start < existingEnd && end > existingStart;
  });
}

// Находит emoji в тексте и строит Telegram MessageEntity custom_emoji для каждого найденного premium emoji.
function buildPremiumEntities(text, emojiItems) {
  const entities = [];

  for (const item of getPremiumEmojiItems(emojiItems)) {
    let offset = String(text).indexOf(item.emoji);

    while (offset !== -1) {
      const entity = {
        type: "custom_emoji",
        offset,
        length: item.emoji.length,
        custom_emoji_id: item.id
      };

      if (!entityOverlaps(entity, entities)) {
        entities.push(entity);
      }

      offset = String(text).indexOf(item.emoji, offset + item.emoji.length);
    }
  }

  return entities;
}

// Добавляет icon_custom_emoji_id в inline-кнопки, когда Bot API и заполненный premium id это поддерживают.
function applyPremiumInlineKeyboardIcons(replyMarkup, emojiItems = getAllPremiumEmojiItems()) {
  if (!replyMarkup?.inline_keyboard) return replyMarkup;

  return {
    ...replyMarkup,
    inline_keyboard: replyMarkup.inline_keyboard.map((row) => {
      return row.map((button) => {
        const premium = getPremiumEmojiItems(emojiItems).find((item) => {
          return typeof button.text === "string" && button.text.includes(item.emoji);
        });

        if (!premium) return button;

        const textWithoutEmoji = button.text.replace(premium.emoji, "").trim();

        return {
          ...button,
          text: textWithoutEmoji || button.text,
          icon_custom_emoji_id: premium.id
        };
      });
    })
  };
}

// Собирает options для отправки/редактирования сообщения с premium entities и premium-иконками кнопок.
function buildPremiumMessageOptions(text, emojiItems, options = {}) {
  const nextOptions = {
    ...options,
    reply_markup: applyPremiumInlineKeyboardIcons(options.reply_markup, emojiItems)
  };

  if (nextOptions.parse_mode) {
    return nextOptions;
  }

  const existingEntities = Array.isArray(nextOptions.entities) ? nextOptions.entities : [];
  const premiumEntities = buildPremiumEntities(text, emojiItems)
    .filter((entity) => !entityOverlaps(entity, existingEntities));
  const entities = existingEntities.concat(premiumEntities);

  if (entities.length > 0) {
    nextOptions.entities = entities;
  }

  return nextOptions;
}

// Отправляет сообщение с premium emoji entities и автоматически откатывается на обычный текст при ошибке.
async function sendPremiumMessage(chatId, text, emojiItems, options = {}) {
  const premiumOptions = buildPremiumMessageOptions(text, emojiItems, options);

  try {
    return await originalSendMessage(chatId, text, premiumOptions);
  } catch (error) {
    console.error("Premium message error:", getErrorMessage(error));
    return originalSendMessage(chatId, text, options);
  }
}

// Редактирует сообщение с тем же premium-слоем, что и sendPremiumMessage.
async function editPremiumMessageText(text, options = {}) {
  const premiumOptions = buildPremiumMessageOptions(text, getAllPremiumEmojiItems(), options);

  try {
    return await originalEditMessageText(text, premiumOptions);
  } catch (error) {
    console.error("Premium edit message error:", getErrorMessage(error));
    return originalEditMessageText(text, options);
  }
}

bot.sendMessage = (chatId, text, options = {}) => {
  return sendPremiumMessage(chatId, text, getAllPremiumEmojiItems(), options);
};

bot.editMessageText = (text, options = {}) => {
  return editPremiumMessageText(text, options);
};

bot.on("message", (msg) => {
  rememberPremiumEmojiIdsFromMessage(msg);
});

bot.on("webhook_error", (error) => {
  console.error("Webhook error:", getErrorMessage(error));
});

console.log("🍦 Сливки Бот запущен");

const users = new Map();
const chatUsers = new Map();
const muteTimers = new Map();
const activeMutes = new Map();
const quizTimers = new Map();
const tagCallController = new TagCallController(1200);
let adminLogs = new Map();
let botId = null;

const pendingMarriages = new Map();
const rpPresentationSelector = new RpPresentationSelector();
const supportUsers = new Map();
const MARRIAGE_PROPOSAL_SEPARATOR = "━".repeat(15);

const chatRules = new Map();
const waitingRulesInput = new Set();
const autoKickSettings = new Map();
const userLeftHistory = new Map();
let userLeftEventCount = 0;
const joinLeaveSettings = new Map();
const slowModeSettings = new Map();
const slowModeLastMessages = new Map();
const ignoredSlowModeMessages = new Set();

const STATS_FILE = path.join(__dirname, "stats.json");
const CHATS_FILE = path.join(__dirname, "chats.json");
const USERS_FILE = path.join(__dirname, "users.json");
const MARRIAGES_FILE = path.join(__dirname, "marriages.json");
const MARRIAGE_QUOTES_STATE_FILE = path.join(__dirname, "marriage-quotes-state.json");
const COMMAND_SETTINGS_FILE = path.join(__dirname, "command-settings.json");
const ADMIN_LOGS_FILE = path.join(__dirname, "admin-logs.json");
const CHAT_SETTINGS_FILE = path.join(__dirname, "chat-settings.json");
const CURRENCY_FILE = path.join(__dirname, "currency-users.json");
const QUIZ_STATE_FILE = path.join(__dirname, "quiz-state.json");
const BUG_REPORTS_FILE = path.join(__dirname, "bug-reports.json");
const RPG_STATE_FILE = path.join(__dirname, "rpg-game-state.json");

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const MAX_SAFE_REPLY_LENGTH = 3900;
const MAX_MUTE_SECONDS = 365 * 24 * 60 * 60;
const MAX_NODE_TIMER_MS = 2147483647;
const MUTE_VERIFY_DELAY_MS = 350;
const MUTE_RETRY_DELAY_MS = 60 * 1000;

const DEFAULT_JOIN_LEAVE_SETTINGS = {
  joins: true,
  leaves: true,
  leaveMinMessages: 0
};

const stats = loadStats();
const chatInfo = loadChatInfo();
const marriages = loadMarriages();
const marriageQuotesState = loadMarriageQuotesState();
const savedUsers = loadUsers();
const currencyStore = new CurrencyStore(CURRENCY_FILE, { startingBalance: 100 });
const ownerEconomyCommandService = new OwnerEconomyCommandService({
  currencyStore,
  ownerIds,
  ownerIdsEnvironmentLoaded,
  logger: console
});
const paymentService = new PaymentService(currencyStore);
const quizManager = new QuizManager(QUIZ_STATE_FILE);
const bugReportStore = new BugReportStore(BUG_REPORTS_FILE);
adminLogs = loadAdminLogs();
const savedChatSettings = loadChatSettings();

for (const [id, user] of savedUsers) {
  users.set(id, user);
}

for (const [chatId, info] of chatInfo) {
  if (Array.isArray(info.users)) {
    chatUsers.set(chatId, new Set(info.users.map(Number).filter(Number.isFinite)));
  }
}

for (const [chatId, rules] of savedChatSettings.rules) {
  chatRules.set(chatId, rules);
}

for (const [chatId, settings] of savedChatSettings.autoKickSettings) {
  autoKickSettings.set(chatId, settings);
}

for (const [chatId, settings] of savedChatSettings.joinLeaveSettings) {
  joinLeaveSettings.set(chatId, settings);
}

for (const [chatId, settings] of savedChatSettings.slowModeSettings) {
  slowModeSettings.set(chatId, settings);
}

for (const [key, mute] of savedChatSettings.activeMutes) {
  activeMutes.set(key, mute);
}

bot.on("message", async (msg) => {
  if (!msg.from) {
    return;
  }

  if (!msg.from.is_bot) {
    const isCommand =
      typeof msg.text === "string" &&
      msg.text.startsWith("/");

    incrementUserStat(msg.from, "messages", 1);

    if (isCommand) {
      incrementUserStat(msg.from, "commands", 1);
    }

    currencyStore.ensureUser(msg.from);
  }

  registerUserInChat(msg);

  try {
    await enforceSlowMode(msg);
  } catch (error) {
    console.error(
      "Slowmode enforcement error:",
      getErrorMessage(error)
    );
  }
});

// --- Command Normalization Layer ---
const RUSSIAN_COMMAND_ALIASES = {
  "мут": "mute",
  "размут": "unmute",
  "бан": "ban",
  "разбан": "unban",
  "кик": "kick",
  "варн": "warn",
  "пред": "warn",
  "анварн": "unwarn",
  "снятьварн": "unwarn",
  "логи": "logs",
  "стата": "stats",
  "статистика": "stats",
  "правила": "rules",
  "профиль": "profile",
  "топ": "top",
  "админы": "admins",
  "меню": "menu",
  "команды": "commands",
  "айди": "id",
  "чат": "chat",
  "закрыть": "lock",
  "открыть": "unlock",
  "медленный": "slowmode"
};

// This layer normalizes Russian command names to their internal names
bot.on("message", (msg) => {
  // Only normalize if text exists and doesn't start with "/"
  if (!msg.text || msg.text.startsWith("/")) return;

  // Split message into words
  const parts = msg.text.trim().split(/\s+/);
  if (parts.length === 0) return;
  const firstWord = parts[0].toLowerCase();
  // Check if it's a known Russian command alias
  const normalized = RUSSIAN_COMMAND_ALIASES[firstWord];
  if (normalized) {
    // Rebuild text as if user typed "/<normalized> ..." for downstream handlers
    msg.text = "/" + normalized + (parts.length > 1 ? " " + parts.slice(1).join(" ") : "");
  }
});

console.log("Users file:", USERS_FILE);
console.log("Saved users loaded:", users.size);

function getErrorMessage(error) {
  return (
    error?.response?.body?.description ||
    error?.message ||
    "неизвестная ошибка"
  );
}

function recordRuntimeError(source, error, context = {}) {
  const correlationId = `err-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  runtimeErrors.push({
    correlationId,
    source,
    message: getErrorMessage(error),
    stack: typeof error?.stack === "string" ? error.stack.slice(0, 4000) : undefined,
    context,
    occurredAt: new Date().toISOString()
  });
  if (runtimeErrors.length > MAX_RUNTIME_ERRORS) runtimeErrors.splice(0, runtimeErrors.length - MAX_RUNTIME_ERRORS);
  return correlationId;
}

function writeJsonFile(filePath, data, label) {
  try {
    if (fs.existsSync(filePath)) {
      try {
        JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        backupCorruptJson(filePath);
      }
    }
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpFile, filePath);
    return true;
  } catch (error) {
    console.error(`${label} error:`, getErrorMessage(error));
    return false;
  }
}

const deferredJsonWriter = new DeferredJsonWriter(writeJsonFile, { delayMs: 750, retryMs: 5000 });

function truncateTelegramText(text) {
  const value = String(text);

  if (value.length <= MAX_TELEGRAM_MESSAGE_LENGTH) {
    return value;
  }

  return value.slice(0, MAX_SAFE_REPLY_LENGTH) + "\n\n…сообщение сокращено";
}

async function sendMessageSafe(chatId, text, options = {}, context = "sendMessage") {
  try {
    return await bot.sendMessage(chatId, truncateTelegramText(text), options);
  } catch (error) {
    console.error(`${context} error:`, getErrorMessage(error));
    return null;
  }
}

async function answerCallbackSafe(queryId, options = {}) {
  try {
    return await bot.answerCallbackQuery(queryId, options);
  } catch (error) {
    console.error("answerCallbackQuery error:", getErrorMessage(error));
    return null;
  }
}

function normalizeJoinLeaveSettings(settings = {}) {
  return {
    joins: settings.joins !== false,
    leaves: settings.leaves !== false,
    leaveMinMessages: Number.isInteger(Number(settings.leaveMinMessages))
      ? Math.max(0, Number(settings.leaveMinMessages))
      : DEFAULT_JOIN_LEAVE_SETTINGS.leaveMinMessages
  };
}

function normalizeAutoKickSetting(setting) {
  if (!setting || typeof setting !== "object") return null;

  const count = Number(setting.count);
  const time = Number(setting.time);
  const action = setting.action === "ban" ? "ban" : "kick";

  if (!Number.isInteger(count) || count < 1) return null;
  if (!Number.isInteger(time) || time < 1) return null;

  return {
    enabled: setting.enabled === true,
    count,
    time,
    action
  };
}

function normalizeSlowModeSetting(setting) {
  const seconds = Number(setting?.seconds);

  if (!Number.isInteger(seconds) || seconds < 1) {
    return null;
  }

  return {
    seconds,
    updatedAt: typeof setting.updatedAt === "string" ? setting.updatedAt : new Date().toISOString()
  };
}

function normalizeActiveMute(setting, key) {
  if (!setting || typeof setting !== "object") return null;
  const [keyChatId, keyUserId] = String(key).split(":").map(Number);
  const chatId = Number(setting.chatId ?? keyChatId);
  const userId = Number(setting.userId ?? keyUserId);
  const expiresAt = String(setting.expiresAt || "");
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId) || !Number.isFinite(Date.parse(expiresAt))) return null;
  return {
    chatId,
    userId,
    expiresAt,
    displayName: String(setting.displayName || `ID:${userId}`),
    mutedBy: Number.isSafeInteger(Number(setting.mutedBy)) ? Number(setting.mutedBy) : null,
    createdAt: Number.isFinite(Date.parse(setting.createdAt)) ? String(setting.createdAt) : new Date().toISOString()
  };
}

function loadChatSettings() {
  try {
    if (!fs.existsSync(CHAT_SETTINGS_FILE)) {
      return {
        rules: new Map(),
        autoKickSettings: new Map(),
        joinLeaveSettings: new Map(),
        slowModeSettings: new Map(),
        activeMutes: new Map()
      };
    }

    const data = JSON.parse(fs.readFileSync(CHAT_SETTINGS_FILE, "utf8"));
    const rules = new Map();
    const loadedAutoKickSettings = new Map();
    const loadedJoinLeaveSettings = new Map();
    const loadedSlowModeSettings = new Map();
    const loadedActiveMutes = new Map();

    if (data?.rules && typeof data.rules === "object" && !Array.isArray(data.rules)) {
      for (const [chatId, text] of Object.entries(data.rules)) {
        const numericChatId = Number(chatId);

        if (Number.isFinite(numericChatId) && typeof text === "string" && text.trim()) {
          rules.set(numericChatId, text.trim());
        }
      }
    }

    if (data?.autoKickSettings && typeof data.autoKickSettings === "object" && !Array.isArray(data.autoKickSettings)) {
      for (const [chatId, setting] of Object.entries(data.autoKickSettings)) {
        const numericChatId = Number(chatId);
        const normalized = normalizeAutoKickSetting(setting);

        if (Number.isFinite(numericChatId) && normalized) {
          loadedAutoKickSettings.set(numericChatId, normalized);
        }
      }
    }

    if (data?.joinLeaveSettings && typeof data.joinLeaveSettings === "object" && !Array.isArray(data.joinLeaveSettings)) {
      for (const [chatId, setting] of Object.entries(data.joinLeaveSettings)) {
        const numericChatId = Number(chatId);

        if (Number.isFinite(numericChatId)) {
          loadedJoinLeaveSettings.set(numericChatId, normalizeJoinLeaveSettings(setting));
        }
      }
    }

    if (data?.slowModeSettings && typeof data.slowModeSettings === "object" && !Array.isArray(data.slowModeSettings)) {
      for (const [chatId, setting] of Object.entries(data.slowModeSettings)) {
        const numericChatId = Number(chatId);
        const normalized = normalizeSlowModeSetting(setting);

        if (Number.isFinite(numericChatId) && normalized) {
          loadedSlowModeSettings.set(numericChatId, normalized);
        }
      }
    }

    if (data?.activeMutes && typeof data.activeMutes === "object" && !Array.isArray(data.activeMutes)) {
      for (const [key, setting] of Object.entries(data.activeMutes)) {
        const normalized = normalizeActiveMute(setting, key);
        if (normalized) loadedActiveMutes.set(`${normalized.chatId}:${normalized.userId}`, normalized);
      }
    }

    return {
      rules,
      autoKickSettings: loadedAutoKickSettings,
      joinLeaveSettings: loadedJoinLeaveSettings,
      slowModeSettings: loadedSlowModeSettings,
      activeMutes: loadedActiveMutes
    };
  } catch (error) {
    console.error("Load chat settings error:", getErrorMessage(error));
    return {
      rules: new Map(),
      autoKickSettings: new Map(),
      joinLeaveSettings: new Map(),
      slowModeSettings: new Map(),
      activeMutes: new Map()
    };
  }
}

function saveChatSettings() {
  writeJsonFile(
    CHAT_SETTINGS_FILE,
    {
      rules: Object.fromEntries(chatRules),
      autoKickSettings: Object.fromEntries(autoKickSettings),
      joinLeaveSettings: Object.fromEntries(joinLeaveSettings),
      slowModeSettings: Object.fromEntries(slowModeSettings),
      activeMutes: Object.fromEntries(activeMutes)
    },
    "Save chat settings"
  );
}

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .map(([id, user]) => [Number(id), user])
        .filter(([id, user]) => Number.isFinite(id) && user && typeof user === "object")
    );
  } catch (error) {
    console.error("Load users error:", getErrorMessage(error));
    return new Map();
  }
}

function saveUsers() {
  deferredJsonWriter.schedule(USERS_FILE, () => Object.fromEntries(users), "Save users");
}

function loadAdminLogs() {
  try {
    if (!fs.existsSync(ADMIN_LOGS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(ADMIN_LOGS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .filter(([, logs]) => Array.isArray(logs))
        .map(([chatId, logs]) => [Number(chatId), logs.slice(0, 50)])
        .filter(([chatId]) => Number.isFinite(chatId))
    );
  } catch (error) {
    console.error("Load admin logs error:", getErrorMessage(error));
    return new Map();
  }
}

function saveAdminLogs() {
  writeJsonFile(ADMIN_LOGS_FILE, Object.fromEntries(adminLogs), "Save admin logs");
}

function getTashkentDateInfo() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) {
      return {
        messagesToday: 0,
        chatMessagesToday: {},
        lastResetDate: getTashkentDateInfo().date
      };
    }

    const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));

    return {
      messagesToday: Number(data.messagesToday) || 0,
      chatMessagesToday: data.chatMessagesToday && typeof data.chatMessagesToday === "object" ? data.chatMessagesToday : {},
      lastResetDate: data.lastResetDate || getTashkentDateInfo().date
    };
  } catch (error) {
    console.error("Load stats error:", getErrorMessage(error));
    return {
      messagesToday: 0,
      chatMessagesToday: {},
      lastResetDate: getTashkentDateInfo().date
    };
  }
}

function saveStats() {
  deferredJsonWriter.schedule(STATS_FILE, () => stats, "Save stats");
}

function loadChatInfo() {
  try {
    if (!fs.existsSync(CHATS_FILE)) {
      return new Map();
    }

    const data = JSON.parse(fs.readFileSync(CHATS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .map(([chatId, info]) => [Number(chatId), info])
        .filter(([chatId, info]) => Number.isFinite(chatId) && info && typeof info === "object")
    );
  } catch (error) {
    console.error("Load chats error:", getErrorMessage(error));
    return new Map();
  }
}

function saveChatInfo() {
  deferredJsonWriter.schedule(CHATS_FILE, () => Object.fromEntries(chatInfo), "Save chats");
}

function loadMarriages() {
  try {
    if (!fs.existsSync(MARRIAGES_FILE)) {
      writeJsonFile(MARRIAGES_FILE, {}, "Init marriages");
      return new Map();
    }

    const fileContent = fs.readFileSync(MARRIAGES_FILE, "utf8").trim();

    if (!fileContent) {
      writeJsonFile(MARRIAGES_FILE, {}, "Init marriages");
      return new Map();
    }

    const data = JSON.parse(fileContent);

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return new Map();
    }

    return new Map(
      Object.entries(data)
        .map(([chatId, chatMarriages]) => [Number(chatId), chatMarriages])
        .filter(([chatId, chatMarriages]) => Number.isFinite(chatId) && chatMarriages && typeof chatMarriages === "object" && !Array.isArray(chatMarriages))
    );
  } catch (error) {
    console.error("Load marriages error:", getErrorMessage(error));
    writeJsonFile(MARRIAGES_FILE, {}, "Reset marriages");
    return new Map();
  }
}

function saveMarriages() {
  writeJsonFile(MARRIAGES_FILE, Object.fromEntries(marriages), "Save marriages");
}

function loadMarriageQuotesState() {
  try {
    if (!fs.existsSync(MARRIAGE_QUOTES_STATE_FILE)) {
      const initialState = { nextIndex: 0 };
      writeJsonFile(MARRIAGE_QUOTES_STATE_FILE, initialState, "Init marriage quotes state");
      return initialState;
    }

    const data = JSON.parse(fs.readFileSync(MARRIAGE_QUOTES_STATE_FILE, "utf8"));
    const nextIndex = Number(data?.nextIndex);

    return {
      nextIndex: Number.isInteger(nextIndex) && nextIndex >= 0 ? nextIndex % loveQuotes.length : 0
    };
  } catch (error) {
    console.error("Load marriage quotes state error:", getErrorMessage(error));
    return { nextIndex: 0 };
  }
}

function saveMarriageQuotesState() {
  writeJsonFile(MARRIAGE_QUOTES_STATE_FILE, marriageQuotesState, "Save marriage quotes state");
}

function getNextLoveQuote() {
  const currentIndex = marriageQuotesState.nextIndex % loveQuotes.length;
  const quote = loveQuotes[currentIndex];

  marriageQuotesState.nextIndex = (currentIndex + 1) % loveQuotes.length;
  saveMarriageQuotesState();

  return quote;
}

function writeCommandSettings(settings) {
  writeJsonFile(COMMAND_SETTINGS_FILE, Object.fromEntries(settings), "Save command settings");
}

function loadCommandSettings() {
  const settings = new Map(DEFAULT_COMMAND_SETTINGS);

  try {
    if (!fs.existsSync(COMMAND_SETTINGS_FILE)) {
      writeCommandSettings(settings);
      return settings;
    }

    const data = JSON.parse(fs.readFileSync(COMMAND_SETTINGS_FILE, "utf8"));

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      writeCommandSettings(settings);
      return settings;
    }

    for (const [commandName] of DEFAULT_COMMAND_SETTINGS) {
      if (typeof data[commandName] === "boolean") {
        settings.set(commandName, data[commandName]);
      }
    }

    writeCommandSettings(settings);
  } catch (error) {
    console.error("Load command settings error:", getErrorMessage(error));
  }

  return settings;
}

function saveCommandSettings() {
  try {
    writeCommandSettings(commandSettings);
  } catch (error) {
    console.error("Save command settings error:", getErrorMessage(error));
  }
}

function getChatMarriages(chatId) {
  if (!marriages.has(chatId)) {
    marriages.set(chatId, {});
  }

  return marriages.get(chatId);
}

function getMarriagePartnerId(chatId, userId) {
  const chatMarriages = getChatMarriages(chatId);
  const marriage = chatMarriages[userId];

  if (!marriage) return null;

  const partnerId = typeof marriage === "object" && marriage !== null
    ? marriage.partnerId
    : marriage;

  return partnerId ? Number(partnerId) : null;
}

function getMarriageRecord(chatId, userId) {
  const chatMarriages = getChatMarriages(chatId);
  const marriage = chatMarriages[userId];

  if (!marriage) return null;

  if (typeof marriage === "object" && marriage !== null) {
    const partnerId = Number(marriage.partnerId);

    if (!Number.isFinite(partnerId)) return null;

    return {
      partnerId,
      marriedAt: typeof marriage.marriedAt === "string" ? marriage.marriedAt : null
    };
  }

  const partnerId = Number(marriage);

  if (!Number.isFinite(partnerId)) return null;

  return {
    partnerId,
    marriedAt: null
  };
}

function setMarriage(chatId, firstUserId, secondUserId) {
  const chatMarriages = getChatMarriages(chatId);
  const marriedAt = new Date().toISOString();
  chatMarriages[firstUserId] = { partnerId: secondUserId, marriedAt };
  chatMarriages[secondUserId] = { partnerId: firstUserId, marriedAt };
  saveMarriages();
}

function getAllMarriages(chatId) {
  const chatMarriages = getChatMarriages(chatId);
  const seenPairs = new Set();

  // В JSON каждый брак хранится в две стороны, поэтому для списка убираем дубликаты.
  return Object.entries(chatMarriages)
    .map(([firstUserId]) => {
      const numericFirstUserId = Number(firstUserId);
      const record = getMarriageRecord(chatId, numericFirstUserId);
      return [numericFirstUserId, record?.partnerId, record?.marriedAt || null];
    })
    .filter(([firstUserId, secondUserId]) => Number.isFinite(firstUserId) && Number.isFinite(secondUserId))
    .filter(([firstUserId, secondUserId]) => {
      const pairKey = [firstUserId, secondUserId].sort((a, b) => a - b).join(":");

      if (seenPairs.has(pairKey)) {
        return false;
      }

      seenPairs.add(pairKey);
      return true;
    })
    .map(([firstUserId, secondUserId, marriedAt]) => {
      const firstUser = users.get(firstUserId);
      const secondUser = users.get(secondUserId);

      return {
        user1_id: firstUserId,
        user1_name: getMarriageDisplayName(firstUser),
        user2_id: secondUserId,
        user2_name: getMarriageDisplayName(secondUser),
        married_at: marriedAt
      };
    });
}

function recordMarriageListDiagnostic(chatId, source, diagnostic) {
  const { error: diagnosticError, ...context } = diagnostic;
  const error = diagnosticError instanceof Error
    ? diagnosticError
    : new Error(`Marriage list diagnostic: ${diagnostic.code}`);
  const correlationId = recordRuntimeError(source, error, { chatId, ...context });
  console.error(`Marriage list error (${correlationId}):`, error.message);
}

function removeMarriage(chatId, userId) {
  const chatMarriages = getChatMarriages(chatId);
  const record = getMarriageRecord(chatId, userId);

  if (!record) return null;

  delete chatMarriages[userId];
  delete chatMarriages[record.partnerId];
  saveMarriages();

  return record.partnerId;
}

function createMarriageProposal(chatId, firstUserId, secondUserId) {
  const now = Date.now();
  for (const [id, proposal] of pendingMarriages) {
    if (proposal.expiresAt <= now) pendingMarriages.delete(id);
  }
  while (pendingMarriages.size >= MAX_PENDING_MARRIAGES) {
    pendingMarriages.delete(pendingMarriages.keys().next().value);
  }
  const proposalId = `${now}-${randomBytes(6).toString("hex")}`;

  pendingMarriages.set(proposalId, {
    chatId,
    firstUserId,
    secondUserId,
    expiresAt: now + 10 * 60 * 1000
  });

  return proposalId;
}

function getMarriageProposalText(senderName, recipientName, loveQuote) {
  return [
    "💍 ПРЕДЛОЖЕНИЕ БРАКА 💍",
    MARRIAGE_PROPOSAL_SEPARATOR,
    "",
    `👤 ${senderName} → ${recipientName}`,
    "",
    `"${loveQuote}"`,
    "",
    MARRIAGE_PROPOSAL_SEPARATOR,
    "Принимаешь предложение? 💌"
  ].join("\n");
}

const RP_COMMANDS = {
  "удар": { emoji: PREMIUM_EMOJI_FALLBACK.hit, customEmojiId: PREMIUM_EMOJI.hit, actionText: "ударил" },
  "ударить": { emoji: PREMIUM_EMOJI_FALLBACK.hit, customEmojiId: PREMIUM_EMOJI.hit, actionText: "ударил" },
  "убить": { emoji: PREMIUM_EMOJI_FALLBACK.kill, customEmojiId: PREMIUM_EMOJI.kill, actionText: "убил" },
  "пнуть": { emoji: "🦵", customEmojiId: PREMIUM_EMOJI.kick, actionText: "пнул" },
  "толкнуть": { emoji: "🤜", customEmojiId: PREMIUM_EMOJI.rp_tolknut, actionText: "толкнул" },
  "обнять": { emoji: PREMIUM_EMOJI_FALLBACK.hug, customEmojiId: PREMIUM_EMOJI.hug, actionText: "обнял" },
  "поцеловать": { emoji: PREMIUM_EMOJI_FALLBACK.kiss, customEmojiId: PREMIUM_EMOJI.kiss, actionText: "поцеловал" },
  "погладить": { emoji: "🐱", customEmojiId: PREMIUM_EMOJI.rp_pogladit, actionText: "погладил" },
  "укусить": { emoji: "😈", customEmojiId: PREMIUM_EMOJI.rp_ukusit, actionText: "укусил" },
  "ущипнуть": { emoji: "👌", customEmojiId: PREMIUM_EMOJI.rp_uschipnut, actionText: "ущипнул" },
  "защитить": { emoji: PREMIUM_EMOJI_FALLBACK.shield, customEmojiId: PREMIUM_EMOJI.shield, actionText: "защитил" },
  "спасти": { emoji: PREMIUM_EMOJI_FALLBACK.heart, customEmojiId: PREMIUM_EMOJI.heart, actionText: "спас" },
  "поддержать": { emoji: "🤝", customEmojiId: PREMIUM_EMOJI.rp_podderzhat, actionText: "поддержал" },
  "похвалить": { emoji: PREMIUM_EMOJI_FALLBACK.praise, customEmojiId: PREMIUM_EMOJI.praise, actionText: "похвалил" },
  "накормить": { emoji: "🍽️", customEmojiId: PREMIUM_EMOJI.rp_nakormit, actionText: "накормил" },
  "напоить": { emoji: "🥤", customEmojiId: PREMIUM_EMOJI.rp_napoit, actionText: "напоил" },
  "угостить": { emoji: "🍬", customEmojiId: PREMIUM_EMOJI.rp_ugostit, actionText: "угостил" },
  "подарить": { emoji: PREMIUM_EMOJI_FALLBACK.gift, customEmojiId: PREMIUM_EMOJI.gift, actionText: "подарил подарок" },
  "рассмешить": { emoji: "😂", customEmojiId: PREMIUM_EMOJI.rp_rassmeshit, actionText: "рассмешил" },
  "развеселить": { emoji: "🥳", customEmojiId: PREMIUM_EMOJI.rp_razveselit, actionText: "развеселил" },
  "удивить": { emoji: "😲", customEmojiId: PREMIUM_EMOJI.rp_udivit, actionText: "удивил" },
  "напугать": { emoji: "👻", customEmojiId: PREMIUM_EMOJI.rp_napugat, actionText: "напугал" },
  "разозлить": { emoji: "😡", customEmojiId: PREMIUM_EMOJI.rp_razozlit, actionText: "разозлил" },
  "простить": { emoji: "🕊️", customEmojiId: PREMIUM_EMOJI.rp_prostit, actionText: "простил" },
  "поздравить": { emoji: "🎉", customEmojiId: PREMIUM_EMOJI.rp_pozdravit, actionText: "поздравил" },
  "пожать руку": { emoji: "🤝", customEmojiId: PREMIUM_EMOJI.rp_pozhat_ruku, actionText: "пожал руку" },
  "дать пять": { emoji: "🙏", customEmojiId: PREMIUM_EMOJI.rp_dat_pyat, actionText: "дал пять" },
  "дать леща": { emoji: "🐟", customEmojiId: PREMIUM_EMOJI.rp_dat_lescha, actionText: "дал леща" },
  "дать подзатыльник": { emoji: "👋", customEmojiId: PREMIUM_EMOJI.rp_dat_podzatylnik, actionText: "дал подзатыльник" },
  "дать пендель": { emoji: "🦵", customEmojiId: PREMIUM_EMOJI.rp_dat_pendel, actionText: "дал пендель" },
  "облить водой": { emoji: "💧", customEmojiId: PREMIUM_EMOJI.rp_oblit_vodoy, actionText: "облил водой" },
  "закидать помидорами": { emoji: "🍅", customEmojiId: PREMIUM_EMOJI.rp_zakidat_pomidorami, actionText: "закидал помидорами" },
  "ударить рыбой": { emoji: "🐟", customEmojiId: PREMIUM_EMOJI.rp_udarit_ryboy, actionText: "ударил рыбой" },
  "кинуть тапок": { emoji: "🩴", customEmojiId: PREMIUM_EMOJI.rp_kinut_tapok, actionText: "кинул тапок" },
  "кинуть подушку": { emoji: "🛏️", customEmojiId: PREMIUM_EMOJI.rp_kinut_podushku, actionText: "кинул подушку" },
  "кинуть банан": { emoji: "🍌", customEmojiId: PREMIUM_EMOJI.rp_kinut_banan, actionText: "кинул банан" },
  "кинуть арбуз": { emoji: "🍉", customEmojiId: PREMIUM_EMOJI.rp_kinut_arbuz, actionText: "кинул арбуз" },
  "разбудить": { emoji: "⏰", customEmojiId: PREMIUM_EMOJI.rp_razbudit, actionText: "разбудил" },
  "усыпить": { emoji: "😴", customEmojiId: PREMIUM_EMOJI.rp_usypit, actionText: "усыпил" },
  "заморозить": { emoji: "🧊", customEmojiId: PREMIUM_EMOJI.rp_zamorozit, actionText: "заморозил" },
  "поджечь": { emoji: "🔥", customEmojiId: PREMIUM_EMOJI.rp_podzhech, actionText: "поджёг" },
  "заколдовать": { emoji: "🪄", customEmojiId: PREMIUM_EMOJI.rp_zakoldovat, actionText: "заколдовал" },
  "благословить": { emoji: "✨", customEmojiId: PREMIUM_EMOJI.rp_blagoslovit, actionText: "благословил" },
  "проклясть": { emoji: "🧿", customEmojiId: PREMIUM_EMOJI.rp_proklyast, actionText: "проклял" },
  "превратить": { emoji: "🐸", customEmojiId: PREMIUM_EMOJI.rp_prevratit, actionText: "превратил" },
  "телепортировать": { emoji: "🌀", customEmojiId: PREMIUM_EMOJI.rp_teleportirovat, actionText: "телепортировал" },
  "воскресить": { emoji: "💫", customEmojiId: PREMIUM_EMOJI.rp_voskresit, actionText: "воскресил" },
  "призвать дракона": { emoji: PREMIUM_EMOJI_FALLBACK.dragon, customEmojiId: PREMIUM_EMOJI.dragon, actionText: "призвал дракона" },
  "призвать феникса": { emoji: "🔥", customEmojiId: PREMIUM_EMOJI.rp_prizvat_feniksa, actionText: "призвал феникса" },
  "призвать хомяков": { emoji: "🐹", customEmojiId: PREMIUM_EMOJI.rp_prizvat_homyakov, actionText: "призвал хомяков" },
  "призвать пингвинов": { emoji: "🐧", customEmojiId: PREMIUM_EMOJI.rp_prizvat_pingvinov, actionText: "призвал пингвинов" },
  "призвать курицу": { emoji: "🐔", customEmojiId: PREMIUM_EMOJI.rp_prizvat_kuritsu, actionText: "призвал курицу" },
  "призвать уток": { emoji: "🦆", customEmojiId: PREMIUM_EMOJI.rp_prizvat_utok, actionText: "призвал уток" },
  "атаковать": { emoji: "⚔️", customEmojiId: PREMIUM_EMOJI.rp_atakovat, actionText: "атаковал" },
  "контратаковать": { emoji: "🗡️", customEmojiId: PREMIUM_EMOJI.rp_kontratakovat, actionText: "контратаковал" },
  "обезоружить": { emoji: "🛡️", customEmojiId: PREMIUM_EMOJI.rp_obezoruzhit, actionText: "обезоружил" },
  "оглушить": { emoji: "💥", customEmojiId: PREMIUM_EMOJI.rp_oglushit, actionText: "оглушил" },
  "перехитрить": { emoji: "🧠", customEmojiId: PREMIUM_EMOJI.rp_perehitrit, actionText: "перехитрил" },
  "победить": { emoji: "🏆", customEmojiId: PREMIUM_EMOJI.rp_pobedit, actionText: "победил" },
  "добить": { emoji: "🎯", customEmojiId: PREMIUM_EMOJI.rp_dobit, actionText: "добил" },
  "выгнать": { emoji: "🚪", customEmojiId: PREMIUM_EMOJI.rp_vygnat, actionText: "выгнал" },
  "прогнать": { emoji: "👋", customEmojiId: PREMIUM_EMOJI.rp_prognat, actionText: "прогнал" },
  "арестовать": { emoji: "🚓", customEmojiId: PREMIUM_EMOJI.rp_arestovat, actionText: "арестовал" },
  "допросить": { emoji: "🔎", customEmojiId: PREMIUM_EMOJI.rp_doprosit, actionText: "допросил" },
  "наградить": { emoji: "🏅", customEmojiId: PREMIUM_EMOJI.rp_nagradit, actionText: "наградил" },
  "короновать": { emoji: "👑", customEmojiId: PREMIUM_EMOJI.rp_koronovat, actionText: "короновал" },
  "сделать легендой": { emoji: "🏆", customEmojiId: PREMIUM_EMOJI.rp_sdelat_legendoy, actionText: "сделал легендой" },
  "сделать сигмой": { emoji: "🗿", customEmojiId: PREMIUM_EMOJI.rp_sdelat_sigmoy, actionText: "сделал сигмой" },
  "сделать альфой": { emoji: "🐺", customEmojiId: PREMIUM_EMOJI.rp_sdelat_alfoy, actionText: "сделал альфой" },
  "сделать npc": { emoji: "🤖", customEmojiId: PREMIUM_EMOJI.rp_sdelat_npc, actionText: "сделал NPC" },
  "сделать миллионером": { emoji: "💸", customEmojiId: PREMIUM_EMOJI.rp_sdelat_millionerom, actionText: "сделал миллионером" },
  "обанкротить": { emoji: "📉", customEmojiId: PREMIUM_EMOJI.rp_obankrotit, actionText: "обанкротил" },
  "отправить в космос": { emoji: PREMIUM_EMOJI_FALLBACK.rocket, customEmojiId: PREMIUM_EMOJI.rocket, actionText: "отправил в космос" },
  "отправить в minecraft": { emoji: "⛏️", customEmojiId: PREMIUM_EMOJI.rp_otpravit_v_minecraft, actionText: "отправил в Minecraft" },
  "отправить в roblox": { emoji: "🎮", customEmojiId: PREMIUM_EMOJI.rp_otpravit_v_roblox, actionText: "отправил в Roblox" },
  "отправить на работу": { emoji: "💼", customEmojiId: PREMIUM_EMOJI.rp_otpravit_na_rabotu, actionText: "отправил на работу" },
  "отправить учиться": { emoji: "📚", customEmojiId: PREMIUM_EMOJI.rp_otpravit_uchitsya, actionText: "отправил учиться" },
  "отправить мыть посуду": { emoji: "🧽", customEmojiId: PREMIUM_EMOJI.rp_otpravit_myt_posudu, actionText: "отправил мыть посуду" },
  "отправить за хлебом": { emoji: "🍞", customEmojiId: PREMIUM_EMOJI.rp_otpravit_za_hlebom, actionText: "отправил за хлебом" },
  "лишить вайфая": { emoji: "📵", customEmojiId: PREMIUM_EMOJI.rp_lishit_vayfaya, actionText: "лишил вайфая" },
  "лишить печеньки": { emoji: "🍪", customEmojiId: PREMIUM_EMOJI.rp_lishit_pechenki, actionText: "лишил печеньки" },
  "подарить цветы": { emoji: "💐", customEmojiId: PREMIUM_EMOJI.rp_podarit_tsvety, actionText: "подарил цветы" },
  "подарить шоколадку": { emoji: "🍫", customEmojiId: PREMIUM_EMOJI.rp_podarit_shokoladku, actionText: "подарил шоколадку" },
  "подарить кофе": { emoji: "☕", customEmojiId: PREMIUM_EMOJI.rp_podarit_kofe, actionText: "подарил кофе" },
  "подарить чай": { emoji: "🍵", customEmojiId: PREMIUM_EMOJI.rp_podarit_chay, actionText: "подарил чай" },
  "подарить мороженое": { emoji: "🍦", customEmojiId: PREMIUM_EMOJI.rp_podarit_morozhenoe, actionText: "подарил мороженое" },
  "подарить удачу": { emoji: "🍀", customEmojiId: PREMIUM_EMOJI.rp_podarit_udachu, actionText: "подарил удачу" },
  "подарить улыбку": { emoji: "😊", customEmojiId: PREMIUM_EMOJI.rp_podarit_ulybku, actionText: "подарил улыбку" },
  "согреть": { emoji: "🔥", customEmojiId: PREMIUM_EMOJI.rp_sogret, actionText: "согрел" },
  "охладить": { emoji: "❄️", customEmojiId: PREMIUM_EMOJI.rp_ohladit, actionText: "охладил" },
  "обидеть": { emoji: "💔", customEmojiId: PREMIUM_EMOJI.rp_obidet, actionText: "обидел" },
  "отомстить": { emoji: "😈", customEmojiId: PREMIUM_EMOJI.rp_otomstit, actionText: "отомстил" },
  "помириться": { emoji: "🤝", customEmojiId: PREMIUM_EMOJI.rp_pomiritsya, actionText: "помирился с" },
  "подружиться": { emoji: "👯", customEmojiId: PREMIUM_EMOJI.rp_podruzhitsya, actionText: "подружился с" },
  "пригласить гулять": { emoji: "🚶", customEmojiId: PREMIUM_EMOJI.rp_priglasit_gulyat, actionText: "пригласил гулять" },
  "пригласить в кино": { emoji: "🎬", customEmojiId: PREMIUM_EMOJI.rp_priglasit_v_kino, actionText: "пригласил в кино" },
  "станцевать": { emoji: "💃", customEmojiId: PREMIUM_EMOJI.rp_stantsevat, actionText: "станцевал для" },
  "похитить": { emoji: "🛸", customEmojiId: PREMIUM_EMOJI.rp_pohitit, actionText: "похитил" },
  "освободить": { emoji: "🗝️", customEmojiId: PREMIUM_EMOJI.rp_osvobodit, actionText: "освободил" },
  "поймать": { emoji: "🎣", customEmojiId: PREMIUM_EMOJI.rp_poymat, actionText: "поймал" },
  "спрятать": { emoji: "📦", customEmojiId: PREMIUM_EMOJI.rp_spryatat, actionText: "спрятал" },
  "найти": { emoji: "🔍", customEmojiId: PREMIUM_EMOJI.rp_nayti, actionText: "нашёл" },
  "выдать алмаз": { emoji: "💎", customEmojiId: PREMIUM_EMOJI.rp_vydat_almaz, actionText: "выдал алмаз" },
  "выдать платину": { emoji: "🏅", customEmojiId: PREMIUM_EMOJI.rp_vydat_platinu, actionText: "выдал платину" },
  "выдать легендарный лут": { emoji: "🧰", customEmojiId: PREMIUM_EMOJI.rp_vydat_legendarnyy_lut, actionText: "выдал легендарный лут" }
};

// Синхронизирует RP-команды с PREMIUM_EMOJI после загрузки env/JSON или автообучения через /emojiid.
function syncRpCommandEmojiIds() {
  for (const [commandName, commandData] of Object.entries(RP_COMMANDS)) {
    const matched = Object.entries(PREMIUM_EMOJI_FALLBACK)
      .find(([, emoji]) => emoji === commandData.emoji);
    const commandEmojiId = RP_COMMAND_PREMIUM_EMOJI[commandName] || "";
    const rpEmojiId = RP_PREMIUM_EMOJI[commandData.emoji] || "";

    if (!matched) {
      commandData.customEmojiId = commandEmojiId || rpEmojiId || commandData.customEmojiId || "";
      continue;
    }

    const [key] = matched;
    commandData.customEmojiId = commandEmojiId || rpEmojiId || PREMIUM_EMOJI[key] || commandData.customEmojiId || "";
  }
}

rpCommandsReady = true;
syncRpCommandEmojiIds();

// Возвращает имена RP-команд, которые используют указанный emoji.
function getRpCommandNamesByEmoji(emoji) {
  return Object.entries(RP_COMMANDS)
    .filter(([, commandData]) => commandData.emoji === emoji)
    .map(([commandName]) => commandName);
}

const RP_REPLY_HINT = [
  "🎭 Ответь на сообщение пользователя и напиши:",
  "ударить",
  "обнять",
  "поцеловать",
  "убить"
].join("\n");

// Отправляет RP-действие. Если customEmojiId заполнен, первый emoji в сообщении
// отправляется через Telegram MessageEntity custom_emoji; иначе уходит обычный emoji.
async function sendRpActionMessage(msg, command, commandData) {
  const userName = getTelegramName(msg.from);
  const targetName = getTelegramName(msg.reply_to_message.from);
  const emoji = commandData.emoji || "🎲";
  const selectionKey = `${msg.chat.id}:${msg.from.id}:${msg.reply_to_message.from.id}:${command}`;
  const actionText = buildRpText(rpPresentationSelector, selectionKey, userName, commandData.actionText, targetName);
  const text = `${emoji} | ${actionText}`;
  const normalizedCommand = command.replace(/\s+/g, "");
  const customEmojiId = rpPresentationSelector.choose([
    commandData.customEmojiId,
    RP_COMMAND_PREMIUM_EMOJI[command],
    RP_COMMAND_PREMIUM_EMOJI[normalizedCommand],
    RP_PREMIUM_EMOJI[emoji],
    savedPremiumEmojiIds.rp?.[emoji]
  ], `${selectionKey}:emoji`);

  console.log("RP:", command, customEmojiId);

  if (customEmojiId) {
    try {
      await bot.sendMessage(msg.chat.id, text, {
        entities: [
          {
            type: "custom_emoji",
            offset: 0,
            length: emoji.length,
            custom_emoji_id: customEmojiId
          }
        ],
        reply_parameters: { message_id: msg.message_id }
      });
      return;
    } catch (error) {
      console.error("RP premium emoji error:", getErrorMessage(error));
    }
  }

  await bot.sendMessage(msg.chat.id, text, {
    reply_parameters: { message_id: msg.message_id }
  });
}

const handledRpMessageIds = new Set();

function normalizeRpCommandText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/\s+/g, " ");
}

bot.on("message", async (msg) => {
  if (!msg?.text || !msg.from || msg.from.is_bot) return;
  if (msg.chat?.type === "private") return;

  const commandText = normalizeRpCommandText(msg.text);
  const compactCommandText = commandText.replace(/\s+/g, "");
  const commandData =
    RP_COMMANDS[commandText] ||
    RP_COMMANDS[compactCommandText];

  if (!commandData) return;
  if (!ensureCommandEnabled(msg, "action")) return;

  if (!msg.reply_to_message?.from || msg.reply_to_message.from.is_bot) {
    await bot.sendMessage(msg.chat.id, RP_REPLY_HINT, {
      reply_parameters: {
        message_id: msg.message_id
      }
    });

    return;
  }

  const messageKey = `${msg.chat.id}:${msg.message_id}`;

  if (handledRpMessageIds.has(messageKey)) {
    return;
  }

  handledRpMessageIds.add(messageKey);

  if (handledRpMessageIds.size > 2000) {
    handledRpMessageIds.delete(
      handledRpMessageIds.values().next().value
    );
  }

  registerUserInChat(msg);

  registerUserInChat({
    chat: msg.chat,
    from: msg.reply_to_message.from
  });

  incrementUserStat(msg.from, "rpActions", 1);

  await sendRpActionMessage(
    msg,
    commandText,
    commandData
  );
});

const DEFAULT_COMMAND_SETTINGS = [
  ["start", true],
  ["menu", true],
  ["commands", true],
  ["balance", true],
  ["dice", true],
  ["casino", true],
  ["quiz", true],
  ["quizstats", true],
  ["profile", true],
  ["top", true],
  ["admins", true],
  ["slowmode", true],
  ["lock", true],
  ["unlock", true],
  ["chat", true],
  ["topic", true],
  ["logs", true],
  ["stats", true],
  ["warn", true],
  ["unwarn", true],
  ["mute", true],
  ["unmute", true],
  ["kick", true],
  ["action", true],
  ["tagall", true],
  ["diagnostics", true],
  ["reportbug", true],
  ["ban", true],
  ["unban", true],
  ["clear", true],
  ["pin", true],
  ["unpin", true],
  ["messageid", true],
  ["emojiid", true],
  ["settitle", true],
  ["setdescription", true],
  ["invite", true],
  ["id", true],
  ["chatinfo", true],
  ["rules", true],
  ["setrules", true],
  ["resetlinks", true],
  ["autokick", true],
  ["tgadmin", true],
  ["joinleave", true],
  ["brak", true],
  ["razvod", true],
  ["partner", true],
  ["career", true],
];

const commandSettings = loadCommandSettings();

const HIDDEN_RPG_UI_SETTINGS = new Set([
  "balance",
  "profile",
  "brak",
  "razvod",
  "partner",
  "career",
  "action"
]);

function isCommandVisibleInUserInterface(commandName) {
  return isCommandEnabled(commandName) && !HIDDEN_RPG_UI_SETTINGS.has(commandName);
}

const groupCommands = [
  { command: "start", description: "🍦 запуск бота" },
  { command: "menu", description: "📋 меню" },
  { command: "commands", description: "📜 все команды" },
  { command: "balance", description: "💰 баланс монет" },
  { command: "dice", description: "🎲 кости на монеты" },
  { command: "casino", description: "🎰 слот-машина" },
  { command: "quiz", description: "❓ викторина" },
  { command: "profile", description: "👤 профиль" },
  { command: "top", description: "🏆 топ активных" },
  { command: "admins", description: "👑 список администраторов" },
  { command: "slowmode", description: "🐢 задержка сообщений" },
  { command: "lock", description: "🔒 закрыть чат" },
  { command: "unlock", description: "🔓 открыть чат" },
  { command: "chat", description: "💬 +чат / -чат" },
  { command: "topic", description: "🧵 +топик / -топик" },
  { command: "logs", description: "📋 логи админ-действий" },
  { command: "stats", description: "📊 статистика" },
  { command: "warn", description: "⚠️ предупреждение" },
  { command: "unwarn", description: "♻️ снять предупреждения" },
  { command: "mute", description: "🔇 мут" },
  { command: "unmute", description: "🔊 снять мут" },
  { command: "kick", description: "👢 кик" },
  { command: "ban", description: "🚫 бан" },
  { command: "unban", description: "✅ разбан" },
  { command: "pin", description: "📌 закрепить сообщение" },
  { command: "unpin", description: "📍 открепить сообщение" },
  { command: "emojiid", description: "💎 получить ID premium emoji" },
  { command: "settitle", description: "✏️ изменить название чата" },
  { command: "setdescription", description: "📝 описание чата" },
  { command: "invite", description: "🔗 ссылка на чат" },
  { command: "id", description: "🆔 информация об ID" },
  { command: "chatinfo", description: "ℹ️ информация о чате" },
  { command: "rules", description: "📜 правила группы" },
  { command: "setrules", description: "✍️ установить правила" },
  { command: "resetlinks", description: "♻️ сбросить ссылки" },
  { command: "autokick", description: "👢 автокик после выхода" },
  { command: "tgadmin", description: "👮 сетка +тг админ" },
  { command: "joinleave", description: "👋 +входы / +выходы" },
  { command: "brak", description: "💍 Брак" },
  { command: "razvod", description: "💔 Развод" },
  { command: "partner", description: "💞 Вторая половинка" },
  { command: "tagall", description: "📢 позвать всех участников" },
  { command: "tagpause", description: "⏸ приостановить вызов" },
  { command: "tagresume", description: "▶️ продолжить вызов" },
  { command: "tagstop", description: "⏹ остановить вызов" },
  { command: "quizstats", description: "🏆 статистика викторины" },
  { command: "diagnostics", description: "🩺 диагностика бота" },
  { command: "reportbug", description: "🐞 сообщить об ошибке" }
];

let botUsername = "";

bot.getMe().then((me) => {
  botUsername = me.username;
  botId = me.id;
}).catch((error) => {
  console.error("getMe error:", getErrorMessage(error));
});


async function setupBotCommands() {
  try {
    const privateCommands = [
      { command: "start", description: "🍦 добавить бота в группу" }
    ];
    const enabledGroupCommands = groupCommands.filter(({ command }) => isCommandVisibleInUserInterface(command));

    await bot.deleteMyCommands();
    await bot.deleteMyCommands({ scope: { type: "all_group_chats" } });
    await bot.deleteMyCommands({ scope: { type: "all_chat_administrators" } });
    await bot.deleteMyCommands({ scope: { type: "all_private_chats" } });

    await bot.setMyCommands(enabledGroupCommands, { scope: { type: "all_group_chats" } });
    await bot.setMyCommands(enabledGroupCommands, { scope: { type: "all_chat_administrators" } });
    await bot.setMyCommands(privateCommands, { scope: { type: "all_private_chats" } });
  } catch (error) {
    console.error("Ошибка меню команд:", getErrorMessage(error));
  }
}

setupBotCommands();

function getUser(user) {
  const id = user.id;
  let changed = false;
  const existingProfile = users.get(id);
  const identity = mergeTelegramIdentity(existingProfile, user);

  if (!existingProfile) {
    users.set(id, {
      ...identity,
      messages: 0,
      warnings: 0
    });
    changed = true;
  }

  const profile = users.get(id);
  for (const property of ["id", "firstName", "lastName", "username", "isBot"]) {
    if (profile[property] !== identity[property]) {
      profile[property] = identity[property];
      changed = true;
    }
  }

  if (typeof profile.messages !== "number") {
    profile.messages = Number(profile.messages) || 0;
    changed = true;
  }

  if (typeof profile.warnings !== "number") {
    profile.warnings = Number(profile.warnings) || 0;
    changed = true;
  }

  if (changed) {
    saveUsers();
  }

  return profile;
}

function isPrivateChat(msg) {
  return msg.chat.type === "private";
}

function registerUserInChat(msg) {
  if (!msg.from || !msg.chat) return;
  const profile = getUser(msg.from);
  if (isPrivateChat(msg)) return;

  const chatId = msg.chat.id;

  if (!chatUsers.has(chatId)) {
    chatUsers.set(chatId, new Set());
  }

  if (!chatInfo.has(chatId)) {
    chatInfo.set(chatId, {
      joinedAt: formatDateTime(),
      title: msg.chat.title || "Группа",
      type: msg.chat.type,
      users: []
    });
  }

  chatUsers.get(chatId).add(profile.id);

  const info = chatInfo.get(chatId);
  let changed = false;

  if (info.title !== (msg.chat.title || "Группа")) {
    info.title = msg.chat.title || "Группа";
    changed = true;
  }

  if (info.type !== msg.chat.type) {
    info.type = msg.chat.type;
    changed = true;
  }

  if (!Array.isArray(info.users)) {
    info.users = [];
    changed = true;
  }

  if (!info.users.includes(profile.id)) {
    info.users.push(profile.id);
    changed = true;
  }

  if (changed) {
    saveChatInfo();
  }
}

function getTelegramName(user) {
  if (!user) return "Пользователь";
  if (user.username) return `@${user.username}`;
  if (user.id) return `ID:${user.id}`;
  return user.first_name || "Пользователь";
}

function getUserDisplayName(profile) {
  if (profile.username && profile.username !== "нет") {
    return `@${profile.username}`;
  }
  return profile.firstName || `ID:${profile.id}`;
}

function getMarriageDisplayName(user) {
  return getPreferredTelegramName(user);
}

function getRussianPlural(value, one, few, many) {
  const absValue = Math.abs(Number(value));
  const lastTwo = absValue % 100;
  const lastOne = absValue % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (lastOne === 1) return one;
  if (lastOne >= 2 && lastOne <= 4) return few;
  return many;
}

function getJoinLeaveSettings(chatId) {
  if (!joinLeaveSettings.has(chatId)) {
    joinLeaveSettings.set(chatId, { ...DEFAULT_JOIN_LEAVE_SETTINGS });
    saveChatSettings();
    return joinLeaveSettings.get(chatId);
  }

  const current = joinLeaveSettings.get(chatId);
  const normalized = normalizeJoinLeaveSettings(current);

  if (
    current.joins !== normalized.joins ||
    current.leaves !== normalized.leaves ||
    current.leaveMinMessages !== normalized.leaveMinMessages
  ) {
    joinLeaveSettings.set(chatId, normalized);
    saveChatSettings();
  }

  return joinLeaveSettings.get(chatId);
}

function parseSlowModeDuration(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "0") {
    return 0;
  }

  const match = normalized.match(/^(\d+)(s|m)$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    return null;
  }

  const multiplier = match[2] === "m" ? 60 : 1;
  const seconds = amount * multiplier;

  if (seconds > 3600) {
    return null;
  }

  return seconds;
}

function formatSlowModeDuration(seconds) {
  if (seconds <= 0) return "0";
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function getSlowModeSetting(chatId) {
  return slowModeSettings.get(chatId) || null;
}

function setSlowModeSetting(chatId, seconds) {
  if (seconds <= 0) {
    slowModeSettings.delete(chatId);
    slowModeLastMessages.delete(chatId);
    saveChatSettings();
    return;
  }

  slowModeSettings.set(chatId, {
    seconds,
    updatedAt: new Date().toISOString()
  });
  saveChatSettings();
}

function getSlowModeUserKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function getSlowModeMessageKey(msg) {
  return `${msg.chat.id}:${msg.message_id}`;
}

function markSlowModeIgnored(msg) {
  const key = getSlowModeMessageKey(msg);
  ignoredSlowModeMessages.add(key);

  if (ignoredSlowModeMessages.size > 1000) {
    const firstKey = ignoredSlowModeMessages.values().next().value;
    ignoredSlowModeMessages.delete(firstKey);
  }
}

function isSlowModeIgnored(msg) {
  return ignoredSlowModeMessages.has(getSlowModeMessageKey(msg));
}

async function deleteMessageSafe(chatId, messageId, context = "deleteMessage") {
  try {
    await bot.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    console.error(`${context} error:`, getErrorMessage(error));
    return false;
  }
}

async function shouldBypassSlowMode(msg) {
  if (!msg.from || msg.from.is_bot) return true;
  return canUseAdminCommands(msg.chat.id, msg.from.id);
}

async function enforceSlowMode(msg) {
  if (!msg.chat || !msg.from || isPrivateChat(msg)) return false;
  if (msg.new_chat_members || msg.left_chat_member) return false;

  const setting = getSlowModeSetting(msg.chat.id);
  if (!setting || setting.seconds <= 0) return false;

  if (await shouldBypassSlowMode(msg)) return false;

  const now = Date.now();
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!slowModeLastMessages.has(chatId)) {
    slowModeLastMessages.set(chatId, new Map());
  }

  const chatLastMessages = slowModeLastMessages.get(chatId);
  if (chatLastMessages.size > 1000) {
    for (const [knownUserId, lastSeenAt] of chatLastMessages) {
      if (now - lastSeenAt > setting.seconds * 1000) chatLastMessages.delete(knownUserId);
    }
  }
  const lastMessageAt = chatLastMessages.get(userId) || 0;
  const elapsedSeconds = Math.floor((now - lastMessageAt) / 1000);

  if (lastMessageAt > 0 && elapsedSeconds < setting.seconds) {
    const remainingSeconds = setting.seconds - elapsedSeconds;
    markSlowModeIgnored(msg);
    await deleteMessageSafe(msg.chat.id, msg.message_id, "slowmodeDeleteMessage");
    await sendMessageSafe(
      msg.chat.id,
      `⏳ Подождите ещё ${remainingSeconds} секунд.`,
      { reply_parameters: { message_id: msg.message_id } },
      "slowmodeNotice"
    );
    return true;
  }

  chatLastMessages.set(userId, now);
  return false;
}

function getStatusLabel(status) {
  if (status === "creator") return "Владелец";
  if (status === "administrator") return "Админ";
  if (status === "member") return "Участник";
  if (status === "restricted") return "Ограничен";
  if (status === "left") return "Покинул группу";
  if (status === "kicked") return "Забанен";
  return "Неизвестно";
}

function getUserTag(user) {
  if (!user) return "Неизвестно";
  if (user.username) return `@${user.username}`;
  return `ID:${user.id}`;
}

function getFullName(user) {
  if (!user) return "Пользователь";
  const firstName = user.first_name || "";
  const lastName = user.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || "Пользователь";
}

function formatUnixDate(unixTime) {
  if (!unixTime) return "Telegram не показывает";

  const date = new Date(unixTime * 1000);
  const months = [
    "янв", "фев", "мар", "апр", "мая", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек"
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day} ${month} ${year} г., ${hours}:${minutes}`;
}

function formatDateTime(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function addAdminLog(chatId, action, adminUser, targetText, details = "") {
  if (!adminLogs.has(chatId)) {
    adminLogs.set(chatId, []);
  }

  const logs = adminLogs.get(chatId);

  logs.unshift({
    createdAt: new Date().toISOString(),
    date: formatDateTime(),
    action,
    admin: getTelegramName(adminUser),
    target: targetText,
    details
  });

  if (logs.length > 50) {
    logs.length = 50;
  }

  saveAdminLogs();
}

function getChatTitle(chatId) {
  const info = chatInfo.get(Number(chatId));
  return info?.title || `ID:${chatId}`;
}

function getKnownChatUserIds(chatId) {
  return [
    ...(chatUsers.has(chatId) ? Array.from(chatUsers.get(chatId)) : []),
    ...(chatInfo.get(chatId)?.users || [])
  ];
}

function formatAdminLogs(logs, options = {}) {
  return logs
    .slice(0, 15)
    .map((log, index) => {
      const chatText = options.showChat ? `\n   💬 Чат: ${getChatTitle(log.chatId)}` : "";
      const detailsText = log.details ? `\n   📝 ${log.details}` : "";

      return `${index + 1}. ${log.action}${chatText}\n   🕒 ${log.date}\n   👮 Админ: ${log.admin}\n   👤 Цель: ${log.target}${detailsText}`;
    })
    .join("\n\n");
}

function getAdminLogsText(chatId) {
  const logs = adminLogs.get(chatId) || [];

  if (logs.length === 0) {
    return "📋 Логи пока пустые.";
  }

  return "📋 Последние админ-действия:\n\n" + formatAdminLogs(logs);
}

function getAllAdminLogsText() {
  const logs = Array.from(adminLogs.entries())
    .flatMap(([chatId, chatLogs]) => chatLogs.map((log) => ({ ...log, chatId })))
    .sort((first, second) => {
      const firstTime = first.createdAt ? new Date(first.createdAt).getTime() : 0;
      const secondTime = second.createdAt ? new Date(second.createdAt).getTime() : 0;
      return secondTime - firstTime;
    });

  if (logs.length === 0) {
    return "📋 Логи пока пустые.";
  }

  return "📋 Последние админ-действия во всех группах:\n\n" + formatAdminLogs(logs, { showChat: true });
}

bot.onText(
  /^(?:\/stats(?:@\w+)?|стата|статистика)(?:\s|$)/i,
  async (msg) => {
    registerUserInChat(msg);

    if (!ensureCommandEnabled(msg, "stats")) {
      return;
    }

    let targetUser = msg.from;

    // Если команда отправлена ответом на сообщение
    if (msg.reply_to_message?.from) {
      targetUser = msg.reply_to_message.from;

      registerUserInChat({
        chat: msg.chat,
        from: targetUser
      });
    } else {
      // Если указан @username или Telegram ID
      const targetProfile = resolveTargetProfile(msg);

      if (targetProfile) {
        targetUser = {
          id: Number(targetProfile.id),
          first_name: targetProfile.firstName || "",
          last_name: targetProfile.lastName || "",
          username:
            targetProfile.username &&
              targetProfile.username !== "нет"
              ? targetProfile.username
              : ""
        };
      } else {
        const args = getCommandArgs(msg);

        if (args) {
          await bot.sendMessage(
            msg.chat.id,
            "⚠️ Пользователь не найден.\n\nИспользуй команду ответом на сообщение, через @username или Telegram ID.",
            {
              reply_parameters: {
                message_id: msg.message_id
              }
            }
          );

          return;
        }
      }
    }

    const text = getUserStatsText(targetUser);

    await bot.sendMessage(msg.chat.id, text, {
      reply_parameters: {
        message_id: msg.message_id
      }
    });
  }
);

function findUserByUsername(username) {
  const cleanUsername = username.replace("@", "").toLowerCase();

  return Array.from(users.values()).find((user) => {
    return (
      user.username &&
      user.username !== "нет" &&
      user.username.toLowerCase() === cleanUsername
    );
  });
}

function resetDailyStatsIfNeeded() {
  const current = getTashkentDateInfo();

  if (stats.lastResetDate !== current.date) {
    stats.messagesToday = 0;
    stats.chatMessagesToday = {};
    stats.lastResetDate = current.date;
    saveStats();
  }
}

function formatUserStatsDate(timestamp) {
  const value = Number(timestamp);

  if (!Number.isFinite(value) || value <= 0) {
    return "Нет данных";
  }

  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getUserStatsText(user) {
  const userStats = getOrCreateUserStats(user);

  const fullName = [
    userStats.firstName,
    userStats.lastName
  ]
    .filter(Boolean)
    .join(" ") || "Пользователь";

  const username = userStats.username
    ? `@${userStats.username}`
    : "Нет";

  return [
    "«СЛИВКИ»",
    "📊 СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ",
    "",
    `👤 Имя: ${fullName}`,
    `🏷 Username: ${username}`,
    `🆔 Telegram ID: ${userStats.telegramId}`,
    "",
    `💬 Сообщений: ${Number(userStats.messages) || 0}`,
    `⌨️ Команд: ${Number(userStats.commands) || 0}`,
    `🎭 RP-действий: ${Number(userStats.rpActions) || 0}`,
    "",
    `🏆 Побед в играх: ${Number(userStats.gameWins) || 0}`,
    `💔 Поражений в играх: ${Number(userStats.gameLosses) || 0}`,
    "",
    `🎰 Игр в казино: ${Number(userStats.casinoGames) || 0}`,
    `✅ Побед в казино: ${Number(userStats.casinoWins) || 0}`,
    `❌ Поражений в казино: ${Number(userStats.casinoLosses) || 0}`,
    "",
    `🧠 Ответов в викторине: ${Number(userStats.quizAnswers) || 0}`,
    `🎯 Правильных ответов: ${Number(userStats.quizCorrectAnswers) || 0}`,
    "",
    `⚠️ Варнов: ${Number(userStats.warnsReceived) || 0}`,
    `🔇 Мутов: ${Number(userStats.mutesReceived) || 0}`,
    `🚫 Банов: ${Number(userStats.bansReceived) || 0}`,
    `⭐ Репутация: ${Number(userStats.reputation) || 0}`,
    "",
    `📅 Регистрация: ${formatUserStatsDate(userStats.registeredAt)}`,
    `🕒 Последняя активность: ${formatUserStatsDate(userStats.lastActiveAt)}`
  ].join("\n");
}

  const seenUsersInThisGroup = chatUsers.has(chatId) ? chatUsers.get(chatId).size : 0;
  const messagesInThisGroup = stats.chatMessagesToday?.[chatId] || 0;

  function formatUserStatsDate(timestamp) {
    const value = Number(timestamp);

    if (!Number.isFinite(value) || value <= 0) {
      return "Нет данных";
    }

    return new Date(value).toLocaleString("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getUserStatsText(user) {
    const userStats = getOrCreateUserStats(user);

    const fullName = [
      userStats.firstName,
      userStats.lastName
    ]
      .filter(Boolean)
      .join(" ") || "Пользователь";

    const username = userStats.username
      ? `@${userStats.username}`
      : "Нет";

    return [
      "«СЛИВКИ»",
      "📊 СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ",
      "",
      `👤 Имя: ${fullName}`,
      `🏷 Username: ${username}`,
      `🆔 Telegram ID: ${userStats.telegramId}`,
      "",
      `💬 Сообщений: ${Number(userStats.messages) || 0}`,
      `⌨️ Команд: ${Number(userStats.commands) || 0}`,
      `🎭 RP-действий: ${Number(userStats.rpActions) || 0}`,
      "",
      `🏆 Побед в играх: ${Number(userStats.gameWins) || 0}`,
      `💔 Поражений в играх: ${Number(userStats.gameLosses) || 0}`,
      "",
      `🎰 Игр в казино: ${Number(userStats.casinoGames) || 0}`,
      `✅ Побед в казино: ${Number(userStats.casinoWins) || 0}`,
      `❌ Поражений в казино: ${Number(userStats.casinoLosses) || 0}`,
      "",
      `🧠 Ответов в викторине: ${Number(userStats.quizAnswers) || 0}`,
      `🎯 Правильных ответов: ${Number(userStats.quizCorrectAnswers) || 0}`,
      "",
      `⚠️ Варнов: ${Number(userStats.warnsReceived) || 0}`,
      `🔇 Мутов: ${Number(userStats.mutesReceived) || 0}`,
      `🚫 Банов: ${Number(userStats.bansReceived) || 0}`,
      `⭐ Репутация: ${Number(userStats.reputation) || 0}`,
      "",
      `📅 Регистрация: ${formatUserStatsDate(userStats.registeredAt)}`,
      `🕒 Последняя активность: ${formatUserStatsDate(userStats.lastActiveAt)}`
    ].join("\n");
  }


async function getAdminStatsText() {
  resetDailyStatsIfNeeded();

  return (
    "🍦 АДМИН-СТАТИСТИКА СЛИВКИ\n\n" +
    `🤖 Всего групп, где есть бот: ${chatInfo.size}\n\n` +
    `👤 Всего пользователей, которых видел бот: ${users.size}\n\n` +
    `💬 Всего сообщений сегодня: ${stats.messagesToday}`
  );
}

function resolveTargetProfile(msg) {
  if (msg.reply_to_message && msg.reply_to_message.from) {
    const targetProfile = getUser(msg.reply_to_message.from);
    registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });
    return targetProfile;
  }

  const parts = msg.text.trim().split(/\s+/);
  const target = parts[1];

  if (!target) return null;

  const cleanTarget = target.replace("@", "");

  if (/^\d+$/.test(cleanTarget)) {
    const userId = Number(cleanTarget);

    return users.get(userId) || {
      id: userId,
      firstName: `ID:${userId}`,
      username: "нет",
      messages: 0,
      warnings: 0
    };
  }

  return findUserByUsername(cleanTarget) || null;
}

function getCommandArgs(msg) {
  return (msg.text || "").trim().split(/\s+/).slice(1).join(" ").trim();
}

function resolveTargetIdentity(msg, argsText = getCommandArgs(msg)) {
  if (msg.reply_to_message?.from) {
    const profile = getUser(msg.reply_to_message.from);
    registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });

    return {
      userId: profile.id,
      profile,
      token: String(profile.id),
      displayName: getUserDisplayName(profile)
    };
  }

  const parts = argsText.split(/\s+/).filter(Boolean);
  const token = (
    parts.find((part) => part.startsWith("@") || /^\d+$/.test(part)) ||
    parts.find((part) => /^[A-Za-z0-9_]{5,32}$/.test(part))
  );

  if (!token) return null;

  const cleanToken = token.replace("@", "");

  if (/^\d+$/.test(cleanToken)) {
    const userId = Number(cleanToken);
    const profile = users.get(userId) || {
      id: userId,
      firstName: `ID:${userId}`,
      username: "нет",
      messages: 0,
      warnings: 0
    };

    return {
      userId,
      profile,
      token,
      displayName: getUserDisplayName(profile)
    };
  }

  const profile = findUserByUsername(cleanToken);

  if (!profile) return null;

  return {
    userId: profile.id,
    profile,
    token,
    displayName: getUserDisplayName(profile)
  };
}

async function isUserAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

function isOwner(userId) {
  return ownerIds.includes(Number(userId));
}

async function ensureOwnerOnlyGroupCommand(msg, commandName) {
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    await sendMessageSafe(msg.chat.id, `👤 Команда /${commandName} работает только в группах.`);
    return false;
  }

  if (!isOwner(msg.from.id)) {
    await sendMessageSafe(msg.chat.id, "⛔ Эта команда доступна только владельцу бота.");
    return false;
  }

  return true;
}

function isCommandEnabled(commandName) {
  return commandSettings.get(commandName) !== false;
}

function getCommandStatus(commandName) {
  return isCommandEnabled(commandName) ? "ON ✅" : "OFF ❌";
}

const COMMAND_SETTINGS_PAGE_SIZE = 8;

function getCommandSettingsPageCount() {
  return Math.max(1, Math.ceil(commandSettings.size / COMMAND_SETTINGS_PAGE_SIZE));
}

function getSafeCommandSettingsPage(page = 0) {
  return Math.min(
    Math.max(Number(page) || 0, 0),
    getCommandSettingsPageCount() - 1
  );
}

function getAdminPanelText() {
  return "🍦 АДМИН-ПАНЕЛЬ СЛИВКИ\n\n" +
    "📊 Статистика\n" +
    "⚙️ Команды\n" +
    "📜 Логи\n" +
    "🛡 Модерация\n" +
    "👥 Пользователи\n\n" +
    "❌ Закрыть";
}

function getAdminPanelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📊 Статистика", callback_data: "admin_stats" }],
        [{ text: "⚙️ Команды", callback_data: "admin_commands" }],
        [{ text: "📜 Логи", callback_data: "admin_logs" }],
        [{ text: "🛡 Модерация", callback_data: "admin_moderation" }],
        [{ text: "👥 Пользователи", callback_data: "admin_users" }],
        [{ text: "❌ Закрыть", callback_data: "admin_close" }]
      ]
    }
  };
}

function getCommandSettingsKeyboard(page = 0) {
  const safePage = getSafeCommandSettingsPage(page);
  const pageCount = getCommandSettingsPageCount();
  const prevPage = safePage === 0 ? pageCount - 1 : safePage - 1;
  const nextPage = safePage === pageCount - 1 ? 0 : safePage + 1;
  const commandNames = Array.from(commandSettings.keys()).slice(
    safePage * COMMAND_SETTINGS_PAGE_SIZE,
    safePage * COMMAND_SETTINGS_PAGE_SIZE + COMMAND_SETTINGS_PAGE_SIZE
  );

  const rows = commandNames.map((commandName) => [
    {
      text: `/${commandName} — ${getCommandStatus(commandName)}`,
      callback_data: `toggle_command:${commandName}:${safePage}`
    }
  ]);

  rows.push([
    { text: "⬅️", callback_data: `admin_commands_page:${prevPage}` },
    { text: `📄 ${safePage + 1}/${pageCount}`, callback_data: `admin_commands_page:${safePage}` },
    { text: "➡️", callback_data: `admin_commands_page:${nextPage}` }
  ]);

  rows.push([{ text: "🔙 Назад", callback_data: "admin_back" }]);

  return {
    reply_markup: {
      inline_keyboard: rows
    }
  };
}

function getBackKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Назад", callback_data: "admin_back" }]
      ]
    }
  };
}

function getAdminCommandsText(page = 0) {
  const safePage = getSafeCommandSettingsPage(page);
  const pageCount = getCommandSettingsPageCount();

  return `⚙️ УПРАВЛЕНИЕ КОМАНДАМИ • ${safePage + 1}/${pageCount}\n\n` +
    "Нажми на команду, чтобы включить или выключить её.\n\n" +
    "✅ ON — команда работает\n" +
    "❌ OFF — команда выключена";
}

function getAdminModerationText() {
  return "🛡 МОДЕРАЦИЯ\n\n" +
    "⚠️ /warn — выдать предупреждение\n" +
    "♻️ /unwarn — снять предупреждения\n" +
    "🔇 /mute — выдать мут\n" +
    "🔊 /unmute — снять мут\n" +
    "👢 /kick — кикнуть пользователя\n" +
    "🚫 /ban — забанить пользователя\n" +
    "✅ /unban — разбанить пользователя\n" +
    "🐢 /slowmode — задержка сообщений\n" +
    "🔒 /lock — закрыть чат\n" +
    "🔓 /unlock — открыть чат\n" +
    "🧹 /clear — очистить сообщения";
}

function getAdminUsersText(chatId) {
  const groupUsers = chatUsers.has(chatId) ? chatUsers.get(chatId).size : 0;

  return "👥 ПОЛЬЗОВАТЕЛИ И ГРУППЫ\n\n" +
    `🤖 Групп, где есть бот: ${chatInfo.size}\n` +
    `👤 Всего пользователей, которых видел бот: ${users.size}\n` +
    `👥 Пользователей в этой группе, которых видел бот: ${groupUsers}\n\n` +
    "ℹ️ Telegram не отдаёт боту полный список пользователей. Бот показывает тех, кого уже видел.";
}

function replyCommandDisabled(msg, commandName) {
  bot.sendMessage(
    msg.chat.id,
    [
      "🔕 Функция временно выключена",
      "",
      `🍦 Команда /${commandName} сейчас недоступна.`,
      "👮 Админ отключил её на время.",
      "",
      "✨ Попробуй позже."
    ].join("\n")
  );
}

function ensureCommandEnabled(msg, commandName) {
  if (isCommandEnabled(commandName)) return true;

  replyCommandDisabled(msg, commandName);
  return false;
}

async function ensureGroupAdminCommand(msg, commandName, options = {}) {
  registerUserInChat(msg);

  if (!ensureCommandEnabled(msg, commandName)) return false;

  if (isPrivateChat(msg)) {
    await sendMessageSafe(
      msg.chat.id,
      options.privateText || `👤 Добавь меня в группу, чтобы пользоваться командой /${commandName}.`
    );
    return false;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    await sendMessageSafe(
      msg.chat.id,
      options.noAccessText || `⛔ Вы не админ, поэтому не можете пользоваться командой /${commandName}.`
    );
    return false;
  }

  return true;
}

async function canUseAdminCommands(chatId, userId) {
  if (isOwner(userId)) return true;
  return isUserAdmin(chatId, userId);
}

async function getBotIdentity() {
  if (botId) return { id: botId, username: botUsername };

  const me = await bot.getMe();
  botId = me.id;
  botUsername = me.username || botUsername;

  return me;
}

function hasBotAdminPermission(botMember, permission) {
  if (botMember.status === "creator") return true;
  if (botMember.status !== "administrator") return false;
  return botMember[permission] === true;
}

async function canBotUsePermission(chatId, permission) {
  try {
    const me = await getBotIdentity();
    const botMember = await bot.getChatMember(chatId, me.id);
    return hasBotAdminPermission(botMember, permission);
  } catch (error) {
    console.error(`Bot permission check error (${permission}):`, getErrorMessage(error));
    return false;
  }
}

const nukeService = new NukeService({
  bot,
  ownerIds,
  getBotIdentity,
  canBotUsePermission,
  getKnownChatUserIds,
  getStoredUser: (userId) => users.get(Number(userId)),
  getChatTitle,
  addAdminLog,
  getErrorMessage
});

const emergencyNukeService = new EmergencyNukeService({
  bot,
  nukeService,
  ownerIds,
  getBotIdentity,
  canBotUsePermission,
  getChatTitle,
  getErrorMessage
});

const randomPicksService = new RandomPicksService({
  bot,
  getKnownChatUserIds,
  getStoredUser: (userId) => users.get(Number(userId)),
  getUserDisplayName,
  isUserAdmin,
  getErrorMessage
});

registerRandomPickCommands(bot, randomPicksService, {
  registerUserInChat,
  isPrivateChat
});

async function canBotChangeSlowMode(chatId) {
  return canBotUsePermission(chatId, "can_restrict_members");
}

function getTelegramFailureReason(error) {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes("not enough rights") || lower.includes("have no rights") || lower.includes("need administrator rights")) {
    return "У бота не хватает нужных прав администратора.";
  }

  if (lower.includes("user is an administrator") || lower.includes("can't restrict chat owner") || lower.includes("can't remove chat owner")) {
    return "Telegram не разрешает применять это действие к владельцу или администратору.";
  }

  if (lower.includes("message to delete not found") || lower.includes("message can't be deleted")) {
    return "Telegram не дал удалить это сообщение: оно уже удалено, слишком старое или у бота нет права удаления.";
  }

  if (lower.includes("chat not found")) {
    return "Чат не найден или бот больше не состоит в нём.";
  }

  if (lower.includes("bot was blocked")) {
    return "Пользователь заблокировал бота, поэтому личное сообщение отправить нельзя.";
  }

  if (lower.includes("too many requests") || lower.includes("retry after")) {
    return "Telegram временно ограничил частоту запросов. Повтори действие чуть позже.";
  }

  return `Ответ Telegram: ${message}`;
}

function getActionErrorText(actionText, error, hint = "") {
  const parts = [
    `⚠️ Не удалось ${actionText}.`,
    "",
    getTelegramFailureReason(error)
  ];

  if (hint) {
    parts.push("", hint);
  }

  return parts.join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTelegramResultError(actionText, result) {
  return new Error(`${actionText}: Telegram API не подтвердил успешное выполнение (${JSON.stringify(result)})`);
}

async function banChatMemberConfirmed(chatId, userId, options = {}) {
  const result = await bot.banChatMember(chatId, userId, options);

  if (result === false) {
    throw createTelegramResultError("banChatMember", result);
  }

  await sleep(250);

  const member = await bot.getChatMember(chatId, userId);

  if (member.status !== "kicked") {
    throw createTelegramResultError("banChatMember", { status: member.status });
  }

  return true;
}

async function verifyBannedMember(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === "kicked";
  } catch (error) {
    console.error(`Verify banned member error (${userId}):`, getErrorMessage(error));
    return false;
  }
}

async function getChatCreatorId(chatId) {
  try {
    const admins = await bot.getChatAdministrators(chatId);
    const creator = admins.find((member) => member.status === "creator");
    return creator?.user?.id || null;
  } catch (error) {
    console.error("Get chat creator error:", getErrorMessage(error));
    return null;
  }
}

function getBotPermissionText(actionText, permissionText) {
  return [
    `⚠️ Не могу ${actionText}.`,
    "",
    "Боту нужны права администратора:",
    `✅ ${permissionText}`
  ].join("\n");
}

async function ensureBotPermission(msg, permission, permissionText, actionText) {
  const allowed = await canBotUsePermission(msg.chat.id, permission);

  if (allowed) return true;

  await sendMessageSafe(
    msg.chat.id,
    getBotPermissionText(actionText, permissionText),
    {},
    `missingBotPermission:${permission}`
  );
  return false;
}

async function ensureModeratableTarget(msg, targetProfile, actionText) {
  if (targetProfile.id === msg.from.id) {
    return `⛔ Нельзя ${actionText} самого себя.`;
  }

  try {
    await getBotIdentity();
  } catch (error) {
    console.error("Bot identity check error:", getErrorMessage(error));
  }

  if (botId && targetProfile.id === botId) {
    return `⛔ Нельзя ${actionText} самого бота.`;
  }

  const targetIsAdmin = await isUserAdmin(msg.chat.id, targetProfile.id);

  if (targetIsAdmin) {
    return `⛔ Нельзя ${actionText} администратора или владельца группы. Telegram не даст выполнить это действие.`;
  }

  return null;
}

async function applyMuteVerified(chatId, userId, untilDate) {
  const result = await bot.restrictChatMember(chatId, userId, getMutedPermissions(), {
    until_date: untilDate,
    use_independent_chat_permissions: true
  });
  if (result !== true) throw createTelegramResultError("restrictChatMember", result);
  await sleep(MUTE_VERIFY_DELAY_MS);
  const member = await bot.getChatMember(chatId, userId);
  if (!isMuteApplied(member)) {
    throw createTelegramResultError("mute verification", describeMemberRestrictions(member));
  }
  return member;
}

async function liftMuteVerified(chatId, userId) {
  const result = await bot.restrictChatMember(chatId, userId, getFullPermissions(), {
    use_independent_chat_permissions: true
  });
  if (result !== true) throw createTelegramResultError("restrictChatMember", result);
  await sleep(MUTE_VERIFY_DELAY_MS);
  const member = await bot.getChatMember(chatId, userId);
  if (!isMuteLifted(member)) {
    throw createTelegramResultError("unmute verification", describeMemberRestrictions(member));
  }
  return member;
}

function clearMuteState(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const timer = muteTimers.get(key);
  if (timer) clearTimeout(timer);
  muteTimers.delete(key);
  if (activeMutes.delete(key)) saveChatSettings();
}

function scheduleMuteExpiration(record) {
  const key = `${record.chatId}:${record.userId}`;
  const previous = muteTimers.get(key);
  if (previous) clearTimeout(previous);
  const remainingMs = Math.max(0, Date.parse(record.expiresAt) - Date.now());
  const delayMs = Math.min(remainingMs, MAX_NODE_TIMER_MS);
  const timer = setTimeout(async () => {
    muteTimers.delete(key);
    if (Date.parse(record.expiresAt) > Date.now()) {
      scheduleMuteExpiration(record);
      return;
    }
    try {
      await liftMuteVerified(record.chatId, record.userId);
      clearMuteState(record.chatId, record.userId);
      await sendMessageSafe(record.chatId, `🔊 С пользователя ${record.displayName} снят мут: срок ограничения закончился.`);
    } catch (error) {
      console.error(`Automatic unmute failed (${key}):`, getErrorMessage(error));
      const retryTimer = setTimeout(() => scheduleMuteExpiration(record), MUTE_RETRY_DELAY_MS);
      retryTimer.unref?.();
      muteTimers.set(key, retryTimer);
    }
  }, delayMs);
  timer.unref?.();
  muteTimers.set(key, timer);
}

async function restoreActiveMutes() {
  for (const record of activeMutes.values()) scheduleMuteExpiration(record);
}

async function ensureOwnerModeratableTarget(msg, targetProfile, actionText) {
  if (targetProfile.id === msg.from.id) {
    return `⛔ Нельзя ${actionText} самого себя.`;
  }

  try {
    await getBotIdentity();
  } catch (error) {
    console.error("Bot identity check error:", getErrorMessage(error));
  }

  if (botId && targetProfile.id === botId) {
    return `⛔ Нельзя ${actionText} самого бота.`;
  }

  return null;
}

async function getChatPermissionsWithSlowMode(chatId, seconds) {
  try {
    const chat = await bot.getChat(chatId);
    const currentPermissions = chat.permissions || {};

    return {
      can_send_messages: currentPermissions.can_send_messages !== false,
      can_send_audios: currentPermissions.can_send_audios !== false,
      can_send_documents: currentPermissions.can_send_documents !== false,
      can_send_photos: currentPermissions.can_send_photos !== false,
      can_send_videos: currentPermissions.can_send_videos !== false,
      can_send_video_notes: currentPermissions.can_send_video_notes !== false,
      can_send_voice_notes: currentPermissions.can_send_voice_notes !== false,
      can_send_polls: currentPermissions.can_send_polls !== false,
      can_send_other_messages: currentPermissions.can_send_other_messages !== false,
      can_add_web_page_previews: currentPermissions.can_add_web_page_previews !== false,
      can_react_to_messages: currentPermissions.can_react_to_messages !== false,
      can_change_info: currentPermissions.can_change_info === true,
      can_invite_users: currentPermissions.can_invite_users !== false,
      can_pin_messages: currentPermissions.can_pin_messages === true,
      can_manage_topics: currentPermissions.can_manage_topics === true
    };
  } catch {
    return {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_react_to_messages: true,
      can_change_info: false,
      can_invite_users: true,
      can_pin_messages: false,
      can_manage_topics: false
    };
  }
}

async function getCurrentSlowModeDelay(chatId) {
  try {
    const chat = await bot.getChat(chatId);
    return chat.slow_mode_delay || 0;
  } catch {
    return 0;
  }
}

function getLockedChatPermissions(slowModeDelay = 0) {
  return {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_react_to_messages: false,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function getUnlockedChatPermissions(slowModeDelay = 0) {
  return {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_react_to_messages: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function addActivity(user) {
  const profile = getUser(user);
  profile.messages += 1;
  saveUsers();
  return profile;
}

function parseMuteDuration(text) {
  const parts = text.trim().split(/\s+/);
  const durationPart = parts.find((part, index) => {
    return index > 0 && /^\d+(s|m|d)$/i.test(part);
  });

  if (!durationPart) return null;

  const match = durationPart.match(/^(\d+)(s|m|d)$/i);
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isInteger(value) || value < 1) return null;

  if (unit === "s") return { seconds: value, label: `${value} секунд` };
  if (unit === "m") return { seconds: value * 60, label: `${value} минут` };
  if (unit === "d") return { seconds: value * 24 * 60 * 60, label: `${value} дней` };

  return null;
}

function getGroupMenuText() {
  return "✅ Я так рад, что меня добавили!\n\n" +
    "Пока я признаю команды только админов этого чата.\n\n" +
    "⚙️ Со списком всех команд можно ознакомиться в нашей статье.\n\n" +
    "⚪️ В целях безопасности от спама в чате по умолчанию установлен лимит одновременных инвайтов в 30 человек.\n\n" +
    "— Если вы хотите изменить этот лимит, введите:\n" +
    "инвайты {число}\n\n" +
    "Где число может быть 0 — это отключит лимит.\n\n" +
    "Остались вопросы? Можете обратиться в наш официальный чат.";
}

function getMainMenuText() {
  const menuItems = [
    ["profile", "👤 Профиль: /profile"],
    ["top", "🏆 Топ: /top"],
    ["commands", "🛡 Модерация: /commands"]
  ]
    .filter(([commandName]) => isCommandVisibleInUserInterface(commandName))
    .map(([, text]) => text);

  const quickActions = [
    ["warn", "⚠️ /warn — предупреждение"],
    ["mute", "🔇 /mute 10m — мут"],
    ["kick", "👢 /kick — кик"],
    ["ban", "🚫 /ban — бан"]
  ]
    .filter(([commandName]) => isCommandEnabled(commandName))
    .map(([, text]) => text);

  const sections = ["📋 Главное меню"];

  if (menuItems.length > 0) {
    sections.push(menuItems.join("\n"));
  }

  if (quickActions.length > 0) {
    sections.push("✨ Быстрые действия\n" + quickActions.join("\n"));
  }

  if (isCommandEnabled("commands")) {
    sections.push("📜 Полный список команд: /commands");
  }

  return sections.join("\n\n");
}


const COMMANDS_PAGES = [
  {
    title: "📜 Список команд • 1/4",
    subtitle: "🍦 Основные команды",
    commands: [
      { setting: "menu", sticker: "📋", command: "/menu", description: "главное меню" },
      { setting: "commands", sticker: "📜", command: "/commands", description: "красивый список команд" },
      { setting: "balance", sticker: "💰", command: "/balance", description: "баланс монет" },
      { setting: "dice", sticker: "🎲", command: "/dice 10", description: "кости на ставку" },
      { setting: "casino", sticker: "🎰", command: "/casino 10", description: "слот-машина на ставку" },
      { setting: "quiz", sticker: "❓", command: "/quiz", description: "викторина за монеты" },
      { setting: "quizstats", sticker: "🏆", command: "/quizstats", description: "рейтинг викторины" },
      { setting: "menu", sticker: "🆘", command: "/help", description: "как пользоваться командами" },
      { setting: "profile", sticker: "👤", command: "/profile", description: "профиль пользователя" },
      { setting: "top", sticker: "🏆", command: "/top", description: "топ активных участников" },
      { setting: "admins", sticker: "👑", command: "/admins", description: "список администраторов" },
      { setting: "stats", sticker: "📊", command: "/stats", description: "статистика пользователя" },
      { setting: "logs", sticker: "📋", command: "/logs", description: "логи админ-действий" },
      { setting: "id", sticker: "🆔", command: "/id", description: "ID пользователя или сообщения" },
      { setting: "emojiid", sticker: "💎", command: "/emojiid", description: "ID Premium Emoji из ответа" },
      { setting: "chatinfo", sticker: "ℹ️", command: "/chatinfo", description: "информация о группе" },
      { setting: "tagall", sticker: "📢", command: "/tagall или тег все", description: "позвать всех по одному" },
      { setting: "tagall", sticker: "⏸", command: "/tagpause /tagresume", description: "управление вызовом" },
      { setting: "tagall", sticker: "⏹", command: "/tagstop или /stopcall", description: "остановить вызов" }
    ]
  },
  {
    title: "🛡 Модерация • 2/4",
    subtitle: "⚔️ Команды для админов",
    commands: [
      { setting: "warn", sticker: "⚠️", command: "/warn", description: "выдать предупреждение" },
      { setting: "unwarn", sticker: "♻️", command: "/unwarn", description: "снять предупреждения" },
      { setting: "mute", sticker: "🔇", command: "/mute 10m", description: "выдать мут" },
      { setting: "unmute", sticker: "🔊", command: "/unmute", description: "снять мут" },
      { setting: "kick", sticker: "👢", command: "/kick", description: "кикнуть пользователя" },
      { setting: "ban", sticker: "🚫", command: "/ban", description: "забанить пользователя" },
      { setting: "unban", sticker: "✅", command: "/unban", description: "разбанить пользователя" },
      { setting: "clear", sticker: "🧹", command: "/clear 10", description: "удалить сообщения" },
      { setting: "pin", sticker: "📌", command: "/pin или !пин", description: "закрепить сообщение" },
      { setting: "unpin", sticker: "📍", command: "/unpin или !анпин", description: "открепить сообщение" }
    ]
  },
  {
    title: "⚙️ Настройки • 3/4",
    subtitle: "🔧 Управление группой",
    commands: [
      { setting: "slowmode", sticker: "🐢", command: "/slowmode 10s", description: "задержка сообщений" },
      { setting: "lock", sticker: "🔒", command: "/lock", description: "закрыть чат" },
      { setting: "unlock", sticker: "🔓", command: "/unlock", description: "открыть чат" },
      { setting: "chat", sticker: "💬", command: "+чат / -чат", description: "открыть или закрыть чат" },
      { setting: "topic", sticker: "🧵", command: "+топик / -топик", description: "открыть или закрыть топик" },
      { setting: "settitle", sticker: "✏️", command: "/settitle", description: "изменить название чата" },
      { setting: "setdescription", sticker: "📝", command: "/setdescription", description: "изменить описание чата" },
      { setting: "invite", sticker: "🔗", command: "/invite", description: "получить ссылку-приглашение" },
      { setting: "rules", sticker: "📖", command: "/rules", description: "правила группы" },
      { setting: "setrules", sticker: "✍️", command: "/setrules", description: "установить правила" }
    ]
  },
  {
    title: "🎮 Дополнительно • 4/4",
    subtitle: "💎 Игры и полезные функции",
    commands: [
      { setting: "resetlinks", sticker: "♻️", command: "/resetlinks", description: "сбросить ссылки" },
      { setting: "autokick", sticker: "👢", command: "/autokick", description: "автокик после выхода" },
      { setting: "tgadmin", sticker: "👮", command: "+тг админ", description: "выдать админку в чатах" },
      { setting: "joinleave", sticker: "👋", command: "+входы / -входы", description: "уведомления о входах" },
      { setting: "joinleave", sticker: "🚪", command: "+выходы / -выходы", description: "уведомления о выходах" },
      { setting: "joinleave", sticker: "🔔", command: "+входы-выходы", description: "включить оба уведомления" },
      { setting: "brak", sticker: "💍", command: "/brak или брак", description: "игровой брак" },
      { setting: "brak", sticker: "💒", command: "браки", description: "список браков в чате" },
      { setting: "brak", sticker: "🏡", command: "семья", description: "карточка игровой семьи" },
      { setting: "brak", sticker: "💞", command: "любовь", description: "ежедневная любовь партнёру" },
      { setting: "career", sticker: "💼", command: "работать", description: "заработать монеты для семьи" },
      { setting: "career", sticker: "📋", command: "профессии", description: "список карьер" },
      { setting: "career", sticker: "🔁", command: "сменить профессию", description: "выбрать карьеру" },
      { setting: "razvod", sticker: "💔", command: "/razvod или развод", description: "игровой развод" },
      { setting: "partner", sticker: "💞", command: "/partner", description: "показать вторую половинку" },
      { setting: "reportbug", sticker: "🐞", command: "/reportbug", description: "сообщить об ошибке" },
      { setting: "diagnostics", sticker: "🩺", command: "/diagnostics", description: "диагностика для владельца" },
      { setting: "action", sticker: "🎭", command: "ударить / обнять / убить", description: "ролевые действия ответом" },
      { sticker: "🎲", command: "сливки шанс", description: "рандомная вероятность" },
      { sticker: "🏆", command: "сливки кто лучший", description: "выбрать случайного участника" }
    ]
  }
];

function getVisibleCommands(pageData) {
  return pageData.commands.filter((item) => {
    return !item.setting || isCommandVisibleInUserInterface(item.setting);
  });
}

function getCommandsText(page = 0) {
  const safePage = Math.min(Math.max(Number(page) || 0, 0), COMMANDS_PAGES.length - 1);
  const pageData = COMMANDS_PAGES[safePage];
  const visibleCommands = getVisibleCommands(pageData);

  const commandsText = visibleCommands
    .map((item, index) => {
      const number = String(index + 1).padStart(2, "0");
      return `${number}. ${item.sticker} ${item.command}\n    └ ${item.description}`;
    })
    .join("\n\n") || "На этой странице все команды выключены.";

  return [
    "🍦 СЛИВКИ БОТ",
    pageData.title,
    pageData.subtitle,
    "",
    commandsText,
    "",
    "🧩 Как использовать:",
    "↩️ ответом на сообщение",
    "🏷 через @username",
    "🆔 через ID пользователя",
    "",
    "✨ Пример: /mute @username 10m"
  ].join("\n");
}

function getCommandsKeyboard(page = 0) {
  const safePage = Math.min(Math.max(Number(page) || 0, 0), COMMANDS_PAGES.length - 1);
  const prevPage = safePage === 0 ? COMMANDS_PAGES.length - 1 : safePage - 1;
  const nextPage = safePage === COMMANDS_PAGES.length - 1 ? 0 : safePage + 1;

  return {
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        COMMANDS_PAGES.map((_, index) => ({
          text: safePage === index ? `🔘 ${index + 1}` : `⚪️ ${index + 1}`,
          callback_data: `commands_page:${index}`
        })),
        [
          { text: "⬅️", callback_data: `commands_page:${prevPage}` },
          { text: `📄 ${safePage + 1}/${COMMANDS_PAGES.length}`, callback_data: `commands_page:${safePage}` },
          { text: "➡️", callback_data: `commands_page:${nextPage}` }
        ],
        [{ text: "❌ Закрыть", callback_data: "commands_close" }]
      ]
    }
  };
}

function getHelpText() {
  return "🆘 Как пользоваться командами\n\n" +
    "✅ Самый удобный способ — ответом на сообщение пользователя.\n\n" +
    "1️⃣ Ответом на сообщение\n" +
    "Нажми на сообщение пользователя → Ответить → напиши команду:\n\n" +
    "/warn — выдать предупреждение\n" +
    "/mute 10m — дать мут на 10 минут\n" +
    "/unmute — снять мут\n" +
    "/kick — кикнуть из группы\n" +
    "/ban — забанить\n\n" +
    "/pin — закрепить сообщение\n" +
    "/unpin — открепить сообщение\n" +
    "смс ид — узнать ID сообщения\n\n" +
    "2️⃣ Через username\n" +
    "Если у пользователя есть username:\n\n" +
    "/warn @username\n" +
    "/mute @username 10m\n" +
    "/ban @username\n\n" +
    "⚠️ Важно: через @username команда работает только если бот уже видел этого пользователя в группе.\n\n" +
    "3️⃣ Через Telegram ID\n" +
    "Если знаешь ID пользователя:\n\n" +
    "/warn 123456789\n" +
    "/mute 123456789 10m\n" +
    "/ban 123456789\n\n" +
    "📌 Закрепление сообщений\n" +
    "Ответь на сообщение и напиши:\n" +
    "/pin или !пин\n\n" +
    "Или закрепи по ID сообщения:\n" +
    "/pin 1234 или !пин 1234\n\n" +
    "Чтобы узнать ID сообщения, ответь на него текстом:\n" +
    "смс ид\n\n" +
    "Открепить сообщение:\n" +
    "/unpin или !анпин\n\n" +
    "⏰ Формат времени для мута\n" +
    "1s — 1 секунда\n" +
    "1m — 1 минута\n" +
    "1d — 1 день\n\n" +
    "Примеры:\n" +
    "/mute 10m\n" +
    "/mute @username 1d\n\n" +
    "📋 Полный список команд: /commands\n" +
    "📌 Главное меню: /menu";
}


function getGroupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📜 Статья с командами", url: "https://t.me/slivki_bot" }],
        [{ text: "💬 Официальный чат", url: "https://t.me/slivki_chat" }]
      ]
    }
  };
}

function isBestUserQuestion(text) {
  const cleanText = text.trim();
  return /^(?:сливки\s+)?кто\s+(?:(?:сам(?:ый|ая)\s+)?лучш(?:ий|ая|ее)|лучше\s+всех)(?:\s+(?:в\s+чате|тут|здесь|сегодня))?[?!]*$/i.test(cleanText);
}

function getSlivkiWhoSubject(text) {
  const match = String(text || "").trim().match(/^сливки\s+кто\s+(.+?)\s*[?!]*$/i);
  return match?.[1]?.trim() || "";
}

function getRandomChatUser(chatId, excludeUserId = null) {
  const knownUserIds = chatUsers.has(chatId)
    ? Array.from(chatUsers.get(chatId))
    : (chatInfo.get(chatId)?.users || []);

  const candidates = knownUserIds
    .map((userId) => users.get(Number(userId)))
    .filter((user) => user && !user.isBot && user.id !== excludeUserId);

  if (candidates.length === 0) return null;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

bot.onText(/^\/start(?:@([A-Za-z0-9_]{5,32}))?(?:\s|$)/i, async (msg, match) => {
  if (!await isCommandAddressedToThisBot(match?.[1])) return;

  getUser(msg.from);
  if (!ensureCommandEnabled(msg, "start")) return;
  registerUserInChat(msg);

  if (isPrivateChat(msg)) {
    if (!botUsername) {
      try {
        const me = await getBotIdentity();
        botUsername = me.username;
      } catch (error) {
        console.error("Start getMe error:", getErrorMessage(error));
        bot.sendMessage(msg.chat.id, "⚠️ Не удалось получить данные бота. Попробуй позже.");
        return;
      }
    }

    bot.sendMessage(
      msg.chat.id,
      "🍦 Привет! Я «Сливки Бот»\n\nЧтобы активировать мои команды, добавь меня в группу и дай права администратора.\n\nВ группе доступны:\n\n⛑ инструменты для модерации;\n\n⚠️ предупреждения пользователей;\n\n🔇 мут и снятие мута;\n\n🚫 бан и разбан участников;\n\n📋 удобное меню команд;\n\n👋 уведомления о входе и выходе участников;",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "➕ Добавить в группу",
                url: `https://t.me/${botUsername}?startgroup=true`
              }
            ],
            [
              {
                text: "💬 Поддержка",
                callback_data: "support_open"
              }
            ]
          ]
        }
      }
    );
    return;
  }

  bot.sendMessage(
    msg.chat.id,
    getGroupMenuText(),
    getGroupKeyboard()
  );
});

bot.onText(/^\/admin(?:@\w+)?(?:\s|$)/i, (msg) => {
  getUser(msg.from);

  if (!isPrivateChat(msg)) return;

  if (!isOwner(msg.from.id)) {
    bot.sendMessage(msg.chat.id, "⛔ У вас нет доступа к админ-панели.");
    return;
  }

  bot.sendMessage(msg.chat.id, getAdminPanelText(), getAdminPanelKeyboard());
});

bot.onText(/^\/nuke(?:@\w+)?(?:\s+(\S+))?\s*$/i, async (msg, match) => {
  if (!isOwner(msg.from?.id)) return;

  registerUserInChat(msg);
  await nukeService.confirmManualNuke(msg, match?.[1] || "");
});

function getBetValidationError(user, bet, commandName) {
  const balance = currencyStore.getBalance(user);

  if (balance <= 0) {
    return "💰 На балансе 0 монет. Попробуй заработать монеты в викторине.";
  }

  if (!bet) {
    return `💰 Укажи ставку целым числом.\n\nПример: /${commandName} 10\nТвой баланс: ${balance} монет.`;
  }

  if (bet > balance) {
    return `💰 Недостаточно монет для ставки ${bet}.\n\nТвой баланс: ${balance} монет.`;
  }

  return "";
}

function createGameReplayToken() {
  return randomBytes(8).toString("hex");
}

function createGameKeyboard(gameType, bet, userId) {
  const code = gameType === "dice" ? "d" : "c";
  return {
    reply_markup: {
      inline_keyboard: [[{
        text: "Сыграть ещё",
        callback_data: `bet:${code}:${bet}:${userId}:${createGameReplayToken()}`
      }]]
    }
  };
}

function settleGameRound(user, gameType, bet, operationId) {
  const generated = gameType === "dice" ? playDice() : playCasino();
  const settlement = currencyStore.settleBet(user, {
    operationId,
    bet,
    multiplier: generated.multiplier,
    metadata: generated
  });
  if (!settlement) return null;
  return { settlement, result: settlement.metadata };
}

function formatGameRound(gameType, round) {
  const { settlement, result } = round;
  const title = gameType === "dice" ? "🎲 КОСТЬ" : "🎰 КАЗИНО";
  const visual = gameType === "dice" ? `Выпало: ${result.roll}` : result.slots.join("  ");
  const outcome = settlement.won
    ? `✅ Победа\n💵 Выплата: ${settlement.payout} монет\n📈 Чистый выигрыш: +${settlement.payout - settlement.bet} монет`
    : `❌ Поражение\n📉 Проигрыш: ${settlement.bet} монет`;
  return [
    title,
    "",
    visual,
    "",
    `Ставка: ${settlement.bet} монет`,
    `Баланс до: ${settlement.balanceBefore} монет`,
    `Коэффициент: x${settlement.multiplier}`,
    outcome,
    `Баланс после: ${settlement.balanceAfter} монет`
  ].join("\n");
}

bot.onText(/^дай\s+мне(?:\s|$).*$/i, async (msg) => {
  try {
    const result = ownerEconomyCommandService.execute(msg);
    if (result.responseText) await bot.sendMessage(msg.chat.id, result.responseText);
  } catch (error) {
    const correlationId = recordRuntimeError("owner_economy_command", error, {
      chatType: msg.chat?.type,
      fromId: msg.from?.id,
      selectedAccount: msg.from?.id ? `currency_store:user:${msg.from.id}` : null
    });
    await sendMessageSafe(
      msg.chat.id,
      `❌ Не удалось начислить монеты. Код диагностики: ${correlationId}`,
      {},
      "ownerEconomyCommandFailure"
    );
  }
});

bot.onText(/^\/(?:balance|баланс)(?:@\w+)?(?:\s|$)/i, (msg) => {
  getUser(msg.from);
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "balance")) return;

  const balance = currencyStore.getBalance(msg.from);

  bot.sendMessage(
    msg.chat.id,
    `💰 Баланс: ${balance} монет`,
    { reply_parameters: { message_id: msg.message_id } }
  );
});

function resolvePaymentRecipient(msg, targetToken) {
  if (!targetToken) {
    return msg.reply_to_message?.from ? getUser(msg.reply_to_message.from) : null;
  }
  if (/^@?[A-Za-z0-9_]{5,32}$/.test(targetToken) && !/^\d+$/.test(targetToken)) {
    return findUserByUsername(targetToken);
  }
  if (/^\d+$/.test(targetToken)) {
    const userId = Number(targetToken);
    return Number.isSafeInteger(userId) ? users.get(userId) || null : null;
  }
  return null;
}

bot.onText(/^\/pay(?:@[A-Za-z0-9_]{5,32})?(?:\s|$)/i, async (msg) => {
  getUser(msg.from);
  registerUserInChat(msg);
  let payment;
  let receiver;
  try {
    const parsed = parsePayCommand(msg.text);
    receiver = resolvePaymentRecipient(msg, parsed.targetToken);
    if (!receiver && !parsed.targetToken && !msg.reply_to_message?.from) {
      throw new PaymentError(
        "RECIPIENT_REQUIRED",
        "⚠️ Укажите получателя ответом на сообщение, через @username или Telegram ID."
      );
    }
    const operationId = `pay:${msg.chat.id}:${msg.message_id}`;
    payment = paymentService.transfer({
      sender: msg.from,
      receiver,
      amount: parsed.amount,
      operationId,
      idempotencyKey: operationId,
      correlationId: operationId
    });
  } catch (error) {
    if (error instanceof PaymentError) {
      await sendMessageSafe(
        msg.chat.id,
        error.userMessage,
        { reply_parameters: { message_id: msg.message_id } },
        "payValidation"
      );
      return;
    }
    const correlationId = recordRuntimeError("pay.transfer", error, {
      chatId: msg.chat.id,
      senderId: msg.from.id,
      receiverId: receiver?.id || null
    });
    await sendMessageSafe(
      msg.chat.id,
      `❌ Не удалось выполнить перевод. Код диагностики: ${correlationId}`,
      { reply_parameters: { message_id: msg.message_id } },
      "payTransferFailure"
    );
    return;
  }

  await sendMessageSafe(
    msg.chat.id,
    payment.senderText,
    { reply_parameters: { message_id: msg.message_id } },
    "paySenderReceipt"
  );
  if (!payment.operation.replayed) {
    try {
      await bot.sendMessage(receiver.id, payment.receiverText);
    } catch (error) {
      const correlationId = recordRuntimeError("pay.notification", error, {
        operationId: payment.operation.operationId,
        senderId: msg.from.id,
        receiverId: receiver.id
      });
      console.error(`Pay notification error (${correlationId}):`, getErrorMessage(error));
    }
  }
});

bot.onText(/^\/dice(?:@\w+)?(?:\s+(\S+))?\s*$/i, async (msg, match) => {
  getUser(msg.from);
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "dice")) return;

  const bet = parseBet(match?.[1]);
  const validationError = getBetValidationError(msg.from, bet, "dice");

  if (validationError) {
    bot.sendMessage(msg.chat.id, validationError, { reply_parameters: { message_id: msg.message_id } });
    return;
  }

  const round = settleGameRound(msg.from, "dice", bet, `dice:${msg.chat.id}:${msg.message_id}`);
  if (!round) return bot.sendMessage(msg.chat.id, getBetValidationError(msg.from, bet, "dice"));
  if (round.settlement.replayed) return;
  await bot.sendMessage(msg.chat.id, formatGameRound("dice", round), {
    reply_parameters: { message_id: msg.message_id },
    ...createGameKeyboard("dice", bet, msg.from.id)
  });
});

bot.onText(/^\/casino(?:@\w+)?(?:\s+(\S+))?\s*$/i, async (msg, match) => {
  getUser(msg.from);
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "casino")) return;

  const bet = parseBet(match?.[1]);
  const validationError = getBetValidationError(msg.from, bet, "casino");

  if (validationError) {
    bot.sendMessage(msg.chat.id, validationError, { reply_parameters: { message_id: msg.message_id } });
    return;
  }

  const round = settleGameRound(msg.from, "casino", bet, `casino:${msg.chat.id}:${msg.message_id}`);
  if (!round) return bot.sendMessage(msg.chat.id, getBetValidationError(msg.from, bet, "casino"));
  if (round.settlement.replayed) return;
  await bot.sendMessage(msg.chat.id, formatGameRound("casino", round), {
    reply_parameters: { message_id: msg.message_id },
    ...createGameKeyboard("casino", bet, msg.from.id)
  });
});

const QUIZ_CATEGORY_ALIASES = Object.freeze({
  наука: "science", география: "geography", история: "history", литература: "literature",
  технологии: "technology", математика: "math", культура: "culture", спорт: "sport"
});
const QUIZ_DIFFICULTY_ALIASES = Object.freeze({ легко: "easy", средне: "medium", сложно: "hard" });

function parseQuizFilters(value) {
  const tokens = String(value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  let category;
  let difficulty;
  for (const token of tokens) {
    const normalizedCategory = CATEGORY_LABELS[token] ? token : QUIZ_CATEGORY_ALIASES[token];
    const normalizedDifficulty = DIFFICULTY_LABELS[token] ? token : QUIZ_DIFFICULTY_ALIASES[token];
    if (normalizedCategory) category = normalizedCategory;
    else if (normalizedDifficulty) difficulty = normalizedDifficulty;
    else return { error: `Неизвестный фильтр: ${token}` };
  }
  return { category, difficulty };
}

function scheduleQuizExpiration(quiz) {
  const previous = quizTimers.get(quiz.id);
  if (previous) clearTimeout(previous);
  const delay = Math.min(Math.max(0, Date.parse(quiz.expiresAt) - Date.now()), MAX_NODE_TIMER_MS);
  const timer = setTimeout(async () => {
    quizTimers.delete(quiz.id);
    if (Date.parse(quiz.expiresAt) > Date.now()) return scheduleQuizExpiration(quiz);
    const result = quizManager.expireQuiz(quiz.id);
    if (result.status !== "expired" || !result.quiz.messageId) return;
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: result.quiz.chatId, message_id: result.quiz.messageId
    }).catch(() => { });
    await sendMessageSafe(
      result.quiz.chatId,
      `⏰ Время викторины истекло.\nПравильный ответ: ${result.quiz.question.options[result.quiz.question.correctIndex]}`
    );
  }, delay);
  timer.unref?.();
  quizTimers.set(quiz.id, timer);
}

function restoreQuizTimers() {
  for (const quiz of quizManager.getActiveQuizzes()) scheduleQuizExpiration(quiz);
}

bot.onText(/^\/quiz(?:@\w+)?(?:\s+([\s\S]+?))?\s*$/i, async (msg, match) => {
  getUser(msg.from);
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "quiz")) return;
  const filters = parseQuizFilters(match?.[1]);
  if (filters.error) {
    await bot.sendMessage(msg.chat.id, `${filters.error}\n\nКатегории: ${Object.keys(CATEGORY_LABELS).join(", ")}\nСложность: easy, medium, hard`);
    return;
  }
  const { quizId, question, expiresAt } = quizManager.createQuiz(msg.chat.id, filters);
  const sent = await bot.sendMessage(
    msg.chat.id,
    [
      "❓ Викторина",
      `📚 Категория: ${CATEGORY_LABELS[question.category]}`,
      `🎚 Сложность: ${DIFFICULTY_LABELS[question.difficulty]}`,
      `⏱ Время: ${Math.round((Date.parse(expiresAt) - Date.now()) / 1000)} секунд`, "",
      question.question,
      "",
      `Первый правильный ответ получит ${QUIZ_REWARD} монет.`
    ].join("\n"),
    {
      reply_parameters: { message_id: msg.message_id },
      ...quizManager.getKeyboard(quizId, question)
    }
  );
  quizManager.setMessageRef(quizId, msg.chat.id, sent.message_id);
  const activeQuiz = quizManager.getActiveQuizzes().find((quiz) => quiz.id === quizId);
  if (activeQuiz) scheduleQuizExpiration(activeQuiz);
});

bot.onText(/^\/quizstats(?:@\w+)?(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "quizstats")) return;
  const leaders = quizManager.getLeaderboard(10);
  const lines = leaders.map((entry, index) => `${index + 1}. ${entry.name} — ${entry.correct}/${entry.answers}`);
  await bot.sendMessage(msg.chat.id, ["🏆 Лучшие игроки викторины", "", ...(lines.length ? lines : ["Пока нет результатов."])].join("\n"));
});

async function collectDiagnostics(msg) {
  const checks = [];
  try {
    const me = await bot.getMe();
    checks.push(diagnosticCheck("Telegram API", Boolean(me?.id), `getMe: @${me?.username || me?.id}`));
    if (!isPrivateChat(msg)) {
      try {
        const member = await bot.getChatMember(msg.chat.id, me.id);
        const isAdmin = member.status === "administrator" || member.status === "creator";
        const capabilities = getBotAdminCapabilities(member, msg.chat);
        checks.push(diagnosticCheck(
          "Permissions",
          isAdmin,
          isAdmin
            ? [
              `status=${capabilities.status}`,
              `can_promote_members=${capabilities.canPromoteMembers}`,
              `chat_type=${capabilities.chatType}`,
              `выдаваемые права=${capabilities.safeGrantableRights.join(", ") || "нет"}`
            ].join("; ")
            : `status=${member.status}; chat_type=${msg.chat.type}; административные команды недоступны`,
          isAdmin ? "ok" : "warning"
        ));
      } catch (error) {
        checks.push(diagnosticCheck("Permissions", false, getErrorMessage(error)));
      }
    } else {
      checks.push(diagnosticCheck("Permissions", true, "личный чат: административные права не требуются", "warning"));
    }
  } catch (error) {
    checks.push(diagnosticCheck("Telegram API", false, getErrorMessage(error)));
    checks.push(diagnosticCheck("Permissions", false, "getMe завершился ошибкой"));
  }

  checks.push(...inspectRpgArchitecture(__dirname));
  checks.push(...inspectRpgRuntime(RPG_STATE_FILE));
  checks.push(...inspectJsonFiles([
    USERS_FILE, CHATS_FILE, STATS_FILE, MARRIAGES_FILE, CHAT_SETTINGS_FILE, COMMAND_SETTINGS_FILE,
    ADMIN_LOGS_FILE, CURRENCY_FILE, QUIZ_STATE_FILE, PREMIUM_EMOJI_FILE, BUG_REPORTS_FILE
  ]));
  checks.push(inspectStorage(__dirname));
  checks.push(inspectPremiumEmoji({ ...PREMIUM_EMOJI, ...RP_PREMIUM_EMOJI, ...RP_COMMAND_PREMIUM_EMOJI }));
  const economyHealth = currencyStore.healthCheck();
  checks.push(diagnosticCheck("Economy Repository", economyHealth.ok, economyHealth.detail));
  const activeQuizCount = quizManager.getActiveQuizzes().length;
  const legacyTimersHealthy = [...activeMutes.keys()].every((key) => muteTimers.has(key)) && quizTimers.size >= activeQuizCount;
  checks.push(diagnosticCheck(
    "Legacy Scheduler",
    legacyTimersHealthy,
    `mute records/timers=${activeMutes.size}/${muteTimers.size}; quiz records/timers=${activeQuizCount}/${quizTimers.size}; tag=${tagCallController.has(msg.chat.id) ? "active" : "idle"}`
  ));
  checks.push(diagnosticCheck(
    "Callback routing",
    callbackHandlerCount > 0,
    `защищённых обработчиков=${callbackHandlerCount}; idempotency cache=${processedCallbackQueries.size}`
  ));
  return checks;
}

bot.onText(/^\/diagnostics(?:@\w+)?\s*$/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "diagnostics")) return;
  if (!isOwner(msg.from.id)) {
    await sendMessageSafe(msg.chat.id, "⛔ Диагностика доступна только владельцу бота.");
    return;
  }
  const status = await sendMessageSafe(msg.chat.id, "🩺 Выполняю диагностику…", { reply_parameters: { message_id: msg.message_id } });
  const text = formatDiagnostics(await collectDiagnostics(msg));
  if (status?.message_id) {
    try {
      await bot.editMessageText(text, { chat_id: msg.chat.id, message_id: status.message_id });
      return;
    } catch (error) {
      console.error("Diagnostics edit error:", getErrorMessage(error));
    }
  }
  await sendMessageSafe(msg.chat.id, text);
});

bot.onText(/^\/reportbug(?:@\w+)?(?:\s+([\s\S]+))?\s*$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "reportbug")) return;
  const repliedText = String(msg.reply_to_message?.text || msg.reply_to_message?.caption || "").trim();
  const description = String(match?.[1] || (repliedText ? `Ошибка в сообщении: ${repliedText}` : "")).trim().slice(0, 1500);
  if (!description) {
    await sendMessageSafe(
      msg.chat.id,
      "🐞 Добавьте описание после команды или ответьте /reportbug на проблемное сообщение.",
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }
  const relatedError = [...runtimeErrors].reverse().find((entry) =>
    Number(entry.context?.chatId) === Number(msg.chat.id) || Number(entry.context?.userId) === Number(msg.from.id)
  );
  const reportId = `bug-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
  const correlationId = relatedError?.correlationId || `report-${randomBytes(8).toString("hex")}`;
  const reportedText = repliedText || String(msg.text || "");
  const report = {
    id: reportId,
    chat: { id: msg.chat.id, type: msg.chat.type, title: msg.chat.title || null },
    message: {
      id: msg.message_id,
      threadId: msg.message_thread_id || null,
      replyToMessageId: msg.reply_to_message?.message_id || null,
      text: reportedText.slice(0, 2000)
    },
    command: reportedText.trim().split(/\s+/)[0] || null,
    user: {
      id: msg.from.id,
      username: msg.from.username || null,
      firstName: msg.from.first_name || null,
      lastName: msg.from.last_name || null
    },
    correlationId,
    occurredAt: new Date().toISOString(),
    log: relatedError || { source: "user_report", message: "Связанный runtime error не найден" },
    description
  };
  try {
    bugReportStore.append(report);
  } catch (error) {
    const failureId = recordRuntimeError("reportbug.storage", error, { chatId: msg.chat.id, messageId: msg.message_id, userId: msg.from.id });
    await sendMessageSafe(msg.chat.id, `❌ Не удалось сохранить отчёт. Код ошибки: ${failureId}`);
    return;
  }
  await sendMessageSafe(msg.chat.id, `✅ Отчёт сохранён. ID: ${reportId}\nCorrelation ID: ${correlationId}`);
  for (const ownerId of ownerIds) {
    if (Number(ownerId) === Number(msg.from.id) && Number(msg.chat.id) === Number(ownerId)) continue;
    await sendMessageSafe(
      ownerId,
      `🐞 Новый bug report\nID: ${reportId}\nCorrelation ID: ${correlationId}\nПользователь: ${getTelegramName(msg.from)} (${msg.from.id})\nОписание: ${description}`,
      {},
      "bug report notification"
    );
  }
});

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const userId = query.from?.id;

  if (data.startsWith("nuke:")) {
    await answerCallbackSafe(query.id);
    await emergencyNukeService.handleCallback(query);
    return;
  }

  if (data.startsWith("bet:")) {
    const [, gameCode, betValue, expectedUserId, token] = data.split(":");
    const gameType = gameCode === "d" ? "dice" : gameCode === "c" ? "casino" : null;
    const bet = parseBet(betValue);
    if (!gameType || !bet || !token) {
      await answerCallbackSafe(query.id, { text: "Некорректный игровой callback.", show_alert: true });
      return;
    }
    if (Number(expectedUserId) !== Number(userId)) {
      await answerCallbackSafe(query.id, { text: "Эта кнопка принадлежит другому игроку.", show_alert: true });
      return;
    }
    const validationError = getBetValidationError(query.from, bet, gameType);
    if (validationError) {
      await answerCallbackSafe(query.id, { text: validationError.slice(0, 180), show_alert: true });
      return;
    }
    const round = settleGameRound(query.from, gameType, bet, `callback:${token}`);
    if (!round || round.settlement.replayed) {
      await answerCallbackSafe(query.id, { text: "Этот раунд уже обработан.", show_alert: true });
      return;
    }
    await answerCallbackSafe(query.id, { text: round.settlement.won ? "Победа!" : "Поражение" });
    await bot.editMessageText(formatGameRound(gameType, round), {
      chat_id: chatId,
      message_id: messageId,
      ...createGameKeyboard(gameType, bet, userId)
    });
    return;
  }

  if (data.startsWith("quiz:")) {
    const [, quizId, optionIndex] = data.split(":");
    const result = quizManager.answer(quizId, optionIndex, query.from);

    if (result.status === "missing") {
      await answerCallbackSafe(query.id, { text: "Викторина уже завершена.", show_alert: true });
      return;
    }

    if (result.status === "answered") {
      await answerCallbackSafe(query.id, { text: "На этот вопрос уже ответили.", show_alert: true });
      return;
    }

    if (result.status === "attempted") {
      await answerCallbackSafe(query.id, { text: "Вы уже отвечали на этот вопрос.", show_alert: true });
      return;
    }

    if (result.status === "expired") {
      if (chatId && messageId) {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => { });
      }
      await answerCallbackSafe(query.id, { text: "Время ответа истекло.", show_alert: true });
      return;
    }

    if (result.status === "invalid_user" || result.status === "invalid_option") {
      await answerCallbackSafe(query.id, { text: "Некорректный ответ.", show_alert: true });
      return;
    }

    if (result.status === "wrong") {
      await answerCallbackSafe(query.id, { text: "Неверно. Попробуй другой вопрос.", show_alert: true });
      return;
    }

    if (query.message?.chat && query.from) {
      registerUserInChat({ chat: query.message.chat, from: query.from });
    }

    const reward = currencyStore.creditOnce(query.from, {
      operationId: `quiz:${quizId}`,
      amount: result.reward,
      metadata: { quizId, questionId: result.quiz.questionId }
    });
    const newBalance = reward.balanceAfter;
    const winner = getUser(query.from);
    const winnerName = getUserDisplayName(winner);

    await answerCallbackSafe(query.id, { text: `Правильно! +${result.reward} монет` });

    if (chatId && messageId) {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => { });
    }
    const timer = quizTimers.get(quizId);
    if (timer) clearTimeout(timer);
    quizTimers.delete(quizId);

    await bot.sendMessage(
      chatId,
      `✅ ${winnerName} ответил(а) правильно и заработал(а) ${result.reward} монет.\n💰 Баланс: ${newBalance} монет`
    );
    return;
  }

  if (data === "support_open") {
    const now = Date.now();
    for (const [pendingUserId, expiresAt] of supportUsers) {
      if (expiresAt <= now) supportUsers.delete(pendingUserId);
    }
    supportUsers.set(userId, now + 10 * 60 * 1000);
    while (supportUsers.size > MAX_SUPPORT_SESSIONS) supportUsers.delete(supportUsers.keys().next().value);

    await bot.sendMessage(
      query.message.chat.id,
      "💬 Напишите ваше сообщение. Оно будет отправлено владельцу бота."
    );

    await answerCallbackSafe(query.id);
    return;
  }
  if (data.startsWith("marriage_accept:") || data.startsWith("marriage_decline:")) {
    const [action, proposalId] = data.split(":");
    const proposal = pendingMarriages.get(proposalId);

    if (!proposal || proposal.expiresAt <= Date.now()) {
      pendingMarriages.delete(proposalId);
      await answerCallbackSafe(query.id, {
        text: "⏳ Предложение уже устарело.",
        show_alert: true
      });
      return;
    }

    if (Number(userId) !== Number(proposal.secondUserId)) {
      await answerCallbackSafe(query.id, {
        text: "⛔ Это предложение не для вас.",
        show_alert: true
      });
      return;
    }

    const firstUser = users.get(proposal.firstUserId);
    const secondUser = users.get(proposal.secondUserId);

    const firstName = firstUser ? getMarriageDisplayName(firstUser) : `ID:${proposal.firstUserId}`;
    const secondName = secondUser ? getMarriageDisplayName(secondUser) : `ID:${proposal.secondUserId}`;

    if (action === "marriage_decline") {
      pendingMarriages.delete(proposalId);

      await bot.editMessageText(
        `💔 ПРЕДЛОЖЕНИЕ ОТКЛОНЕНО\n\n${secondName} отказался(ась) от игрового брака с ${firstName}.`,
        {
          chat_id: proposal.chatId,
          message_id: query.message.message_id
        }
      );

      await answerCallbackSafe(query.id, { text: "Вы отказались." });
      return;
    }

    if (
      getMarriagePartnerId(proposal.chatId, proposal.firstUserId) ||
      getMarriagePartnerId(proposal.chatId, proposal.secondUserId)
    ) {
      pendingMarriages.delete(proposalId);

      await bot.editMessageText(
        "💍 Брак не оформлен. Кто-то из участников уже состоит в игровом браке.",
        {
          chat_id: proposal.chatId,
          message_id: query.message.message_id
        }
      );

      await answerCallbackSafe(query.id, { text: "Брак не оформлен." });
      return;
    }

    setMarriage(proposal.chatId, proposal.firstUserId, proposal.secondUserId);
    familySystem.createFamilyForMarriage(proposal.chatId, proposal.firstUserId, proposal.secondUserId);
    pendingMarriages.delete(proposalId);

    await bot.editMessageText(
      `💍 БРАК ПОДТВЕРЖДЁН!\n\n👤 Первая половинка: ${firstName}\n💞 Вторая половинка: ${secondName}\n\n🍦 Сливки официально подтверждает этот союз!`,
      {
        chat_id: proposal.chatId,
        message_id: query.message.message_id
      }
    );

    await answerCallbackSafe(query.id, { text: "Брак подтверждён!" });
    return;
  }

  if (data.startsWith("commands_page:")) {
    if (!isCommandEnabled("commands")) {
      await answerCallbackSafe(query.id, {
        text: "Команда /commands сейчас выключена",
        show_alert: true
      });
      return;
    }

    const page = Number(data.split(":")[1]) || 0;

    try {
      await bot.editMessageText(getCommandsText(page), {
        chat_id: chatId,
        message_id: messageId,
        ...getCommandsKeyboard(page)
      });
    } catch (error) {
      if (!getErrorMessage(error).includes("message is not modified")) {
        console.error("Commands page edit error:", getErrorMessage(error));
      }
    }

    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "commands_close") {
    await bot.deleteMessage(chatId, messageId).catch((error) => {
      console.error("Commands close delete error:", getErrorMessage(error));
    });
    await answerCallbackSafe(query.id, { text: "Список команд закрыт" });
    return;
  }

  if (!data.startsWith("admin_") && !data.startsWith("toggle_command:")) {
    await answerCallbackSafe(query.id, { text: "Эта кнопка устарела или больше не поддерживается.", show_alert: true });
    return;
  }

  if (!isOwner(userId)) {
    await answerCallbackSafe(query.id, {
      text: "⛔ Нет доступа",
      show_alert: true
    });
    return;
  }

  if (data === "admin_back") {
    await bot.editMessageText(getAdminPanelText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getAdminPanelKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_close") {
    await bot.deleteMessage(chatId, messageId).catch((error) => {
      console.error("Admin close delete error:", getErrorMessage(error));
    });
    await answerCallbackSafe(query.id, { text: "Админ-панель закрыта" });
    return;
  }

  if (data === "admin_commands") {
    await bot.editMessageText(getAdminCommandsText(0), {
      chat_id: chatId,
      message_id: messageId,
      ...getCommandSettingsKeyboard(0)
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data.startsWith("admin_commands_page:")) {
    const page = Number(data.split(":")[1]) || 0;

    try {
      await bot.editMessageText(getAdminCommandsText(page), {
        chat_id: chatId,
        message_id: messageId,
        ...getCommandSettingsKeyboard(page)
      });
    } catch (error) {
      if (!getErrorMessage(error).includes("message is not modified")) {
        console.error("Admin commands page edit error:", getErrorMessage(error));
      }
    }

    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_stats") {
    await bot.editMessageText(await getAdminStatsText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_logs") {
    const logsText = query.message?.chat?.type === "private"
      ? getAllAdminLogsText()
      : getAdminLogsText(chatId);

    await bot.editMessageText(logsText, {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_moderation") {
    await bot.editMessageText(getAdminModerationText(), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data === "admin_users") {
    await bot.editMessageText(getAdminUsersText(chatId), {
      chat_id: chatId,
      message_id: messageId,
      ...getBackKeyboard()
    });
    await answerCallbackSafe(query.id);
    return;
  }

  if (data.startsWith("toggle_command:")) {
    const [, commandName, pageValue] = data.split(":");
    const page = Number(pageValue) || 0;

    if (!commandSettings.has(commandName)) {
      await answerCallbackSafe(query.id, {
        text: "Команда не найдена",
        show_alert: true
      });
      return;
    }

    commandSettings.set(commandName, !isCommandEnabled(commandName));
    saveCommandSettings();

    await answerCallbackSafe(query.id, {
      text: `/${commandName}: ${getCommandStatus(commandName)}`
    });

    await setupBotCommands();

    await bot.editMessageText(getAdminCommandsText(page), {
      chat_id: chatId,
      message_id: messageId,
      ...getCommandSettingsKeyboard(page)
    });
  }
});

bot.onText(/^\/menu(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "menu")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📋 Чтобы открыть меню команд, добавь меня в группу и напиши там /menu");
    return;
  }

  bot.sendMessage(msg.chat.id, getMainMenuText());
});

bot.onText(/^\/help(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "menu")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(
      msg.chat.id,
      "ℹ️ Чтобы пользоваться командами, добавь меня в группу."
    );
    return;
  }

  bot.sendMessage(msg.chat.id, getHelpText());
});

bot.onText(/^\/commands(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "commands")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📜 Добавь меня в группу, чтобы посмотреть команды.");
    return;
  }

  bot.sendMessage(msg.chat.id, getCommandsText(0), getCommandsKeyboard(0)).catch((error) => {
    console.error("Commands send error:", getErrorMessage(error));
  });
});

bot.onText(/^(?:\/profile(?:@\w+)?|профиль)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "profile")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /profile.");
    return;
  }

  const targetUser = msg.reply_to_message?.from || msg.from;
  const profile = getUser(targetUser);

  let memberStatus = "unknown";
  let joinedDate = "Telegram не показывает";

  try {
    const member = await bot.getChatMember(msg.chat.id, targetUser.id);
    memberStatus = member.status;
    joinedDate = formatUnixDate(member.joined_date);
  } catch (error) {
    console.error("Profile member info error:", getErrorMessage(error));
  }

  const usernameText = targetUser.username ? `@${targetUser.username}` : "Отсутствует";
  const tagText = getUserTag(targetUser);
  const statusText = getStatusLabel(memberStatus);
  const fullName = getFullName(targetUser);
  const marriageRecord = getMarriageRecord(msg.chat.id, targetUser.id);
  const marriagePartner = marriageRecord ? users.get(marriageRecord.partnerId) : null;
  const marriageText = marriageRecord
    ? `\n\n💞 Партнёр: ${marriagePartner ? getMarriageDisplayName(marriagePartner) : `ID:${marriageRecord.partnerId}`}\n${formatMarriageDetails(marriageRecord.marriedAt)}`
    : "";

  const profileText =
    `🍦 «СЛИВКИ» • профиль пользователя\n\n` +
    `🆔 ID: ${targetUser.id}\n` +
    `🔎 Хэштег: #id${targetUser.id}\n\n` +
    `👤 Имя: ${fullName}\n` +
    `🌐 Username: ${usernameText}\n` +
    `🏷 Тег: ${tagText}\n\n` +
    `👀 Статус в группе: ${statusText}\n` +
    `↘️ Вступил(а): ${joinedDate}\n\n` +
    `💬 Сообщений: ${profile.messages}\n` +
    `⚠️ Предупреждения: ${profile.warnings}/3` +
    marriageText;

  bot.sendMessage(msg.chat.id, profileText);
});

// /top command handler
bot.onText(/^(?:\/top(?:@\w+)?|топ)(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "top")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "🏆 Добавь меня в группу, чтобы посмотреть топ участников.");
    return;
  }

  const info = chatInfo.get(msg.chat.id);

  if (!info || !Array.isArray(info.users) || info.users.length === 0) {
    bot.sendMessage(msg.chat.id, "🏆 Пока недостаточно данных для топа.");
    return;
  }

  const topUsers = info.users
    .map((userId) => users.get(userId))
    .filter(Boolean)
    .filter((user) => !user.isBot)
    .sort((a, b) => (b.messages || 0) - (a.messages || 0))
    .slice(0, 10);

  if (topUsers.length === 0) {
    bot.sendMessage(msg.chat.id, "🏆 Пока нет активных участников.");
    return;
  }

  const text = "🏆 ТОП АКТИВНЫХ УЧАСТНИКОВ\n\n" + topUsers
    .map((user, index) => `${index + 1}. ${getUserDisplayName(user)} — ${user.messages || 0} сообщений`)
    .join("\n");

  bot.sendMessage(msg.chat.id, text);
});


bot.onText(/^(?:\/logs(?:@\w+)?|логи)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "logs")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /logs.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете смотреть логи.");
    return;
  }

  bot.sendMessage(msg.chat.id, getAdminLogsText(msg.chat.id));
});

bot.onText(/^\/emojiid(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);

  const sourceMessage = msg.reply_to_message || msg;
  const customEmojis = getCustomEmojiIdsFromMessage(sourceMessage);

  if (customEmojis.length === 0) {
    bot.sendMessage(
      msg.chat.id,
      [
        "💎 <b>Premium Emoji ID не найден</b>",
        "",
        "1️⃣ Отправь Premium Emoji в чат.",
        "2️⃣ Ответь на него командой <b>/emojiid</b>.",
        "3️⃣ Я покажу <code>custom_emoji_id</code>."
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_parameters: { message_id: msg.message_id }
      }
    );
    return;
  }

  rememberPremiumEmojiIdsFromMessage(sourceMessage);
  syncRpCommandEmojiIds();

  const text = customEmojis
    .map((item, index) => {
      console.log("Premium emoji:", item.customEmojiId);
      return `${index + 1}. ${item.emoji}\n<code>${item.customEmojiId}</code>`;
    })
    .join("\n\n");

  bot.sendMessage(
    msg.chat.id,
    "💎 <b>Найденные Premium Emoji ID:</b>\n\n" + text,
    {
      parse_mode: "HTML",
      reply_parameters: { message_id: msg.message_id }
    }
  );
});

bot.onText(/^(?:\/id(?:@\w+)?|айди)(?:\s+(.+))?$/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "id")) return;

  const targetUser = msg.reply_to_message?.from || msg.from;
  const targetMessageId = msg.reply_to_message?.message_id || msg.message_id;
  const user = getUser(targetUser);

  const text = [
    "🆔 ID информация",
    "",
    `👤 Пользователь: ${getUserDisplayName(user)}`,
    `🆔 User ID: ${targetUser.id}`,
    `💬 Chat ID: ${msg.chat.id}`,
    `🧾 Message ID: ${targetMessageId}`
  ].join("\n");

  bot.sendMessage(msg.chat.id, text, { reply_parameters: { message_id: msg.message_id } });
});

bot.onText(/^\/chatinfo(?:@\w+)?$/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "chatinfo")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "ℹ️ Команда /chatinfo работает в группе.");
    return;
  }

  let chat = msg.chat;
  let memberCount = "не удалось получить";

  try {
    chat = await bot.getChat(msg.chat.id);
  } catch (error) {
    console.error("Chat info getChat error:", getErrorMessage(error));
  }

  try {
    memberCount = await bot.getChatMemberCount(msg.chat.id);
  } catch (error) {
    console.error("Chat info member count error:", getErrorMessage(error));
  }

  const info = chatInfo.get(msg.chat.id);
  const seenUsers = Array.isArray(info?.users) ? info.users.length : 0;
  const description = chat.description ? `\n📝 Описание: ${chat.description}` : "";

  bot.sendMessage(
    msg.chat.id,
    [
      "ℹ️ Информация о группе",
      "",
      `💬 Название: ${chat.title || "без названия"}`,
      `🆔 Chat ID: ${msg.chat.id}`,
      `🏷 Тип: ${chat.type || msg.chat.type}`,
      `👥 Участников: ${memberCount}`,
      `👤 Бот видел пользователей: ${seenUsers}`,
      `📅 Бот добавлен: ${info?.joinedAt || "неизвестно"}${description}`
    ].join("\n")
  );
});

bot.onText(/^(?:\/rules(?:@\w+)?|правила)$/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "rules")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📜 Правила работают отдельно для каждой группы.");
    return;
  }

  const rules = chatRules.get(msg.chat.id);

  if (!rules) {
    bot.sendMessage(
      msg.chat.id,
      "📜 Правила группы пока не установлены.\n\nАдмин может установить их командой:\n/setrules текст правил"
    );
    return;
  }

  bot.sendMessage(msg.chat.id, `📜 Правила группы:\n\n${rules}`);
});

bot.onText(/^\/setrules(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "setrules", {
    privateText: "📜 Добавь меня в группу, чтобы настраивать правила.",
    noAccessText: "⛔ Только админы могут менять правила группы."
  })) {
    return;
  }

  const rawText = (match[1] || "").trim();
  const replyText = (msg.reply_to_message?.text || msg.reply_to_message?.caption || "").trim();
  const rulesText = rawText || replyText;

  if (["off", "выкл", "удалить", "reset", "сброс"].includes(rulesText.toLowerCase())) {
    chatRules.delete(msg.chat.id);
    saveChatSettings();
    addAdminLog(msg.chat.id, "📜 Удалил правила", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, "✅ Правила группы удалены.");
    return;
  }

  if (!rulesText) {
    waitingRulesInput.add(`${msg.chat.id}:${msg.from.id}`);
    bot.sendMessage(
      msg.chat.id,
      "📜 Отправь следующим сообщением текст правил.\n\nЧтобы удалить правила: /setrules off"
    );
    return;
  }

  if (rulesText.length > 3500) {
    bot.sendMessage(msg.chat.id, "⚠️ Правила слишком длинные. Сократи текст до 3500 символов.");
    return;
  }

  chatRules.set(msg.chat.id, rulesText);
  saveChatSettings();
  addAdminLog(msg.chat.id, "📜 Обновил правила", msg.from, "Группа");
  bot.sendMessage(msg.chat.id, "✅ Правила группы обновлены.\n\nПосмотреть: /rules");
});

bot.onText(/^\/settitle(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "settitle", {
    privateText: "✏️ Добавь меня в группу, чтобы менять название.",
    noAccessText: "⛔ Только админы могут менять название группы."
  })) {
    return;
  }

  const title = (match[1] || "").trim();

  if (!title) {
    bot.sendMessage(msg.chat.id, "✏️ Укажи новое название.\n\nПример:\n/settitle Новый чат");
    return;
  }

  if (title.length > 255) {
    bot.sendMessage(msg.chat.id, "⚠️ Название слишком длинное. Максимум 255 символов.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_change_info", "Изменение информации группы", "изменить название")) {
    return;
  }

  try {
    await bot.setChatTitle(msg.chat.id, title);
    const info = chatInfo.get(msg.chat.id);

    if (info) {
      info.title = title;
      saveChatInfo();
    }

    addAdminLog(msg.chat.id, "✏️ Изменил название", msg.from, "Группа", title);
    bot.sendMessage(msg.chat.id, `✅ Название группы изменено:\n${title}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить название", error));
  }
});

bot.onText(/^\/setdescription(?:@\w+)?(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "setdescription", {
    privateText: "📝 Добавь меня в группу, чтобы менять описание.",
    noAccessText: "⛔ Только админы могут менять описание группы."
  })) {
    return;
  }

  const description = (match[1] || msg.reply_to_message?.text || msg.reply_to_message?.caption || "").trim();

  if (!description) {
    bot.sendMessage(msg.chat.id, "📝 Укажи новое описание.\n\nПример:\n/setdescription Описание группы");
    return;
  }

  if (description.length > 255) {
    bot.sendMessage(msg.chat.id, "⚠️ Описание слишком длинное. Telegram принимает до 255 символов.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_change_info", "Изменение информации группы", "изменить описание")) {
    return;
  }

  try {
    await bot.setChatDescription(msg.chat.id, description);
    addAdminLog(msg.chat.id, "📝 Изменил описание", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, "✅ Описание группы обновлено.");
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить описание", error));
  }
});

bot.onText(/^\/invite(?:@\w+)?$/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "invite", {
    privateText: "🔗 Добавь меня в группу, чтобы получать ссылку-приглашение.",
    noAccessText: "⛔ Только админы могут получать ссылку-приглашение."
  })) {
    return;
  }

  if (!await ensureBotPermission(msg, "can_invite_users", "Приглашение пользователей", "создать ссылку-приглашение")) {
    return;
  }

  try {
    const link = await bot.exportChatInviteLink(msg.chat.id);
    bot.sendMessage(msg.chat.id, `🔗 Ссылка-приглашение:\n${link}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("создать ссылку-приглашение", error));
  }
});

bot.onText(/^\/resetlinks(?:@\w+)?$/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "resetlinks", {
    privateText: "♻️ Добавь меня в группу, чтобы сбрасывать ссылки.",
    noAccessText: "⛔ Только админы могут сбрасывать ссылки-приглашения."
  })) {
    return;
  }

  if (!await ensureBotPermission(msg, "can_invite_users", "Приглашение пользователей", "сбросить ссылку-приглашение")) {
    return;
  }

  try {
    const link = await bot.exportChatInviteLink(msg.chat.id);
    addAdminLog(msg.chat.id, "♻️ Сбросил ссылку", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, `✅ Основная ссылка сброшена.\n\nНовая ссылка:\n${link}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("сбросить ссылку-приглашение", error));
  }
});

bot.onText(/^(?:(?:сетка\s+)?([+-])\s*(?:тг\s*админ|tg\s*admin)|\/?(tg-admin|tg_admin|untg-admin|untg_admin|promote|demote)(?:@\w+)?)\s*$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "tgadmin")) return;

  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    await bot.sendMessage(msg.chat.id, "⚠️ Команда работает только в группах и супергруппах.");
    return;
  }

  const repliedUser = msg.reply_to_message?.from;
  if (!repliedUser?.id) {
    await bot.sendMessage(msg.chat.id, "Ответьте этой командой на сообщение участника.");
    return;
  }

  const alias = String(match[2] || "").toLowerCase();
  const promote = match[1] ? match[1] === "+" : !alias.startsWith("untg") && alias !== "demote";
  try {
    const me = await getBotIdentity();
    const change = await changeTelegramAdmin({
      bot,
      chat: msg.chat,
      actorId: msg.from.id,
      targetId: repliedUser.id,
      botId: me.id,
      ownerIds,
      promote
    });
    if (!change.changed) {
      await bot.sendMessage(msg.chat.id, change.message);
      return;
    }

    addAdminLog(
      msg.chat.id,
      promote ? "👮 Выдал тг админа" : "👮 Снял тг админа",
      msg.from,
      getMarriageDisplayName(repliedUser)
    );
    await bot.sendMessage(msg.chat.id, [
      `${promote ? "👮" : "👤"} Результат ${promote ? "выдачи админки" : "снятия админки"}:`,
      "",
      "✅ Успешно: 1",
      "⚠️ Ошибок: 0",
      "",
      change.message
    ].join("\n"));
  } catch (error) {
    const details = error instanceof TelegramAdminOperationError ? error.details : {};
    const correlationId = recordRuntimeError("telegram.admin_promotion", error, {
      chatId: msg.chat.id,
      chatType: msg.chat.type,
      actorId: msg.from.id,
      targetId: repliedUser.id,
      promote,
      requestedRights: details.requestedRights || null,
      capabilities: details.capabilities || null,
      telegram: details.telegram || null
    });
    console.error(`Telegram admin operation error (${correlationId}):`, getErrorMessage(error));

    if (error.code === "RIGHT_FORBIDDEN" || isRightForbidden(error)) {
      const forbiddenRight = getForbiddenRight(error);
      const lines = [
        `❌ Не удалось ${promote ? "назначить администратора" : "снять права администратора"}.`,
        "Telegram отклонил одно из запрошенных прав.",
        "Проверьте:",
        "• бот является администратором;",
        "• у бота включено «Назначение администраторов»;",
        "• бот выдаёт только те права, которыми обладает сам."
      ];
      if (forbiddenRight) lines.push(`Конфликтующее право: ${forbiddenRight}`);
      lines.push(`Код диагностики: ${correlationId}`);
      await bot.sendMessage(msg.chat.id, lines.join("\n"));
      return;
    }
    await bot.sendMessage(
      msg.chat.id,
      `${error.userMessage || getTelegramFailureReason(error)}\nКод диагностики: ${correlationId}`
    );
  }
});

bot.onText(/^\/(partner|партнер)(?:@\w+)?(?:\s|$)/i, (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "partner")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "💞 Добавь меня в группу, чтобы пользоваться командой /partner.");
    return;
  }

  const partnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);

  if (!partnerId) {
    bot.sendMessage(msg.chat.id, "💔 У тебя пока нет игровой второй половинки.");
    return;
  }

  const partner = users.get(partnerId);
  const partnerName = partner ? getMarriageDisplayName(partner) : `ID:${partnerId}`;
  const marriageRecord = getMarriageRecord(msg.chat.id, msg.from.id);

  bot.sendMessage(
    msg.chat.id,
    [`💞 Твоя игровая вторая половинка: ${partnerName}`, "", formatMarriageDetails(marriageRecord?.marriedAt)].join("\n"),
    { reply_parameters: { message_id: msg.message_id } }
  );
});

bot.onText(/^\/ollban(?:@\w+)?(?:\s+(\S+))?\s*$/i, async (msg, match) => {
  if (!await ensureOwnerOnlyGroupCommand(msg, "ollban")) return;

  const confirmText = (match?.[1] || "").trim().toLowerCase();

  if (confirmText !== "confirm") {
    await sendMessageSafe(
      msg.chat.id,
      "⚠️ Массовый бан не запущен.\n\nДля подтверждения напиши: /ollban confirm",
      { reply_parameters: { message_id: msg.message_id } },
      "ollbanConfirmRequired"
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Ban users / Блокировка пользователей", "запустить массовый бан")) {
    return;
  }

  const me = await getBotIdentity();
  const creatorId = await getChatCreatorId(msg.chat.id);
  const knownUserIds = new Set([
    ...(chatUsers.has(msg.chat.id) ? Array.from(chatUsers.get(msg.chat.id)) : []),
    ...(chatInfo.get(msg.chat.id)?.users || [])
  ].map(Number).filter(Number.isFinite));

  let bannedCount = 0;
  let skippedCount = 0;
  const bannedUserIds = [];
  const errors = [];

  await sendMessageSafe(
    msg.chat.id,
    `🚫 Запускаю массовый бан известных пользователей: ${knownUserIds.size}.`,
    { reply_parameters: { message_id: msg.message_id } },
    "ollbanStarted"
  );

  for (const userId of knownUserIds) {
    if (
      userId === me.id ||
      isOwner(userId) ||
      (creatorId && userId === creatorId)
    ) {
      skippedCount += 1;
      continue;
    }

    try {
      await banChatMemberConfirmed(msg.chat.id, userId);
      bannedUserIds.push(userId);
      bannedCount += 1;
    } catch (error) {
      skippedCount += 1;
      errors.push(`ID:${userId} - ${getErrorMessage(error)}`);
    }

    await sleep(75);
  }

  await sleep(750);

  for (const userId of [...bannedUserIds]) {
    const stillBanned = await verifyBannedMember(msg.chat.id, userId);

    if (!stillBanned) {
      bannedCount -= 1;
      skippedCount += 1;
      errors.push(`ID:${userId} - бан не подтвердился при итоговой проверке`);
    }
  }

  const report = [
    "🚫 /ollban завершён",
    "",
    `✅ Забанено: ${bannedCount}`,
    `⏭ Пропущено/ошибок: ${skippedCount}`
  ];

  if (errors.length > 0) {
    report.push("", "Первые ошибки:", ...errors.slice(0, 8));
  }

  await sendMessageSafe(msg.chat.id, report.join("\n"), {}, "ollbanReport");
});

// /lock and /unlock handlers
bot.onText(/^(?:\/lock(?:@\w+)?|закрыть)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "lock")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /lock.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /lock.");
    return;
  }

  const botCanChangePermissions = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangePermissions) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу закрыть чат.\n\nДай боту права администратора:\n✅ Блокировка пользователей / Ограничение участников"
    );
    return;
  }

  try {
    const slowModeDelay = await getCurrentSlowModeDelay(msg.chat.id);
    await bot.setChatPermissions(msg.chat.id, getLockedChatPermissions(slowModeDelay));
    addAdminLog(msg.chat.id, "🔒 Закрыл чат", msg.from, "Вся группа", "Обычные участники больше не могут писать.");
    bot.sendMessage(msg.chat.id, "🔒 Чат закрыт. Обычные участники больше не могут писать.");
  } catch (error) {
    console.error("Lock error:", getErrorMessage(error));
    bot.sendMessage(msg.chat.id, getActionErrorText("закрыть чат", error));
  }
});


bot.onText(/^(?:\/unlock(?:@\w+)?|открыть)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unlock")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /unlock.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /unlock.");
    return;
  }

  const botCanChangePermissions = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangePermissions) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу открыть чат.\n\nДай боту права администратора:\n✅ Блокировка пользователей / Ограничение участников"
    );
    return;
  }

  try {
    const slowModeDelay = await getCurrentSlowModeDelay(msg.chat.id);
    await bot.setChatPermissions(msg.chat.id, getUnlockedChatPermissions(slowModeDelay));
    addAdminLog(msg.chat.id, "🔓 Открыл чат", msg.from, "Вся группа", "Обычные участники снова могут писать.");
    bot.sendMessage(msg.chat.id, "🔓 Чат открыт. Обычные участники снова могут писать.");
  } catch (error) {
    console.error("Unlock error:", getErrorMessage(error));
    bot.sendMessage(msg.chat.id, getActionErrorText("открыть чат", error));
  }
});

// +чат / -чат
bot.onText(/^([+-])\s*(?:чат|chat)$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "chat")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "💬 Команда +чат / -чат работает в группе.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут открывать или закрывать чат.");
    return;
  }

  const botCanChangePermissions = await canBotChangeSlowMode(msg.chat.id);

  if (!botCanChangePermissions) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Я не могу изменить права чата. Дай боту права администратора на ограничение участников."
    );
    return;
  }

  try {
    const slowModeDelay = await getCurrentSlowModeDelay(msg.chat.id);

    if (match[1] === "-") {
      await bot.setChatPermissions(msg.chat.id, getLockedChatPermissions(slowModeDelay));
      addAdminLog(msg.chat.id, "🔒 Закрыл чат", msg.from, "Вся группа", "Команда -чат");
      bot.sendMessage(msg.chat.id, "🔒 Чат закрыт. Обычные участники больше не могут писать.");
      return;
    }

    await bot.setChatPermissions(msg.chat.id, getUnlockedChatPermissions(slowModeDelay));
    addAdminLog(msg.chat.id, "🔓 Открыл чат", msg.from, "Вся группа", "Команда +чат");
    bot.sendMessage(msg.chat.id, "🔓 Чат открыт. Обычные участники снова могут писать.");
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить права чата", error));
  }
});

// +топик / -топик
bot.onText(/^([+-])\s*(?:топик|topic)$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "topic")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "🧵 Команда +топик / -топик работает в группе.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут открывать или закрывать топики.");
    return;
  }

  if (!msg.message_thread_id) {
    bot.sendMessage(msg.chat.id, "🧵 Эта команда работает только внутри топика/темы.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_manage_topics", "Управление темами", "изменить топик")) {
    return;
  }

  try {
    if (match[1] === "-") {
      await bot.closeForumTopic(msg.chat.id, msg.message_thread_id);
      addAdminLog(msg.chat.id, "🔒 Закрыл топик", msg.from, `Topic:${msg.message_thread_id}`, "Команда -топик");
      bot.sendMessage(msg.chat.id, "🔒 Топик закрыт. Обычные участники больше не могут писать в этой теме.", {
        message_thread_id: msg.message_thread_id
      });
      return;
    }

    await bot.reopenForumTopic(msg.chat.id, msg.message_thread_id);
    addAdminLog(msg.chat.id, "🔓 Открыл топик", msg.from, `Topic:${msg.message_thread_id}`, "Команда +топик");
    bot.sendMessage(msg.chat.id, "🔓 Топик открыт. Участники снова могут писать в этой теме.", {
      message_thread_id: msg.message_thread_id
    });
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText(
        "изменить топик",
        error,
        "Проверь, что это форум-группа и команда отправлена внутри темы."
      )
    );
  }
});

function escapeHtmlText(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildUserMentionHtml(profile) {
  const name = escapeHtmlText(getUserDisplayName(profile) || `ID:${profile.id}`);
  return `<a href="tg://user?id=${profile.id}">${name}</a>`;
}

async function sendTagMentionWithRetry(chatId, mentionHtml) {
  let attempts = 0;

  while (attempts < 2) {
    try {
      await bot.sendMessage(chatId, mentionHtml, { parse_mode: "HTML" });
      return true;
    } catch (error) {
      const retryAfter = error?.response?.body?.parameters?.retry_after;

      if (retryAfter && attempts === 0) {
        await sleep((retryAfter + 1) * 1000);
        attempts += 1;
        continue;
      }

      console.error("Tag all send error:", getErrorMessage(error));
      return false;
    }
  }

  return false;
}

bot.onText(/^(?:\/tagall(?:@\w+)?|тег все|позвать всех)(?:\s+([\s\S]+))?$/i, async (msg, match) => {
  if (!await ensureGroupAdminCommand(msg, "tagall")) return;

  if (tagCallController.has(msg.chat.id)) {
    const current = tagCallController.get(msg.chat.id);
    await sendMessageSafe(
      msg.chat.id,
      `📢 Вызов уже выполняется: ${current.called}/${current.total}. Используйте /tagpause или /tagstop.`,
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  const customText = (match[1] || "").trim();
  const knownUserIds = Array.from(new Set(getKnownChatUserIds(msg.chat.id).map(Number).filter(Number.isFinite)));

  const candidates = knownUserIds
    .map((userId) => users.get(userId))
    .filter((profile) => profile && !profile.isBot && profile.id !== botId);

  if (candidates.length === 0) {
    await sendMessageSafe(msg.chat.id, "📢 Пока не знаю участников этого чата, чтобы позвать всех.");
    return;
  }

  const progressMessage = await sendMessageSafe(
    msg.chat.id,
    [
      "📢 Вызов участников запущен",
      `Вызвано: 0 из ${candidates.length}`,
      `Статус: выполняется${customText ? `\n\n${customText}` : ""}`
    ].join("\n"),
    { reply_parameters: { message_id: msg.message_id } }
  );

  const updateProgress = async (progress, force = false) => {
    if (!progressMessage?.message_id || (!force && progress.processed % 5 !== 0)) return;
    const status = progress.state === "stopped" ? "остановлен" :
      progress.state === "paused" ? "приостановлен" :
        progress.state === "completed" ? "завершён" : "выполняется";
    try {
      await bot.editMessageText(
        [
          "📢 Вызов участников",
          `Вызвано: ${progress.called} из ${progress.total}`,
          `Обработано: ${progress.processed} из ${progress.total}`,
          `Статус: ${status}${customText ? `\n\n${customText}` : ""}`
        ].join("\n"),
        { chat_id: msg.chat.id, message_id: progressMessage.message_id }
      );
    } catch (error) {
      const description = getErrorMessage(error);
      if (!description.includes("message is not modified")) console.error("Tag all progress error:", description);
    }
  };

  const result = await tagCallController.start(
    msg.chat.id,
    candidates,
    async (profile) => sendTagMentionWithRetry(msg.chat.id, buildUserMentionHtml(profile)),
    updateProgress
  );

  if (!result.started) return;
  await updateProgress(result, true);
  addAdminLog(
    msg.chat.id,
    result.state === "stopped" ? "⏹ Остановил вызов участников" : "📢 Позвал всех участников",
    msg.from,
    "Вся группа",
    `Вызвано: ${result.called}/${result.total}`
  );
});

bot.onText(/^(?:\/tagpause(?:@\w+)?|пауза вызова)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "tagall")) return;
  if (!tagCallController.pause(msg.chat.id)) {
    await sendMessageSafe(msg.chat.id, "⏸ Активный вызов участников не найден или уже приостановлен.");
    return;
  }
  const progress = tagCallController.get(msg.chat.id);
  await sendMessageSafe(msg.chat.id, `⏸ Вызов приостановлен. Обработано: ${progress.processed}/${progress.total}.`);
});

bot.onText(/^(?:\/tagresume(?:@\w+)?|продолжить вызов)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "tagall")) return;
  if (!tagCallController.resume(msg.chat.id)) {
    await sendMessageSafe(msg.chat.id, "▶️ Приостановленный вызов участников не найден.");
    return;
  }
  const progress = tagCallController.get(msg.chat.id);
  await sendMessageSafe(msg.chat.id, `▶️ Вызов продолжен. Обработано: ${progress.processed}/${progress.total}.`);
});

bot.onText(/^(?:\/(?:tagstop|stopcall)(?:@\w+)?|остановить вызов)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "tagall")) return;
  const progress = tagCallController.get(msg.chat.id);
  if (!progress || !tagCallController.stop(msg.chat.id)) {
    await sendMessageSafe(msg.chat.id, "⏹ Активный вызов участников не найден.");
    return;
  }
  await sendMessageSafe(msg.chat.id, `⏹ Вызов остановлен. Обработано: ${progress.processed}/${progress.total}.`);
});

bot.onText(/^(?:\/admins(?:@\w+)?|админы)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "admins")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👑 Добавь меня в группу, чтобы посмотреть список администраторов.");
    return;
  }

  try {
    const admins = await bot.getChatAdministrators(msg.chat.id);

    if (!admins || admins.length === 0) {
      bot.sendMessage(msg.chat.id, "👑 Администраторы не найдены.");
      return;
    }

    const adminsText = admins
      .map((admin, index) => {
        const user = admin.user;
        const name = getFullName(user);
        const username = user.username ? `@${user.username}` : `ID:${user.id}`;
        const role = admin.status === "creator" ? "👑 Владелец" : "⛑ Админ";

        return `${index + 1}. ${role}\n   👤 ${name}\n   🏷 ${username}`;
      })
      .join("\n\n");

    bot.sendMessage(msg.chat.id, `👑 Список администраторов:\n\n${adminsText}`);
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText("получить список администраторов", error)
    );
  }
});



// /slowmode command handler
bot.onText(/^(?:\/slowmode(?:@\w+)?|слоумод)(?:\s+(.+))?$/i, async (msg, match) => {
  registerUserInChat(msg);

  if (!ensureCommandEnabled(msg, "slowmode")) return;

  if (isPrivateChat(msg)) {
    return bot.sendMessage(
      msg.chat.id,
      "👤 Добавь меня в группу, чтобы пользоваться командой /slowmode."
    );
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(
    msg.chat.id,
    msg.from.id
  );

  if (!senderCanUseAdminCommands) {
    return bot.sendMessage(
      msg.chat.id,
      "⛔ Вы не админ."
    );
  }

  const value = (match[1] || "").trim().toLowerCase();

  if (!value) {
    return bot.sendMessage(
      msg.chat.id,
      `🐢 Использование:

/slowmode 10s — 10 секунд
/slowmode 30s — 30 секунд
/slowmode 1m — 1 минута
/slowmode 5m — 5 минут
/slowmode 15m — 15 минут
/slowmode 1h — 1 час
/slowmode 0 — отключить

👤 Для пользователя:

/mute @username 10m
/mute @username 1d`
    );
  }

  if (value.includes("@")) {
    return bot.sendMessage(
      msg.chat.id,
      `⚠️ Slowmode работает только на весь чат.

Для пользователя используй:

/mute @username 10m
/mute @username 1d`
    );
  }

  const seconds = value === "1h" ? 3600 : parseSlowModeDuration(value);

  if (seconds === null) {
    return bot.sendMessage(
      msg.chat.id,
      `⚠️ Поддерживаемые значения:

0
10s
30s
1m
5m
15m
1h

Пример:
/slowmode 5m`
    );
  }

  if (seconds > 0 && !await canBotUsePermission(msg.chat.id, "can_delete_messages")) {
    return bot.sendMessage(
      msg.chat.id,
      getBotPermissionText("включить slowmode", "Удаление сообщений")
    );
  }

  try {
    setSlowModeSetting(msg.chat.id, seconds);
    const saved = getSlowModeSetting(msg.chat.id);

    if ((seconds === 0 && saved !== null) || (seconds > 0 && saved?.seconds !== seconds)) {
      throw new Error("Настройка slowmode не сохранилась в chat-settings.json");
    }

    if (seconds === 0) {
      addAdminLog(
        msg.chat.id,
        "🐢 Отключил slowmode",
        msg.from,
        "Вся группа"
      );

      return bot.sendMessage(
        msg.chat.id,
        "✅ Slowmode отключён."
      );
    }

    addAdminLog(
      msg.chat.id,
      "🐢 Изменил slowmode",
      msg.from,
      "Вся группа",
      `${seconds} сек`
    );

    bot.sendMessage(
      msg.chat.id,
      `🐢 Slowmode установлен: ${formatSlowModeDuration(seconds)}`
    );
  } catch (error) {
    console.error("Slowmode error:", getErrorMessage(error));
    bot.sendMessage(msg.chat.id, getActionErrorText("изменить slowmode", error));
  }
});


bot.on("left_chat_member", async (msg) => {
  if (!msg.left_chat_member) return;

  await emergencyNukeService.handleOwnerLeft(msg);

  const leftUser = msg.left_chat_member;
  const name = getTelegramName(leftUser);
  const setting = autoKickSettings.get(msg.chat.id);

  const notifySettings = getJoinLeaveSettings(msg.chat.id);
  const leftProfile = users.get(leftUser.id);
  const leftMessages = leftProfile?.messages || 0;

  if (notifySettings.leaves && leftMessages >= notifySettings.leaveMinMessages) {
    bot.sendMessage(msg.chat.id, `👋 ${name} покинул(а) группу`);
  }

  if (!setting || setting.enabled !== true) return;
  if (leftUser.is_bot) return;

  const key = `${msg.chat.id}:${leftUser.id}`;
  const now = Date.now();
  const timeLimitMs = setting.time * 1000;

  userLeftEventCount += 1;
  if (userLeftEventCount % 100 === 0 || userLeftHistory.size > 10000) {
    for (const [historyKey, timestamps] of userLeftHistory) {
      const historyChatId = Number(historyKey.split(":")[0]);
      const historySetting = autoKickSettings.get(historyChatId);
      const retentionMs = Math.max(1000, Number(historySetting?.time || 3600) * 1000);
      const retained = timestamps.filter((timestamp) => now - timestamp <= retentionMs);
      if (retained.length) userLeftHistory.set(historyKey, retained);
      else userLeftHistory.delete(historyKey);
    }
    while (userLeftHistory.size > 10000) userLeftHistory.delete(userLeftHistory.keys().next().value);
  }

  const history = (userLeftHistory.get(key) || []).filter((time) => now - time <= timeLimitMs);
  history.push(now);
  userLeftHistory.set(key, history);

  if (history.length < setting.count) return;

  try {
    if (setting.action === "ban") {
      await banChatMemberConfirmed(msg.chat.id, leftUser.id);
      bot.sendMessage(msg.chat.id, `🚫 ${name} забанен за частые выходы из чата.`);
      addAdminLog(msg.chat.id, "🚫 Автобан за выходы", { id: botId || 0, first_name: "Сливки Бот" }, name, `Выходов: ${history.length}/${setting.count}`);
    } else {
      await banChatMemberConfirmed(msg.chat.id, leftUser.id, {
        until_date: Math.floor(Date.now() / 1000) + 40
      });

      setTimeout(() => {
        bot.unbanChatMember(msg.chat.id, leftUser.id, { only_if_banned: true }).catch((error) => {
          console.error("Autokick temporary unban error:", getErrorMessage(error));
        });
      }, 1000);

      bot.sendMessage(msg.chat.id, `👢 ${name} кикнут за частые выходы из чата.`);
      addAdminLog(msg.chat.id, "👢 Автокик за выходы", { id: botId || 0, first_name: "Сливки Бот" }, name, `Выходов: ${history.length}/${setting.count}`);
    }

    userLeftHistory.delete(key);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("выполнить автокик", error));
  }
});

bot.on("new_chat_members", (msg) => {
  if (!Array.isArray(msg.new_chat_members) || msg.new_chat_members.length === 0) return;
  if (isPrivateChat(msg)) return;

  const notifySettings = getJoinLeaveSettings(msg.chat.id);

  for (const member of msg.new_chat_members) {
    getUser(member);
    registerUserInChat({ chat: msg.chat, from: member });

    if (notifySettings.joins) {
      bot.sendMessage(msg.chat.id, `👋 ${getTelegramName(member)} присоединился(ась) к группе`);
    }
  }
});

bot.onText(/^([+-])\s*(входы|выходы|входы-выходы)(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "joinleave")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👋 Настройка входов и выходов работает в группе.");
    return;
  }

  const isAdmin = await canUseAdminCommands(msg.chat.id, msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут настраивать входы и выходы.");
    return;
  }

  const settings = getJoinLeaveSettings(msg.chat.id);
  const sign = match[1];
  const type = match[2].toLowerCase();
  const count = match[3] ? Number(match[3]) : null;

  if (type === "входы") {
    settings.joins = sign === "+";
    saveChatSettings();
    bot.sendMessage(msg.chat.id, settings.joins ? "✅ Входы включены." : "❌ Входы отключены.");
    return;
  }

  if (type === "выходы") {
    settings.leaves = sign === "+";

    if (count !== null) {
      settings.leaveMinMessages = count;
      settings.leaves = true;
      saveChatSettings();
      bot.sendMessage(msg.chat.id, `✅ Выходы включены.\nПорог: ${count} сообщений.`);
      return;
    }

    saveChatSettings();
    bot.sendMessage(msg.chat.id, settings.leaves ? "✅ Выходы включены." : "❌ Выходы отключены.");
    return;
  }

  const enabled = sign === "+";
  settings.joins = enabled;
  settings.leaves = enabled;
  saveChatSettings();

  bot.sendMessage(
    msg.chat.id,
    enabled ? "✅ Входы и выходы включены." : "❌ Входы и выходы отключены."
  );
});

bot.onText(/^(?:\/autokick|автокик)(?:\s+(.*))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "autokick")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👢 Добавь меня в группу, чтобы пользоваться автокиком.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Только админы могут настраивать автокик.");
    return;
  }

  const value = (match[1] || "").trim().toLowerCase();

  if (!value) {
    const current = autoKickSettings.get(msg.chat.id);

    if (!current || current.enabled !== true) {
      bot.sendMessage(
        msg.chat.id,
        "👢 Автокик выключен.\n\nИспользование:\nавтокик 3 60 кик\nавтокик 3 60 бан\n/autokick off\n\nГде:\n3 — количество выходов\n60 — время в секундах\nкик или бан — наказание"
      );
      return;
    }

    bot.sendMessage(
      msg.chat.id,
      `👢 Автокик включён.\n\nВыходов: ${current.count}\nВремя: ${current.time} сек.\nНаказание: ${current.action === "ban" ? "бан" : "кик"}`
    );
    return;
  }

  if (["off", "выкл", "0"].includes(value)) {
    autoKickSettings.delete(msg.chat.id);
    saveChatSettings();
    bot.sendMessage(msg.chat.id, "✅ Автокик выключен.");
    return;
  }

  if (["on", "вкл"].includes(value)) {
    if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "включить автокик")) {
      return;
    }

    autoKickSettings.set(msg.chat.id, {
      enabled: true,
      count: 3,
      time: 60,
      action: "kick"
    });
    saveChatSettings();

    bot.sendMessage(msg.chat.id, "✅ Автокик включён.\n\nПо умолчанию: 3 выхода за 60 секунд → кик.");
    return;
  }

  const parts = value.split(/\s+/);
  const count = Number(parts[0]);
  const time = Number(parts[1]);
  const action = parts[2];

  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(time) || time < 1 || !["кик", "kick", "бан", "ban"].includes(action)) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Неверный формат.\n\nПример:\nавтокик 3 60 кик\nавтокик 3 60 бан\n\nГде 3 — количество выходов, 60 — секунды."
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "включить автокик")) {
    return;
  }

  autoKickSettings.set(msg.chat.id, {
    enabled: true,
    count,
    time,
    action: ["бан", "ban"].includes(action) ? "ban" : "kick"
  });
  saveChatSettings();

  bot.sendMessage(
    msg.chat.id,
    `✅ Автокик настроен.\n\nЕсли участник выйдет ${count} раз за ${time} сек., будет: ${["бан", "ban"].includes(action) ? "бан" : "кик"}.`
  );
});

bot.on("my_chat_member", (update) => {
  const oldStatus = update.old_chat_member?.status;
  const newStatus = update.new_chat_member?.status;
  const chatId = update.chat.id;
  const adminName = getTelegramName(update.from);

  if (["member", "administrator"].includes(newStatus) && !chatInfo.has(chatId)) {
    chatInfo.set(chatId, {
      joinedAt: formatDateTime(),
      title: update.chat.title || "Группа",
      type: update.chat.type,
      users: []
    });
    saveChatInfo();
  } else if (["member", "administrator"].includes(newStatus) && chatInfo.has(chatId)) {
    const info = chatInfo.get(chatId);
    info.title = update.chat.title || info.title || "Группа";
    info.type = update.chat.type || info.type;
    if (!Array.isArray(info.users)) info.users = [];
    saveChatInfo();
  }

  if (["left", "kicked"].includes(newStatus)) {
    chatInfo.delete(chatId);
    chatUsers.delete(chatId);
    saveChatInfo();
  }

  if (["member", "administrator"].includes(newStatus) && !["member", "administrator"].includes(oldStatus)) {
    bot.sendMessage(chatId, getGroupMenuText(), getGroupKeyboard());
  }

  if (oldStatus !== "administrator" && newStatus === "administrator") {
    bot.sendMessage(
      chatId,
      `⛑ ${adminName} сделал(а) меня администратором группы.\n\nТеперь мне доступны функции модерации: warn, mute, unmute, kick, ban и unban.`
    );
  }
});

bot.onText(/^(?:\/warn(?:@\w+)?|варн)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "warn")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /warn.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /warn.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Чтобы выдать предупреждение, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /warn\n2. Напиши /warn @username\n3. Напиши /warn ID\n\nВажно: /warn @username работает только если бот уже видел этого пользователя в группе после запуска. Самый надёжный способ — ответить /warn на сообщение пользователя."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "предупредить");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  targetProfile.warnings += 1;
  saveUsers();

  if (targetProfile.warnings >= 3) {
    try {
      if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "забанить за 3 предупреждения")) {
        return;
      }

      await banChatMemberConfirmed(msg.chat.id, targetProfile.id);
      addAdminLog(msg.chat.id, "🚫 Автобан за 3 предупреждения", msg.from, getUserDisplayName(targetProfile), "Пользователь получил 3/3 предупреждений.");
      bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} получил 3/3 предупреждений и был забанен.`);
    } catch (error) {
      bot.sendMessage(
        msg.chat.id,
        `${getActionErrorText("забанить пользователя за 3 предупреждения", error)}\n\n⚠️ Предупреждение сохранено: 3/3.`
      );
    }
    return;
  }

  addAdminLog(msg.chat.id, "⚠️ Выдал предупреждение", msg.from, getUserDisplayName(targetProfile), `Предупреждения: ${targetProfile.warnings}/3`);

  bot.sendMessage(
    msg.chat.id,
    `⚠️ ${getUserDisplayName(targetProfile)} получил предупреждение.\n\nПредупреждения: ${targetProfile.warnings}/3`
  );
});

bot.onText(/^(?:\/unwarn(?:@\w+)?|анварн)(?:\s|$)/i, async (msg) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unwarn")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /unwarn.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /unwarn.");
    return;
  }

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "♻️ Чтобы снять предупреждения, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /unwarn\n2. Напиши /unwarn @username\n3. Напиши /unwarn ID"
    );
    return;
  }

  targetProfile.warnings = 0;
  saveUsers();

  addAdminLog(msg.chat.id, "♻️ Снял предупреждения", msg.from, getUserDisplayName(targetProfile), "Предупреждения: 0/3");

  bot.sendMessage(
    msg.chat.id,
    `♻️ У пользователя ${getUserDisplayName(targetProfile)} сняты все предупреждения.\n\nПредупреждения: 0/3`
  );
});

bot.onText(/^(?:\/mute(?:@\w+)?|мут)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "mute")) return;

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "🔇 Чтобы замьютить пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /mute 10m\n2. Напиши /mute @username 10m\n3. Напиши /mute ID 10m\n\nФормат времени:\n1s — 1 секунда\n1m — 1 минута\n1d — 1 день\n\nВажно: /mute @username работает только если бот уже видел этого пользователя в группе после запуска."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "замьютить");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  const duration = parseMuteDuration(msg.text);

  if (!duration) {
    bot.sendMessage(
      msg.chat.id,
      "⛔ Неверный формат времени.\n\n🔇 Формат времени:\n1s — 1 секунда\n1m — 1 минута\n1d — 1 день\n\nПример:\n/mute 10m\n/mute 1d"
    );
    return;
  }

  if (duration.seconds > MAX_MUTE_SECONDS) {
    bot.sendMessage(msg.chat.id, "⛔ Максимальный срок мута — 365 дней.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "замьютить пользователя")) {
    return;
  }

  const untilDate = Math.floor(Date.now() / 1000) + duration.seconds;
  const timerKey = `${msg.chat.id}:${targetProfile.id}`;

  try {
    await applyMuteVerified(msg.chat.id, targetProfile.id, untilDate);
    const muteRecord = {
      chatId: msg.chat.id,
      userId: targetProfile.id,
      expiresAt: new Date(untilDate * 1000).toISOString(),
      displayName: getUserDisplayName(targetProfile),
      mutedBy: msg.from.id,
      createdAt: new Date().toISOString()
    };
    activeMutes.set(timerKey, muteRecord);
    saveChatSettings();
    scheduleMuteExpiration(muteRecord);
    addAdminLog(msg.chat.id, "🔇 Замьютил", msg.from, getUserDisplayName(targetProfile), `Время: ${duration.label}`);
    bot.sendMessage(msg.chat.id, `🔇 ${getUserDisplayName(targetProfile)} получил мут на ${duration.label}.\n✅ Ограничения подтверждены Telegram.`);
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText("замьютить пользователя", error)
    );
  }
});

bot.onText(/^(?:\/unmute(?:@\w+)?|размут)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "unmute")) return;

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "🔊 Чтобы снять мут, ответь на сообщение пользователя командой /unmute или напиши /unmute @username."
    );
    return;
  }

  const timerKey = `${msg.chat.id}:${targetProfile.id}`;

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "снять мут")) {
    return;
  }

  try {
    const currentMember = await bot.getChatMember(msg.chat.id, targetProfile.id);
    if (!activeMutes.has(timerKey) && !isMemberMuted(currentMember)) {
      bot.sendMessage(msg.chat.id, "У пользователя нет активного мута.");
      return;
    }
    await liftMuteVerified(msg.chat.id, targetProfile.id);
    clearMuteState(msg.chat.id, targetProfile.id);
    addAdminLog(msg.chat.id, "🔊 Снял мут", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `🔊 С пользователя ${getUserDisplayName(targetProfile)} снят мут.\n✅ Снятие подтверждено Telegram.`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("снять мут", error));
  }
});

bot.onText(/^(?:\/(?:kick|cick)(?:@\w+)?|кик)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "kick")) return;

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "👢 Чтобы кикнуть пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /kick\n2. Напиши /kick @username\n3. Напиши /kick ID\n\nВажно: /kick @username работает только если бот уже видел этого пользователя в группе после запуска. Самый надёжный способ — ответить /kick на сообщение пользователя."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "кикнуть");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "кикнуть пользователя")) {
    return;
  }

  try {
    await banChatMemberConfirmed(msg.chat.id, targetProfile.id, {
      until_date: Math.floor(Date.now() / 1000) + 40
    });

    setTimeout(() => {
      bot.unbanChatMember(msg.chat.id, targetProfile.id, { only_if_banned: true }).catch((error) => {
        console.error("Kick temporary unban error:", getErrorMessage(error));
      });
    }, 1000);

    addAdminLog(msg.chat.id, "👢 Кикнул", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `👢 ${getUserDisplayName(targetProfile)} был(а) кикнут(а) из группы.`);
  } catch (error) {
    bot.sendMessage(
      msg.chat.id,
      getActionErrorText("кикнуть пользователя", error)
    );
  }
});

bot.onText(/^(?:\/ban(?:@\w+)?|бан)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "ban")) return;

  const targetProfile = resolveTargetProfile(msg);

  if (!targetProfile) {
    bot.sendMessage(
      msg.chat.id,
      "🚫 Чтобы забанить пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /ban\n2. Напиши /ban @username\n3. Напиши /ban ID\n\nВажно: /ban @username работает только если бот уже видел этого пользователя в группе после запуска. Самый надёжный способ — ответить /ban на сообщение пользователя."
    );
    return;
  }

  const targetError = await ensureModeratableTarget(msg, targetProfile, "забанить");

  if (targetError) {
    bot.sendMessage(msg.chat.id, targetError);
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "забанить пользователя")) {
    return;
  }

  try {
    await banChatMemberConfirmed(msg.chat.id, targetProfile.id);
    addAdminLog(msg.chat.id, "🚫 Забанил", msg.from, getUserDisplayName(targetProfile));
    bot.sendMessage(msg.chat.id, `🚫 ${getUserDisplayName(targetProfile)} был забанен.`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("забанить пользователя", error));
  }
});

bot.onText(/^(?:\/unban(?:@\w+)?|разбан)(?:\s|$)/i, async (msg) => {
  if (!await ensureGroupAdminCommand(msg, "unban")) return;

  let targetProfile = null;
  let userId = null;

  if (msg.reply_to_message && msg.reply_to_message.from) {
    targetProfile = getUser(msg.reply_to_message.from);
    userId = targetProfile.id;
  } else {
    const parts = msg.text.trim().split(/\s+/);
    const target = parts[1];

    if (target) {
      const cleanTarget = target.replace("@", "");

      if (/^\d+$/.test(cleanTarget)) {
        userId = Number(cleanTarget);
        targetProfile = users.get(userId) || null;
      } else {
        targetProfile = findUserByUsername(cleanTarget);
        if (targetProfile) userId = targetProfile.id;
      }
    }
  }

  if (!userId) {
    bot.sendMessage(
      msg.chat.id,
      "✅ Чтобы разбанить пользователя, используй один из вариантов:\n\n1. Ответь на сообщение пользователя командой /unban\n2. Напиши /unban @username\n3. Напиши /unban ID\n\nВажно: /unban @username работает только если бот уже видел этого пользователя в группе. Если не сработало — используй ID."
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_restrict_members", "Блокировка пользователей / Ограничение участников", "разбанить пользователя")) {
    return;
  }

  try {
    await bot.unbanChatMember(msg.chat.id, userId, { only_if_banned: true });

    if (targetProfile) {
      targetProfile.warnings = 0;
      saveUsers();
    }

    const targetText = targetProfile ? getUserDisplayName(targetProfile) : "ID:" + userId;
    addAdminLog(msg.chat.id, "✅ Разбанил", msg.from, targetText);
    bot.sendMessage(msg.chat.id, `✅ Пользователь ${targetProfile ? getUserDisplayName(targetProfile) : "с ID " + userId} разбанен.`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("разбанить пользователя", error));
  }
});

bot.onText(/^\/(clear|claer)(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "clear")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "👤 Добавь меня в группу, чтобы пользоваться командой /clear.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете пользоваться командой /clear.");
    return;
  }

  if (!match[2]) {
    bot.sendMessage(
      msg.chat.id,
      "🧹 Укажите количество сообщений для удаления.\n\nПример:\n/clear 10 — удалить последние 10 сообщений\n/clear 20 — удалить последние 20 сообщений"
    );
    return;
  }

  const count = Number(match[2]);

  if (!Number.isInteger(count) || count < 1) {
    bot.sendMessage(
      msg.chat.id,
      "🧹 Используй команду так:\n\n/clear — удалить последнее сообщение\n/clear 10 — удалить последние 10 сообщений\n/clear 20 — удалить последние 20 сообщений"
    );
    return;
  }

  if (count > 100) {
    bot.sendMessage(msg.chat.id, "⚠️ За один раз можно удалить максимум 100 сообщений.");
    return;
  }

  if (!await ensureBotPermission(msg, "can_delete_messages", "Удаление сообщений", "удалить сообщения")) {
    return;
  }

  const fromMessageId = Math.max(1, msg.message_id - count);
  const toMessageId = msg.message_id - 1;
  let deletedCount = 0;
  let lastDeleteError = null;

  for (let messageId = fromMessageId; messageId <= toMessageId; messageId++) {
    let attempts = 0;
    let succeeded = false;

    while (attempts < 2 && !succeeded) {
      try {
        await bot.deleteMessage(msg.chat.id, messageId);
        succeeded = true;
        deletedCount += 1;
      } catch (error) {
        const retryAfter = error?.response?.body?.parameters?.retry_after;

        if (retryAfter && attempts === 0) {
          await sleep((retryAfter + 1) * 1000);
          attempts += 1;
          continue;
        }

        lastDeleteError = error;
        break;
      }
    }

    await sleep(35);
  }

  if (deletedCount === 0) {
    bot.sendMessage(
      msg.chat.id,
      lastDeleteError
        ? getActionErrorText("удалить сообщения", lastDeleteError)
        : "⚠️ Не получилось удалить сообщения."
    );
    return;
  }

  addAdminLog(msg.chat.id, "🧹 Очистил сообщения", msg.from, "Чат", `Удалено сообщений: ${deletedCount}`);
  bot.sendMessage(msg.chat.id, `🧹 Удалено сообщений: ${deletedCount}`);
});

bot.onText(/^(?:\/pin(?:@\w+)?|!пин|!pin)(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "pin")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📌 Добавь меня в группу, чтобы пользоваться закреплением сообщений.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете закреплять сообщения.");
    return;
  }

  let targetMessageId = null;

  if (msg.reply_to_message) {
    targetMessageId = msg.reply_to_message.message_id;
  } else if (match[1]) {
    targetMessageId = Number(match[1]);
  }

  if (!targetMessageId) {
    bot.sendMessage(
      msg.chat.id,
      "📌 Чтобы закрепить сообщение, ответь на него командой /pin или !пин.\n\nТакже можно по ID:\n/pin 1234\n!пин 1234\n\nЧтобы узнать ID, ответь на сообщение текстом: смс ид"
    );
    return;
  }

  if (!await ensureBotPermission(msg, "can_pin_messages", "Закрепление сообщений", "закрепить сообщение")) {
    return;
  }

  try {
    await bot.pinChatMessage(msg.chat.id, targetMessageId, {
      disable_notification: false
    });

    addAdminLog(msg.chat.id, "📌 Закрепил сообщение", msg.from, `ID:${targetMessageId}`);
    bot.sendMessage(msg.chat.id, `📌 Сообщение закреплено.\nID: ${targetMessageId}`);
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("закрепить сообщение", error));
  }
});

bot.onText(/^(?:\/unpin(?:@\w+)?|!анпин|!unpin)(?:\s+(\d+))?$/i, async (msg, match) => {
  registerUserInChat(msg);
  if (!ensureCommandEnabled(msg, "unpin")) return;

  if (isPrivateChat(msg)) {
    bot.sendMessage(msg.chat.id, "📍 Добавь меня в группу, чтобы пользоваться откреплением сообщений.");
    return;
  }

  const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

  if (!senderCanUseAdminCommands) {
    bot.sendMessage(msg.chat.id, "⛔ Вы не админ, поэтому не можете откреплять сообщения.");
    return;
  }

  const targetMessageId = msg.reply_to_message ? msg.reply_to_message.message_id : match[1] ? Number(match[1]) : null;

  if (!await ensureBotPermission(msg, "can_pin_messages", "Закрепление сообщений", "открепить сообщение")) {
    return;
  }

  try {
    if (targetMessageId) {
      await bot.unpinChatMessage(msg.chat.id, { message_id: targetMessageId });
      addAdminLog(msg.chat.id, "📍 Открепил сообщение", msg.from, `ID:${targetMessageId}`);
      bot.sendMessage(msg.chat.id, `📍 Сообщение откреплено.\nID: ${targetMessageId}`);
      return;
    }

    await bot.unpinChatMessage(msg.chat.id);
    addAdminLog(msg.chat.id, "📍 Открепил последнее закреплённое сообщение", msg.from, "Чат");
    bot.sendMessage(msg.chat.id, "📍 Последнее закреплённое сообщение откреплено.");
  } catch (error) {
    bot.sendMessage(msg.chat.id, getActionErrorText("открепить сообщение", error));
  }
});

bot.on("message", async (msg) => {
  if (!msg.text) return;
  registerUserInChat(msg);
  if (isPrivateChat(msg)) return;

  const rulesInputKey = `${msg.chat.id}:${msg.from.id}`;

  if (waitingRulesInput.has(rulesInputKey)) {
    waitingRulesInput.delete(rulesInputKey);

    const senderCanUseAdminCommands = await canUseAdminCommands(msg.chat.id, msg.from.id);

    if (!senderCanUseAdminCommands) {
      bot.sendMessage(msg.chat.id, "⛔ Только админы могут менять правила группы.");
      return;
    }

    const rulesText = msg.text.trim();

    if (rulesText.length > 3500) {
      bot.sendMessage(msg.chat.id, "⚠️ Правила слишком длинные. Сократи текст до 3500 символов.");
      return;
    }

    chatRules.set(msg.chat.id, rulesText);
    saveChatSettings();
    addAdminLog(msg.chat.id, "📜 Обновил правила", msg.from, "Группа");
    bot.sendMessage(msg.chat.id, "✅ Правила группы обновлены.\n\nПосмотреть: /rules");
    return;
  }

  if (msg.text.match(/^(?:сливки\s+брак|брак|\/brak)(?:\s+(.+))?$/i) && !ensureCommandEnabled(msg, "brak")) {
    return;
  }

  if (msg.text.match(/^(?:сливки\s+развод|развод|\/razvod)$/i) && !ensureCommandEnabled(msg, "razvod")) {
    return;
  }

  if (/^браки$/i.test(msg.text.trim())) {
    if (!ensureCommandEnabled(msg, "brak")) return;

    const storedList = getAllMarriages(msg.chat.id);

    if (!storedList.length) {
      bot.sendMessage(
        msg.chat.id,
        "💔 В этом чате пока никто не женат.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const list = await resolveMarriageParticipants(storedList, {
      chatId: msg.chat.id,
      getStoredUser: (userId) => users.get(userId),
      getChatMember: (chatId, userId) => bot.getChatMember(chatId, userId),
      upsertUser: (telegramUser) => getUser(telegramUser),
      onDiagnostic: (diagnostic) => {
        recordMarriageListDiagnostic(msg.chat.id, "marriage.participant_resolution", diagnostic);
      }
    });

    const messages = formatMarriageListMessages(list, {
      escapeHtml: escapeHtmlText,
      onDiagnostic: (diagnostic) => {
        recordMarriageListDiagnostic(msg.chat.id, "marriage.list_format", diagnostic);
      }
    });

    for (const [index, text] of messages.entries()) {
      const options = { parse_mode: "HTML" };
      if (index === 0) options.reply_parameters = { message_id: msg.message_id };
      await sendMessageSafe(msg.chat.id, text, options, "marriageList");
    }
    return;
  }

  if (/^любовь$/i.test(msg.text.trim())) {
    if (!ensureCommandEnabled(msg, "brak")) return;

    if (!msg.reply_to_message?.from) {
      bot.sendMessage(
        msg.chat.id,
        "💞 Ответь на сообщение своей второй половинки и напиши: любовь",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const partnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);

    if (!partnerId) {
      bot.sendMessage(
        msg.chat.id,
        "💔 У тебя пока нет игровой семьи. Сначала заключи брак.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (Number(msg.reply_to_message.from.id) !== Number(partnerId)) {
      bot.sendMessage(
        msg.chat.id,
        "💞 Любовь можно отправить только своей второй половинке.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const result = familySystem.addLove(msg.chat.id, msg.from.id, partnerId);

    if (!result.ok && result.reason === "cooldown") {
      bot.sendMessage(
        msg.chat.id,
        `⏳ Семейную любовь уже начисляли недавно.\n\nПопробуйте снова через ${familySystem.formatRemainingTime(result.remainingMs)}.`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (!result.ok && result.reason === "item_required") {
      bot.sendMessage(
        msg.chat.id,
        `🔒 Для работы по этой профессии нужен актив: ${result.requiredItemName}. Категория пока недоступна для использования.`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    bot.sendMessage(
      msg.chat.id,
      [
        "💞 Любовь принята!",
        "",
        `❤️ +${result.loveGain} любви`,
        `⭐ +${result.xpGain} опыта семьи`,
        `🏡 Уровень семьи: ${result.family.level}`,
        result.leveledUp ? "🎉 Семья получила новый уровень!" : ""
      ].filter(Boolean).join("\n"),
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  if (/^семья$/i.test(msg.text.trim())) {
    if (!ensureCommandEnabled(msg, "brak")) return;

    const partnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);

    if (!partnerId) {
      bot.sendMessage(
        msg.chat.id,
        "💔 У тебя пока нет игровой семьи. Напиши брак ответом на сообщение участника.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const family = familySystem.ensureFamilyForMarriage(msg.chat.id, msg.from.id, partnerId);
    const partner = users.get(partnerId);
    const firstName = getMarriageDisplayName(getUser(msg.from));
    const partnerName = partner ? getMarriageDisplayName(partner) : `ID:${partnerId}`;
    const firstCareer = familySystem.getCareer(msg.from.id);
    const partnerCareer = familySystem.getCareer(partnerId);
    const xpToNextLevel = familySystem.getXpToNextLevel(family.level);

    bot.sendMessage(
      msg.chat.id,
      [
        "🏡 Семья",
        "",
        `💍 Пара: ${firstName} 💞 ${partnerName}`,
        `🏆 Уровень: ${family.level}`,
        `⭐ Опыт: ${family.xp}/${xpToNextLevel}`,
        `❤️ Любовь: ${family.love}`,
        `💰 Баланс: ${family.balance}`,
        "",
        "💼 Карьера:",
        `• ${firstName}: ${familySystem.getProfessionName(firstCareer.profession)} ур. ${firstCareer.level}`,
        `• ${partnerName}: ${familySystem.getProfessionName(partnerCareer.profession)} ур. ${partnerCareer.level}`
      ].join("\n"),
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  if (/^работать$/i.test(msg.text.trim())) {
    registerUserInChat(msg);
    if (!ensureCommandEnabled(msg, "career")) return;

    if (isPrivateChat(msg)) {
      bot.sendMessage(msg.chat.id, "💼 Карьера работает в группе, где есть игровая семья.");
      return;
    }

    const partnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);
    const result = familySystem.doWork(msg.from.id, {
      chatId: msg.chat.id,
      partnerId
    });

    if (!result.ok && result.reason === "no_marriage") {
      bot.sendMessage(
        msg.chat.id,
        "💔 Чтобы работать и пополнять семейный баланс, сначала заключи игровой брак.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (!result.ok && result.reason === "unemployed") {
      bot.sendMessage(
        msg.chat.id,
        "💼 У тебя пока нет профессии.\n\nНапиши: профессии\nЗатем выбери: сменить профессию курьер",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (!result.ok && result.reason === "cooldown") {
      bot.sendMessage(
        msg.chat.id,
        `⏳ Ты уже работал(а) недавно.\n\nСледующая смена через ${familySystem.formatRemainingTime(result.remainingMs)}.`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const xpLeft = Math.max(0, result.xpToNextLevel - result.career.xp);

    bot.sendMessage(
      msg.chat.id,
      [
        `💼 Ты поработал(а): ${result.professionName.toLowerCase()} и заработал(а) ${result.earned} монет для семьи!`,
        `⭐ +${result.xpGain} опыта карьеры (Уровень ${result.career.level}, до след. уровня: ${xpLeft} XP)`,
        result.leveledUp ? "🎉 Карьерный уровень повышен!" : ""
      ].filter(Boolean).join("\n"),
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  if (/^профессии$/i.test(msg.text.trim())) {
    registerUserInChat(msg);
    if (!ensureCommandEnabled(msg, "career")) return;

    const career = familySystem.getCareer(msg.from.id);
    const professions = familySystem.getAvailableProfessions(msg.from.id);
    const lines = professions.map((profession) => {
      const lock = profession.unlocked ? "🔓" : "🔒";
      const current = profession.current ? " — выбрана" : "";
      const itemText = profession.requiresItem
        ? `, нужен предмет: ${familySystem.getRequiredItemName(profession.requiresItem)}`
        : "";

      return `${lock} ${profession.name} (${profession.key}) — с ур. ${profession.requiredLevel}${itemText}${current}`;
    });

    bot.sendMessage(
      msg.chat.id,
      [
        "💼 Профессии",
        "",
        `👤 Текущая: ${familySystem.getProfessionName(career.profession)} ур. ${career.level}`,
        `⭐ Опыт: ${career.xp}/${familySystem.getXpToNextCareerLevel(career.level)}`,
        "",
        lines.join("\n"),
        "",
        "🔁 Смена: сменить профессию курьер"
      ].join("\n"),
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  const switchProfessionMatch = msg.text.trim().match(/^сменить\s+профессию\s+(.+)$/i);

  if (switchProfessionMatch) {
    registerUserInChat(msg);
    if (!ensureCommandEnabled(msg, "career")) return;

    const professionText = switchProfessionMatch[1].trim();
    const result = familySystem.switchProfession(msg.from.id, professionText);

    if (!result.ok && result.reason === "unknown_profession") {
      bot.sendMessage(
        msg.chat.id,
        "⚠️ Профессия не найдена.\n\nНапиши: профессии",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (!result.ok && result.reason === "level_required") {
      bot.sendMessage(
        msg.chat.id,
        `🔒 ${result.professionName} пока недоступен.\n\nНужен карьерный уровень: ${result.requiredLevel}\nТвой уровень: ${result.career.level}`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (!result.ok && result.reason === "item_required") {
      bot.sendMessage(
        msg.chat.id,
        `🔒 ${result.professionName} пока недоступен. Нужен актив: ${result.requiredItemName}.`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    bot.sendMessage(
      msg.chat.id,
      `✅ Профессия изменена: ${result.professionName}.\n\nТеперь можно написать: работать`,
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  const commandText = (msg.text || "").trim().toLowerCase();
  const commandData = RP_COMMANDS[commandText];

  if (commandData) {
    if (!ensureCommandEnabled(msg, "action")) return;

    if (!msg.reply_to_message?.from) {
      bot.sendMessage(
        msg.chat.id,
        RP_REPLY_HINT,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });
    await sendRpActionMessage(msg, commandText, commandData);
    return;
  }

  if (/^(?:смс\s*ид|sms\s*id|message\s*id)$/i.test(msg.text.trim())) {
    if (!ensureCommandEnabled(msg, "messageid")) return;

    const targetMessageId = msg.reply_to_message ? msg.reply_to_message.message_id : msg.message_id;

    bot.sendMessage(
      msg.chat.id,
      `🧾 ID сообщения: ${targetMessageId}`,
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  if (!chatInfo.has(msg.chat.id)) {
    chatInfo.set(msg.chat.id, {
      joinedAt: formatDateTime(),
      title: msg.chat.title || "Группа",
      type: msg.chat.type,
      users: []
    });
    saveChatInfo();
  }

  resetDailyStatsIfNeeded();
  addActivity(msg.from);
  stats.messagesToday += 1;

  if (!stats.chatMessagesToday || typeof stats.chatMessagesToday !== "object") {
    stats.chatMessagesToday = {};
  }

  stats.chatMessagesToday[msg.chat.id] = (stats.chatMessagesToday[msg.chat.id] || 0) + 1;
  saveStats();

  if (isBestUserQuestion(msg.text)) {
    const bestUser = getRandomChatUser(msg.chat.id, botId);

    if (!bestUser) {
      bot.sendMessage(
        msg.chat.id,
        "🏆 Пока не из кого выбрать лучшего. Пусть участники напишут пару сообщений в группе.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    bot.sendMessage(
      msg.chat.id,
      `🏆 Лучший сегодня: ${getUserDisplayName(bestUser)}`,
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  const slivkiWhoSubject = getSlivkiWhoSubject(msg.text);

  if (slivkiWhoSubject) {
    const randomUser = getRandomChatUser(msg.chat.id, botId);

    if (!randomUser) {
      bot.sendMessage(
        msg.chat.id,
        "Пока не знаю участников этого чата. Пусть участники напишут пару сообщений, и я смогу выбрать.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    bot.sendMessage(
      msg.chat.id,
      `${getUserDisplayName(randomUser)} — ${slivkiWhoSubject}`,
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }

  // --- "сливки брак" feature
  const marriageMatch = msg.text.match(/^(?:сливки\s+брак|брак|\/brak)(?:\s+(.+))?$/i);

  if (marriageMatch) {
    const userName = getMarriageDisplayName(msg.from);
    const currentPartnerId = getMarriagePartnerId(msg.chat.id, msg.from.id);

    if (currentPartnerId) {
      const currentPartner = users.get(currentPartnerId);
      const currentPartnerName = currentPartner ? getMarriageDisplayName(currentPartner) : `ID:${currentPartnerId}`;

      bot.sendMessage(
        msg.chat.id,
        `💍 ${userName} уже состоит в игровом браке.\n\n💞 Вторая половинка: ${currentPartnerName}\n\nЧтобы отменить: напиши "развод" или /razvod`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    let partnerId = null;
    let partnerName = "";

    if (msg.reply_to_message?.from) {
      const partnerProfile = getUser(msg.reply_to_message.from);
      registerUserInChat({ chat: msg.chat, from: msg.reply_to_message.from });
      partnerId = partnerProfile.id;
      partnerName = getMarriageDisplayName(partnerProfile);
    } else if (marriageMatch[1]) {
      const targetText = marriageMatch[1].trim();
      const cleanTarget = targetText.replace("@", "");
      const foundUser = findUserByUsername(cleanTarget);

      if (foundUser) {
        partnerId = foundUser.id;
        partnerName = getMarriageDisplayName(foundUser);
      }
    }

    if (!partnerName || !partnerId) {
      bot.sendMessage(
        msg.chat.id,
        "💍 Укажи конкретного пользователя: ответь командой на его сообщение или напиши брак @username.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (partnerId === msg.from.id) {
      bot.sendMessage(
        msg.chat.id,
        "💍 Самого себя выбрать нельзя.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const partnerProfileForCheck = users.get(partnerId);

    if (partnerProfileForCheck?.isBot) {
      bot.sendMessage(
        msg.chat.id,
        "💍 Ботов нельзя выбирать для брака.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    if (getMarriagePartnerId(msg.chat.id, partnerId)) {
      bot.sendMessage(
        msg.chat.id,
        `💍 ${partnerName} уже состоит в игровом браке.`,
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const proposalId = createMarriageProposal(msg.chat.id, msg.from.id, partnerId);
    const loveQuote = getNextLoveQuote();

    bot.sendMessage(
      msg.chat.id,
      getMarriageProposalText(userName, partnerName, loveQuote),
      {
        reply_parameters: { message_id: msg.message_id },
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Принять", callback_data: `marriage_accept:${proposalId}` },
              { text: "❌ Отказаться", callback_data: `marriage_decline:${proposalId}` }
            ]
          ]
        }
      }
    );

    return;
  }

  const divorceMatch = msg.text.match(/^(?:сливки\s+развод|развод|\/razvod)$/i);

  if (divorceMatch) {
    const partnerId = removeMarriage(msg.chat.id, msg.from.id);

    if (!partnerId) {
      bot.sendMessage(
        msg.chat.id,
        "💔 У тебя пока нет игрового брака.",
        { reply_parameters: { message_id: msg.message_id } }
      );
      return;
    }

    const partner = users.get(partnerId);
    const partnerName = partner ? getMarriageDisplayName(partner) : `ID:${partnerId}`;

    bot.sendMessage(
      msg.chat.id,
      `💔 Игровой брак расторгнут.\n\n${getMarriageDisplayName(msg.from)} и ${partnerName} больше не вместе.`,
      { reply_parameters: { message_id: msg.message_id } }
    );
    return;
  }
});

restoreActiveMutes().catch((error) => {
  console.error("Mute recovery error:", getErrorMessage(error));
});
restoreQuizTimers();

function stopBot(signal) {
  tagCallController.stopAll();
  deferredJsonWriter.flushAll();
  return bot.stopPolling({ cancel: true, reason: signal });
}

process.once("SIGINT", () => stopBot("SIGINT"));
process.once("SIGTERM", () => stopBot("SIGTERM"));

bot.on("message", async (msg) => {
  if (!isPrivateChat(msg)) return;
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;
  if (parseOwnerCoinGrant(msg.text).attempted) return;
  const supportExpiresAt = supportUsers.get(msg.from.id);
  if (!supportExpiresAt || supportExpiresAt <= Date.now()) {
    supportUsers.delete(msg.from.id);
    return;
  }

  supportUsers.delete(msg.from.id);

  const sender = getTelegramName(msg.from);

  for (const ownerId of ownerIds) {
    try {
      await bot.sendMessage(
        ownerId,
        `📩 Новое обращение в поддержку\n\n👤 От: ${sender}\n🆔 ID: ${msg.from.id}\n\n💬 Сообщение:\n${msg.text}`
      );
    } catch (error) {
      console.error(`Support forward error (${ownerId}):`, getErrorMessage(error));
    }
  }

  await bot.sendMessage(
    msg.chat.id,
    "✅ Ваше сообщение отправлено в поддержку."
  );
});

bot.on("message", async (msg) => {
  if (!isSlashCommandMessage(msg)) return;
  if (isKnownSlashCommand(msg.text, msg)) return;
  if (!(await shouldReportUnknownCommand(msg))) return;

  bot.sendMessage(
    msg.chat.id,
    UNKNOWN_COMMAND_TEXT,
    { reply_parameters: { message_id: msg.message_id } }
  ).catch((error) => {
    console.error("Unknown command fallback error:", getErrorMessage(error));
  });
});
