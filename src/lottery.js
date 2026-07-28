const LOTTERY_TICKET_PRICE = 100;

function getCurrentRound(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(now);
}

function getNextRoundDelayMs() {
  if (process.env.SHOP_DEBUG_TIMERS === "1") {
    return 2 * 60 * 1000;
  }

  return 24 * 60 * 60 * 1000;
}

function ensureLotteryState(state = {}) {
  return {
    round: state.round || getCurrentRound(),
    tickets: state.tickets && typeof state.tickets === "object" ? state.tickets : {},
    pot: Math.max(0, Math.floor(Number(state.pot) || 0)),
    lastDrawAt: Number(state.lastDrawAt) || 0
  };
}

class LotteryManager {
  constructor(store) {
    this.store = store;
  }

  buyTicket(user, price = LOTTERY_TICKET_PRICE) {
    const state = ensureLotteryState(this.store.getLotteryState());
    const userId = String(user.id);

    state.tickets[userId] = (Number(state.tickets[userId]) || 0) + 1;
    state.pot += price;
    this.store.setLotteryState(state);

    return state;
  }

  drawIfNeeded(now = Date.now()) {
    const state = ensureLotteryState(this.store.getLotteryState());
    const currentRound = getCurrentRound(new Date(now));

    if (process.env.SHOP_DEBUG_TIMERS === "1") {
      if (now - state.lastDrawAt < getNextRoundDelayMs()) return null;
    } else if (state.round === currentRound) {
      return null;
    }

    const entries = Object.entries(state.tickets);

    if (entries.length === 0 || state.pot <= 0) {
      this.store.setLotteryState({
        round: currentRound,
        tickets: {},
        pot: 0,
        lastDrawAt: now
      });
      return null;
    }

    const pool = entries.flatMap(([userId, count]) => Array.from({ length: Number(count) || 0 }, () => userId));
    const winnerId = pool[Math.floor(Math.random() * pool.length)];
    const pot = state.pot;

    this.store.addBalanceById(winnerId, pot);
    this.store.setLotteryState({
      round: currentRound,
      tickets: {},
      pot: 0,
      lastDrawAt: now
    });

    return {
      winnerId: Number(winnerId),
      pot,
      ticketsCount: pool.length
    };
  }
}

module.exports = {
  LotteryManager,
  LOTTERY_TICKET_PRICE,
  getCurrentRound,
  getNextRoundDelayMs
};
