function addItem(profile, itemId, quantity = 1) {
  if (!profile.inventory || typeof profile.inventory !== "object") {
    profile.inventory = {};
  }

  profile.inventory[itemId] = Math.max(0, Math.floor(Number(profile.inventory[itemId]) || 0)) + quantity;
  return profile.inventory[itemId];
}

function getItemCount(profile, itemId) {
  return Math.max(0, Math.floor(Number(profile?.inventory?.[itemId]) || 0));
}

function consumeItem(profile, itemId, quantity = 1) {
  if (getItemCount(profile, itemId) < quantity) return false;

  profile.inventory[itemId] -= quantity;

  if (profile.inventory[itemId] <= 0) {
    delete profile.inventory[itemId];
  }

  return true;
}

function getInventoryLines(profile, shopItems) {
  const inventory = profile?.inventory || {};

  return shopItems
    .map((item) => ({ item, count: getItemCount({ inventory }, item.id) }))
    .filter(({ count }) => count > 0)
    .map(({ item, count }) => `${item.emoji} ${item.name}: ${count}`);
}

module.exports = {
  addItem,
  getItemCount,
  consumeItem,
  getInventoryLines
};
