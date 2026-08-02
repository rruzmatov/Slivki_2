const fs = require("node:fs");
const { backupCorruptJson } = require("./json-file-safety");
const { randomInt, randomUUID } = require("node:crypto");

const QUIZ_REWARD = 20;
const DEFAULT_QUIZ_DURATION_MS = 45_000;
const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;

const CATEGORY_LABELS = Object.freeze({
  science: "Наука",
  geography: "География",
  history: "История",
  literature: "Литература",
  technology: "Технологии",
  math: "Математика",
  culture: "Культура",
  sport: "Спорт"
});

const DIFFICULTY_LABELS = Object.freeze({ easy: "Легко", medium: "Средне", hard: "Сложно" });

const QUESTIONS = [
  q("science-1", "science", "easy", "Какая планета ближе всего к Солнцу?", ["Меркурий", "Венера", "Марс", "Юпитер"], 0),
  q("science-2", "science", "easy", "Какой газ нужен человеку для дыхания?", ["Кислород", "Азот", "Гелий", "Неон"], 0),
  q("science-3", "science", "easy", "Какой металл обозначается символом Fe?", ["Золото", "Железо", "Серебро", "Медь"], 1),
  q("science-4", "science", "medium", "Какая частица имеет отрицательный заряд?", ["Протон", "Нейтрон", "Электрон", "Фотон"], 2),
  q("science-5", "science", "medium", "Как называется переход вещества из жидкости в газ?", ["Конденсация", "Испарение", "Кристаллизация", "Плавление"], 1),
  q("science-6", "science", "hard", "Какой элемент имеет атомный номер 6?", ["Кислород", "Углерод", "Азот", "Бор"], 1),
  q("geography-1", "geography", "easy", "Столица Японии?", ["Пекин", "Сеул", "Токио", "Бангкок"], 2),
  q("geography-2", "geography", "easy", "Какой океан самый большой?", ["Индийский", "Тихий", "Атлантический", "Северный Ледовитый"], 1),
  q("geography-3", "geography", "easy", "На каком материке находится Египет?", ["Азия", "Африка", "Европа", "Южная Америка"], 1),
  q("geography-4", "geography", "medium", "Столица Канады?", ["Торонто", "Ванкувер", "Оттава", "Монреаль"], 2),
  q("geography-5", "geography", "medium", "Какая река протекает через Будапешт?", ["Рейн", "Дунай", "Сена", "Темза"], 1),
  q("geography-6", "geography", "hard", "Какой пролив разделяет Азию и Северную Америку?", ["Гибралтарский", "Берингов", "Босфор", "Малаккский"], 1),
  q("history-1", "history", "easy", "В каком веке началась Вторая мировая война?", ["XVIII", "XIX", "XX", "XXI"], 2),
  q("history-2", "history", "easy", "Как назывался древнеримский амфитеатр в Риме?", ["Акрополь", "Колизей", "Пантеон", "Форум"], 1),
  q("history-3", "history", "medium", "Кто первым совершил кругосветное плавание, завершённое его экспедицией?", ["Колумб", "Магеллан", "Кук", "Веспуччи"], 1),
  q("history-4", "history", "medium", "В каком году человек впервые высадился на Луне?", ["1957", "1961", "1969", "1975"], 2),
  q("history-5", "history", "hard", "Какой город был столицей Византийской империи?", ["Афины", "Константинополь", "Спарта", "Антиохия"], 1),
  q("literature-1", "literature", "easy", "Кто написал роман «Война и мир»?", ["Достоевский", "Пушкин", "Толстой", "Гоголь"], 2),
  q("literature-2", "literature", "easy", "Кто является автором «Ромео и Джульетты»?", ["Шекспир", "Диккенс", "Байрон", "Гёте"], 0),
  q("literature-3", "literature", "medium", "Как зовут капитана из романа «Двадцать тысяч лье под водой»?", ["Немо", "Ахав", "Грант", "Сильвер"], 0),
  q("literature-4", "literature", "hard", "Кто написал роман «Сто лет одиночества»?", ["Борхес", "Маркес", "Кортасар", "Неруда"], 1),
  q("technology-1", "technology", "easy", "Какой язык выполняется в Node.js?", ["JavaScript", "Python", "PHP", "Ruby"], 0),
  q("technology-2", "technology", "easy", "Какой инструмент обычно используют для контроля версий кода?", ["Git", "Figma", "Excel", "Photoshop"], 0),
  q("technology-3", "technology", "easy", "Что означает HTML?", ["Язык разметки", "База данных", "Операционная система", "Редактор"], 0),
  q("technology-4", "technology", "medium", "Какой протокол обычно защищает веб-соединение шифрованием?", ["FTP", "HTTP", "HTTPS", "SMTP"], 2),
  q("technology-5", "technology", "medium", "Какая структура данных работает по принципу LIFO?", ["Очередь", "Стек", "Граф", "Хеш-таблица"], 1),
  q("technology-6", "technology", "hard", "Какая нормальная форма БД устраняет транзитивные зависимости неключевых атрибутов?", ["1НФ", "2НФ", "3НФ", "4НФ"], 2),
  q("math-1", "math", "easy", "Сколько минут в двух часах?", ["60", "90", "120", "180"], 2),
  q("math-2", "math", "easy", "Сколько градусов в прямом угле?", ["45", "90", "120", "180"], 1),
  q("math-3", "math", "easy", "Сколько сторон у треугольника?", ["2", "3", "4", "5"], 1),
  q("math-4", "math", "medium", "Чему равен квадрат числа 12?", ["124", "132", "144", "156"], 2),
  q("math-5", "math", "medium", "Какое число является простым?", ["21", "29", "39", "51"], 1),
  q("math-6", "math", "hard", "Чему равна сумма внутренних углов шестиугольника?", ["540°", "720°", "900°", "1080°"], 1),
  q("culture-1", "culture", "easy", "Какой цвет получится при смешении синего и жёлтого?", ["Красный", "Зелёный", "Фиолетовый", "Оранжевый"], 1),
  q("culture-2", "culture", "easy", "Какой музыкальный инструмент имеет клавиши, педали и струны?", ["Скрипка", "Флейта", "Фортепиано", "Труба"], 2),
  q("culture-3", "culture", "medium", "Кто написал картину «Звёздная ночь»?", ["Моне", "Ван Гог", "Пикассо", "Рембрандт"], 1),
  q("culture-4", "culture", "hard", "Как называется японское искусство складывания бумаги?", ["Икебана", "Оригами", "Кабуки", "Бонсай"], 1),
  q("sport-1", "sport", "easy", "Сколько игроков одной команды на поле в классическом футболе?", ["9", "10", "11", "12"], 2),
  q("sport-2", "sport", "easy", "В каком виде спорта используют ракетку и волан?", ["Теннис", "Бадминтон", "Сквош", "Крикет"], 1),
  q("sport-3", "sport", "medium", "Сколько периодов в стандартном хоккейном матче?", ["2", "3", "4", "5"], 1),
  q("sport-4", "sport", "hard", "Какова длина марафонской дистанции?", ["40 км", "41,5 км", "42,195 км", "45 км"], 2)
];

class QuizManager {
  constructor(filePath = null, options = {}) {
    this.filePath = filePath;
    this.durationMs = Number.isSafeInteger(options.durationMs) ? options.durationMs : DEFAULT_QUIZ_DURATION_MS;
    this.random = options.random || ((length) => randomInt(0, length));
    this.state = this.load();
    this.activeQuizzes = new Map(Object.entries(this.state.activeQuizzes));
  }

  createQuiz(chatId, options = {}) {
    const category = normalizeFilter(options.category, CATEGORY_LABELS);
    const difficulty = normalizeFilter(options.difficulty, DIFFICULTY_LABELS);
    const candidates = QUESTIONS.filter((question) => (!category || question.category === category) && (!difficulty || question.difficulty === difficulty));
    if (candidates.length === 0) throw new Error("Для выбранной категории и сложности пока нет вопросов");
    const poolKey = `${chatId}:${category || "all"}:${difficulty || "all"}`;
    const used = new Set(this.state.usedPools[poolKey] || []);
    let available = candidates.filter((question) => !used.has(question.id));
    if (available.length === 0) {
      used.clear();
      available = candidates;
    }
    const question = available[this.random(available.length)];
    used.add(question.id);
    this.state.usedPools[poolKey] = [...used];
    const createdAt = normalizeNow(options.now);
    const quiz = {
      id: randomUUID(), chatId: Number(chatId), questionId: question.id, category: question.category,
      difficulty: question.difficulty, attemptedUserIds: [], createdAt,
      expiresAt: new Date(Date.parse(createdAt) + this.durationMs).toISOString()
    };
    this.activeQuizzes.set(quiz.id, quiz);
    this.state.activeQuizzes[quiz.id] = quiz;
    this.save();
    return { quizId: quiz.id, question, expiresAt: quiz.expiresAt };
  }

  getKeyboard(quizId, question) {
    return { reply_markup: { inline_keyboard: question.options.map((option, index) => [
      { text: option, callback_data: `quiz:${quizId}:${index}` }
    ]) } };
  }

  setMessageRef(quizId, chatId, messageId) {
    const quiz = this.activeQuizzes.get(quizId);
    if (!quiz) return false;
    quiz.chatId = Number(chatId);
    quiz.messageId = Number(messageId);
    this.state.activeQuizzes[quizId] = quiz;
    this.save();
    return true;
  }

  answer(quizId, optionIndex, user = {}, now = Date.now()) {
    const quiz = this.activeQuizzes.get(quizId);
    if (!quiz) return { status: this.state.completedQuizzes[quizId] ? "answered" : "missing" };
    if (Date.parse(quiz.expiresAt) <= normalizeTimestamp(now)) return this.expireQuiz(quizId, now);
    const userId = Number(user.id);
    if (!Number.isSafeInteger(userId)) return { status: "invalid_user", quiz: this.hydrate(quiz) };
    if (quiz.attemptedUserIds.includes(userId)) return { status: "attempted", quiz: this.hydrate(quiz) };
    const question = questionById(quiz.questionId);
    const selectedIndex = Number(optionIndex);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= question.options.length) return { status: "invalid_option", quiz: this.hydrate(quiz) };
    quiz.attemptedUserIds.push(userId);
    const stat = this.getOrCreateStat(user);
    stat.answers += 1;
    if (selectedIndex !== question.correctIndex) {
      this.state.activeQuizzes[quizId] = quiz;
      this.save();
      return { status: "wrong", quiz: this.hydrate(quiz) };
    }
    stat.correct += 1;
    stat.lastCorrectAt = normalizeNow(now);
    this.complete(quiz, "correct", now);
    return { status: "correct", quiz: this.hydrate(quiz), reward: QUIZ_REWARD };
  }

  expireQuiz(quizId, now = Date.now()) {
    const quiz = this.activeQuizzes.get(quizId);
    if (!quiz) return { status: "missing" };
    this.complete(quiz, "expired", now);
    return { status: "expired", quiz: this.hydrate(quiz) };
  }

  getActiveQuizzes() {
    return [...this.activeQuizzes.values()].map((quiz) => this.hydrate(quiz));
  }

  getLeaderboard(limit = 10) {
    return Object.values(this.state.stats)
      .sort((left, right) => right.correct - left.correct || left.answers - right.answers)
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((entry) => ({ ...entry }));
  }

  hydrate(quiz) {
    return { ...quiz, question: questionById(quiz.questionId) };
  }

  complete(quiz, status, now) {
    this.activeQuizzes.delete(quiz.id);
    delete this.state.activeQuizzes[quiz.id];
    this.state.completedQuizzes[quiz.id] = { status, completedAt: normalizeNow(now) };
    this.pruneCompleted(now);
    this.save();
  }

  getOrCreateStat(user) {
    const key = String(user.id);
    this.state.stats[key] ??= { userId: Number(user.id), name: displayName(user), answers: 0, correct: 0 };
    this.state.stats[key].name = displayName(user);
    return this.state.stats[key];
  }

  pruneCompleted(now) {
    const cutoff = normalizeTimestamp(now) - COMPLETED_RETENTION_MS;
    for (const [quizId, record] of Object.entries(this.state.completedQuizzes)) {
      if (Date.parse(record.completedAt) < cutoff) delete this.state.completedQuizzes[quizId];
    }
  }

  load() {
    const empty = { version: 1, usedPools: {}, activeQuizzes: {}, completedQuizzes: {}, stats: {} };
    if (!this.filePath || !fs.existsSync(this.filePath)) return empty;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
      return {
        version: 1,
        usedPools: objectOrEmpty(data.usedPools),
        activeQuizzes: objectOrEmpty(data.activeQuizzes),
        completedQuizzes: objectOrEmpty(data.completedQuizzes),
        stats: objectOrEmpty(data.stats)
      };
    } catch (error) {
      console.error("Quiz state load error:", error?.message || error);
      backupCorruptJson(this.filePath);
      return empty;
    }
  }

  save() {
    if (!this.filePath) return true;
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
      fs.renameSync(tmp, this.filePath);
      return true;
    } catch (error) {
      console.error("Quiz state save error:", error?.message || error);
      return false;
    }
  }
}

function q(id, category, difficulty, question, options, correctIndex) {
  return Object.freeze({ id, category, difficulty, question, options: Object.freeze(options), correctIndex });
}

function questionById(id) {
  const question = QUESTIONS.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`Quiz question not found: ${id}`);
  return question;
}

function normalizeFilter(value, labels) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized && normalized !== "all" && labels[normalized] ? normalized : undefined;
}

function normalizeNow(value = Date.now()) {
  const timestamp = normalizeTimestamp(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid quiz timestamp");
  return new Date(timestamp).toISOString();
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return Number(value);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function displayName(user) {
  return [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(" ") || user.username || `ID:${user.id}`;
}

module.exports = { CATEGORY_LABELS, DEFAULT_QUIZ_DURATION_MS, DIFFICULTY_LABELS, QUESTIONS, QuizManager, QUIZ_REWARD };
