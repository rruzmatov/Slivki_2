import type { AssetCategory, AssetType, Product, ShopListing } from "../../domain/assets";
import type { CatalogItem } from "../../domain/types";

export interface CatalogRepository {
  listAssetTypes(): Promise<readonly AssetType[]>;
  findAssetType(id: string): Promise<AssetType | undefined>;
  listCategories(): Promise<readonly AssetCategory[]>;
  findCategory(id: string): Promise<AssetCategory | undefined>;
  listProducts(): Promise<readonly Product[]>;
  findProduct(id: string): Promise<Product | undefined>;
  listListings(): Promise<readonly ShopListing[]>;
  findListing(id: string): Promise<ShopListing | undefined>;
  findActiveListingByProduct(productId: string): Promise<ShopListing | undefined>;
  listLegacyItems(): Promise<readonly CatalogItem[]>;
  findLegacyItem(productId: string): Promise<CatalogItem | undefined>;
}
