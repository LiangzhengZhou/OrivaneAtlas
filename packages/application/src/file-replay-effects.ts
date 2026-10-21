import { DomainError, type LibraryFile } from "@arclattice/domain";
import type { LibraryFileStore } from "./files";
import { requireOriginalFileIdentity } from "./files";
import { requireCanonicalFile } from "./local-canonical-file";
import { requireStableUuid } from "./mutation-receipt";

export interface FileReplayEffect {
  readonly collection: "files";
  readonly id: string;
  readonly op: "UPSERT";
  readonly baseVersion: number;
}
export interface CanonicalFileReplayEffect {
  readonly collection: "files";
  readonly id: string;
  readonly op: "UPSERT";
  readonly version: number;
  readonly value: LibraryFile;
}
/** The caller owns the authenticated business/Activity/Outbox/receipt transaction. */
export class FileReplayEffects {
  private readonly effect: FileReplayEffect;
  private canonical: readonly CanonicalFileReplayEffect[] = [];
  get acceptedEffects() {
    return structuredClone(this.canonical);
  }
  constructor(
    private readonly workspaceId: string,
    private readonly principalId: string,
    effects: readonly FileReplayEffect[],
  ) {
    const e = effects[0];
    if (
      !workspaceId ||
      !principalId ||
      effects.length !== 1 ||
      !e ||
      e.collection !== "files" ||
      e.op !== "UPSERT" ||
      !e.id ||
      e.id.length > 240 ||
      !Number.isSafeInteger(e.baseVersion) ||
      e.baseVersion < 0
    )
      throw new DomainError("VALIDATION_ERROR", { field: "fileEffects" });
    if (!e.baseVersion) requireStableUuid(e.id, "effect.id");
    this.effect = structuredClone(e);
  }
  async run<T>(
    store: LibraryFileStore,
    operation: (store: LibraryFileStore) => Promise<T>,
  ): Promise<T> {
    this.canonical = [];
    let old: LibraryFile | null = null;
    try {
      old = await store.get(this.effect.id);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
        throw error;
    }
    if (old && old.workspaceId !== this.workspaceId)
      throw new DomainError("FORBIDDEN");
    if ((old?.version ?? 0) !== this.effect.baseVersion)
      throw new DomainError("VERSION_CONFLICT");
    let consumed = false;
    const guarded: LibraryFileStore = {
      list: () => store.list(),
      get: (id) => store.get(id),
      save: async (value, base) => {
        if (
          consumed ||
          base !== this.effect.baseVersion ||
          value.id !== this.effect.id
        )
          throw new DomainError("VERSION_CONFLICT");
        const canonical = requireCanonicalFile(
          value,
          this.effect.id,
          this.workspaceId,
          base + 1,
        );
        if (
          canonical.updatedBy !== this.principalId ||
          (!base && canonical.createdBy !== this.principalId)
        )
          throw new DomainError("FORBIDDEN");
        if (old) requireOriginalFileIdentity(old, canonical);
        await store.save(canonical, base);
        consumed = true;
      },
    };
    const result = await operation(guarded);
    if (!consumed) throw new DomainError("VERSION_CONFLICT");
    const value = requireCanonicalFile(
      await store.get(this.effect.id),
      this.effect.id,
      this.workspaceId,
      this.effect.baseVersion + 1,
    );
    if (value.updatedBy !== this.principalId)
      throw new DomainError("FORBIDDEN");
    this.canonical = [
      {
        collection: "files",
        id: value.id,
        op: "UPSERT",
        version: value.version,
        value,
      },
    ];
    return result;
  }
}
