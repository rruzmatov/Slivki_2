const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BugReportStore } = require("../bug-report-store");
const { CurrencyStore } = require("../currency");
const { QuizManager } = require("../quiz");
const { formatDiagnostics, inspectJsonFiles, inspectPremiumEmoji, inspectRpgArchitecture, inspectStorage } = require("../diagnostics");

test("bug reports are atomic and retained within their configured bound", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-bugs-"));
  const file = path.join(directory, "reports.json");
  const store = new BugReportStore(file, { maxReports: 2 });
  store.append({ id: "one" });
  store.append({ id: "two" });
  store.append({ id: "three" });
  assert.deepEqual(store.load().map((report) => report.id), ["two", "three"]);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test("diagnostics reports exact JSON, storage, emoji and RPG architecture state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-diagnostics-"));
  const valid = path.join(directory, "valid.json");
  const invalid = path.join(directory, "invalid.json");
  fs.writeFileSync(valid, "{}", "utf8");
  fs.writeFileSync(invalid, "{", "utf8");
  const json = inspectJsonFiles([valid, invalid]);
  assert.equal(json[0].ok, true);
  assert.equal(json[1].ok, false);
  assert.equal(inspectStorage(directory).ok, true);
  assert.equal(inspectPremiumEmoji({ one: "123", two: "bad" }).ok, false);
  const sourceRoot = path.join(__dirname, "..");
  assert.ok(inspectRpgArchitecture(sourceRoot).every((item) => item.ok));
  assert.match(formatDiagnostics(json), /ошибок 1/);
});

test("legacy currency and quiz preserve corrupted JSON before recovery", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slivki-corrupt-"));
  const currencyFile = path.join(directory, "currency.json");
  const quizFile = path.join(directory, "quiz.json");
  fs.writeFileSync(currencyFile, "{broken", "utf8");
  fs.writeFileSync(quizFile, "{broken", "utf8");
  new CurrencyStore(currencyFile);
  new QuizManager(quizFile);
  const files = fs.readdirSync(directory);
  assert.ok(files.some((file) => file.startsWith("currency.json.corrupt-")));
  assert.ok(files.some((file) => file.startsWith("quiz.json.corrupt-")));
});
