export function detached<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

export function detachedValues<T>(values: Iterable<T>): T[] {
  return Array.from(values, (value) => detached(value));
}
