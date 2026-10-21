import { DomainError } from "@arclattice/domain";
import type { LibraryEntry, LibraryStore } from "./library";
import type { Note, NotebookStore } from "./notebook";

export interface KnowledgeReplayEffect {
  readonly collection: "notes" | "library";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}

export interface CanonicalKnowledgeReplayEffect {
  readonly collection: KnowledgeReplayEffect["collection"];
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: Note | LibraryEntry;
}

/** Must run inside the caller's authenticated business/receipt transaction.
 * Purge and binary writes require separate complete-effect contracts. */
export class KnowledgeReplayEffects {
  private readonly effects: readonly KnowledgeReplayEffect[];
  private canonical: readonly CanonicalKnowledgeReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalKnowledgeReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly workspaceId: string,
    effects: readonly KnowledgeReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !workspaceId ||
      !this.effects.length ||
      this.effects.length > 2000 ||
      this.effects.some(
        (effect) =>
          !["notes", "library"].includes(effect.collection) ||
          effect.op !== "UPSERT" ||
          !effect.id ||
          effect.id.length > 240 ||
          !Number.isSafeInteger(effect.baseVersion) ||
          effect.baseVersion < 0,
      )
    )
      throw new DomainError("VALIDATION_ERROR", { field: "effects" });
  }

  async run<T>(
    notes: NotebookStore,
    library: LibraryStore,
    operation: (notes: NotebookStore, library: LibraryStore) => Promise<T>,
  ): Promise<T> {
    this.canonical = [];
    const groups = new Map<string, KnowledgeReplayEffect[]>();
    for (const effect of this.effects) {
      const key = JSON.stringify([effect.collection, effect.id]);
      const group = groups.get(key);
      if (group) {
        group.push(effect);
        continue;
      }
      let version = 0;
      try {
        const value = await (effect.collection === "notes"
          ? notes
          : library
        ).get(effect.id);
        if (value.workspaceId !== this.workspaceId)
          throw new DomainError("FORBIDDEN");
        version = value.version;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
          throw error;
      }
      if (version !== effect.baseVersion)
        throw new DomainError("VERSION_CONFLICT");
      groups.set(key, [effect]);
    }
    let consumed = 0;
    const guard = <S extends NotebookStore | LibraryStore>(
      store: S,
      collection: KnowledgeReplayEffect["collection"],
    ): S =>
      new Proxy(store, {
        get: (target, property) => {
          if (property === "save")
            return async (value: Note | LibraryEntry, expected: number) => {
              const effect = groups
                .get(JSON.stringify([collection, value.id]))
                ?.shift();
              if (
                !effect ||
                effect.baseVersion !== expected ||
                value.version !== expected + 1 ||
                value.workspaceId !== this.workspaceId
              )
                throw new DomainError("VERSION_CONFLICT");
              consumed++;
              if (collection === "notes")
                await notes.save(value as Note, expected);
              else await library.save(value as LibraryEntry, expected);
            };
          if (
            ["purge", "putAsset", "putAssetChunk", "rebuildWikiIndex"].includes(
              String(property),
            )
          )
            return () => {
              throw new DomainError("VALIDATION_ERROR", {
                field: "replayCommand",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const result = await operation(
      guard(notes, "notes"),
      guard(library, "library"),
    );
    if (consumed !== this.effects.length)
      throw new DomainError("VERSION_CONFLICT");
    const final = new Map(
      this.effects.map((effect) => [
        JSON.stringify([effect.collection, effect.id]),
        effect,
      ]),
    );
    const canonical: CanonicalKnowledgeReplayEffect[] = [];
    for (const effect of final.values()) {
      const value = await (effect.collection === "notes" ? notes : library).get(
        effect.id,
      );
      if (
        value.workspaceId !== this.workspaceId ||
        value.version !== effect.baseVersion + 1
      )
        throw new DomainError("VERSION_CONFLICT");
      canonical.push({
        collection: effect.collection,
        id: effect.id,
        op: effect.op,
        version: value.version,
        value,
      });
    }
    this.canonical = structuredClone(canonical);
    return result;
  }
}
