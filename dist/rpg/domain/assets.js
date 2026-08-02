"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownerKey = void 0;
const ownerKey = (owner) => `${owner.kind}:${owner.id}`;
exports.ownerKey = ownerKey;
