"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VehicleEnergyTypeRegistry = exports.VehicleCapabilityRegistry = void 0;
exports.validateVehicleFoundation = validateVehicleFoundation;
const transport_1 = require("./transport");
const transport_errors_1 = require("./transport-errors");
class VehicleCapabilityRegistry {
    definitions;
    constructor(definitions) {
        const byCode = new Map();
        for (const definition of definitions) {
            assertRegistryCode(definition.code, "TRANSPORT_CAPABILITY_CODE_INVALID");
            if (byCode.has(definition.code)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_DUPLICATE", { code: definition.code });
            }
            byCode.set(definition.code, freezeCapabilityDefinition(definition));
        }
        for (const definition of byCode.values()) {
            for (const dependency of referencedCapabilities(definition.requires))
                assertKnown(byCode, dependency);
            for (const implied of definition.implies)
                assertKnown(byCode, implied);
        }
        assertCapabilityGraphAcyclic(byCode);
        this.definitions = byCode;
    }
    list() {
        return [...this.definitions.values()];
    }
    has(code) {
        return this.definitions.has(code);
    }
    validate(capabilities) {
        const codes = new Set();
        for (const capability of capabilities) {
            const definition = this.get(capability.code);
            if (codes.has(capability.code)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_DUPLICATE", { code: capability.code });
            }
            codes.add(capability.code);
            validateParameters(definition.parameters, capability.parameters, capability.code);
        }
        const effective = this.effectiveCodes(capabilities);
        for (const capability of capabilities) {
            const requirement = this.get(capability.code).requires;
            if (requirement && !evaluateDependency(requirement, effective)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_DEPENDENCY_UNSATISFIED", { code: capability.code });
            }
        }
    }
    supports(capabilities, requested) {
        return this.supportsAll(capabilities, [requested]);
    }
    supportsAll(capabilities, requested) {
        return this.missingCapabilities(capabilities, requested).length === 0;
    }
    missingCapabilities(capabilities, requested) {
        for (const code of requested)
            this.get(code);
        this.validate(capabilities);
        const effective = this.effectiveCodes(capabilities);
        return requested.filter((code) => !effective.has(code));
    }
    get(code) {
        const definition = this.definitions.get(code);
        if (!definition)
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_UNKNOWN", { code });
        return definition;
    }
    effectiveCodes(capabilities) {
        const effective = new Set(capabilities.map((capability) => capability.code));
        const addImplied = (code) => {
            for (const implied of this.get(code).implies) {
                if (effective.has(implied))
                    continue;
                effective.add(implied);
                addImplied(implied);
            }
        };
        for (const code of [...effective])
            addImplied(code);
        return effective;
    }
}
exports.VehicleCapabilityRegistry = VehicleCapabilityRegistry;
class VehicleEnergyTypeRegistry {
    definitions;
    constructor(definitions) {
        const byCode = new Map();
        for (const definition of definitions) {
            assertRegistryCode(definition.code, "TRANSPORT_ENERGY_TYPE_CODE_INVALID");
            if (byCode.has(definition.code)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ENERGY_TYPE_DUPLICATE", { code: definition.code });
            }
            byCode.set(definition.code, Object.freeze({ ...definition }));
        }
        this.definitions = byCode;
    }
    list() {
        return [...this.definitions.values()];
    }
    validate(profile) {
        const definition = this.definitions.get(profile.type);
        if (!definition)
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ENERGY_TYPE_UNKNOWN", { code: profile.type });
        if (!Number.isFinite(profile.storageCapacity) || profile.storageCapacity < 0) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ENERGY_PROFILE_INVALID", { code: profile.type });
        }
        if (!definition.runtimeStateRequired && (profile.storageCapacity !== 0 || profile.consumptionMetric !== "none")) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_ENERGY_PROFILE_INVALID", { code: profile.type });
        }
    }
}
exports.VehicleEnergyTypeRegistry = VehicleEnergyTypeRegistry;
function validateVehicleFoundation(specification, capabilities, energyTypes) {
    if (specification.schemaVersion !== transport_1.TRANSPORT_SCHEMA_VERSION) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CATALOG_REVISION_INVALID", { revision: specification.catalogRevision });
    }
    if (!Number.isSafeInteger(specification.catalogRevision) || specification.catalogRevision < 1) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CATALOG_REVISION_INVALID", { revision: specification.catalogRevision });
    }
    capabilities.validate(specification.capabilities);
    energyTypes.validate(specification.energy);
}
function validateParameters(definitions, parameters, capabilityCode) {
    for (const [name, definition] of Object.entries(definitions)) {
        const value = parameters[name];
        if (value === undefined) {
            if (definition.required)
                parameterError(capabilityCode, name);
            continue;
        }
        if (typeof value !== definition.type)
            parameterError(capabilityCode, name);
        if (typeof value === "number") {
            if (!Number.isFinite(value) || (definition.integer && !Number.isSafeInteger(value)))
                parameterError(capabilityCode, name);
            if (definition.minimum !== undefined && value < definition.minimum)
                parameterError(capabilityCode, name);
            if (definition.maximum !== undefined && value > definition.maximum)
                parameterError(capabilityCode, name);
        }
    }
    for (const name of Object.keys(parameters)) {
        if (!definitions[name])
            parameterError(capabilityCode, name);
    }
}
function parameterError(capabilityCode, parameter) {
    throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_PARAMETER_INVALID", { capabilityCode, parameter });
}
function evaluateDependency(rule, capabilities) {
    if (rule.operator === "capability")
        return capabilities.has(rule.code);
    if (rule.operator === "not")
        return !evaluateDependency(rule.rule, capabilities);
    if (rule.operator === "all")
        return rule.rules.every((child) => evaluateDependency(child, capabilities));
    return rule.rules.some((child) => evaluateDependency(child, capabilities));
}
function referencedCapabilities(rule) {
    if (!rule)
        return [];
    if (rule.operator === "capability")
        return [rule.code];
    if (rule.operator === "not")
        return referencedCapabilities(rule.rule);
    return rule.rules.flatMap(referencedCapabilities);
}
function assertKnown(definitions, code) {
    if (!definitions.has(code))
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_UNKNOWN", { code });
}
function assertRegistryCode(code, errorCode) {
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(code))
        throw transport_errors_1.TransportErrorFactory.create(errorCode, { code });
}
function assertCapabilityGraphAcyclic(definitions) {
    const visited = new Set();
    const active = new Set();
    const visit = (code) => {
        if (active.has(code)) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_CAPABILITY_DEPENDENCY_CYCLE", { code });
        }
        if (visited.has(code))
            return;
        active.add(code);
        const definition = definitions.get(code);
        for (const dependency of referencedCapabilities(definition?.requires))
            visit(dependency);
        for (const implied of definition?.implies ?? [])
            visit(implied);
        active.delete(code);
        visited.add(code);
    };
    for (const code of definitions.keys())
        visit(code);
}
function freezeCapabilityDefinition(definition) {
    return Object.freeze({
        ...definition,
        parameters: Object.freeze({ ...definition.parameters }),
        implies: Object.freeze([...definition.implies])
    });
}
