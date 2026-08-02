"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const telegraf_1 = require("telegraf");
const rpg_1 = require("./rpg");
const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error("BOT_TOKEN is required");
}
const ownerIds = (process.env.OWNER_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value));
async function bootstrap(botToken) {
    const bot = new telegraf_1.Telegraf(botToken);
    const runtime = await (0, rpg_1.createRpgRuntime)({ ownerIds });
    bot.use(runtime.composer);
    bot.catch((error) => console.error("RPG bot error:", error));
    await bot.launch();
    console.log("Мир Сливки RPG bot started");
    let stopping = false;
    const stop = async (signal) => {
        if (stopping)
            return;
        stopping = true;
        await runtime.stop();
        bot.stop(signal);
    };
    process.once("SIGINT", (signal) => void stop(signal));
    process.once("SIGTERM", (signal) => void stop(signal));
}
void bootstrap(token);
