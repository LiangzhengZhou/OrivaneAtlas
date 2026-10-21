import { DomainError } from "@arclattice/domain";
import type { ConnectedStore } from "./connected";
import {
  type CanonicalKnowledgeReplayEffect,
  type KnowledgeReplayEffect,
  KnowledgeReplayEffects,
} from "./knowledge-replay-effects";
import type { LibraryStore } from "./library";
import {
  type CanonicalLinkedKnowledgeReplayEffect,
  type LinkedKnowledgeReplayEffect,
  LinkedKnowledgeReplayStore,
} from "./linked-knowledge-replay-effects";
import type { NotebookStore } from "./notebook";

export type NoteKnowledgeReplayEffect =
  | KnowledgeReplayEffect
  | LinkedKnowledgeReplayEffect;
/** Caller owns the business/receipt transaction across all three stores. */
export class NoteKnowledgeReplayEffects {
  private canonical: readonly (
    | CanonicalKnowledgeReplayEffect
    | CanonicalLinkedKnowledgeReplayEffect
  )[] = [];
  private readonly links: LinkedKnowledgeReplayStore;
  private readonly knowledge: KnowledgeReplayEffects | null;
  get acceptedEffects() {
    return structuredClone(this.canonical);
  }
  constructor(
    workspaceId: string,
    principalId: string,
    effects: readonly NoteKnowledgeReplayEffect[],
  ) {
    const detached = structuredClone(effects);
    if (
      !detached.length ||
      detached.length > 3 ||
      detached.some(
        (effect) => !["notes", "library", "links"].includes(effect.collection),
      )
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "noteKnowledgeEffects",
      });
    this.links = new LinkedKnowledgeReplayStore(
      workspaceId,
      principalId,
      detached.filter(
        (e): e is LinkedKnowledgeReplayEffect => e.collection === "links",
      ),
    );
    const bodies = detached.filter(
      (e): e is KnowledgeReplayEffect => e.collection !== "links",
    );
    this.knowledge = bodies.length
      ? new KnowledgeReplayEffects(workspaceId, bodies)
      : null;
  }
  async run<T>(
    notes: NotebookStore,
    library: LibraryStore,
    connected: ConnectedStore,
    operation: (
      notes: NotebookStore,
      library: LibraryStore,
      connected: ConnectedStore,
    ) => Promise<T>,
  ) {
    this.canonical = [];
    const readOnly = <S extends NotebookStore | LibraryStore>(store: S): S =>
      new Proxy(store, {
        get(target, property) {
          if (
            [
              "save",
              "purge",
              "putAsset",
              "putAssetChunk",
              "rebuildWikiIndex",
            ].includes(String(property))
          )
            return () => {
              throw new DomainError("VERSION_CONFLICT", {
                field: "undeclaredNoteKnowledgeEffect",
              });
            };
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const result = await this.links.run(connected, (guarded) =>
      this.knowledge
        ? this.knowledge.run(notes, library, (n, l) => operation(n, l, guarded))
        : operation(readOnly(notes), readOnly(library), guarded),
    );
    this.canonical = [
      ...this.links.acceptedEffects,
      ...(this.knowledge?.acceptedEffects ?? []),
    ];
    return result;
  }
}
