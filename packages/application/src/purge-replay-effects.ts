import { DomainError } from "@arclattice/domain";
import { equalLocalJson } from "./local-json-equal";
import type { LocalJson } from "./local-persistence";

export const purgeCollections = [
  "items",
  "edges",
  "notes",
  "library",
  "links",
  "organization",
  "projectMaterials",
  "workflows",
  "entityMemos",
] as const;
export interface PurgeReplayEffect {
  collection: (typeof purgeCollections)[number];
  id: string;
  op: "UPSERT" | "DELETE";
  baseVersion: number;
}
export interface PurgeSnapshotRow {
  collection: PurgeReplayEffect["collection"];
  id: string;
  version: number;
  value: LocalJson;
}
const key = (row: { collection: string; id: string }) =>
  JSON.stringify([row.collection, row.id]);
function conflict(): never {
  throw new DomainError("VERSION_CONFLICT", { field: "purgeEffects" });
}

/** Caller must keep snapshots, ordinary services and receipt in one transaction. */
export class PurgeReplayEffects {
  private canonical: {
    collection: PurgeReplayEffect["collection"];
    id: string;
    op: "UPSERT" | "DELETE";
    version: number;
    value: LocalJson;
  }[] = [];
  private effects: readonly PurgeReplayEffect[];
  get acceptedEffects() {
    return structuredClone(this.canonical);
  }
  constructor(
    effects: readonly PurgeReplayEffect[],
    target: {
      collection: "items" | "notes" | "library";
      id: string;
      version: number;
    },
  ) {
    if (
      !effects.length ||
      effects.length > 2000 ||
      new Set(effects.map(key)).size !== effects.length ||
      effects.some(
        (e) =>
          !purgeCollections.includes(e.collection) ||
          !e.id ||
          e.id.length > 240 ||
          !Number.isSafeInteger(e.baseVersion) ||
          e.baseVersion < 1 ||
          e.baseVersion >= Number.MAX_SAFE_INTEGER ||
          (e.op !== "DELETE" &&
            !(e.collection === "workflows" && e.op === "UPSERT")),
      )
    )
      throw new DomainError("VALIDATION_ERROR", { field: "purgeEffects" });
    if (
      !effects.some(
        (e) =>
          e.collection === target.collection &&
          e.id === target.id &&
          e.baseVersion === target.version &&
          e.op === "DELETE",
      )
    )
      conflict();
    this.effects = structuredClone(effects);
  }
  async run<T>(
    snapshot: () => Promise<readonly PurgeSnapshotRow[]>,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.canonical = [];
    const before = new Map((await snapshot()).map((row) => [key(row), row]));
    for (const effect of this.effects)
      if (before.get(key(effect))?.version !== effect.baseVersion) conflict();
    const result = await operation();
    const after = new Map((await snapshot()).map((row) => [key(row), row]));
    const changed = new Set(
      [...new Set([...before.keys(), ...after.keys()])].filter((id) => {
        const a = before.get(id),
          b = after.get(id);
        return !a || !b || !equalLocalJson(a.value, b.value);
      }),
    );
    if (changed.size !== this.effects.length) conflict();
    for (const effect of this.effects) {
      const id = key(effect),
        row = after.get(id);
      if (
        !changed.has(id) ||
        (effect.op === "DELETE"
          ? !!row
          : !row || row.version !== effect.baseVersion + 1)
      )
        conflict();
      this.canonical.push({
        collection: effect.collection,
        id: effect.id,
        op: effect.op,
        version: effect.baseVersion + 1,
        value: row?.value ?? null,
      });
    }
    return result;
  }
}
