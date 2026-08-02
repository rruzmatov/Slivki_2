"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createId = void 0;
const node_crypto_1 = require("node:crypto");
const createId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)()}`;
exports.createId = createId;
