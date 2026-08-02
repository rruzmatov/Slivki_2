export type AssetTypeId = string;
export type CategoryId = string;
export type ProductId = string;
export type ListingId = string;
export type InventoryEntryId = string;
export type UnlockType = string;

export type InventoryMode = "stack" | "instance" | "entitlement" | "immediate";
export type AssetStatus = "active" | "hidden" | "disabled";
export type OwnerKind = "player" | "family" | "business" | "group" | "clan" | "system" | (string & {});
export type AssetCapability =
  | "tradable"
  | "repairable"
  | "maintainable"
  | "upgradeable"
  | "consumable"
  | "equippable"
  | "work_eligible"
  | "travel_eligible"
  | "income_generating"
  | "leaseable"
  | "expirable";

export interface OwnerRef {
  kind: OwnerKind;
  id: string | number;
}

export interface ActorRef {
  kind: "player" | "admin" | "service" | "scheduler";
  id: string | number;
}

export interface LocationRef {
  kind: string;
  id?: string;
}

export type AccountRef =
  | { kind: "player_cash"; playerId: number }
  | { kind: "player_bank"; playerId: number }
  | { kind: "family_capital"; familyId: string };

export interface Money {
  amount: number;
  currency: string;
}

export interface RequirementPredicate {
  kind: string;
  params: Readonly<Record<string, string | number | boolean>>;
  message: string;
}

export type RequirementExpression =
  | { operator: "predicate"; predicate: RequirementPredicate }
  | { operator: "and"; rules: readonly RequirementExpression[] }
  | { operator: "or"; rules: readonly RequirementExpression[] }
  | { operator: "not"; rule: RequirementExpression };

export interface UnlockDefinition {
  type: UnlockType;
  targetId: string;
  mode: "permanent" | "while_owned";
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AssetType {
  id: AssetTypeId;
  name: string;
  description: string;
  defaultInventoryMode: InventoryMode;
  allowedOwnerKinds: readonly OwnerKind[];
  defaultCapabilities: readonly AssetCapability[];
  attributeSchemaId: string;
  attributeSchemaVersion: number;
  status: AssetStatus;
  version: number;
}

export interface AssetCategory {
  id: CategoryId;
  assetTypeId: AssetTypeId;
  parentCategoryId?: CategoryId;
  name: string;
  description: string;
  sortOrder: number;
  attributeSchemaId: string;
  attributeSchemaVersion: number;
  allowedCapabilities: readonly AssetCapability[];
  status: AssetStatus;
  version: number;
}

export interface Product {
  id: ProductId;
  categoryId: CategoryId;
  name: string;
  description: string;
  rarity?: string;
  inventoryMode?: InventoryMode;
  allowedOwnerKinds?: readonly OwnerKind[];
  capabilities: readonly AssetCapability[];
  attributes: Readonly<Record<string, unknown>>;
  requirements?: RequirementExpression;
  unlocks: readonly UnlockDefinition[];
  valuation: {
    baseAssetValue: Money;
    defaultResaleValue?: Money;
  };
  status: AssetStatus;
  schemaVersion: number;
  revision: number;
}

export interface SalePolicy {
  enabled: boolean;
  fixedUnitPrice?: Money;
}

export interface ShopListing {
  id: ListingId;
  productId: ProductId;
  price: Money;
  stockMode: "unlimited" | "finite" | "unique";
  stockRemaining?: number;
  minQuantity: number;
  maxQuantity: number;
  perPlayerLimit?: number;
  availableFrom?: string;
  availableUntil?: string;
  purchaseRequirements?: RequirementExpression;
  salePolicy?: SalePolicy;
  status: "active" | "paused" | "closed";
  version: number;
}

export interface OperationContext {
  requestId: string;
  correlationId: string;
  now: string;
  idempotencyKey?: string;
  causationId?: string;
  actor?: ActorRef;
}

export interface PageRequest {
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: readonly T[];
  nextCursor?: string;
  hasMore: boolean;
}

export const ownerKey = (owner: OwnerRef): string => `${owner.kind}:${owner.id}`;
