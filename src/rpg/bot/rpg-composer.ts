import path from "path";
import { Composer, Markup, type Context } from "telegraf";
import { AdminService } from "../application/admin-service";
import { GAME_BALANCE } from "../config/game-balance";
import { travelLocations } from "../data/catalog";
import { GameServices } from "../application/game-services";
import { JsonGameDatabase } from "../infrastructure/storage/json-game-database";
import { formatCatalogPage, formatFamily, formatProfile } from "./formatters";

const nowIso = (): string => new Date().toISOString();

const identityFromContext = (ctx: Context) => {
  if (!ctx.from) {
    throw new Error("Не удалось определить пользователя");
  }

  return {
    id: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name || "Игрок"
  };
};

export interface RpgComposerOptions {
  storagePath?: string;
  ownerIds?: number[];
}

export const createRpgComposer = (options: RpgComposerOptions = {}): Composer<Context> => {
  const composer = new Composer<Context>();
  const storage = new JsonGameDatabase(options.storagePath ?? path.join(process.cwd(), "src", "rpg-game-state.json"));
  const services = new GameServices();
  const admin = new AdminService(options.ownerIds ?? []);

  composer.command("rpg", async (ctx) => {
    await storage.transaction((state) => {
      const player = services.ensurePlayer(state, identityFromContext(ctx), nowIso());
      state.stats.commandsHandled += 1;
      return ctx.reply(formatProfile(player, player.familyId ? state.families[player.familyId] : undefined), mainKeyboard());
    });
  });

  composer.command("profile", async (ctx) => {
    await storage.transaction((state) => {
      const { player, family } = services.getPlayerProfile(state, identityFromContext(ctx), nowIso());
      state.stats.commandsHandled += 1;
      return ctx.reply(formatProfile(player, family), mainKeyboard());
    });
  });

  composer.command(["family", "familyinfo"], async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const family = await storage.transaction((state) => services.getFamily(state, identityFromContext(ctx), nowIso()));
      await ctx.reply(formatFamily(family));
    });
  });

  composer.command("stats", async (ctx) => {
    const stats = await storage.transaction((state) => state.stats);
    await ctx.reply([
      "📊 Статистика RPG",
      "",
      `Команд: ${stats.commandsHandled}`,
      `Покупок: ${stats.purchases}`,
      `Браков: ${stats.marriages}`,
      `Работ: ${stats.jobsCompleted}`,
      `Путешествий: ${stats.travels}`,
      `Daily: ${stats.dailyRewards}`
    ].join("\n"));
  });

  composer.command(["inventory", "backpack"], async (ctx) => {
    const entries = await storage.transaction((state) => services.getInventory(state, identityFromContext(ctx), nowIso()));
    const lines = entries.map((entry) => `• ${entry.item.name} x${entry.quantity} (${entry.item.id})`);
    await ctx.reply(["🎒 Инвентарь", "", ...(lines.length > 0 ? lines : ["Пусто"])].join("\n"));
  });

  composer.command("balance", async (ctx) => {
    const { player } = await storage.transaction((state) => services.getPlayerProfile(state, identityFromContext(ctx), nowIso()));
    await ctx.reply(`💰 Баланс: ${player.balance.toLocaleString("ru-RU")} сум`);
  });

  composer.command("level", async (ctx) => {
    const { player } = await storage.transaction((state) => services.getPlayerProfile(state, identityFromContext(ctx), nowIso()));
    await ctx.reply(`⭐ Уровень: ${player.level}\nXP: ${player.xp}`);
  });

  composer.command("skills", async (ctx) => {
    const { player } = await storage.transaction((state) => services.getPlayerProfile(state, identityFromContext(ctx), nowIso()));
    const lines = Object.entries(player.skills).map(([name, value]) => `• ${name}: ${value}`);
    await ctx.reply(["🧠 Навыки", "", ...(lines.length > 0 ? lines : ["Навыки пока не развиты"])].join("\n"));
  });

  composer.command("achievements", async (ctx) => {
    const { player } = await storage.transaction((state) => services.getPlayerProfile(state, identityFromContext(ctx), nowIso()));
    await ctx.reply(["🏆 Достижения", "", ...(player.achievements.length > 0 ? player.achievements.map((id) => `• ${id}`) : ["Пока нет"])].join("\n"));
  });

  composer.command("daily", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await storage.transaction((state) => services.claimDailyReward(state, identityFromContext(ctx), nowIso()));
      await ctx.reply(`🎁 Награда получена: +${result.reward.toLocaleString("ru-RU")} сум, +${result.xp} XP`);
    });
  });

  composer.command("jobs", async (ctx) => {
    const rows = services.listJobs().map((job) => [`${job.title} lvl ${job.minLevel}`, `/work ${job.id}`]);
    await ctx.reply(["💼 Профессии", "", ...rows.map(([title, command]) => `${title}: /job ${command.replace("/work ", "")}`)].join("\n"));
  });

  composer.command("job", async (ctx) => {
    const jobId = commandArg(ctx);
    if (!jobId) {
      const { player } = await storage.transaction((state) => services.getPlayerProfile(state, identityFromContext(ctx), nowIso()));
      await ctx.reply(`💼 Текущая профессия: ${player.jobId ?? "нет"}\nВыбрать: /job job_courier`);
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await storage.transaction((state) => services.setJob(state, identityFromContext(ctx), jobId, nowIso()));
      await ctx.reply(`✅ Профессия выбрана: ${result.title}`);
    });
  });

  composer.command("work", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await storage.transaction((state) => services.work(state, identityFromContext(ctx), commandArg(ctx), nowIso()));
      await ctx.reply(`💼 ${result.title}: +${result.payout.toLocaleString("ru-RU")} сум, +${result.xp} XP`);
    });
  });

  composer.command("salary", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await storage.transaction((state) => services.work(state, identityFromContext(ctx), undefined, nowIso()));
      await ctx.reply(`💵 Зарплата получена: ${result.title}, +${result.payout.toLocaleString("ru-RU")} сум`);
    });
  });

  composer.command("quitjob", async (ctx) => {
    await storage.transaction((state) => services.quitJob(state, identityFromContext(ctx), nowIso()));
    await ctx.reply("✅ Вы уволились");
  });

  composer.command("shop", async (ctx) => {
    const category = commandArg(ctx);
    const items = services.listCatalog(category).slice(0, GAME_BALANCE.pagination.pageSize);
    await ctx.reply(formatCatalogPage(items, 0, GAME_BALANCE.pagination.pageSize));
  });

  composer.command(["catalog", "market"], async (ctx) => {
    const category = commandArg(ctx);
    const items = services.listCatalog(category).slice(0, 25);
    await ctx.reply(formatCatalogPage(items, 0, 25));
  });

  composer.command("buy", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID предмета: /buy car_uz_cobalt");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const item = await storage.transaction((state) => services.buyItem(state, identityFromContext(ctx), itemId, nowIso()));
      await ctx.reply(`✅ Куплено: ${item.name}`);
    });
  });

  composer.command("sell", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID предмета: /sell car_uz_cobalt");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await storage.transaction((state) => services.sellItem(state, identityFromContext(ctx), itemId, nowIso()));
      await ctx.reply(`✅ Продано: ${result.item.name}, +${result.payout.toLocaleString("ru-RU")} сум`);
    });
  });

  composer.command("marry", async (ctx) => {
    const targetId = Number(commandArg(ctx));
    if (!Number.isSafeInteger(targetId) || !ctx.chat) {
      await ctx.reply("Укажите Telegram ID игрока: /marry 123456");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const proposalId = await storage.transaction((state) => services.createProposal(state, identityFromContext(ctx), targetId, ctx.chat.id, nowIso()));
      await ctx.reply(`💍 Предложение создано. Второй игрок должен принять: /accept ${proposalId}`);
    });
  });

  composer.command("accept", async (ctx) => {
    const proposalId = commandArg(ctx);
    if (!proposalId) {
      await ctx.reply("Укажите ID предложения: /accept proposal_...");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const family = await storage.transaction((state) => services.acceptProposal(state, identityFromContext(ctx), proposalId, nowIso()));
      await ctx.reply(formatFamily(family));
    });
  });

  composer.command("reject", async (ctx) => {
    const proposalId = commandArg(ctx);
    if (!proposalId) {
      await ctx.reply("Укажите ID предложения: /reject proposal_...");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      await storage.transaction((state) => services.rejectProposal(state, identityFromContext(ctx), proposalId, nowIso()));
      await ctx.reply("💔 Предложение отклонено");
    });
  });

  composer.command("divorce", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      await storage.transaction((state) => services.divorce(state, identityFromContext(ctx), nowIso()));
      await ctx.reply("💔 Развод оформлен");
    });
  });

  composer.command("love", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const family = await storage.transaction((state) => services.getFamily(state, identityFromContext(ctx), nowIso()));
      await ctx.reply(`❤️ Любовь семьи: ${family.love}`);
    });
  });

  composer.command("travel", async (ctx) => {
    const locationId = commandArg(ctx);
    if (!locationId) {
      await ctx.reply(["🌍 Локации", "", ...travelLocations.map((location) => `${location.name}: /travel ${location.id}`)].join("\n"));
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await storage.transaction((state) => services.travel(state, identityFromContext(ctx), locationId, nowIso()));
      await ctx.reply(`🌍 ${result.name}: +${result.love} любви, +${result.xp} XP`);
    });
  });

  composer.command(["families", "topfamily"], async (ctx) => {
    const rating = await storage.transaction((state) => services.getFamilyRating(state).slice(0, 10));
    const lines = rating.map((entry, index) => `${index + 1}. ${entry.family.partnerIds.join(" + ")} — ${entry.score.toLocaleString("ru-RU")}`);
    await ctx.reply(["👑 Best Family", "", ...(lines.length > 0 ? lines : ["Пока нет семей"])].join("\n"));
  });

  composer.command(["houses", "house"], (ctx) => showCategory(ctx, services, "home"));
  composer.command(["cars", "garage"], (ctx) => showCategory(ctx, services, "car"));
  composer.command("bikes", (ctx) => showCategory(ctx, services, "bicycle"));
  composer.command("planes", (ctx) => showCategory(ctx, services, "airplane"));
  composer.command("yachts", (ctx) => showCategory(ctx, services, "yacht"));
  composer.command("pets", (ctx) => showCategory(ctx, services, "pet"));
  composer.command(["trips", "airport", "passport"], async (ctx) => {
    await ctx.reply(["🌍 Путешествия", "", ...travelLocations.map((location) => `${location.name}: /travel ${location.id}`)].join("\n"));
  });
  composer.command("ticket", (ctx) => showCategory(ctx, services, "ticket"));
  composer.command("gift", async (ctx) => {
    const itemId = commandArg(ctx) ?? "gift_flowers";
    await replyWithDomainErrors(ctx, async () => {
      const item = await storage.transaction((state) => services.gift(state, identityFromContext(ctx), itemId, nowIso()));
      await ctx.reply(`🎁 Подарок отправлен: ${item.name}`);
    });
  });
  composer.command("flowers", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      await storage.transaction((state) => services.gift(state, identityFromContext(ctx), "gift_flowers", nowIso()));
      await ctx.reply("💐 Цветы подарены");
    });
  });
  composer.command("ring", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      await storage.transaction((state) => services.gift(state, identityFromContext(ctx), "gift_ring", nowIso()));
      await ctx.reply("💍 Кольцо подарено");
    });
  });
  composer.command(["top", "topmoney", "toplove", "topcars", "tophouses"], async (ctx) => {
    await ctx.reply("🏆 Эти рейтинги используют тот же RPG state. Основной семейный рейтинг: /topfamily");
  });
  composer.command(["quests", "weekly", "events"], async (ctx) => {
    await ctx.reply("🎯 Система заданий и событий зарезервирована в архитектуре и подключается отдельным сервисом.");
  });
  composer.command(["settings", "lang"], async (ctx) => {
    await ctx.reply("⚙️ Настройки профиля уже хранятся в RPG state. UI переключателей добавляется отдельным composer-модулем.");
  });
  composer.command("admin", async (ctx) => {
    await ctx.reply([
      "👑 Админ RPG",
      "",
      "/addmoney <userId> <amount>",
      "/take <userId> <amount>",
      "/addxp <userId> <xp>",
      "/setlevel <userId> <level>",
      "/give <userId> <itemId>",
      "/ban <userId>",
      "/unban <userId>",
      "/resetuser <userId>",
      "/logs"
    ].join("\n"));
  });
  composer.command(["addmoney", "give_money"], async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, amount] = numericPairArgs(ctx);
      await storage.transaction((state) => admin.grantMoney(state, actorId(ctx), identityFromId(targetId), amount, nowIso()));
      await ctx.reply("✅ Деньги выданы");
    });
  });
  composer.command("take", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, amount] = numericPairArgs(ctx);
      await storage.transaction((state) => admin.takeMoney(state, actorId(ctx), targetId, amount, nowIso()));
      await ctx.reply("✅ Деньги списаны");
    });
  });
  composer.command("addxp", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, xp] = numericPairArgs(ctx);
      await storage.transaction((state) => admin.grantXp(state, actorId(ctx), identityFromId(targetId), xp, nowIso()));
      await ctx.reply("✅ XP выдан");
    });
  });
  composer.command("setlevel", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, level] = numericPairArgs(ctx);
      await storage.transaction((state) => admin.setLevel(state, actorId(ctx), targetId, level, nowIso()));
      await ctx.reply("✅ Уровень изменен");
    });
  });
  composer.command(["give", "giveitem"], async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetIdText, itemId] = textArgs(ctx, 2);
      const targetId = Number(targetIdText);
      if (!Number.isSafeInteger(targetId) || !itemId) {
        throw new Error("Формат: /give <userId> <itemId>");
      }

      const item = await storage.transaction((state) => admin.grantItem(state, actorId(ctx), identityFromId(targetId), itemId, nowIso()));
      await ctx.reply(`✅ Предмет выдан: ${item.name}`);
    });
  });
  composer.command("resetuser", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const targetId = numericArg(ctx);
      await storage.transaction((state) => admin.resetPlayer(state, actorId(ctx), targetId, nowIso()));
      await ctx.reply("✅ Пользователь сброшен");
    });
  });
  composer.command("ban", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const targetId = numericArg(ctx);
      await storage.transaction((state) => admin.setBlocked(state, actorId(ctx), targetId, true, nowIso()));
      await ctx.reply("✅ Игрок заблокирован");
    });
  });
  composer.command("unban", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const targetId = numericArg(ctx);
      await storage.transaction((state) => admin.setBlocked(state, actorId(ctx), targetId, false, nowIso()));
      await ctx.reply("✅ Игрок разблокирован");
    });
  });
  composer.command("logs", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      if (!options.ownerIds?.includes(actorId(ctx))) {
        throw new Error("Недостаточно прав");
      }

      const logs = await storage.transaction((state) => state.logs.slice(-10));
      await ctx.reply(["📋 Логи", "", ...(logs.length > 0 ? logs.map((log) => `${log.createdAt} ${log.message}`) : ["Пусто"])].join("\n"));
    });
  });
  composer.command("broadcast", async (ctx) => {
    await ctx.reply("📣 Broadcast зарезервирован. Для production нужен отдельный rate-limited sender и источник chatIds.");
  });
  composer.command("help", async (ctx) => {
    await ctx.reply(helpText());
  });

  return composer;
};

const mainKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("👤 Профиль", "rpg_profile"), Markup.button.callback("🛒 Магазин", "rpg_shop")],
  [Markup.button.callback("💼 Работа", "rpg_jobs"), Markup.button.callback("👑 Рейтинг", "rpg_rating")]
]);

const replyWithDomainErrors = async (ctx: Context, handler: () => Promise<void>): Promise<void> => {
  try {
    await handler();
  } catch (error) {
    await ctx.reply(`⚠️ ${error instanceof Error ? error.message : "Неизвестная ошибка"}`);
  }
};

const commandArg = (ctx: Context): string | undefined => {
  if (!ctx.message || !("text" in ctx.message)) {
    return undefined;
  }

  return ctx.message.text.trim().split(/\s+/)[1];
};

const textArgs = (ctx: Context, count: number): string[] => {
  if (!ctx.message || !("text" in ctx.message)) {
    return [];
  }

  return ctx.message.text.trim().split(/\s+/).slice(1, count + 1);
};

const numericArg = (ctx: Context): number => {
  const value = Number(commandArg(ctx));
  if (!Number.isSafeInteger(value)) {
    throw new Error("Аргумент должен быть целым числом");
  }

  return value;
};

const numericPairArgs = (ctx: Context): [number, number] => {
  const [first, second] = textArgs(ctx, 2).map(Number);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second)) {
    throw new Error("Формат: /command <userId> <amount>");
  }

  return [first, second];
};

const actorId = (ctx: Context): number => {
  if (!ctx.from) {
    throw new Error("Не удалось определить администратора");
  }

  return ctx.from.id;
};

const identityFromId = (id: number) => ({
  id,
  firstName: `Игрок ${id}`
});

const showCategory = async (ctx: Context, services: GameServices, category: string): Promise<void> => {
  const items = services.listCatalog(category).slice(0, 20);
  await ctx.reply(formatCatalogPage(items, 0, 20));
};

const helpText = (): string => [
  "🎮 Family RPG",
  "",
  "Профиль: /profile /family /inventory /balance /level",
  "Брак: /marry /accept /reject /divorce /love",
  "Работа: /jobs /job /work /quitjob /salary",
  "Магазин: /shop /buy /sell /catalog",
  "Имущество: /houses /cars /bikes /planes /yachts /pets",
  "Путешествия: /travel /trips /ticket /airport",
  "Рейтинг: /topfamily"
].join("\n");
