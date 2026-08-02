const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function inspectJsonFiles(files) {
  return files.map((filePath) => {
    const name = path.basename(filePath);
    if (!fs.existsSync(filePath)) return check(`JSON ${name}`, true, "файл ещё не создан", "warning");
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!value || typeof value !== "object") return check(`JSON ${name}`, false, "корень JSON не является объектом");
      return check(`JSON ${name}`, true, "читается и разбирается");
    } catch (error) {
      return check(`JSON ${name}`, false, error.message);
    }
  });
}

function inspectStorage(directory) {
  const probe = path.join(directory, `.diagnostics-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(probe, "ok", { encoding: "utf8", flag: "wx" });
    fs.unlinkSync(probe);
    return check("Storage", true, `каталог доступен для атомарной записи: ${directory}`);
  } catch (error) {
    try { if (fs.existsSync(probe)) fs.unlinkSync(probe); } catch { }
    return check("Storage", false, error.message);
  }
}

function inspectRpgRuntime(filePath) {
  if (!fs.existsSync(filePath)) {
    return [
      check("RPG Repository", true, "хранилище ещё не создано", "warning"),
      check("Scheduler", true, "RPG runtime ещё не инициализирован", "warning")
    ];
  }
  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const runtime = state?.runtime;
    if (!runtime || typeof runtime !== "object") {
      return [check("RPG Repository", false, "в хранилище отсутствует runtime"), check("Scheduler", false, "schedulerTasks отсутствует")];
    }
    const tasks = Object.values(runtime.schedulerTasks || {});
    const failed = tasks.filter((task) => task?.status === "failed").length;
    const pending = tasks.filter((task) => task?.status === "pending" || task?.status === "running").length;
    return [
      check("RPG Repository", true, `runtime v${runtime.version || "unknown"}; history=${runtime.history?.length || 0}; outbox=${Object.keys(runtime.outbox || {}).length}`),
      check("Scheduler", failed === 0, `задач=${tasks.length}; активных=${pending}; failed=${failed}`, failed ? "error" : "ok")
    ];
  } catch (error) {
    return [check("RPG Repository", false, error.message), check("Scheduler", false, "невозможно прочитать RPG runtime")];
  }
}

function inspectRpgArchitecture(sourceRoot) {
  const applicationRoot = path.join(sourceRoot, "rpg", "application");
  const domainRoot = path.join(sourceRoot, "rpg", "domain");
  const compositionRoot = path.join(sourceRoot, "rpg", "bootstrap", "composition-root.ts");
  const productionFiles = [...listFiles(applicationRoot), ...listFiles(domainRoot)];
  const gameStateImports = productionFiles.filter((file) => /(?:GameState|game-state)/.test(fs.readFileSync(file, "utf8")));
  const eventBusLocations = listFiles(path.join(sourceRoot, "rpg"))
    .filter((file) => /new\s+EventBus\s*\(/.test(fs.readFileSync(file, "utf8")));
  const compositionExists = fs.existsSync(compositionRoot);
  return [
    check("Composition Root", compositionExists, compositionExists ? "единая точка композиции найдена" : "composition-root.ts отсутствует"),
    check("EventBus", eventBusLocations.length === 1 && eventBusLocations[0] === compositionRoot,
      eventBusLocations.length === 1 ? `единственный экземпляр создаётся в ${path.relative(sourceRoot, eventBusLocations[0])}` : `обнаружено созданий EventBus: ${eventBusLocations.length}`),
    check("Application GameState", gameStateImports.length === 0,
      gameStateImports.length === 0 ? "прямые зависимости отсутствуют" : gameStateImports.map((file) => path.relative(sourceRoot, file)).join(", ")),
    check("Repository async", inspectRepositoryPromises(path.join(applicationRoot, "ports")),
      "контракты Repository возвращают Promise")
  ];
}

function inspectRepositoryPromises(portsRoot) {
  const files = listFiles(portsRoot).filter((file) => file.endsWith("repository.ts"));
  return files.every((file) => {
    const source = fs.readFileSync(file, "utf8");
    const methodLines = source.split("\n").filter((line) => /^\s*[A-Za-z][A-Za-z0-9]*\??\([^;]*\):/.test(line));
    return methodLines.every((line) => /Promise\s*</.test(line));
  });
}

function inspectPremiumEmoji(ids) {
  const configured = [...new Set(Object.values(ids || {}).filter(Boolean).map(String))];
  const invalid = configured.filter((id) => !/^\d+$/.test(id));
  if (invalid.length) return check("Premium Emoji", false, `некорректных ID: ${invalid.length}`);
  return check("Premium Emoji", true,
    configured.length ? `валидных уникальных ID: ${configured.length}` : "ID не настроены, используется штатный fallback", configured.length ? "ok" : "warning");
}

function check(name, ok, detail, level = ok ? "ok" : "error") {
  return { name, ok, level, detail: String(detail || "") };
}

function formatDiagnostics(checks, generatedAt = new Date().toISOString()) {
  const icon = { ok: "✅", warning: "⚠️", error: "❌" };
  const failed = checks.filter((item) => item.level === "error").length;
  const warnings = checks.filter((item) => item.level === "warning").length;
  return [
    "🩺 Диагностика Slivki",
    `Время: ${generatedAt}`,
    `Итог: ошибок ${failed}, предупреждений ${warnings}`,
    "",
    ...checks.map((item) => `${icon[item.level] || "•"} ${item.name}: ${item.detail}`)
  ].join("\n");
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(target));
    else if (entry.isFile() && /\.(?:ts|js)$/.test(entry.name)) result.push(target);
  }
  return result;
}

module.exports = {
  check,
  formatDiagnostics,
  inspectJsonFiles,
  inspectPremiumEmoji,
  inspectRpgArchitecture,
  inspectRpgRuntime,
  inspectStorage
};
