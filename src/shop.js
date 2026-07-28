const { SHOP_ITEMS, getShopItemByNumber } = require("./shopConfig");
const { addItem, getInventoryLines } = require("./inventory");
const { applyMask, applyWhoImmunity, setTitle } = require("./effects");
const { LOTTERY_TICKET_PRICE } = require("./lottery");

const BAD_TITLE_PATTERNS = [
  /https?:\/\//i,
  /t\.me\//i,
  /@everyone/i,
  /(?:хуй|пизд|еба|ёба|сука|бля)/i
];

function getShopText() {
  const lines = SHOP_ITEMS.map((item, index) => {
    return `${index + 1}. ${item.emoji} ${item.name} — ${item.price} монет\n   ${item.description}`;
  });

  return ["🛒 Магазин Сливки:", "", ...lines, "", "Покупка: /buy номер"].join("\n");
}

function validateTitle(rawTitle) {
  const title = String(rawTitle || "").trim();

  if (!title) return { ok: false, error: "👑 Укажи текст титула.\n\nПример: /buy 7 Легенда" };
  if (title.length > 20) return { ok: false, error: "👑 Титул должен быть не длиннее 20 символов." };
  if (BAD_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return { ok: false, error: "👑 Такой титул нельзя использовать." };
  }

  return { ok: true, title };
}

function buyShopItem(store, lotteryManager, user, itemNumber, extraText = "") {
  const item = getShopItemByNumber(itemNumber);

  if (!item) {
    return { ok: false, error: "🛒 Товар не найден. Открой /shop и выбери номер из списка." };
  }

  if (item.id === "lottery_ticket" && item.price !== LOTTERY_TICKET_PRICE) {
    return { ok: false, error: "🎟 Цена билета настроена некорректно." };
  }

  const profile = store.ensureUser(user);

  if (!profile || profile.balance < item.price) {
    return {
      ok: false,
      error: `💰 Недостаточно монет.\n\nЦена: ${item.price}\nБаланс: ${profile?.balance || 0}`
    };
  }

  const titleValidation = item.id === "title" ? validateTitle(extraText) : null;

  if (titleValidation && !titleValidation.ok) {
    return { ok: false, error: titleValidation.error };
  }

  profile.balance -= item.price;

  if (item.id === "mask") {
    applyMask(profile);
  } else if (item.id === "who_immunity") {
    applyWhoImmunity(profile);
  } else if (item.id === "title") {
    setTitle(profile, titleValidation.title);
  } else if (item.id === "lottery_ticket") {
    lotteryManager.buyTicket(user, item.price);
  } else {
    addItem(profile, item.id, 1);
  }

  store.saveData();

  return {
    ok: true,
    item,
    balance: profile.balance
  };
}

function getInventoryText(profile) {
  const itemLines = getInventoryLines(profile, SHOP_ITEMS);
  const effectLines = [];
  const effects = profile.effects || {};

  if (effects.maskUntil) effectLines.push(`🎭 Маска активна до ${new Date(effects.maskUntil).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`);
  if (effects.whoImmunityUntil) effectLines.push(`🔒 Иммунитет активен до ${new Date(effects.whoImmunityUntil).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`);
  if (effects.immuneUntil) effectLines.push(`🛡 Антимут-иммунитет до ${new Date(effects.immuneUntil).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`);
  if (effects.title && effects.titleExpires) effectLines.push(`👑 Титул: ${effects.title} до ${new Date(effects.titleExpires).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`);

  if (itemLines.length === 0 && effectLines.length === 0) {
    return "🎒 Инвентарь пуст.\n\nОткрой /shop, чтобы купить предметы.";
  }

  return ["🎒 Инвентарь", "", ...itemLines, ...effectLines].join("\n");
}

module.exports = {
  getShopText,
  buyShopItem,
  getInventoryText
};
