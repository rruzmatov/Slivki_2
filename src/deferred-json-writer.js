class DeferredJsonWriter {
  constructor(writer, options = {}) {
    this.writer = writer;
    this.delayMs = Math.max(1, Number(options.delayMs) || 750);
    this.retryMs = Math.max(this.delayMs, Number(options.retryMs) || 5000);
    this.pending = new Map();
  }

  schedule(key, producer, label) {
    const existing = this.pending.get(key);
    const entry = existing || { key, timer: null, producer, label };
    entry.producer = producer;
    entry.label = label;
    this.pending.set(key, entry);
    if (!entry.timer) this.arm(entry, this.delayMs);
  }

  flush(key) {
    const entry = this.pending.get(key);
    if (!entry) return true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    let succeeded = false;
    try {
      succeeded = this.writer(entry.key, entry.producer(), entry.label) === true;
    } catch {
      succeeded = false;
    }
    if (succeeded) {
      this.pending.delete(key);
      return true;
    }
    this.arm(entry, this.retryMs);
    return false;
  }

  flushAll() {
    let succeeded = true;
    for (const key of [...this.pending.keys()]) {
      if (!this.flush(key)) succeeded = false;
    }
    return succeeded;
  }

  get pendingCount() {
    return this.pending.size;
  }

  arm(entry, delayMs) {
    entry.timer = setTimeout(() => this.flush(entry.key), delayMs);
    entry.timer.unref?.();
  }
}

module.exports = { DeferredJsonWriter };
