"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detached = detached;
exports.detachedValues = detachedValues;
function detached(value) {
    return value === undefined ? value : structuredClone(value);
}
function detachedValues(values) {
    return Array.from(values, (value) => detached(value));
}
