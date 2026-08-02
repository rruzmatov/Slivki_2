import { Composer, Markup, type Context } from "telegraf";
import { GAME_BALANCE } from "../config/game-balance";
import { travelLocations } from "../data/catalog";
import type { GameServices } from "../application/game-services";
import type { AssetCategory } from "../domain/assets";
import { createCompositionRoot } from "../bootstrap/composition-root";
import { formatCatalogPage, formatFamily, formatInventoryEntry, formatItemCard, formatProfile } from "./formatters";

const nowIso = (): string => new Date().toISOString();
const RPG_UI_DISCOVERY_ENABLED = false;

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

export interface RpgRuntime {
  composer: Composer<Context>;
  stop(): Promise<void>;
}

export const createRpgRuntime = async (options: RpgComposerOptions = {}): Promise<RpgRuntime> => {
  const composer = new Composer<Context>();
  const root = await createCompositionRoot({ ...options, startScheduler: true });
  const services = root.gameServices;
  const admin = root.adminService;

  composer.use(async (ctx, next) => {
    const callback = ctx.callbackQuery;
    if (callback && "data" in callback) {
      root.schemaRegistry.validate("integration", "telegram.callback", 1, {
        callbackQueryId: callback.id,
        data: callback.data,
        actorId: ctx.from?.id
      });
    }
    await next();
  });

  composer.command("rpg", async (ctx) => {
    const { player, family } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await services.recordCommand();
    await ctx.reply(formatProfile(player, family), mainKeyboard());
  });

  composer.command("menu", async (ctx) => {
    await ctx.reply(mainMenuText(), mainKeyboard());
  });

  composer.command("profile", async (ctx) => {
    const { player, family } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await services.recordCommand();
    await ctx.reply(formatProfile(player, family), mainKeyboard());
  });

  composer.command(["family", "familyinfo"], async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const family = await services.getFamily(identityFromContext(ctx), nowIso());
      await ctx.reply(formatFamily(family));
    });
  });

  composer.command("stats", async (ctx) => {
    const stats = await services.getStats();
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
    const page = Math.max(0, Number(commandArg(ctx) ?? 1) - 1);
    await showInventoryPage(ctx, services, page);
  });

  composer.command("asset", async (ctx) => {
    const entryId = commandArg(ctx);
    if (!entryId) {
      await ctx.reply("Формат: /asset <instanceId>");
      return;
    }
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.getInventoryEntry(identityFromContext(ctx), entryId, nowIso());
      await ctx.reply(formatInventoryEntry(result.item, result.entry));
    });
  });

  composer.command("giveasset", async (ctx) => {
    const [entryId, targetRaw] = textArgs(ctx, 2);
    const targetId = Number(targetRaw);
    if (!entryId || !Number.isSafeInteger(targetId)) {
      await ctx.reply("Формат: /giveasset <instanceId> <telegramId>");
      return;
    }
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.createInventoryGiftQuote(
        identityFromContext(ctx),
        entryId,
        targetId,
        nowIso()
      );
      await ctx.reply(
        `🎁 Передать ${result.item.name} игроку ${result.targetPlayer.firstName}?\nОбъект: ${entryId}`,
        inventoryGiftKeyboard(result.session.id)
      );
    });
  });

  composer.command("inventorylog", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const events = options.ownerIds?.includes(actorId(ctx))
        ? await admin.listInventoryHistory(actorId(ctx), 20)
        : await services.getInventoryHistory(identityFromContext(ctx), nowIso(), 10);
      await ctx.reply(formatInventoryHistory(events));
    });
  });

  composer.command("balance", async (ctx) => {
    const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await ctx.reply(`💰 Наличные: ${player.balance.toLocaleString("ru-RU")} сум\n🏦 Банк: ${player.bankBalance.toLocaleString("ru-RU")} сум`);
  });

  composer.command(["economy", "bank"], async (ctx) => {
    const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await ctx.reply([
      "🏦 Экономика",
      "",
      `Наличные: ${player.balance.toLocaleString("ru-RU")} сум`,
      `В банке: ${player.bankBalance.toLocaleString("ru-RU")} сум`,
      "",
      "Команды:",
      "/daily",
      "/deposit <сумма>",
      "/withdraw <сумма>",
      "/transfer <telegramId> <сумма>"
    ].join("\n"));
  });

  composer.command("deposit", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.deposit(identityFromContext(ctx), numericArg(ctx), nowIso());
      await ctx.reply(`🏦 Пополнение: наличные ${result.balance.toLocaleString("ru-RU")}, банк ${result.bankBalance.toLocaleString("ru-RU")}`);
    });
  });

  composer.command("withdraw", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.withdraw(identityFromContext(ctx), numericArg(ctx), nowIso());
      await ctx.reply(`🏦 Снятие: наличные ${result.balance.toLocaleString("ru-RU")}, банк ${result.bankBalance.toLocaleString("ru-RU")}`);
    });
  });

  composer.command("transfer", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, amount] = numericPairArgs(ctx);
      await services.transfer(identityFromContext(ctx), targetId, amount, nowIso());
      await ctx.reply("✅ Перевод выполнен");
    });
  });

  composer.command("level", async (ctx) => {
    const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await ctx.reply(`⭐ Уровень: ${player.level}\nXP: ${player.xp}`);
  });

  composer.command("skills", async (ctx) => {
    const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    const lines = Object.entries(player.skills).map(([name, value]) => `• ${name}: ${value}`);
    await ctx.reply(["🧠 Навыки", "", ...(lines.length > 0 ? lines : ["Навыки пока не развиты"])].join("\n"));
  });

  composer.command("achievements", async (ctx) => {
    const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await ctx.reply(["🏆 Достижения", "", ...(player.achievements.length > 0 ? player.achievements.map((id) => `• ${id}`) : ["Пока нет"])].join("\n"));
  });

  composer.command("daily", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.claimDailyReward(identityFromContext(ctx), nowIso());
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
      const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
      await ctx.reply(`💼 Текущая профессия: ${player.jobId ?? "нет"}\nВыбрать: /job job_courier`);
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await services.setJob(identityFromContext(ctx), jobId, nowIso());
      await ctx.reply(`✅ Профессия выбрана: ${result.title}`);
    });
  });

  composer.command("work", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.work(identityFromContext(ctx), commandArg(ctx), nowIso());
      await ctx.reply(`💼 ${result.title}: +${result.payout.toLocaleString("ru-RU")} сум, +${result.xp} XP`);
    });
  });

  composer.command("salary", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.work(identityFromContext(ctx), undefined, nowIso());
      await ctx.reply(`💵 Зарплата получена: ${result.title}, +${result.payout.toLocaleString("ru-RU")} сум`);
    });
  });

  composer.command("quitjob", async (ctx) => {
    await services.quitJob(identityFromContext(ctx), nowIso());
    await ctx.reply("✅ Вы уволились");
  });

  composer.command("shop", async (ctx) => {
    const category = commandArg(ctx);
    if (category) {
      await showShopCategory(ctx, services, category, 0);
      return;
    }
    await ctx.reply(shopHomeText(), shopHomeKeyboard(services));
  });

  composer.command(["catalog", "market"], async (ctx) => {
    const category = commandArg(ctx);
    const items = services.listCatalog(category).slice(0, 25);
    await ctx.reply(formatCatalogPage(items, 0, 25));
  });

  composer.command("buy", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID предмета: /buy bike_giant_escape_3");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await services.createPurchaseQuote(identityFromContext(ctx), itemId, nowIso());
      await ctx.reply(formatPurchaseQuote(result.item, result.checkout.totalPrice.amount, result.checkout.expiresAt), purchaseKeyboard(result.checkout.id));
    });
  });

  composer.command("item", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID товара: /item bike_giant_escape_3");
      return;
    }
    await replyWithDomainErrors(ctx, async () => {
      const item = services.getCatalogItem(itemId);
      await ctx.reply(formatItemCard(item), buyKeyboard(item.id));
    });
  });

  composer.command("sell", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID предмета из инвентаря: /sell bike_giant_escape_3");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await services.createSaleQuote(identityFromContext(ctx), itemId, nowIso());
      await ctx.reply(formatSaleQuote(result.item.name, result.checkout.totalPrice.amount, result.checkout.expiresAt), saleKeyboard(result.checkout.id));
    });
  });

  composer.command("orders", async (ctx) => {
    const orders = await services.listShopOrders(identityFromContext(ctx), nowIso(), 10);
    const lines = orders.map((order) => `${order.type === "purchase" ? "Покупка" : "Продажа"} ${order.productId} x${order.quantity} — ${order.totalPrice.amount.toLocaleString("ru-RU")} ${order.totalPrice.currency}\n${order.id}`);
    await ctx.reply(["📒 Операции магазина", "", ...(lines.length > 0 ? lines : ["Операций пока нет"])].join("\n"));
  });

  composer.command("repair", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID велосипеда из инвентаря: /repair bike_giant_escape_3");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await services.repairItem(identityFromContext(ctx), itemId, nowIso());
      await ctx.reply(`🔧 Ремонт выполнен: ${result.item.name}\nСтоимость: ${result.cost.toLocaleString("ru-RU")} сум\nСостояние: ${result.condition}\nСтоимость сейчас: ${result.value.toLocaleString("ru-RU")} сум`);
    });
  });

  composer.command(["service", "maintenance"], async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID велосипеда из инвентаря: /service bike_giant_escape_3");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const result = await services.serviceItem(identityFromContext(ctx), itemId, nowIso());
      await ctx.reply(`🧰 Обслуживание выполнено: ${result.item.name}\nСтоимость: ${result.cost.toLocaleString("ru-RU")} сум\nСостояние: ${result.condition}\nСтоимость сейчас: ${result.value.toLocaleString("ru-RU")} сум`);
    });
  });

  composer.command("marry", async (ctx) => {
    const targetId = Number(commandArg(ctx));
    if (!Number.isSafeInteger(targetId) || !ctx.chat) {
      await ctx.reply("Укажите Telegram ID игрока: /marry 123456");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const proposalId = await services.createProposal(identityFromContext(ctx), targetId, ctx.chat.id, nowIso());
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
      const family = await services.acceptProposal(identityFromContext(ctx), proposalId, nowIso());
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
      await services.rejectProposal(identityFromContext(ctx), proposalId, nowIso());
      await ctx.reply("💔 Предложение отклонено");
    });
  });

  composer.command("divorce", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      await services.divorce(identityFromContext(ctx), nowIso());
      await ctx.reply("💔 Развод оформлен");
    });
  });

  composer.command("love", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const family = await services.getFamily(identityFromContext(ctx), nowIso());
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
      const result = await services.travel(identityFromContext(ctx), locationId, nowIso());
      await ctx.reply(`🌍 ${result.name}: +${result.love} любви, +${result.xp} XP`);
    });
  });

  composer.command(["families", "topfamily"], async (ctx) => {
    const rating = (await services.getFamilyRating()).slice(0, 10);
    const lines = rating.map((entry, index) => `${index + 1}. ${entry.family.partnerIds.join(" + ")} — ${entry.score.toLocaleString("ru-RU")}`);
    await ctx.reply(["👑 Best Family", "", ...(lines.length > 0 ? lines : ["Пока нет семей"])].join("\n"));
  });

  composer.command(["houses", "house"], (ctx) => showCategory(ctx, services, "home"));
  composer.command(["realestate", "estate"], (ctx) => showCategory(ctx, services, "home"));
  composer.command(["cars", "garage"], (ctx) => showCategory(ctx, services, "car"));
  composer.command(["transport"], async (ctx) => {
    await ctx.reply([
      "🚗 Транспорт",
      "",
      "/bikes",
      "/motorcycles",
      "/cars",
      "/trucks",
      "/ships",
      "/yachts",
      "/planes",
      "/helicopters"
    ].join("\n"));
  });
  composer.command("bikes", (ctx) => showCategory(ctx, services, "bicycle"));
  composer.command("bike", async (ctx) => {
    const itemId = commandArg(ctx);
    if (!itemId) {
      await ctx.reply("Укажите ID велосипеда: /bike bike_giant_escape_3");
      return;
    }

    await replyWithDomainErrors(ctx, async () => {
      const item = services.listCatalog("bicycle").find((candidate) => candidate.id === itemId);
      if (!item) {
        throw new Error("Велосипед не найден");
      }

      await ctx.reply(formatItemCard(item), buyKeyboard(item.id));
    });
  });
  composer.command("motorcycles", (ctx) => showCategory(ctx, services, "motorcycle"));
  composer.command("trucks", (ctx) => showCategory(ctx, services, "truck"));
  composer.command("ships", (ctx) => showCategory(ctx, services, "ship"));
  composer.command("planes", (ctx) => showCategory(ctx, services, "airplane"));
  composer.command("helicopters", (ctx) => showCategory(ctx, services, "helicopter"));
  composer.command("yachts", (ctx) => showCategory(ctx, services, "yacht"));
  composer.command(["business", "businesses"], (ctx) => showCategory(ctx, services, "business"));
  composer.command("pets", (ctx) => showCategory(ctx, services, "pet"));
  composer.command(["trips", "airport", "passport"], async (ctx) => {
    await ctx.reply(["🌍 Путешествия", "", ...travelLocations.map((location) => `${location.name}: /travel ${location.id}`)].join("\n"));
  });
  composer.command("ticket", (ctx) => showCategory(ctx, services, "ticket"));
  composer.command(["worldmap", "map"], async (ctx) => {
    await ctx.reply(["🗺 Карта мира", "", ...travelLocations.map((location) => `${location.name}: /travel ${location.id}`)].join("\n"));
  });
  composer.command("gift", async (ctx) => {
    const itemId = commandArg(ctx) ?? "gift_flowers";
    await replyWithDomainErrors(ctx, async () => {
      const item = await services.gift(identityFromContext(ctx), itemId, nowIso());
      await ctx.reply(`🎁 Подарок отправлен: ${item.name}`);
    });
  });
  composer.command("flowers", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      await services.gift(identityFromContext(ctx), "gift_flowers", nowIso());
      await ctx.reply("💐 Цветы подарены");
    });
  });
  composer.command("ring", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      await services.gift(identityFromContext(ctx), "gift_ring", nowIso());
      await ctx.reply("💍 Кольцо подарено");
    });
  });
  composer.command(["top", "topmoney", "toplove", "topcars", "tophouses"], async (ctx) => {
    const rating = (await services.getRichestPlayers()).slice(0, 10);
    const lines = rating.map((entry, index) => `${index + 1}. ${entry.player.firstName} — ${entry.netWorth.toLocaleString("ru-RU")} сум`);
    await ctx.reply(["🏆 Forbes", "", ...(lines.length > 0 ? lines : ["Пока нет игроков"])].join("\n"));
  });
  composer.command("forbes", async (ctx) => {
    const rating = (await services.getRichestPlayers()).slice(0, 10);
    const lines = rating.map((entry, index) => `${index + 1}. ${entry.player.firstName} — ${entry.netWorth.toLocaleString("ru-RU")} сум`);
    await ctx.reply(["🏆 Forbes", "", ...(lines.length > 0 ? lines : ["Пока нет игроков"])].join("\n"));
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
  composer.command(["developermode", "developer"], async (ctx) => {
    await ctx.reply("👑 Developer Mode: /admin");
  });
  composer.command(["addmoney", "give_money"], async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, amount] = numericPairArgs(ctx);
      await admin.grantMoney(actorId(ctx), identityFromId(targetId), amount, nowIso());
      await ctx.reply("✅ Деньги выданы");
    });
  });
  composer.command("take", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, amount] = numericPairArgs(ctx);
      await admin.takeMoney(actorId(ctx), targetId, amount, nowIso());
      await ctx.reply("✅ Деньги списаны");
    });
  });
  composer.command("addxp", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, xp] = numericPairArgs(ctx);
      await admin.grantXp(actorId(ctx), identityFromId(targetId), xp, nowIso());
      await ctx.reply("✅ XP выдан");
    });
  });
  composer.command("setlevel", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const [targetId, level] = numericPairArgs(ctx);
      await admin.setLevel(actorId(ctx), targetId, level, nowIso());
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

      const item = await admin.grantItem(actorId(ctx), identityFromId(targetId), itemId, nowIso());
      await ctx.reply(`✅ Предмет выдан: ${item.name}`);
    });
  });
  composer.command("resetuser", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const targetId = numericArg(ctx);
      await admin.resetPlayer(actorId(ctx), targetId, nowIso());
      await ctx.reply("✅ Пользователь сброшен");
    });
  });
  composer.command("ban", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const targetId = numericArg(ctx);
      await admin.setBlocked(actorId(ctx), targetId, true, nowIso());
      await ctx.reply("✅ Игрок заблокирован");
    });
  });
  composer.command("unban", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const targetId = numericArg(ctx);
      await admin.setBlocked(actorId(ctx), targetId, false, nowIso());
      await ctx.reply("✅ Игрок разблокирован");
    });
  });
  composer.command("logs", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      if (!options.ownerIds?.includes(actorId(ctx))) {
        throw new Error("Недостаточно прав");
      }

      const logs = await admin.listLogs(actorId(ctx), 10);
      await ctx.reply(["📋 Логи", "", ...(logs.length > 0 ? logs.map((log) => `${log.createdAt} ${log.message}`) : ["Пусто"])].join("\n"));
    });
  });
  composer.command("confiscate", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const args = allCommandArgs(ctx);
      const targetId = Number(args[0]);
      const entryId = args[1];
      const reason = args.slice(2).join(" ").trim();
      if (!Number.isSafeInteger(targetId) || !entryId || !reason) {
        throw new Error("Формат: /confiscate <telegramId> <instanceId> <причина>");
      }
      const item = await admin.confiscateItem(actorId(ctx), targetId, entryId, reason, nowIso());
      await ctx.reply(`✅ Конфисковано: ${item.name}\nОбъект: ${entryId}`);
    });
  });
  composer.command("recoveritem", async (ctx) => {
    await replyWithDomainErrors(ctx, async () => {
      const args = allCommandArgs(ctx);
      const entryId = args[0];
      const reason = args.slice(1).join(" ").trim();
      if (!entryId || !reason) throw new Error("Формат: /recoveritem <instanceId> <причина>");
      const item = await admin.recoverItem(actorId(ctx), entryId, reason, nowIso());
      await ctx.reply(`✅ Возвращено владельцу: ${item.name}\nОбъект: ${entryId}`);
    });
  });
  composer.command("broadcast", async (ctx) => {
    await ctx.reply("📣 Broadcast зарезервирован. Для production нужен отдельный rate-limited sender и источник chatIds.");
  });
  composer.command("help", async (ctx) => {
    await ctx.reply(helpText());
  });

  composer.action("rpg_profile", async (ctx) => {
    await ctx.answerCbQuery();
    const { player, family } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await ctx.reply(formatProfile(player, family), mainKeyboard());
  });
  composer.action(/^rpg_inventory:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showInventoryPage(ctx, services, Number(ctx.match[1]));
  });
  composer.action("rpg_bank", async (ctx) => {
    await ctx.answerCbQuery();
    const { player } = await services.getPlayerProfile(identityFromContext(ctx), nowIso());
    await ctx.reply(`🏦 Банк\n\nНаличные: ${player.balance.toLocaleString("ru-RU")} сум\nВ банке: ${player.bankBalance.toLocaleString("ru-RU")} сум`);
  });
  composer.action("rpg_jobs", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(["💼 Профессии", "", ...services.listJobs().map((job) => `${job.title}: /job ${job.id}`)].join("\n"));
  });
  composer.action("rpg_shop", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(shopHomeText(), shopHomeKeyboard(services));
  });
  composer.action("rpg_transport", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("🚗 Транспорт\n\n/bikes\n/motorcycles\n/cars\n/trucks\n/ships\n/yachts\n/planes\n/helicopters");
  });
  composer.action("rpg_business", async (ctx) => {
    await ctx.answerCbQuery();
    await showCategory(ctx, services, "business");
  });
  composer.action("rpg_worldmap", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(["🗺 Карта мира", "", ...travelLocations.map((location) => `${location.name}: /travel ${location.id}`)].join("\n"));
  });
  composer.action("rpg_forbes", async (ctx) => {
    await ctx.answerCbQuery();
    const rating = (await services.getRichestPlayers()).slice(0, 10);
    const lines = rating.map((entry, index) => `${index + 1}. ${entry.player.firstName} — ${entry.netWorth.toLocaleString("ru-RU")} сум`);
    await ctx.reply(["🏆 Forbes", "", ...(lines.length > 0 ? lines : ["Пока нет игроков"])].join("\n"));
  });
  composer.action(/^shop_asset:([^:]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, async () => {
      const assetTypeId = ctx.match[1];
      const categories = services.listAssetCategories(assetTypeId);
      await ctx.reply(`🛒 ${services.listAssetTypes().find((item) => item.id === assetTypeId)?.name ?? assetTypeId}`, categoryKeyboard(categories));
    });
  });
  composer.action(/^shop_category:([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, () => showShopCategory(ctx, services, ctx.match[1], Number(ctx.match[2])));
  });
  composer.action(/^shop_product:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, async () => {
      const item = services.getCatalogItem(ctx.match[1]);
      await ctx.reply(formatItemCard(item), buyKeyboard(item.id));
    });
  });
  composer.action(/^shop_quote:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.createPurchaseQuote(identityFromContext(ctx), ctx.match[1], nowIso());
      await ctx.reply(formatPurchaseQuote(result.item, result.checkout.totalPrice.amount, result.checkout.expiresAt), purchaseKeyboard(result.checkout.id));
    });
  });
  composer.action(/^shop_buy_(cash|bank):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, async () => {
      const paymentSource = ctx.match[1] as "cash" | "bank";
      const checkoutId = ctx.match[2];
      const result = await services.confirmPurchase(
        identityFromContext(ctx),
        checkoutId,
        paymentSource,
        callbackRequestId(ctx),
        nowIso()
      );
      await ctx.reply(`✅ Куплено: ${result.item.name}\nЗаказ: ${result.order.id}\nСписано: ${result.order.totalPrice.amount.toLocaleString("ru-RU")} ${result.order.totalPrice.currency}\nОстаток на счёте: ${result.balance.toLocaleString("ru-RU")} сум`);
    });
  });
  composer.action(/^shop_sale_confirm:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.confirmSale(
        identityFromContext(ctx),
        ctx.match[1],
        callbackRequestId(ctx),
        nowIso()
      );
      await ctx.reply(`✅ Продано: ${result.item.name}\nЗаказ: ${result.order.id}\nЗачислено: ${result.order.totalPrice.amount.toLocaleString("ru-RU")} сум\nБаланс: ${result.balance.toLocaleString("ru-RU")} сум`);
    });
  });
  composer.action(/^shop_cancel:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Операция отменена");
    await replyWithDomainErrors(ctx, async () => {
      await services.cancelShopCheckout(identityFromContext(ctx), ctx.match[1], nowIso());
      await ctx.reply("❌ Операция магазина отменена");
    });
  });
  composer.action(/^buy_confirm:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const itemId = ctx.match[1];
    await replyWithDomainErrors(ctx, async () => {
      const item = await services.buyItem(identityFromContext(ctx), itemId, nowIso(), callbackRequestId(ctx));
      await ctx.reply(`✅ Куплено: ${item.name}\nПредмет добавлен через InventoryService. Открыто: ${item.transport?.unlockedJobs.join(", ") || "новых механик нет"}`);
    });
  });
  composer.action(/^buy_cancel:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Покупка отменена");
    await ctx.reply("❌ Покупка отменена");
  });
  composer.action(/^iv_gift_confirm:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await replyWithDomainErrors(ctx, async () => {
      const result = await services.confirmInventoryGift(
        identityFromContext(ctx),
        ctx.match[1],
        callbackRequestId(ctx),
        nowIso()
      );
      await ctx.reply(`✅ Передано: ${result.item.name}\nПолучатель: ${result.targetPlayer.firstName}\nОбъект: ${result.entryId}`);
    });
  });
  composer.action(/^iv_gift_cancel:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Операция отменена");
    await replyWithDomainErrors(ctx, async () => {
      await services.cancelInventoryAction(identityFromContext(ctx), ctx.match[1], nowIso());
      await ctx.reply("❌ Передача объекта отменена");
    });
  });

  return { composer, stop: () => root.stop() };
};

export const createRpgComposer = async (options: RpgComposerOptions = {}): Promise<Composer<Context>> =>
  (await createRpgRuntime(options)).composer;

const mainKeyboard = () => {
  if (!RPG_UI_DISCOVERY_ENABLED) return undefined;
  return Markup.inlineKeyboard([
    [Markup.button.callback("👤 Профиль", "rpg_profile"), Markup.button.callback("🏦 Банк", "rpg_bank")],
    [Markup.button.callback("💼 Работа", "rpg_jobs"), Markup.button.callback("🛒 Магазин", "rpg_shop")],
    [Markup.button.callback("🚗 Транспорт", "rpg_transport"), Markup.button.callback("🏢 Бизнес", "rpg_business")],
    [Markup.button.callback("🌍 Карта", "rpg_worldmap"), Markup.button.callback("🏆 Forbes", "rpg_forbes")]
  ]);
};

const buyKeyboard = (itemId: string) => Markup.inlineKeyboard([
  [callbackButton("Купить", `shop_quote:${itemId}`), callbackButton("Магазин", "rpg_shop")]
]);

const purchaseKeyboard = (checkoutId: string) => Markup.inlineKeyboard([
  [callbackButton("Купить за наличные", `shop_buy_cash:${checkoutId}`)],
  [callbackButton("Купить из банка", `shop_buy_bank:${checkoutId}`)],
  [callbackButton("Отмена", `shop_cancel:${checkoutId}`)]
]);

const saleKeyboard = (checkoutId: string) => Markup.inlineKeyboard([
  [callbackButton("Подтвердить продажу", `shop_sale_confirm:${checkoutId}`)],
  [callbackButton("Отмена", `shop_cancel:${checkoutId}`)]
]);

const inventoryGiftKeyboard = (sessionId: string) => Markup.inlineKeyboard([
  [callbackButton("Передать", `iv_gift_confirm:${sessionId}`)],
  [callbackButton("Отмена", `iv_gift_cancel:${sessionId}`)]
]);

const shopHomeKeyboard = (services: GameServices) => Markup.inlineKeyboard(
  services.listAssetTypes().map((assetType) => [callbackButton(assetType.name, `shop_asset:${assetType.id}`)])
);

const categoryKeyboard = (categories: readonly AssetCategory[]) => Markup.inlineKeyboard([
  ...categories.map((category) => [callbackButton(category.name, `shop_category:${category.id}:0`)]),
  [callbackButton("Назад", "rpg_shop")]
]);

const shopCategoryKeyboard = (items: ReturnType<GameServices["listCatalog"]>, category: string, page: number, pageSize: number) => {
  const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);
  const rows = pageItems.map((item) => [callbackButton(item.name, `shop_product:${item.id}`)]);
  const navigation = [];
  if (page > 0) navigation.push(callbackButton("Назад", `shop_category:${category}:${page - 1}`));
  if ((page + 1) * pageSize < items.length) navigation.push(callbackButton("Далее", `shop_category:${category}:${page + 1}`));
  if (navigation.length > 0) rows.push(navigation);
  rows.push([callbackButton("Категории", "rpg_shop")]);
  return Markup.inlineKeyboard(rows);
};

const callbackButton = (text: string, data: string) => {
  if (Buffer.byteLength(data, "utf8") > 64) throw new Error(`Callback data exceeds Telegram limit: ${data}`);
  return Markup.button.callback(text, data);
};

const shopHomeText = (): string => [
  "🛒 Магазин Мир Сливки",
  "",
  "Выберите тип игрового актива. Все покупки проходят через единый каталог, экономику и инвентарь."
].join("\n");

const formatPurchaseQuote = (item: ReturnType<GameServices["getCatalogItem"]>, total: number, expiresAt: string): string => [
  formatItemCard(item),
  "",
  `К оплате: ${total.toLocaleString("ru-RU")} сум`,
  `Подтверждение действует до ${new Date(expiresAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" })}`
].join("\n");

const formatSaleQuote = (itemName: string, total: number, expiresAt: string): string => [
  `Продажа: ${itemName}`,
  `К зачислению: ${total.toLocaleString("ru-RU")} сум`,
  `Подтверждение действует до ${new Date(expiresAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent" })}`
].join("\n");

const mainMenuText = (): string => {
  if (!RPG_UI_DISCOVERY_ENABLED) return "📋 Главное меню";
  return [
    "🎮 Мир Сливки",
    "",
    "Profile: /profile",
    "Economy: /economy",
    "Jobs: /jobs",
    "Bank: /bank",
    "Shop: /shop",
    "Transport: /transport",
    "Business: /business",
    "Real Estate: /realestate",
    "Inventory: /inventory",
    "Family: /family",
    "Travel: /travel",
    "World Map: /worldmap",
    "Forbes: /forbes",
    "Help: /help",
    "Settings: /settings",
    "Developer Mode: /developermode"
  ].join("\n");
};

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

const allCommandArgs = (ctx: Context): string[] => {
  if (!ctx.message || !("text" in ctx.message)) return [];
  return ctx.message.text.trim().split(/\s+/).slice(1);
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
  await showShopCategory(ctx, services, category, 0);
};

const showShopCategory = async (ctx: Context, services: GameServices, category: string, page: number): Promise<void> => {
  const pageSize = GAME_BALANCE.pagination.pageSize;
  if (!Number.isSafeInteger(page) || page < 0) throw new Error("Некорректная страница магазина");
  const allItems = services.listCatalog(category);
  const items = allItems.slice(page * pageSize, (page + 1) * pageSize);
  if (items.length === 0) {
    await ctx.reply("В этой категории пока нет доступных товаров", categoryKeyboard([]));
    return;
  }
  await ctx.reply(formatCatalogPage(items, page, pageSize), shopCategoryKeyboard(allItems, category, page, pageSize));
};

const callbackRequestId = (ctx: Context): string => {
  if (!ctx.callbackQuery) throw new Error("Не удалось определить callback-запрос");
  return ctx.callbackQuery.id;
};

const showInventoryPage = async (
  ctx: Context,
  services: GameServices,
  page: number
): Promise<void> => {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error("Некорректная страница инвентаря");
  const entries = await services.getInventory(identityFromContext(ctx), nowIso());
  const pageSize = 8;
  const pageEntries = entries.slice(page * pageSize, (page + 1) * pageSize);
  const lines = pageEntries.map(({ item, entry }) => formatInventoryEntry(item, entry));
  const navigation = [];
  if (page > 0) navigation.push(callbackButton("Назад", `rpg_inventory:${page - 1}`));
  if ((page + 1) * pageSize < entries.length) navigation.push(callbackButton("Далее", `rpg_inventory:${page + 1}`));
  await ctx.reply(
    [`🎒 Инвентарь • страница ${page + 1}`, "", ...(lines.length > 0 ? lines : ["Пусто"])].join("\n"),
    navigation.length > 0 ? Markup.inlineKeyboard([navigation]) : undefined
  );
};

const formatInventoryHistory = (events: ReadonlyArray<{
  type: string;
  aggregateId: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}>): string => {
  const labels: Record<string, string> = {
    "inventory.granted": "Получено",
    "inventory.removed": "Изъято",
    "inventory.transferred": "Передано",
    "inventory.gifted": "Подарено",
    "inventory.reserved": "Зарезервировано",
    "inventory.reservation.released": "Резерв снят",
    "inventory.leased": "Передано в аренду",
    "inventory.returned": "Возвращено из аренды",
    "inventory.destroyed": "Уничтожено",
    "inventory.recovered": "Восстановлено",
    "inventory.confiscated": "Конфисковано",
    "inventory.repaired": "Отремонтировано",
    "inventory.maintained": "Обслужено",
    "inventory.upgraded": "Улучшено",
    "inventory.split": "Stack разделён",
    "inventory.merged": "Stack объединён",
    "inventory.consumed": "Использовано"
  };
  if (events.length === 0) return "📋 Журнал Inventory\n\nОпераций пока нет";
  const lines = events.map((event) => {
    const productId = typeof event.payload.productId === "string" ? ` • ${event.payload.productId}` : "";
    const quantity = typeof event.payload.quantity === "number" ? ` ×${event.payload.quantity}` : "";
    return `${event.occurredAt} • ${labels[event.type] ?? event.type}${productId}${quantity}\n${event.aggregateId}`;
  });
  return ["📋 Журнал Inventory", "", ...lines].join("\n");
};

const helpText = (): string => {
  if (!RPG_UI_DISCOVERY_ENABLED) return "🆘 Справка";
  return [
    "🎮 Мир Сливки",
    "",
    "Меню: /menu /rpg",
    "Профиль: /profile /family /inventory /asset /inventorylog /balance /level",
    "Брак: /marry /accept /reject /divorce /love",
    "Работа: /jobs /job /work /quitjob /salary",
    "Экономика: /economy /bank /daily /deposit /withdraw /transfer",
    "Магазин: /shop /item /buy /sell /orders /bike /repair /service /catalog /business",
    "Имущество: /realestate /garage /transport /cars /bikes /motorcycles /trucks /ships /planes /helicopters /yachts",
    "Путешествия: /travel /worldmap /trips /ticket /passport /airport",
    "Подарки: /gift /flowers /ring /giveasset",
    "Рейтинг: /forbes /topfamily"
  ].join("\n");
};
