import type { OwnershipPermissionDefinition } from "../domain/ownership-permissions";

const permission = (
  code: string,
  legalOwnerDefault: boolean,
  custodyDefault: boolean,
  implies: readonly string[] = []
): OwnershipPermissionDefinition => ({
  code,
  localizationKey: `ownership.permission.${code}`,
  legalOwnerDefault,
  custodyDefault,
  implies,
  version: 1
});

export const ownershipPermissionDefinitions: readonly OwnershipPermissionDefinition[] = Object.freeze([
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
