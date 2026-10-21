import type { LocalJson } from "./contracts";

/** Metadata is JSON data, not a structured-clone container for binary objects. */
export function isLocalJson(value: unknown): value is LocalJson {
  const ancestors = new Set<object>();
  let remaining = 100000;
  const visit = (entry: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 128) return false;
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    )
      return true;
    if (typeof entry === "number") return Number.isFinite(entry);
    if (typeof entry !== "object" || ancestors.has(entry)) return false;
    if (
      !Array.isArray(entry) &&
      Object.getPrototypeOf(entry) !== Object.prototype &&
      Object.getPrototypeOf(entry) !== null
    )
      return false;
    const keys = Reflect.ownKeys(entry);
    if (keys.length > remaining) return false;
    if (Array.isArray(entry)) {
      if (entry.length > remaining) return false;
      for (let index = 0; index < entry.length; index++)
        if (!Object.hasOwn(entry, String(index))) return false;
      if (
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" ||
              !/^(0|[1-9]\d*)$/.test(key) ||
              Number(key) >= entry.length),
        )
      )
        return false;
    }
    ancestors.add(entry);
    const valid = keys.every((key) => {
      if (Array.isArray(entry) && key === "length") return true;
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      return (
        !!descriptor &&
        descriptor.enumerable &&
        "value" in descriptor &&
        visit(descriptor.value, depth + 1)
      );
    });
    ancestors.delete(entry);
    return valid;
  };
  return visit(value, 0);
}
