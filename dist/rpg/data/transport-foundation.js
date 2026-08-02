"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicleFoundationByProductId = exports.giantEscape3Foundation = exports.vehicleEnergyTypeDefinitions = exports.vehicleCapabilityDefinitions = void 0;
const transport_1 = require("../domain/transport");
const capability = (code, options = {}) => ({
    code,
    localizationKey: `transport.capability.${code}`,
    parameters: options.parameters ?? {},
    requires: options.requires,
    implies: options.implies ?? [],
    version: 1
});
const requiredCapability = (code) => ({ operator: "capability", code });
exports.vehicleCapabilityDefinitions = Object.freeze([
    capability("ride"),
    capability("drive"),
    capability("rail"),
    capability("fly"),
    capability("sail"),
    capability("cargo", {
        parameters: { capacityKg: { type: "number", required: true, integer: false, minimum: 0, maximum: 1_000_000 } }
    }),
    capability("tow", {
        parameters: { capacityKg: { type: "number", required: true, integer: false, minimum: 0, maximum: 10_000_000 } }
    }),
    capability("passengers", {
        parameters: { seats: { type: "number", required: true, integer: true, minimum: 1, maximum: 2_000 } }
    }),
    capability("delivery", {
        requires: {
            operator: "all",
            rules: [
                requiredCapability("cargo"),
                { operator: "any", rules: [requiredCapability("ride"), requiredCapability("drive")] }
            ]
        }
    }),
    capability("offroad"),
    capability("urban"),
    capability("domestic"),
    capability("international"),
    capability("business"),
    capability("military")
]);
const energy = (code, storageUnit, runtimeStateRequired) => ({
    code,
    localizationKey: `transport.energy.${code}`,
    storageUnit,
    runtimeStateRequired,
    version: 1
});
exports.vehicleEnergyTypeDefinitions = Object.freeze([
    energy("human", "none", false),
    energy("fuel", "liter", true),
    energy("electric", "kilowatt_hour", true),
    energy("hybrid", "kilowatt_hour", true),
    energy("hydrogen", "kilogram", true),
    energy("nuclear", "kilogram", true)
]);
const vehicleCapability = (code, parameters = {}) => Object.freeze({ code, parameters: Object.freeze({ ...parameters }) });
exports.giantEscape3Foundation = Object.freeze({
    schemaVersion: transport_1.TRANSPORT_SCHEMA_VERSION,
    catalogRevision: transport_1.TRANSPORT_CATALOG_REVISION,
    capabilities: Object.freeze([
        vehicleCapability("ride"),
        vehicleCapability("cargo", { capacityKg: 8 }),
        vehicleCapability("delivery"),
        vehicleCapability("urban"),
        vehicleCapability("domestic")
    ]),
    energy: Object.freeze({ type: "human", carriers: Object.freeze([]), storageCapacity: 0, consumptionMetric: "none" }),
    presentation: Object.freeze({
        mediaKey: "transport.bicycle.giant_escape_3",
        emoji: "🚲",
        nameLocalizationKey: "transport.product.bike_giant_escape_3.name"
    })
});
exports.vehicleFoundationByProductId = Object.freeze({
    bike_giant_escape_3: exports.giantEscape3Foundation
});
