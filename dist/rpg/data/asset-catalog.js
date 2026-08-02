"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shopListings = exports.assetProducts = exports.assetCategories = exports.assetTypes = void 0;
exports.legacyRequirementsToExpression = legacyRequirementsToExpression;
const catalog_1 = require("./catalog");
const transport_foundation_1 = require("./transport-foundation");
const SUM = "SUM";
exports.assetTypes = [
    assetType("transport", "Транспорт", "Транспортные средства", "instance", ["player", "family", "business"], ["tradable", "repairable", "maintainable"]),
    assetType("real_estate", "Недвижимость", "Жилая и коммерческая недвижимость", "instance", ["player", "family"], ["tradable"]),
    assetType("business", "Бизнес", "Доходные игровые предприятия", "instance", ["player", "family"], ["tradable", "income_generating"]),
    assetType("license", "Лицензии", "Постоянные и временные игровые разрешения", "entitlement", ["player", "family"], ["expirable"]),
    assetType("item", "Предметы", "Расходуемые и коллекционные игровые предметы", "stack", ["player", "family"], ["tradable"]),
    assetType("pet", "Питомцы", "Питомцы и спутники игрока", "instance", ["player", "family"], ["tradable"]),
    assetType("collectible", "Коллекционные объекты", "Редкие коллекционные активы", "instance", ["player", "family"], ["tradable"]),
    assetType("service", "Сервисы", "Мгновенные эффекты и игровые услуги", "immediate", ["player", "family"], ["expirable"]),
    assetType("currency", "Валюты", "Определения валют EconomyService", "immediate", ["player", "family", "business"], []),
    assetType("quest", "Квесты", "Квестовые права и объекты", "entitlement", ["player", "family", "group", "clan"], ["expirable"]),
    assetType("ticket", "Билеты", "Расходуемые и временные билеты", "stack", ["player", "family", "business"], ["tradable", "consumable", "expirable"]),
    assetType("food", "Еда", "Расходуемые продукты питания", "stack", ["player", "family", "business"], ["tradable", "consumable", "expirable"]),
    assetType("medicine", "Медицина", "Лекарства и медицинские предметы", "stack", ["player", "family", "business"], ["tradable", "consumable", "expirable"]),
    assetType("clothing", "Одежда", "Одежда и экипировка", "instance", ["player", "family", "business", "group", "clan"], ["tradable", "equippable"]),
    assetType("decoration", "Декор", "Размещаемые декоративные объекты", "instance", ["player", "family", "business", "group", "clan"], ["tradable"]),
    assetType("future", "Будущие активы", "Зарезервированная расширяемая группа", "instance", ["player", "family", "business", "group", "clan", "system"], [])
];
const categoryDefinitions = [
    ["bicycle", "transport", "Велосипеды", "Велосипеды и велотранспорт", 10],
    ["scooter", "transport", "Скутеры", "Скутеры", 20],
    ["motorcycle", "transport", "Мотоциклы", "Мотоциклы", 30],
    ["car", "transport", "Автомобили", "Легковые автомобили", 40],
    ["truck", "transport", "Грузовики", "Грузовой транспорт", 50],
    ["ship", "transport", "Корабли", "Морской транспорт", 60],
    ["yacht", "transport", "Яхты", "Частные яхты", 70],
    ["airplane", "transport", "Самолёты", "Воздушный транспорт", 80],
    ["helicopter", "transport", "Вертолёты", "Вертолёты", 90],
    ["home", "real_estate", "Жилая недвижимость", "Квартиры и дома", 100],
    ["business", "business", "Предприятия", "Игровые предприятия", 110],
    ["pet", "pet", "Питомцы", "Игровые питомцы", 120],
    ["gift", "item", "Подарки", "Подарочные предметы", 130],
    ["jewelry", "item", "Украшения", "Украшения и драгоценности", 140],
    ["interior", "item", "Интерьер", "Предметы интерьера", 150],
    ["ticket", "ticket", "Билеты", "Расходуемые билеты", 160],
    ["license.generic", "license", "Лицензии", "Игровые лицензии", 170],
    ["collectible.generic", "collectible", "Коллекции", "Коллекционные объекты", 180],
    ["service.effect", "service", "Эффекты", "Мгновенные и временные эффекты", 190],
    ["currency.game", "currency", "Игровые валюты", "Игровые валюты и токены", 200],
    ["quest.generic", "quest", "Квестовые объекты", "Права и объекты квестов", 210],
    ["food.generic", "food", "Еда", "Расходуемая еда", 220],
    ["medicine.generic", "medicine", "Медицина", "Лекарства и медицинские предметы", 230],
    ["clothing.generic", "clothing", "Одежда", "Одежда и экипировка", 240],
    ["decoration.generic", "decoration", "Декор", "Размещаемые декоративные объекты", 250],
    ["future.generic", "future", "Будущие активы", "Расширяемая будущая категория", 260]
];
exports.assetCategories = categoryDefinitions.map(([id, assetTypeId, name, description, sortOrder]) => ({
    id,
    assetTypeId,
    name,
    description,
    sortOrder,
    attributeSchemaId: `${assetTypeId}.${id}`,
    attributeSchemaVersion: 1,
    allowedCapabilities: exports.assetTypes.find((candidate) => candidate.id === assetTypeId)?.defaultCapabilities ?? [],
    status: "active",
    version: 1
}));
const nativeProducts = [
    {
        id: "currency_sum",
        categoryId: "currency.game",
        name: "Сум",
        description: "Основная игровая валюта Мир Сливки",
        inventoryMode: "immediate",
        allowedOwnerKinds: ["player", "family", "business"],
        capabilities: [],
        attributes: Object.freeze({ code: "SUM", decimals: 0, primary: true }),
        unlocks: [],
        valuation: { baseAssetValue: { amount: 1, currency: SUM } },
        status: "active",
        schemaVersion: 1,
        revision: 1
    }
];
exports.assetProducts = [...catalog_1.catalogItems.map(toProduct), ...nativeProducts];
exports.shopListings = catalog_1.catalogItems.map((item) => toListing(item, toProduct(item)));
function legacyRequirementsToExpression(requirements = []) {
    const rules = requirements.flatMap(requirementToExpressions);
    if (rules.length === 0)
        return undefined;
    return rules.length === 1 ? rules[0] : { operator: "and", rules };
}
function assetType(id, name, description, defaultInventoryMode, allowedOwnerKinds, defaultCapabilities) {
    return {
        id,
        name,
        description,
        defaultInventoryMode,
        allowedOwnerKinds,
        defaultCapabilities,
        attributeSchemaId: id,
        attributeSchemaVersion: 1,
        status: "active",
        version: 1
    };
}
function toProduct(item) {
    const category = exports.assetCategories.find((candidate) => candidate.id === item.category);
    if (!category) {
        throw new Error(`Asset category is not registered: ${item.category}`);
    }
    const inventoryMode = inventoryModeFor(item);
    const assetType = exports.assetTypes.find((candidate) => candidate.id === category.assetTypeId);
    if (!assetType) {
        throw new Error(`Asset type is not registered: ${category.assetTypeId}`);
    }
    const vehicleFoundation = transport_foundation_1.vehicleFoundationByProductId[item.id];
    return {
        id: item.id,
        categoryId: category.id,
        name: item.name,
        description: item.transport?.description ?? item.name,
        rarity: item.rarity,
        inventoryMode,
        allowedOwnerKinds: assetType.allowedOwnerKinds,
        capabilities: capabilitiesFor(item),
        attributes: Object.freeze({
            ...(item.metadata ?? {}),
            ...(item.transport ? { transport: Object.freeze({ ...item.transport }) } : {}),
            ...(vehicleFoundation ? { vehicle: vehicleFoundation } : {}),
            legacyCategory: item.category,
            legacyTransportKind: item.transportKind ?? "none",
            minimumLevel: item.level
        }),
        requirements: legacyRequirementsToExpression([{ level: item.level }, ...(item.requirements ?? [])]),
        unlocks: unlocksFor(item),
        valuation: {
            baseAssetValue: { amount: item.assetValue, currency: SUM },
            defaultResaleValue: item.assetValue > 0 ? { amount: item.transport?.resalePrice ?? item.assetValue, currency: SUM } : undefined
        },
        status: "active",
        schemaVersion: 1,
        revision: 1
    };
}
function toListing(item, product) {
    const resaleAmount = product.valuation.defaultResaleValue?.amount ?? 0;
    return {
        id: `listing:${item.id}`,
        productId: item.id,
        price: { amount: item.price, currency: SUM },
        stockMode: "unlimited",
        minQuantity: 1,
        maxQuantity: product.inventoryMode === "stack" ? 99 : 1,
        salePolicy: {
            enabled: resaleAmount > 0 && item.transport?.canSell !== false,
            fixedUnitPrice: resaleAmount > 0 ? { amount: resaleAmount, currency: SUM } : undefined
        },
        status: "active",
        version: 1
    };
}
function inventoryModeFor(item) {
    if (["bicycle", "scooter", "motorcycle", "car", "truck", "ship", "airplane", "helicopter", "yacht", "home", "business", "pet"].includes(item.category)) {
        return "instance";
    }
    return "stack";
}
function capabilitiesFor(item) {
    const capabilities = new Set();
    if (item.assetValue > 0 && item.transport?.canSell !== false)
        capabilities.add("tradable");
    if (item.transport?.canRepair !== false && item.transport)
        capabilities.add("repairable");
    if ((item.transport?.maintenanceCost ?? 0) > 0)
        capabilities.add("maintainable");
    if (item.transport?.upgradeSupport)
        capabilities.add("upgradeable");
    if (item.transport?.canWork)
        capabilities.add("work_eligible");
    if (item.transport)
        capabilities.add("travel_eligible");
    if (item.category === "business")
        capabilities.add("income_generating");
    if (item.category === "ticket")
        capabilities.add("consumable");
    if (item.category === "ticket")
        capabilities.add("expirable");
    return [...capabilities];
}
function unlocksFor(item) {
    const unlocks = (item.transport?.unlockedJobs ?? []).map((targetId) => ({
        type: "job",
        targetId,
        mode: "while_owned"
    }));
    for (const targetId of item.transport?.businessUsage ?? []) {
        unlocks.push({ type: "business_usage", targetId, mode: "while_owned" });
    }
    return unlocks;
}
function requirementToExpressions(requirement) {
    const rules = [];
    if (requirement.expression)
        rules.push(requirement.expression);
    if (requirement.level !== undefined)
        rules.push(predicate("player.level.at_least", { value: requirement.level }, `Требуется уровень ${requirement.level}`));
    if (requirement.familyLevel !== undefined)
        rules.push(predicate("family.level.at_least", { value: requirement.familyLevel }, `Требуется уровень семьи ${requirement.familyLevel}`));
    if (requirement.balance !== undefined)
        rules.push(predicate("player.balance.at_least", { value: requirement.balance }, `Требуется баланс ${requirement.balance}`));
    if (requirement.itemId)
        rules.push(predicate("inventory.owns_product", { productId: requirement.itemId }, `Требуется предмет ${requirement.itemId}`));
    if (requirement.itemCategory)
        rules.push(predicate("inventory.owns_category", { categoryId: requirement.itemCategory }, `Требуется категория ${requirement.itemCategory}`));
    return rules;
}
function predicate(kind, params, message) {
    return { operator: "predicate", predicate: { kind, params, message } };
}
