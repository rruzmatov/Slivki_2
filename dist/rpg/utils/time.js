"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.secondsSince = exports.sameTashkentDay = exports.nowIso = void 0;
const nowIso = () => new Date().toISOString();
exports.nowIso = nowIso;
const sameTashkentDay = (left, right = (0, exports.nowIso)()) => {
    if (!left) {
        return false;
    }
    const format = (value) => new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tashkent",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date(value));
    return format(left) === format(right);
};
exports.sameTashkentDay = sameTashkentDay;
const secondsSince = (iso) => {
    if (!iso) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
};
exports.secondsSince = secondsSince;
