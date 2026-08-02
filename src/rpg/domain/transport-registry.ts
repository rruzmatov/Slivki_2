import type {
  CapabilityDependencyExpression,
  CapabilityParameterDefinition,
  CapabilityParameterValue,
  EnergyTypeCode,
  EnergyTypeDefinition,
  VehicleCapability,
  VehicleCapabilityCode,
  VehicleCapabilityDefinition,
  VehicleEnergyProfile,
  VehicleFoundationSpecification
} from "./transport";
import { TRANSPORT_SCHEMA_VERSION } from "./transport";
import { TransportErrorFactory } from "./transport-errors";

export class VehicleCapabilityRegistry {
  private readonly definitions: ReadonlyMap<VehicleCapabilityCode, VehicleCapabilityDefinition>;

  constructor(definitions: readonly VehicleCapabilityDefinition[]) {
    const byCode = new Map<VehicleCapabilityCode, VehicleCapabilityDefinition>();
    for (const definition of definitions) {
      assertRegistryCode(definition.code, "TRANSPORT_CAPABILITY_CODE_INVALID");
      if (byCode.has(definition.code)) {
        throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_DUPLICATE", { code: definition.code });
      }
      byCode.set(definition.code, freezeCapabilityDefinition(definition));
    }
    for (const definition of byCode.values()) {
      for (const dependency of referencedCapabilities(definition.requires)) assertKnown(byCode, dependency);
      for (const implied of definition.implies) assertKnown(byCode, implied);
    }
    assertCapabilityGraphAcyclic(byCode);
    this.definitions = byCode;
  }

  list(): readonly VehicleCapabilityDefinition[] {
    return [...this.definitions.values()];
  }

  has(code: VehicleCapabilityCode): boolean {
    return this.definitions.has(code);
  }

  validate(capabilities: readonly VehicleCapability[]): void {
    const codes = new Set<VehicleCapabilityCode>();
    for (const capability of capabilities) {
      const definition = this.get(capability.code);
      if (codes.has(capability.code)) {
        throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_DUPLICATE", { code: capability.code });
      }
      codes.add(capability.code);
      validateParameters(definition.parameters, capability.parameters, capability.code);
    }
    const effective = this.effectiveCodes(capabilities);
    for (const capability of capabilities) {
      const requirement = this.get(capability.code).requires;
      if (requirement && !evaluateDependency(requirement, effective)) {
        throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_DEPENDENCY_UNSATISFIED", { code: capability.code });
      }
    }
  }

  supports(capabilities: readonly VehicleCapability[], requested: VehicleCapabilityCode): boolean {
    return this.supportsAll(capabilities, [requested]);
  }

  supportsAll(capabilities: readonly VehicleCapability[], requested: readonly VehicleCapabilityCode[]): boolean {
    return this.missingCapabilities(capabilities, requested).length === 0;
  }

  missingCapabilities(
    capabilities: readonly VehicleCapability[],
    requested: readonly VehicleCapabilityCode[]
  ): readonly VehicleCapabilityCode[] {
    for (const code of requested) this.get(code);
    this.validate(capabilities);
    const effective = this.effectiveCodes(capabilities);
    return requested.filter((code) => !effective.has(code));
  }

  get(code: VehicleCapabilityCode): VehicleCapabilityDefinition {
    const definition = this.definitions.get(code);
    if (!definition) throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_UNKNOWN", { code });
    return definition;
  }

  private effectiveCodes(capabilities: readonly VehicleCapability[]): ReadonlySet<VehicleCapabilityCode> {
    const effective = new Set(capabilities.map((capability) => capability.code));
    const addImplied = (code: VehicleCapabilityCode): void => {
      for (const implied of this.get(code).implies) {
        if (effective.has(implied)) continue;
        effective.add(implied);
        addImplied(implied);
      }
    };
    for (const code of [...effective]) addImplied(code);
    return effective;
  }
}

export class VehicleEnergyTypeRegistry {
  private readonly definitions: ReadonlyMap<EnergyTypeCode, EnergyTypeDefinition>;

  constructor(definitions: readonly EnergyTypeDefinition[]) {
    const byCode = new Map<EnergyTypeCode, EnergyTypeDefinition>();
    for (const definition of definitions) {
      assertRegistryCode(definition.code, "TRANSPORT_ENERGY_TYPE_CODE_INVALID");
      if (byCode.has(definition.code)) {
        throw TransportErrorFactory.create("TRANSPORT_ENERGY_TYPE_DUPLICATE", { code: definition.code });
      }
      byCode.set(definition.code, Object.freeze({ ...definition }));
    }
    this.definitions = byCode;
  }

  list(): readonly EnergyTypeDefinition[] {
    return [...this.definitions.values()];
  }

  validate(profile: VehicleEnergyProfile): void {
    const definition = this.definitions.get(profile.type);
    if (!definition) throw TransportErrorFactory.create("TRANSPORT_ENERGY_TYPE_UNKNOWN", { code: profile.type });
    if (!Number.isFinite(profile.storageCapacity) || profile.storageCapacity < 0) {
      throw TransportErrorFactory.create("TRANSPORT_ENERGY_PROFILE_INVALID", { code: profile.type });
    }
    if (!definition.runtimeStateRequired && (profile.storageCapacity !== 0 || profile.consumptionMetric !== "none")) {
      throw TransportErrorFactory.create("TRANSPORT_ENERGY_PROFILE_INVALID", { code: profile.type });
    }
  }
}

export function validateVehicleFoundation(
  specification: VehicleFoundationSpecification,
  capabilities: VehicleCapabilityRegistry,
  energyTypes: VehicleEnergyTypeRegistry
): void {
  if (specification.schemaVersion !== TRANSPORT_SCHEMA_VERSION) {
    throw TransportErrorFactory.create("TRANSPORT_CATALOG_REVISION_INVALID", { revision: specification.catalogRevision });
  }
  if (!Number.isSafeInteger(specification.catalogRevision) || specification.catalogRevision < 1) {
    throw TransportErrorFactory.create("TRANSPORT_CATALOG_REVISION_INVALID", { revision: specification.catalogRevision });
  }
  capabilities.validate(specification.capabilities);
  energyTypes.validate(specification.energy);
}

function validateParameters(
  definitions: Readonly<Record<string, CapabilityParameterDefinition>>,
  parameters: Readonly<Record<string, CapabilityParameterValue>>,
  capabilityCode: string
): void {
  for (const [name, definition] of Object.entries(definitions)) {
    const value = parameters[name];
    if (value === undefined) {
      if (definition.required) parameterError(capabilityCode, name);
      continue;
    }
    if (typeof value !== definition.type) parameterError(capabilityCode, name);
    if (typeof value === "number") {
      if (!Number.isFinite(value) || (definition.integer && !Number.isSafeInteger(value))) parameterError(capabilityCode, name);
      if (definition.minimum !== undefined && value < definition.minimum) parameterError(capabilityCode, name);
      if (definition.maximum !== undefined && value > definition.maximum) parameterError(capabilityCode, name);
    }
  }
  for (const name of Object.keys(parameters)) {
    if (!definitions[name]) parameterError(capabilityCode, name);
  }
}

function parameterError(capabilityCode: string, parameter: string): never {
  throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_PARAMETER_INVALID", { capabilityCode, parameter });
}

function evaluateDependency(rule: CapabilityDependencyExpression, capabilities: ReadonlySet<string>): boolean {
  if (rule.operator === "capability") return capabilities.has(rule.code);
  if (rule.operator === "not") return !evaluateDependency(rule.rule, capabilities);
  if (rule.operator === "all") return rule.rules.every((child) => evaluateDependency(child, capabilities));
  return rule.rules.some((child) => evaluateDependency(child, capabilities));
}

function referencedCapabilities(rule?: CapabilityDependencyExpression): VehicleCapabilityCode[] {
  if (!rule) return [];
  if (rule.operator === "capability") return [rule.code];
  if (rule.operator === "not") return referencedCapabilities(rule.rule);
  return rule.rules.flatMap(referencedCapabilities);
}

function assertKnown(
  definitions: ReadonlyMap<VehicleCapabilityCode, VehicleCapabilityDefinition>,
  code: VehicleCapabilityCode
): void {
  if (!definitions.has(code)) throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_UNKNOWN", { code });
}

function assertRegistryCode(
  code: string,
  errorCode: "TRANSPORT_CAPABILITY_CODE_INVALID" | "TRANSPORT_ENERGY_TYPE_CODE_INVALID"
): void {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(code)) throw TransportErrorFactory.create(errorCode, { code });
}

function assertCapabilityGraphAcyclic(
  definitions: ReadonlyMap<VehicleCapabilityCode, VehicleCapabilityDefinition>
): void {
  const visited = new Set<VehicleCapabilityCode>();
  const active = new Set<VehicleCapabilityCode>();
  const visit = (code: VehicleCapabilityCode): void => {
    if (active.has(code)) {
      throw TransportErrorFactory.create("TRANSPORT_CAPABILITY_DEPENDENCY_CYCLE", { code });
    }
    if (visited.has(code)) return;
    active.add(code);
    const definition = definitions.get(code);
    for (const dependency of referencedCapabilities(definition?.requires)) visit(dependency);
    for (const implied of definition?.implies ?? []) visit(implied);
    active.delete(code);
    visited.add(code);
  };
  for (const code of definitions.keys()) visit(code);
}

function freezeCapabilityDefinition(definition: VehicleCapabilityDefinition): VehicleCapabilityDefinition {
  return Object.freeze({
    ...definition,
    parameters: Object.freeze({ ...definition.parameters }),
    implies: Object.freeze([...definition.implies])
  });
}
