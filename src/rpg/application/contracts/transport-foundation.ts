import type {
  TRANSPORT_API_VERSION,
  TRANSPORT_SCHEMA_VERSION,
  CapabilityParameterValue,
  EnergyTypeCode,
  VehicleCapabilityCode,
  VehicleEnergyProfile
} from "../../domain/transport";

export interface TransportApiEnvelope<TData> {
  readonly apiVersion: typeof TRANSPORT_API_VERSION;
  readonly data: Readonly<TData>;
}

export interface VehicleCapabilityDto {
  readonly code: VehicleCapabilityCode;
  readonly parameters: Readonly<Record<string, CapabilityParameterValue>>;
}

export interface VehicleEnergyDto {
  readonly type: EnergyTypeCode;
  readonly carriers: readonly string[];
  readonly storageCapacity: number;
  readonly consumptionMetric: VehicleEnergyProfile["consumptionMetric"];
}

export interface VehicleFoundationDto {
  readonly productId: string;
  readonly schemaVersion: typeof TRANSPORT_SCHEMA_VERSION;
  readonly catalogRevision: number;
  readonly capabilities: readonly VehicleCapabilityDto[];
  readonly energy: VehicleEnergyDto;
  readonly mediaKey: string;
}
