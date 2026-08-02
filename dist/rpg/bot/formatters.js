"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFamily = exports.formatInventoryEntry = exports.formatItemCard = exports.formatCatalogPage = exports.formatProfile = void 0;
const formatProfile = (player, family) => {
    const currentBicycle = player.inventory.find((entry) => entry.itemId.startsWith("bike_") || entry.itemId === "bicycle_city");
    const bicycleLines = currentBicycle
        ? [
            "",
            "🚲 Текущий велосипед",
            `ID: ${currentBicycle.itemId}`,
            `Куплен: ${new Date(currentBicycle.acquiredAt).toLocaleDateString("ru-RU")}`,
            `Состояние: ${currentBicycle.condition ?? "new"}`,
            `Износ: ${currentBicycle.wearLevel ?? 0}%`,
            `Текущая стоимость: ${(currentBicycle.currentValue ?? 0).toLocaleString("ru-RU")} сум`
        ]
        : ["", "🚲 Текущий велосипед: нет"];
    return [
        "👤 Профиль",
        "",
        `ID: ${player.id}`,
        `Имя: ${player.firstName}`,
        `Страна: ${player.country}`,
        `Баланс: ${player.balance.toLocaleString("ru-RU")} сум`,
        `Банк: ${player.bankBalance.toLocaleString("ru-RU")} сум`,
        `Уровень: ${player.level}`,
        `XP: ${player.xp}`,
        `Энергия: ${player.energy}`,
        `Профессия: ${player.jobId ?? "нет"}`,
        `Семья: ${family ? `#${family.id}` : "нет"}`,
        `Инвентарь: ${player.inventory.reduce((sum, item) => sum + item.quantity, 0)}`,
        ...bicycleLines
    ].join("\n");
};
exports.formatProfile = formatProfile;
const formatCatalogPage = (items, page, pageSize) => {
    const visible = items.slice(page * pageSize, page * pageSize + pageSize);
    const lines = visible.map((item) => {
        const transport = item.transport
            ? `\n  ${item.transport.country}, ${item.transport.year} | ${item.transport.weightKg ? `${item.transport.weightKg} кг | ` : ""}${item.transport.horsepower} hp | ${item.transport.topSpeedKmh} км/ч | ${item.transport.fuelType}\n  Работа: ${item.transport.canWork ? item.transport.unlockedJobs.join(", ") : "нет"} | Лицензия: ${item.transport.requiredLicense}`
            : "";
        return `• ${item.name} (${item.id})\n  Цена: ${item.price.toLocaleString("ru-RU")} | lvl ${item.level} | ${item.rarity ?? "common"}${transport}`;
    });
    return ["🛒 Магазин", "", ...lines].join("\n");
};
exports.formatCatalogPage = formatCatalogPage;
const formatItemCard = (item) => {
    const transport = item.transport;
    const details = transport
        ? [
            `Бренд: ${transport.brand}`,
            `Модель: ${transport.model}`,
            `Страна: ${transport.country}`,
            `Год: ${transport.year}`,
            transport.weightKg !== undefined ? `Вес: ${transport.weightKg} кг` : undefined,
            `Макс. скорость: ${transport.topSpeedKmh} км/ч`,
            `Состояние при покупке: ${transport.defaultCondition ?? "new"}`,
            `Обслуживание: ${transport.maintenanceCost.toLocaleString("ru-RU")} сум`,
            `Ремонт: ${transport.repairCost.toLocaleString("ru-RU")} сум`,
            `Перепродажа: ${transport.resalePrice.toLocaleString("ru-RU")} сум`,
            `Можно продать: ${transport.canSell === false ? "нет" : "да"}`,
            `Можно ремонтировать: ${transport.canRepair === false ? "нет" : "да"}`,
            `Можно улучшать: ${transport.upgradeSupport ? "да" : "нет"}`,
            `Открывает: ${transport.unlockedJobs.length > 0 ? transport.unlockedJobs.join(", ") : "нет"}`,
            transport.description ? `Описание: ${transport.description}` : undefined
        ].filter((line) => Boolean(line))
        : [];
    return [
        `📦 ${item.name}`,
        "",
        `ID: ${item.id}`,
        `Цена: ${item.price.toLocaleString("ru-RU")} сум`,
        `Минимальный уровень: ${item.level}`,
        `Категория: ${item.category}`,
        "",
        ...details
    ].join("\n");
};
exports.formatItemCard = formatItemCard;
const formatInventoryEntry = (item, entry) => [
    `• ${item.name} (${entry.itemId}) x${entry.quantity}`,
    `  Экземпляр: ${entry.instanceId}`,
    `  Куплен: ${new Date(entry.acquiredAt).toLocaleDateString("ru-RU")}`,
    `  Состояние: ${entry.condition ?? "new"} | износ ${entry.wearLevel ?? 0}%`,
    `  Текущая стоимость: ${(entry.currentValue ?? item.assetValue).toLocaleString("ru-RU")} сум`,
    `  Ремонтов: ${entry.repairHistory?.length ?? 0} | Улучшений: ${entry.upgradeHistory?.length ?? 0}`
].join("\n");
exports.formatInventoryEntry = formatInventoryEntry;
const formatFamily = (family) => [
    "❤️ Семья",
    "",
    `ID: ${family.id}`,
    `Титул: ${family.title}`,
    `Участники: ${family.partnerIds.join(" + ")}`,
    `Дата свадьбы: ${new Date(family.weddingDate).toLocaleDateString("ru-RU")}`,
    `Любовь: ${family.love}`,
    `Уровень: ${family.level}`,
    `XP семьи: ${family.xp}`,
    `Капитал: ${family.capital.toLocaleString("ru-RU")}`,
    `Путешествия: ${family.travelIds.length}`,
    `Достижения: ${family.achievements.length}`,
    "",
    "Совместная статистика",
    `Работ выполнено: ${family.stats.jobsCompleted}`,
    `Покупок: ${family.stats.purchases}`,
    `Подарков: ${family.stats.giftsSent}`,
    `Заработано: ${family.stats.totalEarned.toLocaleString("ru-RU")}`,
    `Потрачено: ${family.stats.totalSpent.toLocaleString("ru-RU")}`
].join("\n");
exports.formatFamily = formatFamily;
