const SHOP_ITEMS = [
  {
    id: "antimute",
    name: "Антимут",
    emoji: "🛡",
    price: 1500,
    description: "Один раз блокирует /mute и даёт 10 минут иммунитета.",
    type: "consumable"
  },
  {
    id: "mask",
    name: "Маска",
    emoji: "🎭",
    price: 500,
    description: "На 1 час скрывает от команды «Сливки кто».",
    type: "effect"
  },
  {
    id: "luck_charm",
    name: "Талисман удачи",
    emoji: "🍀",
    price: 800,
    description: "Одноразово повышает шанс выигрыша в /dice или /casino.",
    type: "consumable"
  },
  {
    id: "who_aim",
    name: "Прицел на «Сливки кто»",
    emoji: "🎯",
    price: 600,
    description: "Один раз позволяет выбрать цель через reply.",
    type: "consumable"
  },
  {
    id: "who_immunity",
    name: "Иммунитет от «Сливки кто»",
    emoji: "🔒",
    price: 700,
    description: "На 24 часа защищает от выбора в «Сливки кто».",
    type: "effect"
  },
  {
    id: "lottery_ticket",
    name: "Лотерейный билет",
    emoji: "🎟",
    price: 100,
    description: "Билет в ежедневный розыгрыш общего банка.",
    type: "lottery"
  },
  {
    id: "title",
    name: "Титул на 24 часа",
    emoji: "👑",
    price: 400,
    description: "Покупается командой /buy 7 твой титул.",
    type: "effect"
  }
];

function getShopItemByNumber(number) {
  const index = Number(number) - 1;
  return Number.isInteger(index) ? SHOP_ITEMS[index] : null;
}

module.exports = {
  SHOP_ITEMS,
  getShopItemByNumber
};
