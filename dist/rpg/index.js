"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRpgRuntime = exports.createRpgComposer = exports.createEmptyGameState = exports.JsonGameDatabase = exports.UnlockService = exports.ShopService = exports.RequirementEvaluator = exports.OwnershipService = exports.InventoryService = exports.EventBus = exports.EconomyService = exports.CatalogService = exports.AdminService = exports.GameServices = void 0;
var game_services_1 = require("./application/game-services");
Object.defineProperty(exports, "GameServices", { enumerable: true, get: function () { return game_services_1.GameServices; } });
var admin_service_1 = require("./application/admin-service");
Object.defineProperty(exports, "AdminService", { enumerable: true, get: function () { return admin_service_1.AdminService; } });
var catalog_service_1 = require("./application/catalog-service");
Object.defineProperty(exports, "CatalogService", { enumerable: true, get: function () { return catalog_service_1.CatalogService; } });
var economy_service_1 = require("./application/economy-service");
Object.defineProperty(exports, "EconomyService", { enumerable: true, get: function () { return economy_service_1.EconomyService; } });
var event_bus_1 = require("./application/event-bus");
Object.defineProperty(exports, "EventBus", { enumerable: true, get: function () { return event_bus_1.EventBus; } });
var inventory_service_1 = require("./application/inventory-service");
Object.defineProperty(exports, "InventoryService", { enumerable: true, get: function () { return inventory_service_1.InventoryService; } });
var ownership_service_1 = require("./application/ownership-service");
Object.defineProperty(exports, "OwnershipService", { enumerable: true, get: function () { return ownership_service_1.OwnershipService; } });
var requirement_evaluator_1 = require("./application/requirement-evaluator");
Object.defineProperty(exports, "RequirementEvaluator", { enumerable: true, get: function () { return requirement_evaluator_1.RequirementEvaluator; } });
var shop_service_1 = require("./application/shop-service");
Object.defineProperty(exports, "ShopService", { enumerable: true, get: function () { return shop_service_1.ShopService; } });
var unlock_service_1 = require("./application/unlock-service");
Object.defineProperty(exports, "UnlockService", { enumerable: true, get: function () { return unlock_service_1.UnlockService; } });
var json_game_database_1 = require("./infrastructure/storage/json-game-database");
Object.defineProperty(exports, "JsonGameDatabase", { enumerable: true, get: function () { return json_game_database_1.JsonGameDatabase; } });
Object.defineProperty(exports, "createEmptyGameState", { enumerable: true, get: function () { return json_game_database_1.createEmptyGameState; } });
var rpg_composer_1 = require("./bot/rpg-composer");
Object.defineProperty(exports, "createRpgComposer", { enumerable: true, get: function () { return rpg_composer_1.createRpgComposer; } });
Object.defineProperty(exports, "createRpgRuntime", { enumerable: true, get: function () { return rpg_composer_1.createRpgRuntime; } });
__exportStar(require("./domain/types"), exports);
