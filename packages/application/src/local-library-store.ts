import { type ActorContext, DomainError } from "@arclattice/domain";
import type { Clock, IdGenerator } from "./index";
import type { DocumentWikiLink, LibraryEntry, LibraryStore } from "./library";
import { remoteBodyUnavailable } from "./local-body-availability";
import { canonicalWikiLink } from "./local-canonical-wiki-read";
import { localDto, localObject } from "./local-dto";
import { LocalMarkdownStore } from "./local-markdown-store";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { LocalJson } from "./local-persistence";
import type { WorkspaceChange } from "./workspace-change-log";

export interface LocalWikiIndexer {
  yieldRead?(): Promise<void>;
  /** Existing Wiki parser; persist source syntax once per document write. */
  extract(sourceId: string, markdown: string): DocumentWikiLink[];
  /** Existing title/alias resolver; no body hydration on clean startup. */
  resolve(
    links: DocumentWikiLink[],
    entries: readonly {
      id: string;
      title: string;
      aliases?: readonly string[];
    }[],
  ): DocumentWikiLink[];
}
export type LocalLibraryAssets = Pick<
  LibraryStore,
  "putAsset" | "putAssetChunk" | "assetChunk" | "asset"
> & { readImage(id: string): Promise<Blob> };

export class LocalLibraryStore
  extends LocalMarkdownStore<LibraryEntry>
  implements LibraryStore
{
  private async unavailableEntries(
    entries: readonly import("./workspace-bootstrap").BodyManifest<LibraryEntry>[],
  ) {
    const states = new Map(
      (await this.stage.list("$local.libraryBodyAvailability")).map((row) => [
        row.id,
        row,
      ]),
    );
    const result = new Array<boolean>(entries.length);
    const missing: number[] = [];
    for (const [index, entry] of entries.entries()) {
      const availability = states.get(entry.id);
      const state = availability && localObject(availability.value);
      if (state?.state === "MISSING" && state.entityVersion === entry.version)
        missing.push(index);
      else result[index] = false;
    }
    for (let offset = 0; offset < missing.length; offset += 32) {
      const indexes = missing.slice(offset, offset + 32);
      const validated = await this.stage.validateLibraryBodyAvailability(
        indexes.map((index) => ({
          manifest: {
            workspaceId: this.actor.workspaceId,
            collection: "library",
            id: entries[index]!.id,
            version: entries[index]!.version,
            value: entries[index] as unknown as LocalJson,
          },
          availability: states.get(entries[index]!.id) ?? null,
        })),
      );
      if (validated) {
        for (const [position, index] of indexes.entries())
          result[index] = validated[position]!;
        continue;
      }
      const bases = await this.stage.getMany(
        indexes.map((index) => ({
          collection: "$local.remoteBase",
          id: JSON.stringify(["library", entries[index]!.id]),
        })),
      );
      for (const [position, index] of indexes.entries()) {
        const entry = entries[index]!;
        result[index] = remoteBodyUnavailable(
          "library",
          {
            workspaceId: this.actor.workspaceId,
            collection: "library",
            id: entry.id,
            version: entry.version,
            value: entry as unknown as LocalJson,
          },
          states.get(entry.id) ?? null,
          bases[position] ?? null,
        );
      }
    }
    return result;
  }
  constructor(
    stage: LocalMutationTransaction,
    actor: ActorContext,
    clock: Clock,
    ids: IdGenerator,
    publish: (change: Omit<WorkspaceChange, "seq">) => void,
    private readonly indexer: LocalWikiIndexer,
    private readonly assets: LocalLibraryAssets,
    private readonly readProjection = false,
  ) {
    super(stage, actor, clock, ids, publish, "library", "library");
  }

  private metadataRead:
    | ReturnType<LocalMarkdownStore<LibraryEntry>["listMetadata"]>
    | undefined;

  override listMetadata() {
    if (!this.readProjection) return super.listMetadata();
    return (this.metadataRead ??= super.listMetadata());
  }

  override async save(entry: LibraryEntry, expectedVersion: number) {
    await super.save(entry, expectedVersion);
    await this.writeWikiSource(entry);
  }

  private async writeWikiSource(entry: LibraryEntry) {
    const old = await this.stage.get("$local.wikiSources", entry.id);
    this.stage.stageInternal(
      {
        workspaceId: this.actor.workspaceId,
        collection: "$local.wikiSources",
        id: entry.id,
        version: (old?.version ?? 0) + 1,
        value: localDto({
          parserVersion: 1,
          sourceVersion: entry.version,
          links:
            entry.kind === "DOCUMENT" && !entry.deletedAt
              ? this.indexer.extract(entry.id, entry.bodyMd)
              : [],
        }),
      },
      old?.version ?? null,
    );
  }

  async ensureWikiIndex() {
    const entries = (await this.listMetadata()).filter(
      (entry) => entry.kind === "DOCUMENT" && !entry.deletedAt,
    );
    return this.ensureWikiSources(
      entries,
      await this.unavailableEntries(entries),
    );
  }

  private async ensureWikiSources(
    entries: readonly import("./workspace-bootstrap").BodyManifest<LibraryEntry>[],
    unavailable: readonly boolean[],
  ) {
    const sources = new Map(
      (await this.stage.list("$local.wikiSources")).map((value) => [
        value.id,
        value.value &&
        typeof value.value === "object" &&
        !Array.isArray(value.value)
          ? localObject(value.value)
          : null,
      ]),
    );
    let repaired = false;
    for (const [index, entry] of entries.entries()) {
      if (unavailable[index]) continue;
      const source = sources.get(entry.id);
      if (
        !source ||
        source.parserVersion !== 1 ||
        source.sourceVersion !== entry.version ||
        !Array.isArray(source.links) ||
        source.links.some((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return true;
          const link = localObject(value);
          return (
            link.sourceDocumentId !== entry.id ||
            typeof link.targetText !== "string" ||
            !(link.alias === null || typeof link.alias === "string") ||
            !(link.heading === null || typeof link.heading === "string")
          );
        })
      ) {
        await this.writeWikiSource(await this.get(entry.id));
        repaired = true;
      }
    }
    return repaired;
  }

  async rebuildWikiIndex() {
    for (const entry of await this.listMetadata()) {
      if (entry.kind === "DOCUMENT" && !entry.deletedAt)
        await this.writeWikiSource(await this.get(entry.id));
    }
  }

  async wikiLinks() {
    const entries = (await this.listMetadata()).filter(
      (value) => value.kind === "DOCUMENT" && !value.deletedAt,
    );
    const active = new Set(entries.map((value) => value.id));
    const unavailable = new Set<string>();
    const availability = await this.unavailableEntries(entries);
    await this.ensureWikiSources(entries, availability);
    for (const [index, entry] of entries.entries())
      if (availability[index]) unavailable.add(entry.id);
    const links: DocumentWikiLink[] = [];
    for (const entity of await this.stage.list("$local.wikiSources")) {
      if (!active.has(entity.id)) continue;
      if (unavailable.has(entity.id)) continue;
      const value = localObject(entity.value);
      if (!Array.isArray(value.links)) throw new Error("LOCAL_DATA_CORRUPT");
      for (const item of value.links) {
        const link = localObject(item);
        if (
          link.sourceDocumentId !== entity.id ||
          typeof link.targetText !== "string" ||
          (typeof link.alias !== "string" && link.alias !== null) ||
          (typeof link.heading !== "string" && link.heading !== null)
        )
          throw new Error("LOCAL_DATA_CORRUPT");
        links.push({
          sourceDocumentId: entity.id,
          targetDocumentId: null,
          targetText: link.targetText,
          alias: link.alias,
          heading: link.heading,
        });
      }
    }
    const projected = await this.stage.readCanonicalWikiLinks([...unavailable]);
    if (projected) links.push(...projected);
    else
      for (const entity of await this.stage.list("wikiLinks")) {
        const link = canonicalWikiLink(
          entity,
          this.actor.workspaceId,
          unavailable,
        );
        if (link) links.push(link);
      }
    await this.indexer.yieldRead?.();
    return this.indexer.resolve(links, entries);
  }

  override async purge(id: string, expectedVersion: number) {
    const current = await this.get(id);
    if (
      (await this.stage.list("files")).some((entity) => {
        const value = localObject(entity.value);
        return (
          value.localTombstone !== true &&
          (value.spaceId === id || value.parentDocumentId === id)
        );
      })
    )
      throw new DomainError("DEPENDENCY_EXISTS");
    if (
      (await this.listMetadata()).some(
        (value) =>
          value.id !== id &&
          (value.spaceId === id || value.parentDocumentId === id),
      )
    )
      throw new DomainError("DEPENDENCY_EXISTS");
    await super.purge(id, expectedVersion);
    const source = await this.stage.get("$local.wikiSources", id);
    if (source)
      this.stage.stageInternal(
        {
          ...source,
          version: source.version + 1,
          value: {
            parserVersion: 1,
            sourceVersion: current.version + 1,
            links: [],
          },
        },
        source.version,
      );
  }

  putAsset(...args: Parameters<LibraryStore["putAsset"]>) {
    return this.assets.putAsset(...args);
  }
  putAssetChunk(...args: Parameters<LibraryStore["putAssetChunk"]>) {
    return this.assets.putAssetChunk(...args);
  }
  assetChunk(...args: Parameters<LibraryStore["assetChunk"]>) {
    return this.assets.assetChunk(...args);
  }
  asset(...args: Parameters<LibraryStore["asset"]>) {
    return this.assets.asset(...args);
  }
}
