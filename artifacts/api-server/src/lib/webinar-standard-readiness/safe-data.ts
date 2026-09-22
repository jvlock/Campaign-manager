/** Data-only boundary: never read an accessor or retain caller-owned containers. */
export function snapshotData(input: unknown): { ok: true; value: unknown } | { ok: false } {
  const ancestors = new Set<object>();
  let remaining = 100_000;
  function copy(value: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 64) throw new Error("Input exceeds data limits.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || ancestors.has(value)) throw new Error("Expected acyclic data.");
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new Error("Expected plain data.");
    }
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) throw new Error("Symbol properties are not data.");
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    if (array) {
      const length: unknown = descriptors.length?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > remaining
        || keys.length !== length + 1) throw new Error("Expected a dense bounded array.");
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Expected array data.");
        (result as unknown[]).push(copy(descriptor.value, depth + 1));
      }
    } else {
      for (const key of (keys as string[]).sort()) {
        const descriptor = descriptors[key]!;
        if (!Object.hasOwn(descriptor, "value")) throw new Error("Accessors are not data.");
        Object.defineProperty(result, key, {
          value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true,
        });
      }
    }
    ancestors.delete(value);
    return result;
  }
  try {
    return { ok: true, value: copy(input, 0) };
  } catch {
    return { ok: false };
  }
}

/** Only call on fresh owned snapshots, never on public caller objects. */
export function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeOwned);
    Object.freeze(value);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}