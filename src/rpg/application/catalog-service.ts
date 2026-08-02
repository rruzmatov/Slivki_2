import type { CatalogRepository } from "./ports/catalog-repository";
import type { AssetCategory, AssetType, Page, PageRequest, Product, ShopListing } from "../domain/assets";
import type { CatalogItem, ItemCategory, TransportKind, TransportSpec } from "../domain/types";
import { DomainError } from "../domain/errors";
import type { SchemaRegistry } from "./schema-registry";
import type { VehicleFoundationSpecification } from "../domain/transport";
import { validateVehicleFoundation, type VehicleCapabilityRegistry, type VehicleEnergyTypeRegistry } from "../domain/transport-registry";

export interface CategoryQuery extends PageRequest {
  assetTypeId?: string;
  parentCategoryId?: string;
}

export interface ProductQuery extends PageRequest {
  assetTypeId?: string;
  categoryId?: string;
  search?: string;
  availableOnly?: boolean;
}

export interface ListingQuery extends PageRequest {
  productId?: string;
  categoryId?: string;
  activeAt?: string;
}

export class CatalogService {
  private readonly assetTypeById: Map<string, AssetType>;
  private readonly categoryById: Map<string, AssetCategory>;
  private readonly productById: Map<string, Product>;
  private readonly listingById: Map<string, ShopListing>;
  private readonly listingByProduct: Map<string, ShopListing>;
  private readonly legacyById: Map<string, CatalogItem>;

  private constructor(
    private readonly assetTypes: readonly AssetType[],
    private readonly categories: readonly AssetCategory[],
    private readonly products: readonly Product[],
    private readonly listings: readonly ShopListing[],
    legacyItems: readonly CatalogItem[]
  ) {
    this.assetTypeById = new Map(assetTypes.map((item) => [item.id, item]));
    this.categoryById = new Map(categories.map((item) => [item.id, item]));
    this.productById = new Map(products.map((item) => [item.id, item]));
    this.listingById = new Map(listings.map((item) => [item.id, item]));
    this.listingByProduct = new Map(listings.map((item) => [item.productId, item]));
    this.legacyById = new Map(legacyItems.map((item) => [item.id, item]));
  }

  static async create(
    repository: CatalogRepository,
    schemas: SchemaRegistry,
    capabilityRegistry: VehicleCapabilityRegistry,
    energyTypeRegistry: VehicleEnergyTypeRegistry
  ): Promise<CatalogService> {
    const [assetTypes, categories, products, listings, legacyItems] = await Promise.all([
      repository.listAssetTypes(), repository.listCategories(), repository.listProducts(), repository.listListings(), repository.listLegacyItems()
    ]);
    for (const product of products) {
      const category = categories.find((candidate) => candidate.id === product.categoryId);
      if (!category) throw new DomainError(`Категория товара не найдена: ${product.id}`, "CATALOG_CATEGORY_NOT_FOUND");
      schemas.validate("attributes", category.attributeSchemaId, category.attributeSchemaVersion, product.attributes);
      const foundation = product.attributes.vehicle;
      if (isRecord(foundation)) {
        validateVehicleFoundation(
          foundation as unknown as VehicleFoundationSpecification,
          capabilityRegistry,
          energyTypeRegistry
        );
      }
    }
    for (const item of legacyItems) {
      if (item.metadata) schemas.validate("metadata", "catalog-item.metadata", 1, item.metadata);
    }
    return new CatalogService(assetTypes, categories, products, listings, legacyItems);
  }

  listAssetTypes(query: PageRequest): Page<AssetType> {
    return paginate(this.assetTypes.filter((item) => item.status !== "disabled"), query);
  }

  getAssetType(assetTypeId: string): AssetType {
    const item = this.assetTypeById.get(assetTypeId);
    if (!item || item.status === "disabled") throw new DomainError("Тип актива не найден", "CATALOG_ASSET_TYPE_NOT_FOUND");
    return item;
  }

  listCategories(query: CategoryQuery): Page<AssetCategory> {
    const categories = this.categories.filter((category) =>
      category.status !== "disabled" &&
      (!query.assetTypeId || category.assetTypeId === query.assetTypeId) &&
      (query.parentCategoryId === undefined || category.parentCategoryId === query.parentCategoryId)
    );
    return paginate(categories, query);
  }

  getCategory(categoryId: string): AssetCategory {
    const item = this.categoryById.get(categoryId);
    if (!item || item.status === "disabled") throw new DomainError("Категория не найдена", "CATALOG_CATEGORY_NOT_FOUND");
    return item;
  }

  listProducts(query: ProductQuery): Page<Product> {
    const normalizedSearch = query.search?.trim().toLocaleLowerCase("ru-RU");
    const products = this.products.filter((product) => {
      if (product.status === "disabled") return false;
      const category = this.categoryById.get(product.categoryId);
      if (!category) return false;
      if (query.assetTypeId && category.assetTypeId !== query.assetTypeId) return false;
      if (query.categoryId && product.categoryId !== query.categoryId) return false;
      if (normalizedSearch && !`${product.name} ${product.description}`.toLocaleLowerCase("ru-RU").includes(normalizedSearch)) return false;
      if (query.availableOnly && !this.findActiveListingByProduct(product.id)) return false;
      return true;
    });
    return paginate(products, query);
  }

  getProduct(productId: string): Product {
    const item = this.productById.get(productId);
    if (!item || item.status === "disabled") throw new DomainError("Товар не найден", "SHOP_PRODUCT_NOT_FOUND");
    return item;
  }

  listListings(query: ListingQuery): Page<ShopListing> {
    const at = query.activeAt ? Date.parse(query.activeAt) : Date.now();
    const listings = this.listings.filter((listing) => {
      if (query.productId && listing.productId !== query.productId) return false;
      const product = this.productById.get(listing.productId);
      if (!product) return false;
      if (query.categoryId && product.categoryId !== query.categoryId) return false;
      return isListingActive(listing, at);
    });
    return paginate(listings, query);
  }

  getListing(listingId: string): ShopListing {
    const listing = this.listingById.get(listingId);
    if (!listing) throw new DomainError("Предложение магазина не найдено", "SHOP_LISTING_NOT_FOUND");
    return listing;
  }

  resolveActiveListing(productId: string, now = new Date().toISOString()): ShopListing {
    const listing = this.findActiveListingByProduct(productId);
    if (!listing) throw new DomainError("Товар сейчас не продаётся", "SHOP_LISTING_NOT_FOUND");
    if (!isListingActive(listing, Date.parse(now))) throw new DomainError("Предложение магазина неактивно", "SHOP_LISTING_INACTIVE");
    return listing;
  }

  toLegacyCatalogItem(productId: string): CatalogItem {
    const item = this.legacyById.get(productId);
    if (item) return item;
    const product = this.getProduct(productId);
    const listing = this.findActiveListingByProduct(productId);
    const attributes = product.attributes;
    const transport = isRecord(attributes.transport) ? attributes.transport as unknown as TransportSpec : undefined;
    return {
      id: product.id,
      category: product.categoryId as ItemCategory,
      name: product.name,
      price: listing?.price.amount ?? 0,
      level: typeof attributes.minimumLevel === "number" ? attributes.minimumLevel : 1,
      rarity: product.rarity as CatalogItem["rarity"],
      transportKind: typeof attributes.legacyTransportKind === "string" && attributes.legacyTransportKind !== "none"
        ? attributes.legacyTransportKind as TransportKind
        : undefined,
      transport,
      assetValue: product.valuation.baseAssetValue.amount,
      metadata: primitiveMetadata(attributes)
    };
  }

  listLegacyCatalog(category?: string): CatalogItem[] {
    return this.products
      .filter((product) => this.findActiveListingByProduct(product.id))
      .map((product) => this.toLegacyCatalogItem(product.id))
      .filter((item) => !category || item.category === category)
      .map((item) => ({ ...item }));
  }

  getAssetTypeForProduct(productId: string): AssetType {
    const product = this.getProduct(productId);
    return this.getAssetType(this.getCategory(product.categoryId).assetTypeId);
  }

  getVehicleFoundation(productId: string): VehicleFoundationSpecification | undefined {
    const foundation = this.getProduct(productId).attributes.vehicle;
    return isRecord(foundation) ? foundation as unknown as VehicleFoundationSpecification : undefined;
  }

  hasUnlockDefinition(type: string, targetId: string): boolean {
    return this.products.some((product) => product.unlocks.some((unlock) => unlock.type === type && unlock.targetId === targetId));
  }

  private findActiveListingByProduct(productId: string): ShopListing | undefined {
    const listing = this.listingByProduct.get(productId);
    return listing?.status === "active" ? listing : undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function primitiveMetadata(attributes: Readonly<Record<string, unknown>>): Record<string, string | number | boolean> | undefined {
  const entries = Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const isListingActive = (listing: ShopListing, at: number): boolean =>
  listing.status === "active" &&
  (!listing.availableFrom || Date.parse(listing.availableFrom) <= at) &&
  (!listing.availableUntil || Date.parse(listing.availableUntil) >= at);

function paginate<T>(items: readonly T[], query: PageRequest): Page<T> {
  const limit = normalizeLimit(query.limit);
  const offset = decodeCursor(query.cursor);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
    hasMore: nextOffset < items.length
  };
}

function normalizeLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new DomainError("Размер страницы должен быть от 1 до 25", "CATALOG_PAGE_SIZE_INVALID");
  return limit;
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new DomainError("Некорректный курсор каталога", "CATALOG_CURSOR_INVALID");
  return offset;
}
