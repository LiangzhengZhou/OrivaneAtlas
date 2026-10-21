import type { LocalEntity } from "./contracts";

export function encodeMetadataRows(rows: readonly (LocalEntity | null)[]) {
  let negativeZero = false;
  const json = JSON.stringify(rows, (_key, value: unknown) => {
    if (typeof value === "number" && Object.is(value, -0)) negativeZero = true;
    return value;
  });
  return negativeZero ? { rows } : { json };
}
