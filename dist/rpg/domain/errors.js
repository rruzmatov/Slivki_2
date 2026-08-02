"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invariant = exports.DomainError = void 0;
class DomainError extends Error {
    code;
    options;
    constructor(message, code, options = {}) {
        super(message);
        this.code = code;
        this.options = options;
    }
}
exports.DomainError = DomainError;
const invariant = (condition, message, code = "DOMAIN_INVARIANT") => {
    if (!condition) {
        throw new DomainError(message, code);
    }
};
exports.invariant = invariant;
