class TagCallController {
  constructor(delayMs = 1200) {
    this.delayMs = delayMs;
    this.sessions = new Map();
  }

  has(chatId) {
    return this.sessions.has(Number(chatId));
  }

  get(chatId) {
    const session = this.sessions.get(Number(chatId));
    return session ? snapshot(session) : null;
  }

  async start(chatId, items, worker, onProgress = async () => {}) {
    const key = Number(chatId);
    if (this.sessions.has(key)) return { started: false, reason: "already_running", session: this.get(key) };
    const session = { chatId: key, state: "running", total: items.length, processed: 0, called: 0 };
    this.sessions.set(key, session);
    try {
      for (const item of items) {
        await this.waitUntilRunning(session);
        if (session.state === "stopped") break;
        const success = await worker(item, session.processed, snapshot(session));
        session.processed += 1;
        if (success) session.called += 1;
        await onProgress(snapshot(session));
        if (session.processed < session.total && session.state !== "stopped") await this.delay(session);
      }
      if (session.state !== "stopped") session.state = "completed";
      return { started: true, ...snapshot(session) };
    } finally {
      this.releaseWaiters(session);
      this.sessions.delete(key);
    }
  }

  pause(chatId) {
    const session = this.sessions.get(Number(chatId));
    if (!session || session.state !== "running") return false;
    session.state = "paused";
    if (session.timer) clearTimeout(session.timer);
    session.timer = undefined;
    session.delayResolve?.();
    session.delayResolve = undefined;
    return true;
  }

  resume(chatId) {
    const session = this.sessions.get(Number(chatId));
    if (!session || session.state !== "paused") return false;
    session.state = "running";
    session.resumeResolve?.();
    session.resumeResolve = undefined;
    return true;
  }

  stop(chatId) {
    const session = this.sessions.get(Number(chatId));
    if (!session) return false;
    session.state = "stopped";
    this.releaseWaiters(session);
    return true;
  }

  stopAll() {
    for (const chatId of [...this.sessions.keys()]) this.stop(chatId);
  }

  async waitUntilRunning(session) {
    while (session.state === "paused") {
      await new Promise((resolve) => { session.resumeResolve = resolve; });
    }
  }

  delay(session) {
    return new Promise((resolve) => {
      session.delayResolve = resolve;
      session.timer = setTimeout(() => {
        session.timer = undefined;
        session.delayResolve = undefined;
        resolve();
      }, this.delayMs);
    });
  }

  releaseWaiters(session) {
    if (session.timer) clearTimeout(session.timer);
    session.timer = undefined;
    session.delayResolve?.();
    session.resumeResolve?.();
    session.delayResolve = undefined;
    session.resumeResolve = undefined;
  }
}

function snapshot(session) {
  return {
    chatId: session.chatId,
    state: session.state,
    total: session.total,
    processed: session.processed,
    called: session.called
  };
}

module.exports = { TagCallController };
