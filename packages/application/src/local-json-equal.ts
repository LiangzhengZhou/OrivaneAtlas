import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
export function equalLocalJson(a: LocalJson, b: LocalJson): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let index = 0; index < a.length; index++)
      if (!equalLocalJson(a[index]!, b[index]!)) return false;
    return true;
  }
  const left = localObject(a),
    right = localObject(b);
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const field of keys)
    if (
      right[field] === undefined ||
      !equalLocalJson(left[field]!, right[field]!)
    )
      return false;
  return true;
}
