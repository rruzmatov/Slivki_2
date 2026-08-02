const assert = require("node:assert/strict");
const test = require("node:test");
const { hasRequiredItem } = require("../family-system");

test("family career item requirements deny by default and accept explicit ownership", () => {
  assert.equal(hasRequiredItem({}, null), true);
  assert.equal(hasRequiredItem({}, "car"), false);
  assert.equal(hasRequiredItem({ ownedItems: ["car"] }, "car"), true);
  assert.equal(hasRequiredItem({ hasItem: (item) => item === "plane" }, "plane"), true);
  assert.equal(hasRequiredItem({ hasItem: () => false, ownedItems: ["car"] }, "car"), false);
});
