import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface LibraryEntry {
  parentDocumentId?: string | null;
  aliases?: string[];
  aiPolicy?: ContentPolicy;
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
  parentDocumentId?: string | null;
  aliases?: string[];
  aiPolicy?: ContentPolicy;
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
  rebuildWikiIndex?(): Promise<void>;
  wikiLinks?(): Promise<DocumentWikiLink[]>;
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
export interface DocumentWikiLink {
  sourceDocumentId: string;
  targetDocumentId: string | null;
  targetText: string;
  alias: string | null;
  heading: string | null;
}
export class LibraryService {
  constructor(
    private readonly store: LibraryStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly source: LibraryEntry["provenance"] = "HUMAN",
  ) {}
  async rebuildWikiIndex(context: ActorContext) {
    await this.authorization.require(context, "work:update");
    if (!this.store.rebuildWikiIndex) throw new DomainError("FORBIDDEN");
    await this.store.rebuildWikiIndex();
  }
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
    if (old && old.workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    if (old && (old.kind !== input.kind || old.spaceId !== input.spaceId))
      throw new DomainError("VALIDATION_ERROR");
    if (input.kind === "SPACE") {
      if (input.spaceId !== null) throw new DomainError("VALIDATION_ERROR");
    } else {
      if (!input.spaceId) throw new DomainError("VALIDATION_ERROR");
      const space = await this.store.get(input.spaceId);
      if (
        space.workspaceId !== context.workspaceId ||
        space.kind !== "SPACE" ||
        space.deletedAt
      )
        throw new DomainError("NOT_FOUND");
    }
    const parentDocumentId =
      input.parentDocumentId === undefined
        ? (old?.parentDocumentId ?? null)
        : input.parentDocumentId;
    const entries = (await this.store.list()).filter(
      (entry) => entry.workspaceId === context.workspaceId,
    );
    if (input.kind === "SPACE" && parentDocumentId)
      throw new DomainError("VALIDATION_ERROR");
    if (parentDocumentId) {
      const visited = new Set<string>(id ? [id] : []);
      let cursor: string | null = parentDocumentId;
      while (cursor) {
        if (visited.has(cursor)) throw new DomainError("VALIDATION_ERROR");
        visited.add(cursor);
        const parent = entries.find((entry) => entry.id === cursor);
        if (
          !parent ||
          parent.deletedAt ||
          parent.kind !== "DOCUMENT" ||
          parent.spaceId !== input.spaceId
        )
          throw new DomainError("VALIDATION_ERROR");
        cursor = parent.parentDocumentId ?? null;
      }
    }
    const normalize = (value: string) =>
      value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const rawAliases = input.aliases ?? old?.aliases ?? [];
    if (
      !Array.isArray(rawAliases) ||
      rawAliases.length > 100 ||
      rawAliases.some(
        (alias) =>
          typeof alias !== "string" || !alias.trim() || alias.length > 240,
      )
    )
      throw new DomainError("VALIDATION_ERROR");
    const aliases = [
      ...new Map(
        [
          ...rawAliases,
          ...(old && old.title !== input.title && old.kind === "DOCUMENT"
            ? [old.title]
            : []),
        ].map((alias) => [normalize(alias), alias.trim()]),
      ).values(),
    ];
    if (aliases.length > 100 || (input.kind === "SPACE" && aliases.length))
      throw new DomainError("VALIDATION_ERROR");
    if (
      (input.kind === "DOCUMENT" &&
        entries.some(
          (entry) =>
            entry.id !== id &&
            entry.kind === "DOCUMENT" &&
            (entry.aliases ?? []).some(
              (alias) => normalize(alias) === normalize(input.title),
            ),
        )) ||
      aliases.some((alias) =>
        entries.some(
          (entry) =>
            entry.id !== id &&
            entry.kind === "DOCUMENT" &&
            (normalize(entry.title) === normalize(alias) ||
              (entry.aliases ?? []).some(
                (existing) => normalize(existing) === normalize(alias),
              )),
        ),
      )
    )
      throw new DomainError("VALIDATION_ERROR");
    const now = this.clock.now();
    const entry: LibraryEntry = {
      ...input,
      parentDocumentId,
      aliases,
      aiPolicy: contentPolicy(
        this.source === "HUMAN" ? input.aiPolicy : undefined,
        old?.aiPolicy,
      ),
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
    if (old.workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    if (
      deleted &&
      (await this.store.list()).some(
        (entry) =>
          entry.workspaceId === context.workspaceId &&
          !entry.deletedAt &&
          entry.parentDocumentId === id,
      )
    )
      throw new DomainError("VALIDATION_ERROR");
    if (!deleted && old.parentDocumentId) {
      const parent = await this.store.get(old.parentDocumentId);
      if (
        parent.workspaceId !== context.workspaceId ||
        parent.deletedAt ||
        parent.spaceId !== old.spaceId ||
        parent.kind !== "DOCUMENT"
      )
        throw new DomainError("VALIDATION_ERROR");
    }
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
