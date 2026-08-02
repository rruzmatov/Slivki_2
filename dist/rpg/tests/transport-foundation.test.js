"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const composition_root_1 = require("../bootstrap/composition-root");
const errors_1 = require("../domain/errors");
const transport_1 = require("../domain/transport");
const transport_registry_1 = require("../domain/transport-registry");
const now = "2026-08-02T14:00:00.000Z";
const firstPlayer = { id: 3001, firstName: "Владелец" };
const secondPlayer = { id: 3002, firstName: "Пользователь" };
const owner = { kind: "player", id: firstPlayer.id };
const operation = (id) => ({
    requestId: id,
    idempotencyKey: id,
    correlationId: id,
    now,
    actor: { kind: "player", id: firstPlayer.id }
});
async function root() {
    const directory = await node_fs_1.promises.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "slivki-transport-foundation-"));
    const app = await (0, composition_root_1.createCompositionRoot)({ storagePath: node_path_1.default.join(directory, "state.json") });
    await app.gameServices.ensurePlayer(firstPlayer, now);
    await app.gameServices.ensurePlayer(secondPlayer, now);
    return app;
}
(0, node_test_1.default)("Transport versions are separated and the initial catalog model is validated", async () => {
    const app = await root();
    const foundation = app.catalogService.getVehicleFoundation("bike_giant_escape_3");
    strict_1.default.ok(foundation);
    strict_1.default.equal(foundation.schemaVersion, transport_1.TRANSPORT_SCHEMA_VERSION);
    strict_1.default.equal(foundation.catalogRevision, transport_1.TRANSPORT_CATALOG_REVISION);
    strict_1.default.equal(foundation.energy.type, "human");
    strict_1.default.equal(app.capabilityRegistry.supports(foundation.capabilities, "delivery"), true);
    strict_1.default.equal(app.catalogService.getAssetTypeForProduct("bike_giant_escape_3").allowedOwnerKinds.includes("business"), true);
    strict_1.default.deepEqual((0, transport_1.transportVersions)(), {
        schemaVersion: transport_1.TRANSPORT_SCHEMA_VERSION,
        apiVersion: transport_1.TRANSPORT_API_VERSION,
        eventRegistryVersion: transport_1.TRANSPORT_EVENT_REGISTRY_VERSION,
        catalogRevision: transport_1.TRANSPORT_CATALOG_REVISION
    });
    await app.stop();
});
(0, node_test_1.default)("Capability Registry enforces registered composite dependencies without category checks", async () => {
    const app = await root();
    strict_1.default.throws(() => app.capabilityRegistry.validate([{ code: "delivery", parameters: {} }]), (error) => isDomainError(error, "TRANSPORT_CAPABILITY_DEPENDENCY_UNSATISFIED"));
    strict_1.default.throws(() => app.capabilityRegistry.supports([], "unregistered_capability"), (error) => isDomainError(error, "TRANSPORT_CAPABILITY_UNKNOWN"));
    strict_1.default.throws(() => new transport_registry_1.VehicleCapabilityRegistry([
        capability("cap_a", { operator: "capability", code: "cap_b" }),
        capability("cap_b", { operator: "capability", code: "cap_a" })
    ]), (error) => isDomainError(error, "TRANSPORT_CAPABILITY_DEPENDENCY_CYCLE"));
    await app.stop();
});
(0, node_test_1.default)("Energy Registry validates universal energy profiles", async () => {
    const app = await root();
    app.energyTypeRegistry.validate({ type: "electric", carriers: ["electricity"], storageCapacity: 0, consumptionMetric: "per_100_km" });
    strict_1.default.throws(() => app.energyTypeRegistry.validate({ type: "human", carriers: [], storageCapacity: 1, consumptionMetric: "per_hour" }), (error) => isDomainError(error, "TRANSPORT_ENERGY_PROFILE_INVALID"));
    strict_1.default.throws(() => app.energyTypeRegistry.validate({ type: "unknown", carriers: [], storageCapacity: 0, consumptionMetric: "none" }), (error) => isDomainError(error, "TRANSPORT_ENERGY_TYPE_UNKNOWN"));
    await app.stop();
});
(0, node_test_1.default)("Ownership permissions are extensible and implied permissions work through OwnershipService", async () => {
    const app = await root();
    const granted = await app.execute((context) => context.inventoryService.grant({
        owner,
        productId: "bike_giant_escape_3",
        quantity: 1,
        acquiredBy: "reward"
    }, operation("transport-permission-grant")));
    const entryId = granted.inventoryEntryIds[0];
    await app.execute((context) => context.ownershipService.grantPermission(entryId, { kind: "player", id: secondPlayer.id }, "view", "allow", "transport-foundation-test", operation("grant-view")));
    await app.execute((context) => context.ownershipService.grantPermission(entryId, { kind: "player", id: secondPlayer.id }, "repair", "allow", "transport-foundation-test", operation("grant-repair")));
    await app.execute((context) => context.ownershipService.assertPermission(entryId, { kind: "player", id: secondPlayer.id }, "inspect", now, owner));
    await app.execute((context) => context.ownershipService.assertPermission(entryId, { kind: "player", id: secondPlayer.id }, "maintain", now, owner));
    await app.execute((context) => context.ownershipService.assertPermission(entryId, { kind: "player", id: firstPlayer.id }, "sell", now, owner));
    await strict_1.default.rejects(() => app.execute((context) => context.ownershipService.assertPermission(entryId, { kind: "player", id: secondPlayer.id }, "upgrade", now, owner)), (error) => isDomainError(error, "OWNERSHIP_PERMISSION_DENIED"));
    await app.stop();
});
(0, node_test_1.default)("Schema Registry rejects invalid transport event and scheduler payloads", async () => {
    const app = await root();
    const eventPayload = { vehicleId: "vehicle_1", productId: "bike_giant_escape_3", inventoryVersion: 1 };
    strict_1.default.deepEqual(app.schemaRegistry.validate("event", "transport.vehicle.registered", 1, eventPayload), eventPayload);
    strict_1.default.throws(() => app.schemaRegistry.validate("event", "transport.vehicle.registered", 1, { ...eventPayload, unexpected: true }), (error) => isDomainError(error, "SCHEMA_VALIDATION_FAILED"));
    strict_1.default.deepEqual(app.schemaRegistry.validate("scheduler", "transport.maintenance.remind", 1, {
        vehicleId: "vehicle_1",
        expectedVehicleVersion: 1
    }), { vehicleId: "vehicle_1", expectedVehicleVersion: 1 });
    strict_1.default.throws(() => app.schemaRegistry.validate("scheduler", "transport.maintenance.remind", 1, {
        vehicleId: "vehicle_1",
        expectedVehicleVersion: 0
    }), (error) => isDomainError(error, "SCHEMA_VALIDATION_FAILED"));
    await app.stop();
});
function capability(code, requires) {
    return { code, localizationKey: `transport.capability.${code}`, parameters: {}, requires, implies: [], version: 1 };
}
function isDomainError(error, code) {
    return error instanceof errors_1.DomainError && error.code === code;
}
