"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownershipPermissionDefinitions = void 0;
const permission = (code, legalOwnerDefault, custodyDefault, implies = []) => ({
    code,
    localizationKey: `ownership.permission.${code}`,
    legalOwnerDefault,
    custodyDefault,
    implies,
    version: 1
});
exports.ownershipPermissionDefinitions = Object.freeze([
    permission("view", true, true, ["inspect"]),
    permission("inspect", true, true),
    permission("use", true, true),
    permission("move", true, true),
    permission("equip", true, true),
    permission("repair", true, true, ["maintain"]),
    permission("maintain", true, true),
    permission("transfer", true, false),
    permission("sell", true, false),
    permission("lease", true, false),
    permission("manage", true, false, ["inspect", "maintain", "upgrade"]),
    permission("upgrade", true, false),
    permission("confiscate", false, false)
]);
