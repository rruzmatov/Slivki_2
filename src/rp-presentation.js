const { randomInt } = require("node:crypto");

class RpPresentationSelector {
  constructor(random = (length) => randomInt(0, length), maxTrackedKeys = 2000) {
    this.random = random;
    this.maxTrackedKeys = maxTrackedKeys;
    this.lastSelections = new Map();
  }

  choose(items, key) {
    const unique = [...new Set(items.filter(Boolean))];
    if (unique.length === 0) return "";
    const previous = this.lastSelections.get(key);
    const candidates = unique.length > 1 ? unique.filter((item) => item !== previous) : unique;
    const selected = candidates[this.random(candidates.length)];
    this.lastSelections.set(key, selected);
    if (this.lastSelections.size > this.maxTrackedKeys) this.lastSelections.delete(this.lastSelections.keys().next().value);
    return selected;
  }
}

const RP_TEXT_TEMPLATES = [
  ({ actor, action, target }) => `${actor} ${action} ${target}`,
  ({ actor, action, target }) => `Сцена дня: ${actor} ${action} ${target}`,
  ({ actor, action, target }) => `В центре внимания: ${actor} ${action} ${target}`,
  ({ actor, action, target }) => `Неожиданный поворот: ${actor} ${action} ${target}`,
  ({ actor, action, target }) => `Момент между ${actor} и ${target}: ${actor} ${action} ${target}`
];

function buildRpText(selector, key, actor, action, target) {
  const template = selector.choose(RP_TEXT_TEMPLATES, `${key}:text`);
  return template({ actor, action, target });
}

module.exports = { RpPresentationSelector, buildRpText };
