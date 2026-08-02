const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { QUESTIONS, QuizManager } = require("../quiz");

test("quiz exhausts a filtered question pool before repeating", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-quiz-"));
  const file = path.join(directory, "quiz.json");
  const manager = new QuizManager(file, { random: () => 0 });
  const expected = QUESTIONS.filter((question) => question.category === "science" && question.difficulty === "easy").length;
  const ids = new Set();
  for (let index = 0; index < expected; index += 1) {
    ids.add(manager.createQuiz(1, { category: "science", difficulty: "easy" }).question.id);
  }
  assert.equal(ids.size, expected);
  assert.ok(ids.has(manager.createQuiz(1, { category: "science", difficulty: "easy" }).question.id));

  const restarted = new QuizManager(file, { random: () => 0 });
  assert.ok(restarted.getActiveQuizzes().length >= expected + 1);
});

test("quiz rejects repeated user answers, persists stats and expires by deadline", () => {
  const manager = new QuizManager(null, { random: () => 0, durationMs: 1000 });
  const start = "2026-01-01T00:00:00.000Z";
  const created = manager.createQuiz(10, { category: "math", difficulty: "easy", now: start });
  const wrongIndex = (created.question.correctIndex + 1) % created.question.options.length;
  assert.equal(manager.answer(created.quizId, wrongIndex, { id: 1, first_name: "One" }, start).status, "wrong");
  assert.equal(manager.answer(created.quizId, created.question.correctIndex, { id: 1 }, start).status, "attempted");
  assert.equal(manager.answer(created.quizId, created.question.correctIndex, { id: 2, first_name: "Two" }, start).status, "correct");
  assert.equal(manager.answer(created.quizId, created.question.correctIndex, { id: 2 }, start).status, "answered");
  assert.equal(manager.getLeaderboard(1)[0].userId, 2);

  const expiring = manager.createQuiz(10, { now: start });
  assert.equal(manager.answer(expiring.quizId, 0, { id: 3 }, "2026-01-01T00:00:02.000Z").status, "expired");
});
