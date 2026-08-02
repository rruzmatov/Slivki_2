import type { InventoryEntryId, OwnerRef, ProductId, UnlockType } from "./assets";

export interface UnlockRecord {
  id: string;
  owner: OwnerRef;
  type: UnlockType;
  targetId: string;
  sourceProductId: ProductId;
  sourceInventoryEntryId: InventoryEntryId;
  mode: "permanent" | "while_owned";
  grantedAt: string;
  revokedAt?: string;
}

export interface UnlockPersistentState {
  records: Record<string, UnlockRecord>;
  reconciledOwners: Record<string, number>;
}

export const createEmptyUnlockState = (): UnlockPersistentState => ({ records: {}, reconciledOwners: {} });
