import { z } from "zod";
import { DomainError } from "../domain/errors";

export type SchemaNamespace = "attributes" | "metadata" | "event" | "scheduler" | "integration";

export interface SchemaRegistration<T = unknown> {
  namespace: SchemaNamespace;
  schemaId: string;
  version: number;
  schema: z.ZodType<T>;
}

export class SchemaRegistry {
  private readonly schemas = new Map<string, z.ZodType<unknown>>();

  register<T>(registration: SchemaRegistration<T>): void {
    assertSchemaIdentity(registration.schemaId, registration.version);
    const key = schemaKey(registration.namespace, registration.schemaId, registration.version);
    if (this.schemas.has(key)) {
      throw new DomainError(`Схема уже зарегистрирована: ${key}`, "SCHEMA_ALREADY_REGISTERED");
    }
    this.schemas.set(key, registration.schema as z.ZodType<unknown>);
  }

  validate<T>(namespace: SchemaNamespace, schemaId: string, version: number, value: unknown): T {
    const key = schemaKey(namespace, schemaId, version);
    const schema = this.schemas.get(key);
    if (!schema) throw new DomainError(`Схема не зарегистрирована: ${key}`, "SCHEMA_NOT_REGISTERED");
    assertPayloadLimits(value);
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new DomainError(`Данные не соответствуют схеме ${key}: ${z.prettifyError(result.error)}`, "SCHEMA_VALIDATION_FAILED");
    }
    return result.data as T;
  }

  has(namespace: SchemaNamespace, schemaId: string, version: number): boolean {
    return this.schemas.has(schemaKey(namespace, schemaId, version));
  }
}

const schemaKey = (namespace: SchemaNamespace, schemaId: string, version: number): string =>
  `${namespace}:${schemaId}:v${version}`;

function assertSchemaIdentity(schemaId: string, version: number): void {
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(schemaId)) {
    throw new DomainError("Некорректный идентификатор схемы", "SCHEMA_ID_INVALID");
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new DomainError("Версия схемы должна быть положительным целым числом", "SCHEMA_VERSION_INVALID");
  }
}

function assertPayloadLimits(value: unknown): void {
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000 || depth > 32) {
      throw new DomainError("Структура данных превышает допустимую сложность", "SCHEMA_PAYLOAD_LIMIT_EXCEEDED");
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (candidate && typeof candidate === "object") {
      for (const item of Object.values(candidate as Record<string, unknown>)) visit(item, depth + 1);
    }
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (serialized && Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
    throw new DomainError("Размер данных превышает 256 КБ", "SCHEMA_PAYLOAD_LIMIT_EXCEEDED");
  }
}
