import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface LibraryEntry {
  id: string;
  workspaceId: string;
  kind: "SPACE" | "DOCUMENT";
  spaceId: string | null;
  title: string;
  bodyMd: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  deletedAt: string | null;
  provenance: "HUMAN" | "EXTERNAL_AI";
}
export interface LibraryInput {
  kind: LibraryEntry["kind"];
  spaceId: string | null;
  title: string;
  bodyMd: string;
}
export interface LibraryAsset {
  id: string;
  spaceId: string | null;
  name: string;
  mime: string;
  base64: string;
  chunkCount?: number;
}
export interface LibraryStore {
  list(): Promise<LibraryEntry[]>;
  get(id: string): Promise<LibraryEntry>;
  save(entry: LibraryEntry, expected: number): Promise<void>;
  revisions(id: string): Promise<LibraryEntry[]>;
  putAsset(asset: LibraryAsset): Promise<void>;
  putAssetChunk(
    asset: LibraryAsset,
    index: number,
    final: boolean,
  ): Promise<void>;
  assetChunk(id: string, index: number): Promise<string>;
  asset(id: string): Promise<LibraryAsset>;
}
export class LibraryService {
  constructor(
    private readonly store: LibraryStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly source: LibraryEntry["provenance"] = "HUMAN",
  ) {}
  async save(
    context: ActorContext,
    id: string | null,
    version: number,
    input: LibraryInput,
  ) {
    await this.authorization.require(
      context,
      id ? "work:update" : "work:create",
    );
    if (
      !["SPACE", "DOCUMENT"].includes(input.kind) ||
      typeof input.bodyMd !== "string" ||
      input.bodyMd.length > 200000
    )
      throw new DomainError("VALIDATION_ERROR");
    const old = id ? await this.store.get(id) : null;
    if (old?.deletedAt) throw new DomainError("NOT_FOUND");
    if (old && (old.kind !== input.kind || old.spaceId !== input.spaceId))
      throw new DomainError("VALIDATION_ERROR");
    if (input.kind === "SPACE") {
      if (input.spaceId !== null) throw new DomainError("VALIDATION_ERROR");
    } else {
      if (!input.spaceId) throw new DomainError("VALIDATION_ERROR");
      const space = await this.store.get(input.spaceId);
      if (space.kind !== "SPACE" || space.deletedAt)
        throw new DomainError("NOT_FOUND");
    }
    const now = this.clock.now();
    const entry: LibraryEntry = {
      ...input,
      title: requireTitle(input.title),
      id: old?.id ?? this.ids.next(),
      workspaceId: context.workspaceId,
      version: (old?.version ?? 0) + 1,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      createdBy: old?.createdBy ?? context.principalId,
      updatedBy: context.principalId,
      deletedAt: null,
      provenance: this.source,
    };
    await this.store.save(entry, version);
    return entry;
  }
  async setDeleted(
    context: ActorContext,
    id: string,
    version: number,
    deleted: boolean,
  ) {
    await this.authorization.require(
      context,
      deleted ? "work:delete" : "work:update",
    );
    const old = await this.store.get(id);
    if (!deleted && old.spaceId) {
      const space = await this.store.get(old.spaceId);
      if (space.deletedAt) throw new DomainError("NOT_FOUND");
    }
    const entry = {
      ...old,
      version: old.version + 1,
      updatedAt: this.clock.now(),
      updatedBy: context.principalId,
      deletedAt: deleted ? this.clock.now() : null,
    };
    await this.store.save(entry, version);
    return entry;
  }
}
