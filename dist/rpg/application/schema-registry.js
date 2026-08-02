"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaRegistry = void 0;
const zod_1 = require("zod");
const errors_1 = require("../domain/errors");
class SchemaRegistry {
    schemas = new Map();
    register(registration) {
        assertSchemaIdentity(registration.schemaId, registration.version);
        const key = schemaKey(registration.namespace, registration.schemaId, registration.version);
        if (this.schemas.has(key)) {
            throw new errors_1.DomainError(`Схема уже зарегистрирована: ${key}`, "SCHEMA_ALREADY_REGISTERED");
        }
        this.schemas.set(key, registration.schema);
    }
    validate(namespace, schemaId, version, value) {
        const key = schemaKey(namespace, schemaId, version);
        const schema = this.schemas.get(key);
        if (!schema)
            throw new errors_1.DomainError(`Схема не зарегистрирована: ${key}`, "SCHEMA_NOT_REGISTERED");
        assertPayloadLimits(value);
        const result = schema.safeParse(value);
        if (!result.success) {
            throw new errors_1.DomainError(`Данные не соответствуют схеме ${key}: ${zod_1.z.prettifyError(result.error)}`, "SCHEMA_VALIDATION_FAILED");
        }
        return result.data;
    }
    has(namespace, schemaId, version) {
        return this.schemas.has(schemaKey(namespace, schemaId, version));
    }
}
exports.SchemaRegistry = SchemaRegistry;
const schemaKey = (namespace, schemaId, version) => `${namespace}:${schemaId}:v${version}`;
function assertSchemaIdentity(schemaId, version) {
    if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(schemaId)) {
        throw new errors_1.DomainError("Некорректный идентификатор схемы", "SCHEMA_ID_INVALID");
    }
    if (!Number.isSafeInteger(version) || version < 1) {
        throw new errors_1.DomainError("Версия схемы должна быть положительным целым числом", "SCHEMA_VERSION_INVALID");
    }
}
function assertPayloadLimits(value) {
    let nodes = 0;
    const visit = (candidate, depth) => {
        nodes += 1;
        if (nodes > 10_000 || depth > 32) {
            throw new errors_1.DomainError("Структура данных превышает допустимую сложность", "SCHEMA_PAYLOAD_LIMIT_EXCEEDED");
        }
        if (Array.isArray(candidate)) {
            for (const item of candidate)
                visit(item, depth + 1);
            return;
        }
        if (candidate && typeof candidate === "object") {
            for (const item of Object.values(candidate))
                visit(item, depth + 1);
        }
    };
    visit(value, 0);
    const serialized = JSON.stringify(value);
    if (serialized && Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
        throw new errors_1.DomainError("Размер данных превышает 256 КБ", "SCHEMA_PAYLOAD_LIMIT_EXCEEDED");
    }
}
