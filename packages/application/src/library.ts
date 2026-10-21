import {
  type ActorContext,
  DomainError,
  optionalTitle,
  requireTitle,
} from "@arclattice/domain";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import type { AuthorizationService, Clock, IdGenerator } from "./index";
import { stableEntityIds } from "./stable-entity-ids";
import type { BodyManifest } from "./workspace-bootstrap";

/** Asset ids only, never copies Markdown or image data into a purge event. */
export function referencedLibraryAssetIds(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/\/api\/library\/asset\?id=([a-zA-Z0-9_-]+)/g)].map(
      (match) => match[1]!,
    ),
  );
}

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
export const MAX_LIBRARY_ENTRIES = 10000;
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
  ensureWikiIndex?(): Promise<boolean>;
  listMetadata?(): Promise<BodyManifest<LibraryEntry>[]>;
  getMetadata?(id: string): Promise<BodyManifest<LibraryEntry>>;
  searchIds?(query: string): Promise<string[]>;
  rebuildWikiIndex?(): Promise<void>;
  wikiLinks?(): Promise<DocumentWikiLink[]>;
  list(): Promise<LibraryEntry[]>;
  get(id: string): Promise<LibraryEntry>;
  save(entry: LibraryEntry, expected: number): Promise<void>;
  revisions(id: string): Promise<LibraryEntry[]>;
  purge(id: string, expectedVersion: number): Promise<void>;
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
    private readonly inheritedPolicy?: ContentPolicy,
  ) {}
  /** Invoke inside the authenticated business/receipt transaction for offline creation. */
  async createWithStableId(
    contextInput: ActorContext,
    id: string,
    input: LibraryInput,
  ): Promise<LibraryEntry> {
    const context = Object.freeze({ ...contextInput }),
      captured = structuredClone(input);
    await this.authorization.require(context, "work:create");
    const ids = stableEntityIds(this.ids, "LIBRARY", id);
    try {
      await this.store.get(id);
      throw new DomainError("VERSION_CONFLICT");
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
        throw error;
    }
    return new LibraryService(
      this.store,
      this.authorization,
      this.clock,
      ids,
      this.source,
      this.inheritedPolicy,
    ).save(context, null, 0, captured);
  }
  private hierarchyEntries() {
    return this.store.listMetadata
      ? this.store.listMetadata()
      : this.store.list();
  }
  async rebuildWikiIndex(context: ActorContext) {
    await this.authorization.require(context, "work:update");
    if (!this.store.rebuildWikiIndex) throw new DomainError("FORBIDDEN");
    await this.store.rebuildWikiIndex();
  }
  async read(context: ActorContext, id: string, includeDeleted = false) {
    await this.authorization.require(context, "work:read");
    const entry = await this.store.get(id);
    if (
      entry.workspaceId !== context.workspaceId ||
      (entry.deletedAt && !includeDeleted)
    )
      throw new DomainError("NOT_FOUND");
    if (entry.spaceId) {
      const space = this.store.getMetadata
        ? await this.store.getMetadata(entry.spaceId)
        : (await this.hierarchyEntries()).find(
            (value) => value.id === entry.spaceId,
          );
      if (
        !space ||
        space.id !== entry.spaceId ||
        space.kind !== "SPACE" ||
        space.workspaceId !== context.workspaceId ||
        (space.deletedAt && !includeDeleted)
      )
        throw new DomainError("NOT_FOUND");
    }
    return entry;
  }

  async revisions(context: ActorContext, id: string) {
    await this.read(context, id, true);
    return this.store.revisions(id);
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
    const entries = (await this.hierarchyEntries()).filter(
      (entry) => entry.workspaceId === context.workspaceId,
    );
    if (input.kind === "SPACE") {
      if (input.spaceId !== null) throw new DomainError("VALIDATION_ERROR");
    } else {
      if (!input.spaceId) throw new DomainError("VALIDATION_ERROR");
      const space = entries.find((entry) => entry.id === input.spaceId);
      if (
        !space ||
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
          ...(old &&
          old.title.trim() &&
          old.title !== input.title &&
          old.kind === "DOCUMENT"
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
        old?.aiPolicy ?? this.inheritedPolicy,
      ),
      title:
        input.kind === "DOCUMENT"
          ? optionalTitle(input.title)
          : requireTitle(input.title),
      id: old?.id ?? this.ids.nextFor?.("LIBRARY") ?? this.ids.next(),
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
  async moveDocument(
    context: ActorContext,
    id: string,
    version: number,
    spaceId: string,
  ) {
    await this.authorization.require(context, "work:update");
    const document = await this.store.get(id);
    const entries = await this.hierarchyEntries();
    const target = entries.find((entry) => entry.id === spaceId);
    if (
      document.workspaceId !== context.workspaceId ||
      !target ||
      target.workspaceId !== context.workspaceId ||
      document.deletedAt ||
      target.deletedAt ||
      document.kind !== "DOCUMENT" ||
      target.kind !== "SPACE"
    )
      throw new DomainError("NOT_FOUND");
    if (document.version !== version) throw new DomainError("VERSION_CONFLICT");
    if (
      entries.some((entry) => entry.parentDocumentId === id && !entry.deletedAt)
    )
      throw new DomainError("DEPENDENCY_EXISTS");
    const normalize = (value: string) =>
      value.trim().normalize("NFKC").toLocaleLowerCase();
    const names = (document.aliases ?? []).map(normalize);
    if (
      entries.some(
        (entry) =>
          entry.id !== id &&
          !entry.deletedAt &&
          entry.spaceId === spaceId &&
          ([entry.title, ...(entry.aliases ?? [])].some((name) =>
            names.includes(normalize(name)),
          ) ||
            (entry.aliases ?? []).some(
              (name) => normalize(name) === normalize(document.title),
            )),
      )
    )
      throw new DomainError("VALIDATION_ERROR");
    const moved: LibraryEntry = {
      ...document,
      spaceId,
      parentDocumentId: null,
      version: version + 1,
      updatedAt: this.clock.now(),
      updatedBy: context.principalId,
    };
    await this.store.save(moved, version);
    return moved;
  }
  async purge(
    context: ActorContext,
    id: string,
    version: number,
  ): Promise<void> {
    await this.authorization.require(context, "work:delete");
    const entry = await this.store.get(id);
    if (entry.workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    if (entry.version !== version) throw new DomainError("VERSION_CONFLICT");
    if (!entry.deletedAt) throw new DomainError("VALIDATION_ERROR");
    if (
      (await this.hierarchyEntries()).some(
        (child) =>
          child.workspaceId === context.workspaceId &&
          (child.spaceId === id || child.parentDocumentId === id),
      )
    )
      throw new DomainError("DEPENDENCY_EXISTS");
    await this.store.purge(id, version);
  }
  /** Explicit human recovery; existing hierarchy/policy validation and one caller transaction. */
  async restoreAndSave(
    context: ActorContext,
    id: string,
    version: number,
    input: LibraryInput,
  ) {
    context = Object.freeze({ ...context });
    input = structuredClone(input);
    await this.authorization.require(context, "work:update");
    if (this.source !== "HUMAN") throw new DomainError("FORBIDDEN");
    const old = await this.store.get(id);
    if (old.workspaceId !== context.workspaceId)
      throw new DomainError("NOT_FOUND");
    if (!old.deletedAt || old.kind !== "DOCUMENT")
      throw new DomainError("VERSION_CONFLICT");
    const restored = await this.setDeleted(context, id, version, false);
    return this.save(context, id, restored.version, input);
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
      (await this.hierarchyEntries()).some(
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
