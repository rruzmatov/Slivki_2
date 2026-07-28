const QUIZ_REWARD = 20;

const QUESTIONS = [
  {
    question: "Какая планета ближе всего к Солнцу?",
    options: ["Меркурий", "Венера", "Марс", "Юпитер"],
    correctIndex: 0
  },
  {
    question: "Сколько минут в двух часах?",
    options: ["60", "90", "120", "180"],
    correctIndex: 2
  },
  {
    question: "Какой океан самый большой?",
    options: ["Индийский", "Тихий", "Атлантический", "Северный Ледовитый"],
    correctIndex: 1
  },
  {
    question: "Кто написал роман «Война и мир»?",
    options: ["Достоевский", "Пушкин", "Толстой", "Гоголь"],
    correctIndex: 2
  },
  {
    question: "Какой газ нужен человеку для дыхания?",
    options: ["Кислород", "Азот", "Гелий", "Углекислый газ"],
    correctIndex: 0
  },
  {
    question: "Сколько сторон у треугольника?",
    options: ["2", "3", "4", "5"],
    correctIndex: 1
  },
  {
    question: "Столица Японии?",
    options: ["Пекин", "Сеул", "Токио", "Бангкок"],
    correctIndex: 2
  },
  {
    question: "Какой язык выполняется в Node.js?",
    options: ["JavaScript", "Python", "PHP", "Ruby"],
    correctIndex: 0
  },
  {
    question: "Сколько байт обычно в одном килобайте по двоичной системе?",
    options: ["1000", "1012", "1024", "2048"],
    correctIndex: 2
  },
  {
    question: "Какой металл обозначается символом Fe?",
    options: ["Золото", "Железо", "Серебро", "Медь"],
    correctIndex: 1
  },
  {
    question: "Сколько континентов обычно выделяют в мире?",
    options: ["5", "6", "7", "8"],
    correctIndex: 2
  },
  {
    question: "Какая фигура имеет все стороны равными и все углы прямыми?",
    options: ["Ромб", "Квадрат", "Трапеция", "Овал"],
    correctIndex: 1
  },
  {
    question: "Как называется самая длинная река в мире по распространённой школьной версии?",
    options: ["Нил", "Амазонка", "Янцзы", "Волга"],
    correctIndex: 0
  },
  {
    question: "Какой цвет получится при смешении синего и жёлтого?",
    options: ["Красный", "Зелёный", "Фиолетовый", "Оранжевый"],
    correctIndex: 1
  },
  {
    question: "Сколько игроков одной команды одновременно на поле в классическом футболе?",
    options: ["9", "10", "11", "12"],
    correctIndex: 2
  },
  {
    question: "Какая единица измеряет силу электрического тока?",
    options: ["Вольт", "Ампер", "Ватт", "Ом"],
    correctIndex: 1
  },
  {
    question: "Какой месяц идёт после сентября?",
    options: ["Август", "Октябрь", "Ноябрь", "Декабрь"],
    correctIndex: 1
  },
  {
    question: "Что означает HTML?",
    options: ["Язык разметки", "База данных", "Операционная система", "Графический редактор"],
    correctIndex: 0
  },
  {
    question: "Какой инструмент обычно используют для контроля версий кода?",
    options: ["Git", "Figma", "Excel", "Photoshop"],
    correctIndex: 0
  },
  {
    question: "Сколько градусов в прямом угле?",
    options: ["45", "90", "120", "180"],
    correctIndex: 1
  }
];

class QuizManager {
  constructor() {
    this.activeQuizzes = new Map();
  }

  createQuiz(chatId) {
    const quizId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

    this.activeQuizzes.set(quizId, {
      chatId,
      question,
      answered: false
    });

    return {
      quizId,
      question
    };
  }

  getKeyboard(quizId, question) {
    return {
      reply_markup: {
        inline_keyboard: question.options.map((option, index) => [
          { text: option, callback_data: `quiz:${quizId}:${index}` }
        ])
      }
    };
  }

  answer(quizId, optionIndex) {
    const quiz = this.activeQuizzes.get(quizId);

    if (!quiz) return { status: "missing" };
    if (quiz.answered) return { status: "answered", quiz };

    const selectedIndex = Number(optionIndex);

    if (selectedIndex !== quiz.question.correctIndex) {
      return { status: "wrong", quiz };
    }

    quiz.answered = true;
    this.activeQuizzes.delete(quizId);

    return { status: "correct", quiz, reward: QUIZ_REWARD };
  }
}

module.exports = {
  QuizManager,
  QUIZ_REWARD
};
