const assert = require("node:assert/strict");
const test = require("node:test");
const { TagCallController } = require("../tag-call-controller");

test("tag call can pause and resume without losing progress", async () => {
  const controller = new TagCallController(5);
  let paused = false;
  const result = await controller.start(
    10,
    [1, 2, 3],
    async () => true,
    async (progress) => {
      if (progress.processed === 1 && !paused) {
        paused = true;
        assert.equal(controller.pause(10), true);
        setTimeout(() => controller.resume(10), 10);
      }
    }
  );
  assert.equal(result.state, "completed");
  assert.equal(result.called, 3);
  assert.equal(controller.get(10), null);
});

test("tag call stop interrupts its delay and clears the session", async () => {
  const controller = new TagCallController(1000);
  const result = await controller.start(
    20,
    [1, 2, 3],
    async () => true,
    async (progress) => {
      if (progress.processed === 1) assert.equal(controller.stop(20), true);
    }
  );
  assert.equal(result.state, "stopped");
  assert.equal(result.processed, 1);
  assert.equal(controller.get(20), null);
});
