import { equalLocalJson, type LocalJson } from "@arclattice/application";
import type { Snapshot } from "../bootstrap";

export function stableWorkspaceSnapshot(previous: Snapshot, next: Snapshot) {
  let result = next;
  for (const key of ["items", "edges", "organization"] as const) {
    if (
      Object.hasOwn(previous, key) &&
      Object.hasOwn(next, key) &&
      previous[key] !== next[key] &&
      equalLocalJson(
        previous[key] as unknown as LocalJson,
        next[key] as unknown as LocalJson,
      )
    ) {
      if (result === next) result = { ...next };
      Object.assign(result, { [key]: previous[key] });
    }
  }
  return result;
}
