import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCompositionRoot, type RpgCompositionRoot } from "../bootstrap/composition-root";
import type { OperationContext, OwnerRef } from "../domain/assets";
import { DomainError } from "../domain/errors";
import {
  TRANSPORT_API_VERSION,
  TRANSPORT_CATALOG_REVISION,
  TRANSPORT_EVENT_REGISTRY_VERSION,
  TRANSPORT_SCHEMA_VERSION,
  transportVersions,
  type VehicleCapabilityDefinition
} from "../domain/transport";
import { VehicleCapabilityRegistry } from "../domain/transport-registry";

const now = "2026-08-02T14:00:00.000Z";
const firstPlayer = { id: 3001, firstName: "Владелец" };
const secondPlayer = { id: 3002, firstName: "Пользователь" };
const owner: OwnerRef = { kind: "player", id: firstPlayer.id };

const operation = (id: string): OperationContext => ({
  requestId: id,
  idempotencyKey: id,
  correlationId: id,
  now,
  actor: { kind: "player", id: firstPlayer.id }
});

async function root(): Promise<RpgCompositionRoot> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slivki-transport-foundation-"));
  const app = await createCompositionRoot({ storagePath: path.join(directory, "state.json") });
  await app.gameServices.ensurePlayer(firstPlayer, now);
  await app.gameServices.ensurePlayer(secondPlayer, now);
  return app;
}

test("Transport versions are separated and the initial catalog model is validated", async () => {
  const app = await root();
  const foundation = app.catalogService.getVehicleFoundation("bike_giant_escape_3");

  assert.ok(foundation);
  assert.equal(foundation.schemaVersion, TRANSPORT_SCHEMA_VERSION);
  assert.equal(foundation.catalogRevision, TRANSPORT_CATALOG_REVISION);
  assert.equal(foundation.energy.type, "human");
  assert.equal(app.capabilityRegistry.supports(foundation.capabilities, "delivery"), true);
  assert.equal(app.catalogService.getAssetTypeForProduct("bike_giant_escape_3").allowedOwnerKinds.includes("business"), true);
  assert.deepEqual(transportVersions(), {
    schemaVersion: TRANSPORT_SCHEMA_VERSION,
    apiVersion: TRANSPORT_API_VERSION,
    eventRegistryVersion: TRANSPORT_EVENT_REGISTRY_VERSION,
    catalogRevision: TRANSPORT_CATALOG_REVISION
  });
  await app.stop();
});

test("Capability Registry enforces registered composite dependencies without category checks", async () => {
  const app = await root();

  assert.throws(
    () => app.capabilityRegistry.validate([{ code: "delivery", parameters: {} }]),
    (error) => isDomainError(error, "TRANSPORT_CAPABILITY_DEPENDENCY_UNSATISFIED")
  );
  assert.throws(
    () => app.capabilityRegistry.supports([], "unregistered_capability"),
    (error) => isDomainError(error, "TRANSPORT_CAPABILITY_UNKNOWN")
  );
  assert.throws(
    () => new VehicleCapabilityRegistry([
      capability("cap_a", { operator: "capability", code: "cap_b" }),
      capability("cap_b", { operator: "capability", code: "cap_a" })
    ]),
    (error) => isDomainError(error, "TRANSPORT_CAPABILITY_DEPENDENCY_CYCLE")
  );
  await app.stop();
});

test("Energy Registry validates universal energy profiles", async () => {
  const app = await root();

  app.energyTypeRegistry.validate({ type: "electric", carriers: ["electricity"], storageCapacity: 0, consumptionMetric: "per_100_km" });
  assert.throws(
    () => app.energyTypeRegistry.validate({ type: "human", carriers: [], storageCapacity: 1, consumptionMetric: "per_hour" }),
    (error) => isDomainError(error, "TRANSPORT_ENERGY_PROFILE_INVALID")
  );
  assert.throws(
    () => app.energyTypeRegistry.validate({ type: "unknown", carriers: [], storageCapacity: 0, consumptionMetric: "none" }),
    (error) => isDomainError(error, "TRANSPORT_ENERGY_TYPE_UNKNOWN")
  );
  await app.stop();
});

test("Ownership permissions are extensible and implied permissions work through OwnershipService", async () => {
  const app = await root();
  const granted = await app.execute((context) => context.inventoryService.grant({
    owner,
    productId: "bike_giant_escape_3",
    quantity: 1,
    acquiredBy: "reward"
  }, operation("transport-permission-grant")));
  const entryId = granted.inventoryEntryIds[0];

  await app.execute((context) => context.ownershipService.grantPermission(
    entryId,
    { kind: "player", id: secondPlayer.id },
    "view",
    "allow",
    "transport-foundation-test",
    operation("grant-view")
  ));
  await app.execute((context) => context.ownershipService.grantPermission(
    entryId,
    { kind: "player", id: secondPlayer.id },
    "repair",
    "allow",
    "transport-foundation-test",
    operation("grant-repair")
  ));

  await app.execute((context) => context.ownershipService.assertPermission(
    entryId,
    { kind: "player", id: secondPlayer.id },
    "inspect",
    now,
    owner
  ));
  await app.execute((context) => context.ownershipService.assertPermission(
    entryId,
    { kind: "player", id: secondPlayer.id },
    "maintain",
    now,
    owner
  ));
  await app.execute((context) => context.ownershipService.assertPermission(
    entryId,
    { kind: "player", id: firstPlayer.id },
    "sell",
    now,
    owner
  ));
  await assert.rejects(
    () => app.execute((context) => context.ownershipService.assertPermission(
      entryId,
      { kind: "player", id: secondPlayer.id },
      "upgrade",
      now,
      owner
    )),
    (error) => isDomainError(error, "OWNERSHIP_PERMISSION_DENIED")
  );
  await app.stop();
});

test("Schema Registry rejects invalid transport event and scheduler payloads", async () => {
  const app = await root();

  const eventPayload = { vehicleId: "vehicle_1", productId: "bike_giant_escape_3", inventoryVersion: 1 };
  assert.deepEqual(app.schemaRegistry.validate("event", "transport.vehicle.registered", 1, eventPayload), eventPayload);
  assert.throws(
    () => app.schemaRegistry.validate("event", "transport.vehicle.registered", 1, { ...eventPayload, unexpected: true }),
    (error) => isDomainError(error, "SCHEMA_VALIDATION_FAILED")
  );
  assert.deepEqual(
    app.schemaRegistry.validate("scheduler", "transport.maintenance.remind", 1, {
      vehicleId: "vehicle_1",
      expectedVehicleVersion: 1
    }),
    { vehicleId: "vehicle_1", expectedVehicleVersion: 1 }
  );
  assert.throws(
    () => app.schemaRegistry.validate("scheduler", "transport.maintenance.remind", 1, {
      vehicleId: "vehicle_1",
      expectedVehicleVersion: 0
    }),
    (error) => isDomainError(error, "SCHEMA_VALIDATION_FAILED")
  );
  await app.stop();
});

function capability(
  code: string,
  requires: VehicleCapabilityDefinition["requires"]
): VehicleCapabilityDefinition {
  return { code, localizationKey: `transport.capability.${code}`, parameters: {}, requires, implies: [], version: 1 };
}

function isDomainError(error: unknown, code: string): boolean {
  return error instanceof DomainError && error.code === code;
}
