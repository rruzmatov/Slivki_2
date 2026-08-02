"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateOwnershipRepository = void 0;
const assets_1 = require("../../domain/assets");
class GameStateOwnershipRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async findOwner(owner) {
        return clone(this.state.ownership.owners[(0, assets_1.ownerKey)(owner)]);
    }
    async saveOwner(owner) {
        this.state.ownership.owners[owner.key] = clone(owner);
        this.state.ownership.entryIdsByOwner[owner.key] ??= [];
    }
    async findByEntryId(entryId) {
        return clone(this.state.ownership.records[entryId]);
    }
    async saveRecord(record) {
        const previous = this.state.ownership.records[record.entryId];
        if (previous) {
            const previousKey = (0, assets_1.ownerKey)(previous.legalOwner);
            this.state.ownership.entryIdsByOwner[previousKey] = (this.state.ownership.entryIdsByOwner[previousKey] ?? [])
                .filter((id) => id !== record.entryId);
        }
        this.state.ownership.records[record.entryId] = clone(record);
        const nextKey = (0, assets_1.ownerKey)(record.legalOwner);
        const ids = this.state.ownership.entryIdsByOwner[nextKey] ?? [];
        if (!ids.includes(record.entryId))
            ids.push(record.entryId);
        this.state.ownership.entryIdsByOwner[nextKey] = ids;
    }
    async listEntryIds(owner) {
        return [...(this.state.ownership.entryIdsByOwner[(0, assets_1.ownerKey)(owner)] ?? [])];
    }
    async listPermissions(entryId) {
        return Object.values(this.state.ownership.permissions)
            .filter((permission) => permission.entryId === entryId)
            .map((permission) => clone(permission));
    }
    async findPermission(permissionId) {
        return clone(this.state.ownership.permissions[permissionId]);
    }
    async savePermission(permission) {
        this.state.ownership.permissions[permission.id] = clone(permission);
    }
    async listOwnerAccess(owner) {
        const key = (0, assets_1.ownerKey)(owner);
        return Object.values(this.state.ownership.ownerAccess)
            .filter((grant) => (0, assets_1.ownerKey)(grant.owner) === key)
            .map((grant) => clone(grant));
    }
    async findOwnerAccess(ownerAccessId) {
        return clone(this.state.ownership.ownerAccess[ownerAccessId]);
    }
    async saveOwnerAccess(grant) {
        this.state.ownership.ownerAccess[grant.id] = clone(grant);
    }
}
exports.GameStateOwnershipRepository = GameStateOwnershipRepository;
function clone(value) {
    return value === undefined ? value : structuredClone(value);
}
