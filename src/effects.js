const DEFAULT_EFFECT_DURATIONS = {
  antimuteImmuneMs: 10 * 60 * 1000,
  maskMs: 60 * 60 * 1000,
  whoImmunityMs: 24 * 60 * 60 * 1000,
  titleMs: 24 * 60 * 60 * 1000
};

function getEffectDurations() {
  if (process.env.SHOP_DEBUG_TIMERS === "1") {
    return {
      antimuteImmuneMs: 30 * 1000,
      maskMs: 60 * 1000,
      whoImmunityMs: 60 * 1000,
      titleMs: 60 * 1000
    };
  }

  return DEFAULT_EFFECT_DURATIONS;
}

function ensureEffects(profile) {
  if (!profile.effects || typeof profile.effects !== "object") {
    profile.effects = {};
  }

  return profile.effects;
}

function isActiveUntil(value, now = Date.now()) {
  return Number(value) > now;
}

function cleanupExpiredEffects(profile, now = Date.now()) {
  const effects = ensureEffects(profile);
  let changed = false;

  for (const key of ["immuneUntil", "maskUntil", "whoImmunityUntil", "titleExpires"]) {
    if (effects[key] && !isActiveUntil(effects[key], now)) {
      delete effects[key];
      changed = true;
    }
  }

  if (!effects.titleExpires && effects.title) {
    delete effects.title;
    changed = true;
  }

  return changed;
}

function hasMuteImmunity(profile, now = Date.now()) {
  cleanupExpiredEffects(profile, now);
  return isActiveUntil(profile.effects?.immuneUntil, now);
}

function setMuteImmunity(profile, now = Date.now()) {
  const effects = ensureEffects(profile);
  effects.immuneUntil = now + getEffectDurations().antimuteImmuneMs;
}

function applyMask(profile, now = Date.now()) {
  const effects = ensureEffects(profile);
  effects.maskUntil = now + getEffectDurations().maskMs;
}

function applyWhoImmunity(profile, now = Date.now()) {
  const effects = ensureEffects(profile);
  effects.whoImmunityUntil = now + getEffectDurations().whoImmunityMs;
}

function setTitle(profile, title, now = Date.now()) {
  const effects = ensureEffects(profile);
  effects.title = title;
  effects.titleExpires = now + getEffectDurations().titleMs;
}

function isHiddenFromWho(profile, now = Date.now()) {
  cleanupExpiredEffects(profile, now);

  return (
    isActiveUntil(profile.effects?.maskUntil, now) ||
    isActiveUntil(profile.effects?.whoImmunityUntil, now)
  );
}

function getActiveTitle(profile, now = Date.now()) {
  cleanupExpiredEffects(profile, now);

  if (!isActiveUntil(profile.effects?.titleExpires, now)) return "";
  return profile.effects?.title || "";
}

function formatUntil(timestamp) {
  if (!timestamp) return "";

  return new Date(timestamp).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    dateStyle: "short",
    timeStyle: "short"
  });
}

module.exports = {
  cleanupExpiredEffects,
  getActiveTitle,
  getEffectDurations,
  hasMuteImmunity,
  isHiddenFromWho,
  setMuteImmunity,
  applyMask,
  applyWhoImmunity,
  setTitle,
  formatUntil
};
