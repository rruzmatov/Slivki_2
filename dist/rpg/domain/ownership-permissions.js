"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OwnershipPermissionRegistry = void 0;
const errors_1 = require("./errors");
class OwnershipPermissionRegistry {
    definitions;
    constructor(definitions) {
        const byCode = new Map();
        for (const definition of definitions) {
            assertPermissionCode(definition.code);
            if (byCode.has(definition.code)) {
                throw new errors_1.DomainError("Permission зарегистрирован повторно", "OWNERSHIP_PERMISSION_DUPLICATE");
            }
            byCode.set(definition.code, Object.freeze({ ...definition, implies: Object.freeze([...definition.implies]) }));
        }
        for (const definition of byCode.values()) {
            for (const implied of definition.implies) {
                if (!byCode.has(implied)) {
                    throw new errors_1.DomainError("Permission ссылается на неизвестное право", "OWNERSHIP_PERMISSION_UNKNOWN");
                }
            }
        }
        assertAcyclic(byCode);
        this.definitions = byCode;
    }
    list() {
        return [...this.definitions.values()];
    }
    has(permission) {
        return this.definitions.has(permission);
    }
    assertRegistered(permission) {
        if (!this.has(permission)) {
            throw new errors_1.DomainError("Permission не зарегистрирован", "OWNERSHIP_PERMISSION_UNKNOWN");
        }
    }
    isLegalOwnerDefault(permission) {
        this.assertRegistered(permission);
        return this.definitions.get(permission)?.legalOwnerDefault === true;
    }
    isCustodyDefault(permission) {
        this.assertRegistered(permission);
        return this.definitions.get(permission)?.custodyDefault === true;
    }
    allows(granted, requested) {
        this.assertRegistered(requested);
        return granted.some((permission) => this.implies(permission, requested));
    }
    implies(granted, requested) {
        this.assertRegistered(granted);
        this.assertRegistered(requested);
        if (granted === requested)
            return true;
        const visited = new Set();
        const visit = (permission) => {
            if (permission === requested)
                return true;
            if (visited.has(permission))
                return false;
            visited.add(permission);
            return (this.definitions.get(permission)?.implies ?? []).some(visit);
        };
        return visit(granted);
    }
}
exports.OwnershipPermissionRegistry = OwnershipPermissionRegistry;
function assertPermissionCode(code) {
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(code)) {
        throw new errors_1.DomainError("Некорректный permission code", "OWNERSHIP_PERMISSION_CODE_INVALID");
    }
}
function assertAcyclic(definitions) {
    const visited = new Set();
    const active = new Set();
    const visit = (code) => {
        if (active.has(code)) {
            throw new errors_1.DomainError("Permission graph содержит цикл", "OWNERSHIP_PERMISSION_CYCLE");
        }
        if (visited.has(code))
            return;
        active.add(code);
        for (const implied of definitions.get(code)?.implies ?? [])
            visit(implied);
        active.delete(code);
        visited.add(code);
    };
    for (const code of definitions.keys())
        visit(code);
}
