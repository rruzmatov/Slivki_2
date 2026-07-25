import type { CatalogItem, Family, PlayerProfile } from "../domain/types";

export const formatProfile = (player: PlayerProfile, family?: Family): string => [
  "👤 Профиль",
  "",
  `ID: ${player.id}`,
  `Имя: ${player.firstName}`,
  `Баланс: ${player.balance.toLocaleString("ru-RU")} сум`,
  `Уровень: ${player.level}`,
  `XP: ${player.xp}`,
  `Энергия: ${player.energy}`,
  `Профессия: ${player.jobId ?? "нет"}`,
  `Семья: ${family ? `#${family.id}` : "нет"}`,
  `Инвентарь: ${player.inventory.reduce((sum, item) => sum + item.quantity, 0)}`
].join("\n");

export const formatCatalogPage = (items: CatalogItem[], page: number, pageSize: number): string => {
  const visible = items.slice(page * pageSize, page * pageSize + pageSize);
  const lines = visible.map((item) =>
    `• ${item.name} (${item.id})\n  Цена: ${item.price.toLocaleString("ru-RU")} | lvl ${item.level} | ${item.rarity ?? "common"}`
  );

  return ["🛒 Магазин", "", ...lines].join("\n");
};

export const formatFamily = (family: Family): string => [
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
