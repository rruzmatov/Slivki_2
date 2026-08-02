const assert = require("node:assert/strict");
const test = require("node:test");
const { DeferredJsonWriter } = require("../deferred-json-writer");

test("deferred writer coalesces updates and flushes the latest snapshot", async () => {
  const writes = [];
  const writer = new DeferredJsonWriter((key, value) => {
    writes.push({ key, value });
    return true;
  }, { delayMs: 10 });
  let value = 1;
  writer.schedule("users", () => value, "users");
  value = 2;
  writer.schedule("users", () => value, "users");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(writes, [{ key: "users", value: 2 }]);
  assert.equal(writer.pendingCount, 0);
});

test("deferred writer retains failed work and retries", () => {
  let attempts = 0;
  const writer = new DeferredJsonWriter(() => {
    attempts += 1;
    return attempts > 1;
  }, { delayMs: 1000, retryMs: 1000 });
  writer.schedule("stats", () => ({ messages: 5 }), "stats");
  assert.equal(writer.flush("stats"), false);
  assert.equal(writer.pendingCount, 1);
  assert.equal(writer.flush("stats"), true);
  assert.equal(writer.pendingCount, 0);
});
