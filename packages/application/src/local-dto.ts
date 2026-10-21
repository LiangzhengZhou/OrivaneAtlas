import { type LocalJson, LocalStorageError } from "./local-persistence";

/** Encode one typed DTO. Optional object fields are omitted; binary is forbidden. */
export function localDto(value: unknown): LocalJson {
  const ancestors = new Set<object>();
  let remaining = 100_000;
  const encode = (entry: unknown, depth: number): LocalJson => {
    const invalid = () => {
      throw new LocalStorageError("INVALID_WRITE");
    };
    if (--remaining < 0 || depth > 128) return invalid();
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    )
      return entry;
    if (typeof entry === "number")
      return Number.isFinite(entry) ? entry : invalid();
    if (typeof entry !== "object" || ancestors.has(entry)) return invalid();
    if (
      !Array.isArray(entry) &&
      Object.getPrototypeOf(entry) !== Object.prototype &&
      Object.getPrototypeOf(entry) !== null
    )
      return invalid();
    ancestors.add(entry);
    const result: LocalJson[] | Record<string, LocalJson> = Array.isArray(entry)
      ? []
      : Object.create(null);
    const keys = Reflect.ownKeys(entry);
    if (Array.isArray(entry)) {
      if (entry.length > remaining || keys.length !== entry.length + 1)
        return invalid();
      for (let index = 0; index < entry.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
          entry,
          String(index),
        );
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          return invalid();
        (result as LocalJson[]).push(encode(descriptor.value, depth + 1));
      }
    } else {
      for (const key of keys) {
        if (typeof key !== "string") return invalid();
        const descriptor = Object.getOwnPropertyDescriptor(entry, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          return invalid();
        if (descriptor.value !== undefined)
          (result as Record<string, LocalJson>)[key] = encode(
            descriptor.value,
            depth + 1,
          );
      }
    }
    ancestors.delete(entry);
    return result;
  };
  return encode(value, 0);
}

export function localObject(value: LocalJson): Record<string, LocalJson> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("LOCAL_DATA_CORRUPT");
  return value as Record<string, LocalJson>;
}
