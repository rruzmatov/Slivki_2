// transportCatalog.js — каталог транспорта
//
// Каждый предмет:
//   id           — уникальный ключ
//   name         — отображаемое название
//   price        — цена (правило 8: чем выше тир, тем дороже — примерно x15-20 за шаг)
//   requiredLevel— минимальный уровень игрока для покупки (правило 10)
//   unlocks      — что открывает покупка (правило 5 — "каждая покупка должна что-то открывать")
//   maintenance  — периодические расходы на содержание (правило 9)

const TRANSPORT = [
  {
    id: 'bicycle',
    name: '🚲 Велосипед',
    price: 50_000,
    requiredLevel: 1,
    unlocks: 'Курьерская подработка',
    maintenance: 0,
  },
  {
    id: 'cobalt',
    name: '🚗 Chevrolet Cobalt',
    price: 3_000_000,
    requiredLevel: 3,
    unlocks: 'Работа в такси',
    maintenance: 15_000, // в неделю
  },
  {
    id: 'bmw_m5',
    name: '🚘 BMW M5',
    price: 45_000_000,
    requiredLevel: 6,
    unlocks: 'Статус, доступ к элитным гонкам',
    maintenance: 120_000,
  },
  {
    id: 'bmw_m8',
    name: '🏎️ BMW M8',
    price: 90_000_000,
    requiredLevel: 8,
    unlocks: 'Только личное использование — нельзя работать в такси',
    maintenance: 200_000,
  },
  {
    id: 'truck',
    name: '🚚 Грузовик',
    price: 60_000_000,
    requiredLevel: 7,
    unlocks: 'Профессия дальнобойщика',
    maintenance: 180_000,
  },
  {
    id: 'boeing_737',
    name: '✈️ Boeing 737',
    price: 800_000_000,
    requiredLevel: 15,
    unlocks: 'Работа пилотом, старт авиакомпании',
    maintenance: 5_000_000,
  },
];

function getCatalog() {
  return TRANSPORT;
}

function getItemById(itemId) {
  return TRANSPORT.find(i => i.id === itemId) || null;
}

// Разбивает каталог на доступные и заблокированные для конкретного уровня игрока (правило 15)
function splitByLevel(level) {
  const available = TRANSPORT.filter(i => i.requiredLevel <= level);
  const locked = TRANSPORT.filter(i => i.requiredLevel > level);
  return { available, locked };
}

module.exports = { getCatalog, getItemById, splitByLevel };