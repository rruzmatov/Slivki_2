function parseBet(value) {
  const amount = Number(String(value || "").trim());

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  return amount;
}

function playDice() {
  const roll = Math.floor(Math.random() * 6) + 1;
  const won = roll >= 4;

  return {
    roll,
    won,
    multiplier: won ? 2 : 0
  };
}

const CASINO_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "7️⃣"];

function playCasino() {
  const slots = Array.from({ length: 3 }, () => CASINO_SYMBOLS[Math.floor(Math.random() * CASINO_SYMBOLS.length)]);
  const counts = new Map();

  for (const slot of slots) {
    counts.set(slot, (counts.get(slot) || 0) + 1);
  }

  const maxMatches = Math.max(...counts.values());
  const multiplier = maxMatches === 3 ? 5 : maxMatches === 2 ? 1.5 : 0;

  return {
    slots,
    multiplier,
    won: multiplier > 0
  };
}

module.exports = {
  parseBet,
  playDice,
  playCasino
};
