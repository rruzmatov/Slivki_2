import { DomainError } from "./errors";
import type { OwnershipPermission } from "./ownership";

export interface OwnershipPermissionDefinition {
  readonly code: OwnershipPermission;
  readonly localizationKey: string;
  readonly legalOwnerDefault: boolean;
  readonly custodyDefault: boolean;
  readonly implies: readonly OwnershipPermission[];
  readonly version: number;
}

export class OwnershipPermissionRegistry {
  private readonly definitions: ReadonlyMap<OwnershipPermission, OwnershipPermissionDefinition>;

  constructor(definitions: readonly OwnershipPermissionDefinition[]) {
    const byCode = new Map<OwnershipPermission, OwnershipPermissionDefinition>();
    for (const definition of definitions) {
      assertPermissionCode(definition.code);
      if (byCode.has(definition.code)) {
        throw new DomainError("Permission зарегистрирован повторно", "OWNERSHIP_PERMISSION_DUPLICATE");
      }
      byCode.set(definition.code, Object.freeze({ ...definition, implies: Object.freeze([...definition.implies]) }));
    }
    for (const definition of byCode.values()) {
      for (const implied of definition.implies) {
        if (!byCode.has(implied)) {
          throw new DomainError("Permission ссылается на неизвестное право", "OWNERSHIP_PERMISSION_UNKNOWN");
        }
      }
    }
    assertAcyclic(byCode);
    this.definitions = byCode;
  }

  list(): readonly OwnershipPermissionDefinition[] {
    return [...this.definitions.values()];
  }

  has(permission: OwnershipPermission): boolean {
    return this.definitions.has(permission);
  }

  assertRegistered(permission: OwnershipPermission): void {
    if (!this.has(permission)) {
      throw new DomainError("Permission не зарегистрирован", "OWNERSHIP_PERMISSION_UNKNOWN");
    }
  }

  isLegalOwnerDefault(permission: OwnershipPermission): boolean {
    this.assertRegistered(permission);
    return this.definitions.get(permission)?.legalOwnerDefault === true;
  }

  isCustodyDefault(permission: OwnershipPermission): boolean {
    this.assertRegistered(permission);
    return this.definitions.get(permission)?.custodyDefault === true;
  }

  allows(granted: readonly OwnershipPermission[], requested: OwnershipPermission): boolean {
    this.assertRegistered(requested);
    return granted.some((permission) => this.implies(permission, requested));
  }

  implies(granted: OwnershipPermission, requested: OwnershipPermission): boolean {
    this.assertRegistered(granted);
    this.assertRegistered(requested);
    if (granted === requested) return true;
    const visited = new Set<OwnershipPermission>();
    const visit = (permission: OwnershipPermission): boolean => {
      if (permission === requested) return true;
      if (visited.has(permission)) return false;
      visited.add(permission);
      return (this.definitions.get(permission)?.implies ?? []).some(visit);
    };
    return visit(granted);
  }
}

function assertPermissionCode(code: string): void {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(code)) {
    throw new DomainError("Некорректный permission code", "OWNERSHIP_PERMISSION_CODE_INVALID");
  }
}

function assertAcyclic(definitions: ReadonlyMap<OwnershipPermission, OwnershipPermissionDefinition>): void {
  const visited = new Set<OwnershipPermission>();
  const active = new Set<OwnershipPermission>();
  const visit = (code: OwnershipPermission): void => {
    if (active.has(code)) {
      throw new DomainError("Permission graph содержит цикл", "OWNERSHIP_PERMISSION_CYCLE");
    }
    if (visited.has(code)) return;
    active.add(code);
    for (const implied of definitions.get(code)?.implies ?? []) visit(implied);
    active.delete(code);
    visited.add(code);
  };
  for (const code of definitions.keys()) visit(code);
}
