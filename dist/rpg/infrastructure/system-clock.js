"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemClock = void 0;
class SystemClock {
    now() { return new Date(); }
    nowIso() { return this.now().toISOString(); }
}
exports.SystemClock = SystemClock;
