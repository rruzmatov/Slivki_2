function parseBet(value) {
  const amount = Number(String(value || "").trim());

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  return amount;
}

function playDice(random = secureRandomInt) {
  const won = random(2) === 1;
  const roll = (won ? 4 : 1) + random(3);

  return {
    roll,
    won,
    multiplier: won ? 2 : 0
  };
}

const CASINO_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "7️⃣"];

function playCasino(random = secureRandomInt) {
  const won = random(2) === 1;
  const slots = won ? createWinningSlots(random) : createLosingSlots(random);
  const multiplier = won ? 2 : 0;

  return {
    slots,
    multiplier,
    won
  };
}

function createWinningSlots(random) {
  const symbol = CASINO_SYMBOLS[random(CASINO_SYMBOLS.length)];
  return [symbol, symbol, symbol];
}

function createLosingSlots(random) {
  const pool = [...CASINO_SYMBOLS];
  const result = [];
  while (result.length < 3) result.push(pool.splice(random(pool.length), 1)[0]);
  return result;
}

function secureRandomInt(maxExclusive) {
  return randomInt(0, maxExclusive);
}

module.exports = {
  parseBet,
  playDice,
  playCasino
};
const { randomInt } = require("node:crypto");
