"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogService = void 0;
const errors_1 = require("../domain/errors");
const transport_registry_1 = require("../domain/transport-registry");
class CatalogService {
    assetTypes;
    categories;
    products;
    listings;
    assetTypeById;
    categoryById;
    productById;
    listingById;
    listingByProduct;
    legacyById;
    constructor(assetTypes, categories, products, listings, legacyItems) {
        this.assetTypes = assetTypes;
        this.categories = categories;
        this.products = products;
        this.listings = listings;
        this.assetTypeById = new Map(assetTypes.map((item) => [item.id, item]));
        this.categoryById = new Map(categories.map((item) => [item.id, item]));
        this.productById = new Map(products.map((item) => [item.id, item]));
        this.listingById = new Map(listings.map((item) => [item.id, item]));
        this.listingByProduct = new Map(listings.map((item) => [item.productId, item]));
        this.legacyById = new Map(legacyItems.map((item) => [item.id, item]));
    }
    static async create(repository, schemas, capabilityRegistry, energyTypeRegistry) {
        const [assetTypes, categories, products, listings, legacyItems] = await Promise.all([
            repository.listAssetTypes(), repository.listCategories(), repository.listProducts(), repository.listListings(), repository.listLegacyItems()
        ]);
        for (const product of products) {
            const category = categories.find((candidate) => candidate.id === product.categoryId);
            if (!category)
                throw new errors_1.DomainError(`Категория товара не найдена: ${product.id}`, "CATALOG_CATEGORY_NOT_FOUND");
            schemas.validate("attributes", category.attributeSchemaId, category.attributeSchemaVersion, product.attributes);
            const foundation = product.attributes.vehicle;
            if (isRecord(foundation)) {
                (0, transport_registry_1.validateVehicleFoundation)(foundation, capabilityRegistry, energyTypeRegistry);
            }
        }
        for (const item of legacyItems) {
            if (item.metadata)
                schemas.validate("metadata", "catalog-item.metadata", 1, item.metadata);
        }
        return new CatalogService(assetTypes, categories, products, listings, legacyItems);
    }
    listAssetTypes(query) {
        return paginate(this.assetTypes.filter((item) => item.status !== "disabled"), query);
    }
    getAssetType(assetTypeId) {
        const item = this.assetTypeById.get(assetTypeId);
        if (!item || item.status === "disabled")
            throw new errors_1.DomainError("Тип актива не найден", "CATALOG_ASSET_TYPE_NOT_FOUND");
        return item;
    }
    listCategories(query) {
        const categories = this.categories.filter((category) => category.status !== "disabled" &&
            (!query.assetTypeId || category.assetTypeId === query.assetTypeId) &&
            (query.parentCategoryId === undefined || category.parentCategoryId === query.parentCategoryId));
        return paginate(categories, query);
    }
    getCategory(categoryId) {
        const item = this.categoryById.get(categoryId);
        if (!item || item.status === "disabled")
            throw new errors_1.DomainError("Категория не найдена", "CATALOG_CATEGORY_NOT_FOUND");
        return item;
    }
    listProducts(query) {
        const normalizedSearch = query.search?.trim().toLocaleLowerCase("ru-RU");
        const products = this.products.filter((product) => {
            if (product.status === "disabled")
                return false;
            const category = this.categoryById.get(product.categoryId);
            if (!category)
                return false;
            if (query.assetTypeId && category.assetTypeId !== query.assetTypeId)
                return false;
            if (query.categoryId && product.categoryId !== query.categoryId)
                return false;
            if (normalizedSearch && !`${product.name} ${product.description}`.toLocaleLowerCase("ru-RU").includes(normalizedSearch))
                return false;
            if (query.availableOnly && !this.findActiveListingByProduct(product.id))
                return false;
            return true;
        });
        return paginate(products, query);
    }
    getProduct(productId) {
        const item = this.productById.get(productId);
        if (!item || item.status === "disabled")
            throw new errors_1.DomainError("Товар не найден", "SHOP_PRODUCT_NOT_FOUND");
        return item;
    }
    listListings(query) {
        const at = query.activeAt ? Date.parse(query.activeAt) : Date.now();
        const listings = this.listings.filter((listing) => {
            if (query.productId && listing.productId !== query.productId)
                return false;
            const product = this.productById.get(listing.productId);
            if (!product)
                return false;
            if (query.categoryId && product.categoryId !== query.categoryId)
                return false;
            return isListingActive(listing, at);
        });
        return paginate(listings, query);
    }
    getListing(listingId) {
        const listing = this.listingById.get(listingId);
        if (!listing)
            throw new errors_1.DomainError("Предложение магазина не найдено", "SHOP_LISTING_NOT_FOUND");
        return listing;
    }
    resolveActiveListing(productId, now = new Date().toISOString()) {
        const listing = this.findActiveListingByProduct(productId);
        if (!listing)
            throw new errors_1.DomainError("Товар сейчас не продаётся", "SHOP_LISTING_NOT_FOUND");
        if (!isListingActive(listing, Date.parse(now)))
            throw new errors_1.DomainError("Предложение магазина неактивно", "SHOP_LISTING_INACTIVE");
        return listing;
    }
    toLegacyCatalogItem(productId) {
        const item = this.legacyById.get(productId);
        if (item)
            return item;
        const product = this.getProduct(productId);
        const listing = this.findActiveListingByProduct(productId);
        const attributes = product.attributes;
        const transport = isRecord(attributes.transport) ? attributes.transport : undefined;
        return {
            id: product.id,
            category: product.categoryId,
            name: product.name,
            price: listing?.price.amount ?? 0,
            level: typeof attributes.minimumLevel === "number" ? attributes.minimumLevel : 1,
            rarity: product.rarity,
            transportKind: typeof attributes.legacyTransportKind === "string" && attributes.legacyTransportKind !== "none"
                ? attributes.legacyTransportKind
                : undefined,
            transport,
            assetValue: product.valuation.baseAssetValue.amount,
            metadata: primitiveMetadata(attributes)
        };
    }
    listLegacyCatalog(category) {
        return this.products
            .filter((product) => this.findActiveListingByProduct(product.id))
            .map((product) => this.toLegacyCatalogItem(product.id))
            .filter((item) => !category || item.category === category)
            .map((item) => ({ ...item }));
    }
    getAssetTypeForProduct(productId) {
        const product = this.getProduct(productId);
        return this.getAssetType(this.getCategory(product.categoryId).assetTypeId);
    }
    getVehicleFoundation(productId) {
        const foundation = this.getProduct(productId).attributes.vehicle;
        return isRecord(foundation) ? foundation : undefined;
    }
    hasUnlockDefinition(type, targetId) {
        return this.products.some((product) => product.unlocks.some((unlock) => unlock.type === type && unlock.targetId === targetId));
    }
    findActiveListingByProduct(productId) {
        const listing = this.listingByProduct.get(productId);
        return listing?.status === "active" ? listing : undefined;
    }
}
exports.CatalogService = CatalogService;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function primitiveMetadata(attributes) {
    const entries = Object.entries(attributes).filter((entry) => typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean");
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
const isListingActive = (listing, at) => listing.status === "active" &&
    (!listing.availableFrom || Date.parse(listing.availableFrom) <= at) &&
    (!listing.availableUntil || Date.parse(listing.availableUntil) >= at);
function paginate(items, query) {
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
function normalizeLimit(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25)
        throw new errors_1.DomainError("Размер страницы должен быть от 1 до 25", "CATALOG_PAGE_SIZE_INVALID");
    return limit;
}
function decodeCursor(cursor) {
    if (!cursor)
        return 0;
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0)
        throw new errors_1.DomainError("Некорректный курсор каталога", "CATALOG_CURSOR_INVALID");
    return offset;
}
