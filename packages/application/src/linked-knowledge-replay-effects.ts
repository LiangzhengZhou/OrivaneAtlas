import { DomainError } from "@arclattice/domain";
import type { ConnectedStore, EntityRef, KnowledgeLink } from "./connected";

export interface LinkedKnowledgeReplayEffect {
  readonly collection: "links";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalLinkedKnowledgeReplayEffect {
  readonly collection: "links";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: KnowledgeLink;
}
function reference(input: unknown): input is EntityRef {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as EntityRef;
  return (
    ["NOTE", "WORK", "SPACE", "DOCUMENT", "FILE"].includes(value.kind) &&
    typeof value.id === "string" &&
    !!value.id &&
    value.id.length <= 240
  );
}
export function requireCanonicalKnowledgeLink(
  input: unknown,
  id: string,
  workspaceId: string,
  version: number,
): KnowledgeLink {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("VALIDATION_ERROR");
  const value = input as KnowledgeLink;
  if (
    value.id !== id ||
    value.workspaceId !== workspaceId ||
    value.version !== version ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !reference(value.from) ||
    !reference(value.to) ||
    (value.from.kind === value.to.kind && value.from.id === value.to.id) ||
    !["REFERENCES", "RELATED"].includes(value.relation) ||
    typeof value.createdBy !== "string" ||
    !value.createdBy ||
    typeof value.updatedBy !== "string" ||
    !value.updatedBy ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.deletedAt !== null &&
      (typeof value.deletedAt !== "string" ||
        !Number.isFinite(Date.parse(value.deletedAt))))
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "canonicalKnowledgeLink",
    });
  return structuredClone(value);
}
/** Narrow ConnectedStore guard; the caller owns the enclosing business/receipt transaction. */
export class LinkedKnowledgeReplayStore {
  private readonly effects: readonly LinkedKnowledgeReplayEffect[];
  private canonical: readonly CanonicalLinkedKnowledgeReplayEffect[] = [];
  get acceptedEffects(): readonly CanonicalLinkedKnowledgeReplayEffect[] {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly LinkedKnowledgeReplayEffect[],
  ) {
    this.effects = structuredClone(effects);
    if (
      !workspaceId ||
      !principalId ||
      !effects.length ||
      effects.length > 2000 ||
      new Set(effects.map((effect) => effect.id)).size !== effects.length ||
      effects.some(
        (effect) =>
          effect.collection !== "links" ||
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
    store: ConnectedStore,
    operation: (guarded: ConnectedStore) => Promise<T>,
  ): Promise<T> {
    this.canonical = [];
    const before = new Map(
      (await store.links()).map((link) => [link.id, link]),
    );
    for (const effect of this.effects) {
      const old = before.get(effect.id);
      if (
        (old?.version ?? 0) !== effect.baseVersion ||
        (old && old.workspaceId !== this.workspaceId)
      )
        throw new DomainError("VERSION_CONFLICT");
    }
    const pending = new Map(this.effects.map((effect) => [effect.id, effect]));
    const guarded: ConnectedStore = {
      links: store.links.bind(store),
      exists: store.exists.bind(store),
      saveLink: async (link, version) => {
        const effect = pending.get(link.id);
        if (
          !effect ||
          effect.baseVersion !== version ||
          link.updatedBy !== this.principalId ||
          (version === 0 && link.createdBy !== this.principalId)
        )
          throw new DomainError("VERSION_CONFLICT");
        requireCanonicalKnowledgeLink(
          link,
          effect.id,
          this.workspaceId,
          version + 1,
        );
        await store.saveLink(link, version);
        pending.delete(effect.id);
      },
      runs: async () => {
        throw new DomainError("FORBIDDEN");
      },
      getRun: async () => {
        throw new DomainError("FORBIDDEN");
      },
      saveRun: async () => {
        throw new DomainError("FORBIDDEN");
      },
    };
    const result = await operation(guarded);
    if (pending.size) throw new DomainError("VERSION_CONFLICT");
    const after = new Map((await store.links()).map((link) => [link.id, link]));
    this.canonical = this.effects.map((effect) => ({
      collection: "links",
      id: effect.id,
      op: "UPSERT",
      version: effect.baseVersion + 1,
      value: requireCanonicalKnowledgeLink(
        after.get(effect.id),
        effect.id,
        this.workspaceId,
        effect.baseVersion + 1,
      ),
    }));
    return result;
  }
}
