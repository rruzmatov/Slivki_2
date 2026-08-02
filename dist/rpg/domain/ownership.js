"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyOwnershipState = void 0;
const createEmptyOwnershipState = () => ({
    version: "1.0.0",
    owners: {},
    records: {},
    entryIdsByOwner: {},
    permissions: {},
    ownerAccess: {},
    history: [],
    outbox: {}
});
exports.createEmptyOwnershipState = createEmptyOwnershipState;
