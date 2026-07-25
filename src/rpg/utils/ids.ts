import { randomUUID } from "crypto";

export const createId = (prefix: string): string => `${prefix}_${randomUUID()}`;
