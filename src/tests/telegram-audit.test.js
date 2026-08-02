const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourcePath = path.join(__dirname, "..", "bot.js");
const source = fs.readFileSync(sourcePath, "utf8");
const rpgComposerPath = path.join(__dirname, "..", "rpg", "bot", "rpg-composer.ts");
const rpgComposerSource = fs.readFileSync(rpgComposerPath, "utf8");

test("installed Telegram client exposes the migrated v1 API", () => {
  const { TelegramBot } = require("node-telegram-bot-api");
  assert.equal(typeof TelegramBot, "function");
  const bot = new TelegramBot("123456789:abcdefghijklmnopqrstuvwxyzABCDE1234567890", { polling: false });
  for (const method of ["onText", "sendMessage", "restrictChatMember", "answerCallbackQuery", "stopPolling"]) {
    assert.equal(typeof bot[method], "function", method);
  }
});

test("all local bot dependencies resolve", () => {
  const dependencies = getLocalRequires(sourcePath);
  assert.ok(dependencies.length > 0);
  for (const dependency of dependencies) {
    assert.doesNotThrow(() => require.resolve(path.resolve(path.dirname(sourcePath), dependency)), dependency);
  }
});

test("production JavaScript has no circular local dependencies", () => {
  const srcRoot = path.join(__dirname, "..");
  const files = listJavaScript(srcRoot).filter((file) => !file.includes(`${path.sep}tests${path.sep}`));
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  const graph = new Map(files.map((file) => {
    const edges = getLocalRequires(file)
      .map((dependency) => resolveJavaScript(file, dependency))
      .filter((target) => target && fileSet.has(target));
    return [path.resolve(file), edges];
  }));
  const visiting = new Set();
  const visited = new Set();
  const visit = (file, trail = []) => {
    if (visiting.has(file)) assert.fail(`circular dependency: ${[...trail, file].map((item) => path.relative(srcRoot, item)).join(" -> ")}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const target of graph.get(file) || []) visit(target, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of files) visit(path.resolve(file));
});

test("stability commands, aliases and callback fallback are registered", () => {
  for (const token of [
    "tg-admin", "untg-admin", "tagpause", "tagresume", "tagstop", "stopcall",
    "quizstats", "diagnostics", "reportbug", "Эта кнопка устарела"
  ]) {
    assert.ok(source.includes(token), `missing Telegram route: ${token}`);
  }
  assert.match(source, /bot\.onText\s*=.*=>/s);
  assert.match(source, /processedCallbackQueries/);
});

test("published Telegram command metadata is valid", () => {
  const groupCommands = source.match(/const groupCommands = \[([\s\S]*?)\n\];/)?.[1] || "";
  const commands = [...groupCommands.matchAll(/command:\s*"([^"]+)",\s*description:\s*"([^"]+)"/g)]
    .map((match) => ({ command: match[1], description: match[2] }));
  assert.ok(commands.length >= 30);
  assert.equal(new Set(commands.map((item) => item.command)).size, commands.length);
  for (const item of commands) {
    assert.match(item.command, /^[a-z0-9_]{1,32}$/);
    assert.ok(item.description.length >= 1 && item.description.length <= 256);
  }
});

test("RPG discovery is hidden without unregistering command handlers", () => {
  const hiddenSettings = source.match(/const HIDDEN_RPG_UI_SETTINGS = new Set\(\[([\s\S]*?)\n\]\);/)?.[1] || "";
  for (const setting of ["balance", "profile", "brak", "razvod", "partner", "career", "action"]) {
    assert.match(hiddenSettings, new RegExp(`"${setting}"`), `RPG UI setting must remain hidden: ${setting}`);
  }

  assert.match(source, /groupCommands\.filter\(\(\{ command \}\) => isCommandVisibleInUserInterface\(command\)\)/);
  assert.match(source, /\.filter\(\(\[commandName\]\) => isCommandVisibleInUserInterface\(commandName\)\)/);
  assert.match(source, /return !item\.setting \|\| isCommandVisibleInUserInterface\(item\.setting\)/);
  assert.ok(source.includes("bot.onText(/^(?:\\/profile"));
  assert.ok(source.includes("const marriageMatch = msg.text.match(/^(?:сливки\\s+брак|брак|\\/brak)"));

  assert.match(rpgComposerSource, /const RPG_UI_DISCOVERY_ENABLED = false;/);
  assert.match(rpgComposerSource, /if \(!RPG_UI_DISCOVERY_ENABLED\) return undefined;/);
  assert.match(rpgComposerSource, /if \(!RPG_UI_DISCOVERY_ENABLED\) return "📋 Главное меню";/);
  assert.match(rpgComposerSource, /if \(!RPG_UI_DISCOVERY_ENABLED\) return "🆘 Справка";/);
  for (const registration of [
    'composer.command("rpg"',
    'composer.command("profile"',
    'composer.command(["inventory"',
    'composer.command("balance"',
    'composer.command("shop"',
    'composer.command(["transport"',
    'composer.command(["business"',
    'composer.command("forbes"'
  ]) {
    assert.ok(rpgComposerSource.includes(registration), `RPG command must remain registered: ${registration}`);
  }
  assert.match(rpgComposerSource, /composer\.action\("rpg_profile"/);
  assert.match(rpgComposerSource, /composer\.action\("rpg_shop"/);
});

test("slowmode no longer sends unsupported slow_mode_delay in ChatPermissions", () => {
  assert.doesNotMatch(source, /slow_mode_delay\s*:/);
  assert.match(source, /setSlowModeSetting\(msg\.chat\.id, seconds\)/);
});

test("Telegram v1 removed request fields are absent from production JavaScript", () => {
  const productionFiles = [
    sourcePath,
    path.join(__dirname, "..", "nuke-service.js"),
    path.join(__dirname, "..", "commands", "random-picks.js")
  ];
  for (const file of productionFiles) {
    const value = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(value, /reply_to_message_id|disable_web_page_preview/);
  }
  assert.match(source, /const \{ TelegramBot \} = require\("node-telegram-bot-api"\)/);
  assert.match(source, /restrictChatMember\(chatId, userId, getMutedPermissions\(\),/);
});

function listJavaScript(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScript(target));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

function resolveJavaScript(fromFile, dependency) {
  const target = path.resolve(path.dirname(fromFile), dependency);
  for (const candidate of [target, `${target}.js`, path.join(target, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  return null;
}

function getLocalRequires(file) {
  const value = fs.readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...value.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)].map((match) => match[1]);
}
