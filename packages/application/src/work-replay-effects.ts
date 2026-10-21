import { DomainError, type WorkEdge, type WorkItem } from "@arclattice/domain";
import type { UnitOfWork, WorkTransaction } from "./index";

export interface WorkReplayEffect {
  readonly collection: "items" | "edges";
  readonly id: string;
  readonly op: "UPSERT" | "DELETE";
  readonly baseVersion: number;
}

export interface CanonicalWorkReplayEffect {
  readonly collection: WorkReplayEffect["collection"];
  readonly id: string;
  readonly op: WorkReplayEffect["op"];
  readonly version: number;
  readonly value: WorkItem | WorkEdge | null;
}

/** Effect guard around ordinary Application execution, not a direct mutation API. */
export class WorkReplayUnitOfWork implements UnitOfWork {
  private readonly effects: readonly WorkReplayEffect[];
  private canonical: readonly CanonicalWorkReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalWorkReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly delegate: UnitOfWork,
    private readonly workspaceId: string,
    effects: readonly WorkReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !effects.length ||
      effects.length > 2000 ||
      this.effects.some(
        (effect) =>
          !effect.id ||
          effect.id.length > 240 ||
          !["items", "edges"].includes(effect.collection) ||
          !["UPSERT", "DELETE"].includes(effect.op) ||
          !Number.isSafeInteger(effect.baseVersion) ||
          effect.baseVersion < 0 ||
          (effect.collection === "edges" && effect.baseVersion > 1),
      )
    )
      throw new DomainError("VALIDATION_ERROR", { field: "effects" });
  }

  async run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    if (workspaceId !== this.workspaceId) throw new DomainError("FORBIDDEN");
    this.canonical = [];
    const outcome = await this.delegate.run(workspaceId, async (tx) => {
      const work = new Map(
        (await tx.list(true)).map((item) => [item.id, item]),
      );
      const edges = new Map((await tx.edges()).map((edge) => [edge.id, edge]));
      const groups = new Map<string, WorkReplayEffect[]>();
      for (const effect of this.effects) {
        const key = JSON.stringify([effect.collection, effect.id]);
        const group = groups.get(key);
        if (group) group.push(effect);
        else {
          const version =
            effect.collection === "items"
              ? (work.get(effect.id)?.version ?? 0)
              : edges.has(effect.id)
                ? 1
                : 0;
          if (version !== effect.baseVersion)
            throw new DomainError("VERSION_CONFLICT");
          groups.set(key, [effect]);
        }
      }
      let consumed = 0;
      const consume = (
        collection: WorkReplayEffect["collection"],
        id: string,
        op: WorkReplayEffect["op"],
        baseVersion: number,
      ) => {
        const expected = groups.get(JSON.stringify([collection, id]))?.shift();
        if (
          !expected ||
          expected.op !== op ||
          expected.baseVersion !== baseVersion
        )
          throw new DomainError("VERSION_CONFLICT");
        consumed++;
      };
      const guarded = new Proxy(tx, {
        get(target, property) {
          if (property === "insert")
            return async (item: WorkItem) => {
              consume("items", item.id, "UPSERT", 0);
              await target.insert(item);
            };
          if (property === "replace")
            return async (item: WorkItem, version: number) => {
              consume("items", item.id, "UPSERT", version);
              await target.replace(item, version);
            };
          // These repositories own additional effects outside this narrow contract.
          if (
            property === "purge" ||
            property === "appendCategoryChange" ||
            (typeof property === "string" && property.startsWith("save"))
          )
            return () => {
              throw new DomainError("VALIDATION_ERROR", {
                field: "replayCommand",
              });
            };
          if (property === "addEdge")
            return async (edge: WorkEdge) => {
              consume("edges", edge.id, "UPSERT", 0);
              await target.addEdge(edge);
            };
          if (property === "removeEdge")
            return async (id: string) => {
              consume("edges", id, "DELETE", 1);
              await target.removeEdge(id);
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const result = await operation(guarded);
      if (consumed !== this.effects.length)
        throw new DomainError("VERSION_CONFLICT");
      const final = new Map(
        this.effects.map((effect) => [
          JSON.stringify([effect.collection, effect.id]),
          effect,
        ]),
      );
      const canonicalEdges = new Map(
        (await tx.edges()).map((edge) => [edge.id, edge]),
      );
      const canonical: CanonicalWorkReplayEffect[] = [];
      for (const effect of final.values()) {
        const value =
          effect.op === "DELETE"
            ? null
            : effect.collection === "items"
              ? await tx.get(effect.id)
              : canonicalEdges.get(effect.id);
        if (
          value === undefined ||
          (value !== null &&
            (value.id !== effect.id || value.workspaceId !== workspaceId))
        )
          throw new DomainError("VERSION_CONFLICT");
        const version =
          effect.op === "DELETE"
            ? effect.baseVersion + 1
            : effect.collection === "items"
              ? (value as WorkItem).version
              : 1;
        if (version !== effect.baseVersion + 1)
          throw new DomainError("VERSION_CONFLICT");
        canonical.push({
          collection: effect.collection,
          id: effect.id,
          op: effect.op,
          version,
          value,
        });
      }
      return { result, canonical };
    });
    this.canonical = outcome.canonical;
    return outcome.result;
  }
}
