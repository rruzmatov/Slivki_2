"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticCatalogRepository = void 0;
const asset_catalog_1 = require("../../data/asset-catalog");
const catalog_1 = require("../../data/catalog");
class StaticCatalogRepository {
    assetTypeById = uniqueMap(asset_catalog_1.assetTypes, "AssetType");
    categoryById = uniqueMap(asset_catalog_1.assetCategories, "Category");
    productById = uniqueMap(asset_catalog_1.assetProducts, "Product");
    listingById = uniqueMap(asset_catalog_1.shopListings, "ShopListing");
    legacyById = uniqueMap(catalog_1.catalogItems, "CatalogItem");
    listingByProduct = new Map(asset_catalog_1.shopListings.map((listing) => [listing.productId, listing]));
    constructor() {
        this.validateReferences();
    }
    async listAssetTypes() { return asset_catalog_1.assetTypes; }
    async findAssetType(id) { return this.assetTypeById.get(id); }
    async listCategories() { return asset_catalog_1.assetCategories; }
    async findCategory(id) { return this.categoryById.get(id); }
    async listProducts() { return asset_catalog_1.assetProducts; }
    async findProduct(id) { return this.productById.get(id); }
    async listListings() { return asset_catalog_1.shopListings; }
    async findListing(id) { return this.listingById.get(id); }
    async findActiveListingByProduct(productId) {
        const listing = this.listingByProduct.get(productId);
        return listing?.status === "active" ? listing : undefined;
    }
    async listLegacyItems() { return catalog_1.catalogItems; }
    async findLegacyItem(productId) { return this.legacyById.get(productId); }
    validateReferences() {
        for (const category of asset_catalog_1.assetCategories) {
            if (!this.assetTypeById.has(category.assetTypeId))
                throw new Error(`Unknown AssetType ${category.assetTypeId} for ${category.id}`);
            if (category.parentCategoryId && !this.categoryById.has(category.parentCategoryId))
                throw new Error(`Unknown parent Category ${category.parentCategoryId}`);
        }
        for (const product of asset_catalog_1.assetProducts) {
            if (!this.categoryById.has(product.categoryId))
                throw new Error(`Unknown Category ${product.categoryId} for ${product.id}`);
        }
        for (const listing of asset_catalog_1.shopListings) {
            if (!this.productById.has(listing.productId))
                throw new Error(`Unknown Product ${listing.productId} for ${listing.id}`);
            if (!Number.isSafeInteger(listing.price.amount) || listing.price.amount <= 0)
                throw new Error(`Invalid price for ${listing.id}`);
        }
    }
}
exports.StaticCatalogRepository = StaticCatalogRepository;
function uniqueMap(items, entityName) {
    const result = new Map();
    for (const item of items) {
        if (result.has(item.id))
            throw new Error(`Duplicate ${entityName} id: ${item.id}`);
        result.set(item.id, item);
    }
    return result;
}
