export const TRANSPORT_SCHEMA_VERSION = "1.0.0" as const;
export const TRANSPORT_API_VERSION = "1.0" as const;
export const TRANSPORT_EVENT_REGISTRY_VERSION = "1.0.0" as const;
export const TRANSPORT_CATALOG_REVISION = 1 as const;

export type VehicleCapabilityCode = string;
export type EnergyTypeCode = string;
export type CapabilityParameterValue = string | number | boolean;

export interface TransportVersionSet {
  readonly schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  readonly apiVersion: typeof TRANSPORT_API_VERSION;
  readonly eventRegistryVersion: typeof TRANSPORT_EVENT_REGISTRY_VERSION;
  readonly catalogRevision: number;
}

export type CapabilityDependencyExpression =
  | { readonly operator: "capability"; readonly code: VehicleCapabilityCode }
  | { readonly operator: "all"; readonly rules: readonly CapabilityDependencyExpression[] }
  | { readonly operator: "any"; readonly rules: readonly CapabilityDependencyExpression[] }
  | { readonly operator: "not"; readonly rule: CapabilityDependencyExpression };

export interface CapabilityParameterDefinition {
  readonly type: "string" | "number" | "boolean";
  readonly required: boolean;
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface VehicleCapabilityDefinition {
  readonly code: VehicleCapabilityCode;
  readonly localizationKey: string;
  readonly parameters: Readonly<Record<string, CapabilityParameterDefinition>>;
  readonly requires?: CapabilityDependencyExpression;
  readonly implies: readonly VehicleCapabilityCode[];
  readonly version: number;
}

export interface VehicleCapability {
  readonly code: VehicleCapabilityCode;
  readonly parameters: Readonly<Record<string, CapabilityParameterValue>>;
}

export interface EnergyTypeDefinition {
  readonly code: EnergyTypeCode;
  readonly localizationKey: string;
  readonly storageUnit: "none" | "liter" | "kilowatt_hour" | "kilogram";
  readonly runtimeStateRequired: boolean;
  readonly version: number;
}

export interface VehicleEnergyProfile {
  readonly type: EnergyTypeCode;
  readonly carriers: readonly string[];
  readonly storageCapacity: number;
  readonly consumptionMetric: "none" | "per_100_km" | "per_hour";
}

export interface VehiclePresentationDefinition {
  readonly mediaKey: string;
  readonly emoji: string;
  readonly nameLocalizationKey: string;
}

export interface VehicleFoundationSpecification {
  readonly schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  readonly catalogRevision: number;
  readonly capabilities: readonly VehicleCapability[];
  readonly energy: VehicleEnergyProfile;
  readonly presentation: VehiclePresentationDefinition;
}

export const transportVersions = (catalogRevision = TRANSPORT_CATALOG_REVISION): TransportVersionSet => Object.freeze({
  schemaVersion: TRANSPORT_SCHEMA_VERSION,
  apiVersion: TRANSPORT_API_VERSION,
  eventRegistryVersion: TRANSPORT_EVENT_REGISTRY_VERSION,
  catalogRevision
});
