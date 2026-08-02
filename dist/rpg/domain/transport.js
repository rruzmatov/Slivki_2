"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transportVersions = exports.TRANSPORT_CATALOG_REVISION = exports.TRANSPORT_EVENT_REGISTRY_VERSION = exports.TRANSPORT_API_VERSION = exports.TRANSPORT_SCHEMA_VERSION = void 0;
exports.TRANSPORT_SCHEMA_VERSION = "1.0.0";
exports.TRANSPORT_API_VERSION = "1.0";
exports.TRANSPORT_EVENT_REGISTRY_VERSION = "1.0.0";
exports.TRANSPORT_CATALOG_REVISION = 1;
const transportVersions = (catalogRevision = exports.TRANSPORT_CATALOG_REVISION) => Object.freeze({
    schemaVersion: exports.TRANSPORT_SCHEMA_VERSION,
    apiVersion: exports.TRANSPORT_API_VERSION,
    eventRegistryVersion: exports.TRANSPORT_EVENT_REGISTRY_VERSION,
    catalogRevision
});
exports.transportVersions = transportVersions;
