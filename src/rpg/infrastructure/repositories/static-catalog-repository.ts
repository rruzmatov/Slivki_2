import type { CatalogRepository } from "../../application/ports/catalog-repository";
import { assetCategories, assetProducts, assetTypes, shopListings } from "../../data/asset-catalog";
import { catalogItems } from "../../data/catalog";
import type { AssetCategory, AssetType, Product, ShopListing } from "../../domain/assets";
import type { CatalogItem } from "../../domain/types";

export class StaticCatalogRepository implements CatalogRepository {
  private readonly assetTypeById = uniqueMap(assetTypes, "AssetType");
  private readonly categoryById = uniqueMap(assetCategories, "Category");
  private readonly productById = uniqueMap(assetProducts, "Product");
  private readonly listingById = uniqueMap(shopListings, "ShopListing");
  private readonly legacyById = uniqueMap(catalogItems, "CatalogItem");
  private readonly listingByProduct = new Map(shopListings.map((listing) => [listing.productId, listing]));

  constructor() {
    this.validateReferences();
  }

  async listAssetTypes(): Promise<readonly AssetType[]> { return assetTypes; }
  async findAssetType(id: string): Promise<AssetType | undefined> { return this.assetTypeById.get(id); }
  async listCategories(): Promise<readonly AssetCategory[]> { return assetCategories; }
  async findCategory(id: string): Promise<AssetCategory | undefined> { return this.categoryById.get(id); }
  async listProducts(): Promise<readonly Product[]> { return assetProducts; }
  async findProduct(id: string): Promise<Product | undefined> { return this.productById.get(id); }
  async listListings(): Promise<readonly ShopListing[]> { return shopListings; }
  async findListing(id: string): Promise<ShopListing | undefined> { return this.listingById.get(id); }
  async findActiveListingByProduct(productId: string): Promise<ShopListing | undefined> {
    const listing = this.listingByProduct.get(productId);
    return listing?.status === "active" ? listing : undefined;
  }
  async listLegacyItems(): Promise<readonly CatalogItem[]> { return catalogItems; }
  async findLegacyItem(productId: string): Promise<CatalogItem | undefined> { return this.legacyById.get(productId); }

  private validateReferences(): void {
    for (const category of assetCategories) {
      if (!this.assetTypeById.has(category.assetTypeId)) throw new Error(`Unknown AssetType ${category.assetTypeId} for ${category.id}`);
      if (category.parentCategoryId && !this.categoryById.has(category.parentCategoryId)) throw new Error(`Unknown parent Category ${category.parentCategoryId}`);
    }
    for (const product of assetProducts) {
      if (!this.categoryById.has(product.categoryId)) throw new Error(`Unknown Category ${product.categoryId} for ${product.id}`);
    }
    for (const listing of shopListings) {
      if (!this.productById.has(listing.productId)) throw new Error(`Unknown Product ${listing.productId} for ${listing.id}`);
      if (!Number.isSafeInteger(listing.price.amount) || listing.price.amount <= 0) throw new Error(`Invalid price for ${listing.id}`);
    }
  }
}

function uniqueMap<T extends { id: string }>(items: readonly T[], entityName: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`Duplicate ${entityName} id: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}
