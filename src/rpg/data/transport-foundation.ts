import type {
  EnergyTypeDefinition,
  VehicleCapability,
  VehicleCapabilityDefinition,
  VehicleFoundationSpecification
} from "../domain/transport";
import { TRANSPORT_CATALOG_REVISION, TRANSPORT_SCHEMA_VERSION } from "../domain/transport";

const capability = (
  code: string,
  options: Partial<Pick<VehicleCapabilityDefinition, "parameters" | "requires" | "implies">> = {}
): VehicleCapabilityDefinition => ({
  code,
  localizationKey: `transport.capability.${code}`,
  parameters: options.parameters ?? {},
  requires: options.requires,
  implies: options.implies ?? [],
  version: 1
});

const requiredCapability = (code: string) => ({ operator: "capability" as const, code });

export const vehicleCapabilityDefinitions: readonly VehicleCapabilityDefinition[] = Object.freeze([
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

const energy = (
  code: string,
  storageUnit: EnergyTypeDefinition["storageUnit"],
  runtimeStateRequired: boolean
): EnergyTypeDefinition => ({
  code,
  localizationKey: `transport.energy.${code}`,
  storageUnit,
  runtimeStateRequired,
  version: 1
});

export const vehicleEnergyTypeDefinitions: readonly EnergyTypeDefinition[] = Object.freeze([
  energy("human", "none", false),
  energy("fuel", "liter", true),
  energy("electric", "kilowatt_hour", true),
  energy("hybrid", "kilowatt_hour", true),
  energy("hydrogen", "kilogram", true),
  energy("nuclear", "kilogram", true)
]);

const vehicleCapability = (
  code: string,
  parameters: VehicleCapability["parameters"] = {}
): VehicleCapability => Object.freeze({ code, parameters: Object.freeze({ ...parameters }) });

export const giantEscape3Foundation: VehicleFoundationSpecification = Object.freeze({
  schemaVersion: TRANSPORT_SCHEMA_VERSION,
  catalogRevision: TRANSPORT_CATALOG_REVISION,
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

export const vehicleFoundationByProductId: Readonly<Record<string, VehicleFoundationSpecification>> = Object.freeze({
  bike_giant_escape_3: giantEscape3Foundation
});
