"use strict";

/**
 * random-picks.js
 * -----------------------------------------------------------------------
 * Система случайных "кто из чата X" команд (/лох, /сигма, /гигачад ...).
 *
 * Дизайн сделан так, чтобы расширяться без правки логики:
 * - Хочешь добавить новую команду → добавь запись в LABELS.
 * - Хочешь добавить новый "источник" (магический шар, ИИ, таро...) →
 *   добавь запись в SOURCES.
 * - Хочешь больше вариантов фраз → просто дописывай строки в templates,
 *   логика подхватит их автоматически (случайный выбор).
 *
 * Файл не трогает Telegram API напрямую вне переданных зависимостей —
 * это позволяет тестировать и переиспользовать модуль отдельно от bot.js.
 */

// ---------------------------------------------------------------------
// Источники "предсказания". emoji используется в анимации и в финальном
// сообщении, frames — короткие фразы прогресса ожидания (3 шага).
// ---------------------------------------------------------------------
const SOURCES = [
  { key: "ball", emoji: "🔮", name: "Магический шар", frames: ["всматривается в дымку", "видит силуэт", "фокусируется"] },
  { key: "ai", emoji: "🤖", name: "Искусственный интеллект", frames: ["анализирует участников", "считает вероятности", "выдаёт вердикт"] },
  { key: "prophecy", emoji: "📜", name: "Древнее пророчество", frames: ["разворачивается", "проявляются буквы", "текст читается"] },
  { key: "wizard", emoji: "🧙", name: "Волшебник", frames: ["чертит руны", "шепчет заклинание", "взмахивает посохом"] },
  { key: "coffee", emoji: "☕", name: "Кофейная гуща", frames: ["оседает на дне чашки", "складывается в узор", "проявляет силуэт"] },
  { key: "tarot", emoji: "🃏", name: "Карты Таро", frames: ["тасуются", "ложатся на стол", "переворачивается карта"] },
  { key: "universe", emoji: "🌌", name: "Вселенная", frames: ["выравнивает звёзды", "посылает знак", "открывает портал"] },
  { key: "stars", emoji: "🌟", name: "Звёзды", frames: ["выстраиваются в ряд", "мерцают", "загораются ярче"] },
  { key: "allseeingeye", emoji: "👁", name: "Всевидящее око", frames: ["наблюдает за чатом", "ищет достойного", "делает выбор"] },
  { key: "station", emoji: "🛰️", name: "Орбитальная станция", frames: ["сканирует участников", "получает телеметрию", "фиксирует цель"] },
  { key: "comet", emoji: "☄️", name: "Комета", frames: ["пролетает над чатом", "оставляет сияющий след", "указывает направление"] },
  { key: "lightning", emoji: "⚡", name: "Молния", frames: ["озаряет небо", "бьёт совсем рядом", "выделяет участника"] },
  { key: "crystal", emoji: "💎", name: "Магический кристалл", frames: ["наполняется светом", "переливается", "отражает имя"] },
  { key: "owl", emoji: "🦉", name: "Мудрая сова", frames: ["наблюдает молча", "обдумывает выбор", "утвердительно кивает"] },
  { key: "wolf", emoji: "🐺", name: "Старый волк", frames: ["берёт след", "идёт по запаху", "находит цель"] },
  { key: "eagle", emoji: "🦅", name: "Орёл", frames: ["парит высоко", "высматривает добычу", "резко пикирует"] },
  { key: "unicorn", emoji: "🦄", name: "Единорог", frames: ["оставляет волшебный след", "сияет ярче", "делает выбор"] },
  { key: "matrix", emoji: "👾", name: "Матрица", frames: ["загружает симуляцию", "просчитывает варианты", "находит совпадение"] },
  { key: "brain", emoji: "🧠", name: "Нейросеть", frames: ["строит нейронные связи", "обучается", "выдаёт результат"] },
  { key: "tea", emoji: "🫖", name: "Чайные листья", frames: ["раскрываются", "складываются в узор", "подсказывают имя"] },
  { key: "phoenix", emoji: "🔥", name: "Феникс", frames: ["возрождается", "расправляет крылья", "делает выбор"] },
  { key: "raven", emoji: "🐦‍⬛", name: "Ворон", frames: ["кружит над чатом", "каркает загадочно", "садится рядом"] },
  { key: "hourglass", emoji: "⏳", name: "Песочные часы", frames: ["песок сыпется", "время почти вышло", "ответ найден"] },
  { key: "amulet", emoji: "🧿", name: "Магический амулет", frames: ["начинает светиться", "вибрирует", "указывает на цель"] },
  { key: "moon", emoji: "🌙", name: "Луна", frames: ["входит в фазу", "освещает чат", "шлёт лунный свет"] },
  { key: "sun", emoji: "☀️", name: "Солнце", frames: ["встаёт над чатом", "прогревает эфир", "даёт знак"] },
  { key: "space", emoji: "📡", name: "Космос", frames: ["ловит сигнал", "усиливает частоту", "декодирует сообщение"] },
  { key: "aliens", emoji: "👽", name: "Инопланетяне", frames: ["сканируют чат", "совещаются", "выносят вердикт"] },
  { key: "council", emoji: "🏛️", name: "Тайный совет", frames: ["собирается", "совещается", "оглашает решение"] },
  { key: "court", emoji: "⚖️", name: "Высший суд", frames: ["изучает дело", "советуется", "выносит приговор"] },
  { key: "book", emoji: "📖", name: "Книга судеб", frames: ["открывается", "страницы листаются", "строка проявляется"] },
  { key: "dice", emoji: "🎲", name: "Кубик судьбы", frames: ["подбрасывается", "катится по столу", "останавливается"] },
  { key: "rng", emoji: "🎰", name: "Генератор случайностей", frames: ["крутит барабаны", "перебирает варианты", "фиксирует результат"] },
  { key: "computer", emoji: "💻", name: "Суперкомпьютер", frames: ["запускает расчёт", "обрабатывает данные", "выводит ответ"] },
  { key: "lab", emoji: "🔬", name: "Лаборатория", frames: ["готовит образец", "проводит анализ", "фиксирует результат"] },
  { key: "dna", emoji: "🧬", name: "ДНК-анализ", frames: ["берёт пробу", "секвенирует", "сверяет базу"] },
  { key: "detective", emoji: "🕵️", name: "Детектив", frames: ["изучает улики", "сопоставляет факты", "называет подозреваемого"] },
  { key: "cat", emoji: "🐈", name: "Чёрный кот", frames: ["перебегает дорогу", "смотрит в упор", "мяукает"] },
  { key: "pigeon", emoji: "🐦", name: "Голубь удачи", frames: ["кружит над чатом", "выбирает цель", "садится рядом"] },
  { key: "dragon", emoji: "🐉", name: "Дракон", frames: ["просыпается", "принюхивается", "указывает лапой"] },
  { key: "ghost", emoji: "👻", name: "Призрак", frames: ["проявляется", "шепчет имя", "растворяется"] },
  { key: "genie", emoji: "🧞", name: "Джинн", frames: ["выходит из лампы", "выслушивает желание", "исполняет его"] },
  { key: "witch", emoji: "🧙‍♀️", name: "Ведьма", frames: ["варит зелье", "смотрит в котёл", "произносит имя"] },
  { key: "artifact", emoji: "🏺", name: "Древний артефакт", frames: ["нагревается", "светится", "показывает знак"] },
  { key: "radio", emoji: "📻", name: "Радио Вселенной", frames: ["ловит волну", "настраивается", "выдаёт сообщение"] },
  { key: "tv", emoji: "📺", name: "Тайный канал", frames: ["включается", "идут помехи", "картинка проясняется"] },
  { key: "eightball", emoji: "🎱", name: "Шар предсказаний", frames: ["взбалтывается", "всплывает ответ", "показывает текст"] },
  { key: "wand", emoji: "🪄", name: "Волшебная палочка", frames: ["искрит", "чертит символ", "указывает на цель"] },
  { key: "snake", emoji: "🐍", name: "Змея-оракул", frames: ["шипит", "обвивается вокруг чата", "указывает языком"] },
  { key: "candle", emoji: "🕯", name: "Свеча гадания", frames: ["зажигается", "дрожит на ветру", "выхватывает имя"] },
  { key: "bat", emoji: "🦇", name: "Летучая мышь", frames: ["вылетает из тени", "кружит над чатом", "садится на плечо"] },
  { key: "octopus", emoji: "🐙", name: "Оракул-осьминог", frames: ["перебирает щупальца", "выбирает конверт", "показывает ответ"] },
  { key: "darts", emoji: "🎯", name: "Дартс судьбы", frames: ["прицеливается", "летит", "попадает в цель"] },
  { key: "frog", emoji: "🐸", name: "Лягушка-предсказательница", frames: ["квакает трижды", "прыгает по кругу", "садится напротив"] },
  { key: "tornado", emoji: "🌪", name: "Торнадо решений", frames: ["набирает силу", "кружит по чату", "выбрасывает ответ"] },
  { key: "planet", emoji: "🪐", name: "Далёкая планета", frames: ["выходит на орбиту", "посылает сигнал", "расшифровывается"] },
  { key: "butterfly", emoji: "🦋", name: "Бабочка перемен", frames: ["взлетает", "кружит над столом", "садится на плечо"] }
];

// ---------------------------------------------------------------------
// Команды-ярлыки. Каждая запись:
//  - emoji: эмодзи команды (используется в финальном сообщении и текстах)
//  - templates: массив строк с плейсхолдером {user} (обязателен)
//  - excludeAdmins: не выбирать админов/владельца (по умолчанию false)
//  - excludeSelf: не выбирать автора команды (по умолчанию false)
// Добавляй сюда новые команды — регистрация в bot.js подхватит их
// автоматически через registerRandomPickCommands().
// ---------------------------------------------------------------------
const LABELS = {
  "лох": {
    emoji: "🤡",
    templates: [
      "сегодня официально лох чата — {user}",
      "{user}, поздравляю, ты лох дня!",
      "по всем признакам сегодняшний лох — {user}",
      "звание \"лох дня\" уходит к {user}"
    ]
  },
  "сигма": {
    emoji: "🗿",
    templates: [
      "сигма этого чата — {user}",
      "{user} сегодня максимально сигма",
      "молчаливый авторитет чата — {user}"
    ]
  },
  "гигачад": {
    emoji: "💪",
    templates: [
      "гигачад дня — {user}",
      "{user} сегодня на максималках гигачад",
      "звание гигачада уходит {user}"
    ]
  },
  "клоун": {
    emoji: "🤹",
    templates: [
      "клоун дня — {user}",
      "{user}, сегодня ты официальный клоун чата",
      "цирк уехал, а {user} остался"
    ]
  },
  "душнила": {
    emoji: "😮‍💨",
    templates: [
      "душнила дня — {user}",
      "{user} сегодня главный душнила чата",
      "звание душнилы уходит {user}"
    ]
  },
  "легенда": {
    emoji: "🏆",
    templates: [
      "легенда чата — {user}",
      "{user}, сегодня ты легенда",
      "в историю чата войдёт {user}"
    ]
  },
  "бомж": {
    emoji: "🥫",
    templates: [
      "бомж дня — {user}",
      "{user} сегодня официальный бомж чата",
      "звание бомжа уходит {user}"
    ]
  },
  "милый": {
    emoji: "🥰",
    templates: [
      "милашка дня — {user}",
      "{user}, сегодня ты самый милый в чате",
      "самый милый участник — {user}"
    ]
  },
  "красавчик": {
    emoji: "😎",
    templates: [
      "красавчик дня — {user}",
      "{user} сегодня главный красавчик чата",
      "звание красавчика уходит {user}"
    ]
  },
  "богач": {
    emoji: "🤑",
    templates: [
      "богач дня — {user}",
      "{user}, сегодня ты богач чата",
      "звание богача уходит {user}"
    ]
  },
  "неудачник": {
    emoji: "🍀",
    templates: [
      "неудачник дня — {user}",
      "{user}, сегодня не твой день",
      "звание неудачника уходит {user}"
    ]
  },
  "гений": {
    emoji: "🧠",
    templates: [
      "гений дня — {user}",
      "{user} сегодня официально гений чата",
      "звание гения уходит {user}"
    ]
  },
  "ленивый": {
    emoji: "🦥",
    templates: [
      "ленивец дня — {user}",
      "{user}, сегодня ты официальный ленивец",
      "звание ленивца уходит {user}"
    ]
  },
  "везунчик": {
    emoji: "🍀",
    templates: [
      "везунчик дня — {user}",
      "{user}, сегодня удача на твоей стороне",
      "звание везунчика уходит {user}"
    ]
  },
  "краш": {
    emoji: "💘",
    templates: [
      "краш чата — {user}",
      "{user}, сегодня ты краш чата",
      "звание краша уходит {user}"
    ]
  },
  "король": {
    emoji: "👑",
    templates: [
      "король чата — {user}",
      "{user}, сегодня ты король",
      "трон достаётся {user}"
    ]
  },
  "королева": {
    emoji: "👸",
    templates: [
      "королева чата — {user}",
      "{user}, сегодня ты королева",
      "трон достаётся {user}"
    ]
  },
  "скромняга": {
    emoji: "🙈",
    templates: [
      "скромняга дня — {user}",
      "{user} сегодня главный скромняга чата",
      "звание скромняги уходит {user}"
    ]
  },
  "токсик": {
    emoji: "☠️",
    templates: [
      "токсик дня — {user}",
      "{user}, сегодня ты токсик чата",
      "звание токсика уходит {user}"
    ]
  },
  "мем": {
    emoji: "😂",
    templates: [
      "главный мем чата — {user}",
      "{user}, сегодня ты главный мем",
      "звание главного мема уходит {user}"
    ]
  }
};

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000; // не повторять того же участника 15 минут подряд
const ANIMATION_STEP_DELAY_MS = 650;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function buildProgressFrame(source, stepText, percent) {
  const totalBars = 10;
  const filled = Math.round((percent / 100) * totalBars);
  const bar = "█".repeat(filled) + "░".repeat(totalBars - filled);

  return [
    `${source.emoji} ${source.name} ${stepText}...`,
    "",
    `${bar} ${percent}%`
  ].join("\n");
}

/**
 * RandomPicksService
 * Инкапсулирует всё состояние (антиповторы) и умеет проиграть анимацию
 * выбора + отправить финальный результат.
 *
 * Зависимости передаются снаружи (см. bot.js), чтобы не тащить сюда
 * прямую работу с Map пользователей чата — сервис лишь просит функции
 * "дай мне список известных ID участников чата" и "дай мне профиль по ID".
 */
class RandomPicksService {
  /**
   * @param {object} deps
   * @param {import('node-telegram-bot-api')} deps.bot
   * @param {(chatId: number) => number[]} deps.getKnownChatUserIds
   * @param {(userId: number) => object|undefined} deps.getStoredUser
   * @param {(profile: object) => string} deps.getUserDisplayName
   * @param {(userId: number, chatId: number) => Promise<boolean>} [deps.isUserAdmin]
   * @param {(error: any) => string} [deps.getErrorMessage]
   * @param {number} [deps.cooldownMs]
   */
  constructor(deps) {
    this.bot = deps.bot;
    this.getKnownChatUserIds = deps.getKnownChatUserIds;
    this.getStoredUser = deps.getStoredUser;
    this.getUserDisplayName = deps.getUserDisplayName;
    this.isUserAdmin = deps.isUserAdmin || (async () => false);
    this.getErrorMessage = deps.getErrorMessage || ((error) => error?.message || "неизвестная ошибка");
    this.cooldownMs = deps.cooldownMs || DEFAULT_COOLDOWN_MS;

    // key: `${chatId}:${labelKey}` -> { userId, at }
    this.recentPicks = new Map();
  }

  _recentPickKey(chatId, labelKey) {
    return `${chatId}:${labelKey}`;
  }

  _rememberPick(chatId, labelKey, userId) {
    this.recentPicks.set(this._recentPickKey(chatId, labelKey), {
      userId,
      at: Date.now()
    });
  }

  _getRecentPickUserId(chatId, labelKey) {
    const entry = this.recentPicks.get(this._recentPickKey(chatId, labelKey));
    if (!entry) return null;
    if (Date.now() - entry.at > this.cooldownMs) return null;
    return entry.userId;
  }

  async _getCandidates(chatId, labelKey, botId) {
    const label = LABELS[labelKey];
    const knownIds = Array.from(
      new Set((this.getKnownChatUserIds(chatId) || []).map(Number).filter(Number.isFinite))
    );

    let candidates = knownIds
      .map((userId) => this.getStoredUser(userId))
      .filter((profile) => profile && !profile.isBot && profile.id !== botId);

    if (label.excludeAdmins) {
      const adminChecks = await Promise.all(
        candidates.map((profile) => this.isUserAdmin(profile.id, chatId).catch(() => false))
      );
      candidates = candidates.filter((_, index) => !adminChecks[index]);
    }

    return candidates;
  }

  /**
   * Выбирает участника, стараясь не повторять недавний выбор для этой
   * же команды в этом же чате, и по возможности исключая автора команды
   * (если excludeUserId передан). Если кандидатов не хватает, ограничения
   * снимаются одно за другим, чтобы всегда вернуть хоть кого-то.
   */
  _choose(candidates, chatId, labelKey, excludeUserId) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    let pool = candidates;

    if (excludeUserId) {
      const withoutSelf = pool.filter((profile) => profile.id !== excludeUserId);
      if (withoutSelf.length > 0) pool = withoutSelf;
    }

    const recentUserId = this._getRecentPickUserId(chatId, labelKey);

    if (recentUserId) {
      const withoutRecent = pool.filter((profile) => profile.id !== recentUserId);
      if (withoutRecent.length > 0) pool = withoutRecent;
    }

    return getRandomItem(pool);
  }

  /**
   * Запускает анимацию ожидания + финальный результат для команды labelKey.
   * @param {object} msg — оригинальное сообщение Telegram
   * @param {string} labelKey — ключ из LABELS (например "лох")
   * @param {object} [options]
   * @param {number} [options.excludeUserId] — не выбирать этого пользователя
   */
  async run(msg, labelKey, options = {}) {
    const label = LABELS[labelKey];
    if (!label) return;

    const chatId = msg.chat.id;

    try {
      let botId = null;

      try {
        botId = (await this.bot.getMe()).id;
      } catch (error) {
        console.error("RandomPicks getMe error:", this.getErrorMessage(error));
      }

      const candidates = await this._getCandidates(chatId, labelKey, botId);

      if (candidates.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `🔍 Пока не знаю участников этого чата для команды «${labelKey}». Пусть люди напишут пару сообщений.`,
          { reply_to_message_id: msg.message_id }
        ).catch(() => {});
        return;
      }

      const chosen = this._choose(candidates, chatId, labelKey, options.excludeUserId);

      if (!chosen) {
        await this.bot.sendMessage(
          chatId,
          `🔍 Не удалось выбрать участника для «${labelKey}», попробуй ещё раз чуть позже.`,
          { reply_to_message_id: msg.message_id }
        ).catch(() => {});
        return;
      }

      const source = getRandomItem(SOURCES);

      const sent = await this.bot.sendMessage(
        chatId,
        buildProgressFrame(source, source.frames[0], 15),
        { reply_to_message_id: msg.message_id }
      );

      const percents = [40, 70, 100];

      for (let step = 0; step < percents.length; step += 1) {
        await sleep(ANIMATION_STEP_DELAY_MS);

        const isLastFrame = step === percents.length - 1;
        const frameText = isLastFrame
          ? "готово"
          : source.frames[Math.min(step + 1, source.frames.length - 1)];

        try {
          await this.bot.editMessageText(
            buildProgressFrame(source, frameText, percents[step]),
            { chat_id: chatId, message_id: sent.message_id }
          );
        } catch (error) {
          if (!this.getErrorMessage(error).includes("message is not modified")) {
            console.error("RandomPicks animation edit error:", this.getErrorMessage(error));
          }
        }
      }

      this._rememberPick(chatId, labelKey, chosen.id);

      const template = getRandomItem(label.templates);
      const resultText = `${label.emoji} ${source.name} говорит:\n\n${template.replace("{user}", this.getUserDisplayName(chosen))}`;

      try {
        await this.bot.editMessageText(resultText, { chat_id: chatId, message_id: sent.message_id });
      } catch (error) {
        if (!this.getErrorMessage(error).includes("message is not modified")) {
          console.error("RandomPicks final edit error:", this.getErrorMessage(error));
          // Если отредактировать не вышло — хотя бы отправим результат отдельным сообщением.
          await this.bot.sendMessage(chatId, resultText, { reply_to_message_id: msg.message_id }).catch(() => {});
        }
      }
    } catch (error) {
      console.error(`RandomPicks (${labelKey}) error:`, this.getErrorMessage(error));

      await this.bot.sendMessage(
        chatId,
        "⚠️ Что-то пошло не так, попробуй ещё раз чуть позже.",
        { reply_to_message_id: msg.message_id }
      ).catch(() => {});
    }
  }
}

/**
 * Регистрирует bot.onText-хендлер для каждой команды из LABELS.
 * Использование в bot.js:
 *
 *   const { RandomPicksService, registerRandomPickCommands } = require("./random-picks");
 *   const randomPicksService = new RandomPicksService({
 *     bot,
 *     getKnownChatUserIds,
 *     getStoredUser: (userId) => users.get(Number(userId)),
 *     getUserDisplayName,
 *     isUserAdmin,
 *     getErrorMessage
 *   });
 *   registerRandomPickCommands(bot, randomPicksService, {
 *     ensureCommandEnabled, // опционально — переиспользует твою систему вкл/выкл команд
 *     commandSettingKey: "randompicks",
 *     registerUserInChat,
 *     isPrivateChat
 *   });
 *
 * Команды доступны и как "/лох", и как "лох" без слэша (голым словом),
 * чтобы не плодить лишний RUSSIAN_COMMAND_ALIASES.
 */
function registerRandomPickCommands(bot, service, hooks = {}) {
  const {
    ensureCommandEnabled = () => true,
    commandSettingKey = null,
    registerUserInChat = () => {},
    isPrivateChat = (msg) => msg.chat.type === "private"
  } = hooks;

  for (const labelKey of Object.keys(LABELS)) {
    const pattern = new RegExp(`^(?:\\/${labelKey}(?:@\\w+)?|${labelKey})(?:\\s|$)`, "iu");

    bot.onText(pattern, async (msg) => {
      registerUserInChat(msg);

      if (commandSettingKey && !ensureCommandEnabled(msg, commandSettingKey)) return;

      if (isPrivateChat(msg)) {
        await bot.sendMessage(
          msg.chat.id,
          `${LABELS[labelKey].emoji} Добавь меня в группу, чтобы пользоваться командой /${labelKey}.`
        ).catch(() => {});
        return;
      }

      await service.run(msg, labelKey);
    });
  }
}

module.exports = {
  LABELS,
  SOURCES,
  RandomPicksService,
  registerRandomPickCommands
};