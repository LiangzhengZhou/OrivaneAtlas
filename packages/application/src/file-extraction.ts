import {
  type ActorContext,
  DomainError,
  type FileExtractionDocument,
  type FileExtractionKind,
  fileReadTier,
  type LibraryFile,
} from "@arclattice/domain";
import type { AuthorizationService } from "./index";

export const fileExtractionIndexVersion = 2;
export const fileExtractionLimits = Object.freeze({
  inputBytes: 16 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  archiveEntries: 1024,
  xmlBytes: 4 * 1024 * 1024,
  xmlDepth: 64,
  xmlNodes: 200000,
  sections: 1000,
  characters: 2 * 1024 * 1024,
  chunkCharacters: 4000,
  chunks: 2048,
  milliseconds: 15000,
});
export type FileExtractionFailure =
  | "UNSUPPORTED"
  | "MALFORMED"
  | "RESOURCE_LIMIT"
  | "ENCRYPTED"
  | "UNSAFE_CONTENT"
  | "TIMEOUT"
  | "CANCELED";
export class FileExtractionError extends Error {
  constructor(readonly code: FileExtractionFailure) {
    super(`FILE_EXTRACTION_${code}`);
    this.name = "FileExtractionError";
  }
}
export interface FileParserSection {
  readonly kind: FileExtractionKind;
  readonly locator: string;
  readonly title?: string;
  readonly text: string;
}
export interface FileParser {
  parse(
    extension: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<readonly FileParserSection[]>;
}
export interface FileExtractionSource {
  read(actor: ActorContext, id: string): Promise<LibraryFile>;
  bytes(actor: ActorContext, id: string): Promise<Blob>;
}
export interface FileExtractionStore {
  searchIds?(
    actor: ActorContext,
    query: string,
    fileIds: readonly string[],
  ): Promise<string[]>;
  search?(
    actor: ActorContext,
    query: string,
    fileIds: readonly string[],
    limit: number,
  ): Promise<FileExtractionDocument["chunks"]>;
  get(actor: ActorContext, id: string): Promise<FileExtractionDocument | null>;
  /** Recheck live File version/hash and commit all derived chunks atomically. */
  publish(actor: ActorContext, document: FileExtractionDocument): Promise<void>;
}

export function fileExtractionSearchInput(
  query: string,
  fileIds: readonly string[],
  limit: number,
) {
  if (
    typeof query !== "string" ||
    query.length > 200 ||
    !Array.isArray(fileIds) ||
    fileIds.length > 2000 ||
    fileIds.some((id) => typeof id !== "string" || !id || id.length > 240) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new DomainError("VALIDATION_ERROR");
  return {
    terms: fileExtractionSearchText(query).trim().split(/\s+/).filter(Boolean),
    fileIds: [...new Set(fileIds)],
    limit,
  };
}
export function fileExtractionSearchText(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");
}

export function requireFileExtractionDocument(
  value: unknown,
  file: Pick<LibraryFile, "id" | "workspaceId" | "version" | "contentHash">,
): FileExtractionDocument {
  const invalid = (): never => {
    throw new FileExtractionError("MALFORMED");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        ![
          "workspaceId",
          "fileId",
          "fileVersion",
          "contentHash",
          "indexVersion",
          "chunks",
        ].includes(key),
    ) ||
    typeof data.workspaceId !== "string" ||
    !data.workspaceId ||
    data.workspaceId.length > 240 ||
    typeof data.fileId !== "string" ||
    !data.fileId ||
    data.fileId.length > 240 ||
    !Number.isSafeInteger(data.fileVersion) ||
    (data.fileVersion as number) < 1 ||
    typeof data.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.contentHash) ||
    data.workspaceId !== file.workspaceId ||
    data.fileId !== file.id ||
    data.fileVersion !== file.version ||
    data.contentHash !== file.contentHash ||
    data.indexVersion !== fileExtractionIndexVersion ||
    !Array.isArray(data.chunks) ||
    data.chunks.length > fileExtractionLimits.chunks
  )
    return invalid();
  let characters = 0;
  const locators = new Set<string>();
  for (const value of data.chunks as unknown[]) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return invalid();
    const chunk = value as Record<string, unknown>;
    if (
      Object.keys(chunk).some(
        (key) =>
          ![
            "workspaceId",
            "fileId",
            "fileVersion",
            "contentHash",
            "indexVersion",
            "kind",
            "locator",
            "title",
            "text",
          ].includes(key),
      ) ||
      chunk.workspaceId !== file.workspaceId ||
      chunk.fileId !== file.id ||
      chunk.fileVersion !== file.version ||
      chunk.contentHash !== file.contentHash ||
      chunk.indexVersion !== fileExtractionIndexVersion ||
      typeof chunk.kind !== "string" ||
      !["TEXT", "PAGE", "SHEET", "SLIDE", "TABLE"].includes(chunk.kind) ||
      typeof chunk.locator !== "string" ||
      !chunk.locator ||
      chunk.locator.length > 260 ||
      locators.has(chunk.locator) ||
      typeof chunk.text !== "string" ||
      chunk.text.length > fileExtractionLimits.chunkCharacters ||
      (chunk.title !== undefined &&
        (typeof chunk.title !== "string" || chunk.title.length > 240))
    )
      return invalid();
    locators.add(chunk.locator);
    characters += chunk.text.length;
    if (characters > fileExtractionLimits.characters) return invalid();
  }
  return structuredClone(value) as FileExtractionDocument;
}

export function fileExtractionDocument(
  file: LibraryFile,
  sections: readonly FileParserSection[],
): FileExtractionDocument {
  if (
    !Array.isArray(sections) ||
    sections.length > fileExtractionLimits.sections
  )
    throw new FileExtractionError("RESOURCE_LIMIT");
  const locators = new Set<string>();
  const chunks: FileExtractionDocument["chunks"][number][] = [];
  let characters = 0;
  for (const section of sections) {
    if (
      !section ||
      !["TEXT", "PAGE", "SHEET", "SLIDE", "TABLE"].includes(section.kind) ||
      typeof section.locator !== "string" ||
      !section.locator ||
      section.locator.length > 240 ||
      locators.has(section.locator) ||
      typeof section.text !== "string" ||
      (section.title !== undefined &&
        (typeof section.title !== "string" || section.title.length > 240))
    )
      throw new FileExtractionError("MALFORMED");
    locators.add(section.locator);
    characters += section.text.length;
    if (characters > fileExtractionLimits.characters)
      throw new FileExtractionError("RESOURCE_LIMIT");
    for (let offset = 0, part = 1; offset < section.text.length; part++) {
      let end = Math.min(
        offset + fileExtractionLimits.chunkCharacters,
        section.text.length,
      );
      if (
        end < section.text.length &&
        /[\uD800-\uDBFF]/.test(section.text[end - 1]!)
      )
        end--;
      chunks.push({
        workspaceId: file.workspaceId,
        fileId: file.id,
        fileVersion: file.version,
        contentHash: file.contentHash,
        indexVersion: fileExtractionIndexVersion,
        kind: section.kind,
        locator: `${section.locator}/chunk:${part}`,
        ...(section.title === undefined ? {} : { title: section.title }),
        text: section.text.slice(offset, end),
      });
      if (chunks.length > fileExtractionLimits.chunks)
        throw new FileExtractionError("RESOURCE_LIMIT");
      offset = end;
    }
  }
  return {
    workspaceId: file.workspaceId,
    fileId: file.id,
    fileVersion: file.version,
    contentHash: file.contentHash,
    indexVersion: fileExtractionIndexVersion,
    chunks,
  };
}

export class FileExtractionService {
  constructor(
    private readonly source: FileExtractionSource,
    private readonly store: FileExtractionStore,
    private readonly parser: FileParser,
    private readonly auth: AuthorizationService,
  ) {}
  async searchFileIds(
    actorInput: ActorContext,
    query: string,
    ids: readonly string[],
  ) {
    const actor = Object.freeze({ ...actorInput }),
      input = fileExtractionSearchInput(query, ids, 100),
      allowed = new Set(input.fileIds);
    await this.auth.require(actor, "work:read");
    if (!input.terms.length || !allowed.size) return [];
    if (!this.store.searchIds)
      throw new Error("FILE_EXTRACTION_SEARCH_PORT_INCOMPLETE");
    const matches = await this.store.searchIds(actor, query, input.fileIds);
    if (
      matches.length > allowed.size ||
      new Set(matches).size !== matches.length ||
      matches.some((id) => !allowed.has(id))
    )
      throw new DomainError("FORBIDDEN");
    const accepted = new Set<string>();
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, matches.length) }, async () => {
        while (cursor < matches.length) {
          const id = matches[cursor++]!;
          try {
            const file = await this.source.read(actor, id);
            if (!file.deletedAt && file.workspaceId === actor.workspaceId)
              accepted.add(id);
          } catch (error) {
            if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
              throw error;
          }
        }
      }),
    );
    return matches.filter((id) => accepted.has(id));
  }
  async search(
    actorInput: ActorContext,
    query: string,
    ids: readonly string[],
    limit = 12,
  ) {
    const actor = Object.freeze({ ...actorInput }),
      input = fileExtractionSearchInput(query, ids, limit);
    await this.auth.require(actor, "work:read");
    if (!input.terms.length || !input.fileIds.length) return [];
    if (!this.store.search)
      throw new Error("FILE_EXTRACTION_SEARCH_PORT_INCOMPLETE");
    const hits = await this.store.search(actor, query, input.fileIds, limit);
    if (hits.length > limit) throw new FileExtractionError("RESOURCE_LIMIT");
    const files = new Map<string, LibraryFile>();
    const result: FileExtractionDocument["chunks"][number][] = [];
    for (const hit of hits) {
      if (
        !input.fileIds.includes(hit.fileId) ||
        hit.workspaceId !== actor.workspaceId
      )
        throw new DomainError("FORBIDDEN");
      let file = files.get(hit.fileId);
      if (!file) {
        file = await this.source.read(actor, hit.fileId);
        files.set(hit.fileId, file);
      }
      if (
        file.deletedAt ||
        file.workspaceId !== actor.workspaceId ||
        file.version !== hit.fileVersion ||
        file.contentHash !== hit.contentHash
      )
        continue;
      const document = requireFileExtractionDocument(
        {
          workspaceId: file.workspaceId,
          fileId: file.id,
          fileVersion: file.version,
          contentHash: file.contentHash,
          indexVersion: fileExtractionIndexVersion,
          chunks: [hit],
        },
        file,
      );
      result.push(document.chunks[0]!);
    }
    return result;
  }
  async extract(
    actorInput: ActorContext,
    id: string,
    version: number,
    signal?: AbortSignal,
  ) {
    const actor = Object.freeze({ ...actorInput });
    await this.auth.require(actor, "work:read");
    const file = await this.source.read(actor, id);
    if (file.workspaceId !== actor.workspaceId || file.deletedAt)
      throw new DomainError("NOT_FOUND");
    if (file.version !== version) throw new DomainError("VERSION_CONFLICT");
    if (fileReadTier(file.extension) === "STORAGE")
      throw new FileExtractionError("UNSUPPORTED");
    if (file.size > fileExtractionLimits.inputBytes)
      throw new FileExtractionError("RESOURCE_LIMIT");
    if (signal?.aborted) throw new FileExtractionError("CANCELED");
    try {
      const old = await this.store.get(actor, id);
      if (
        old?.fileVersion === version &&
        old.contentHash === file.contentHash &&
        old.indexVersion === fileExtractionIndexVersion
      )
        return requireFileExtractionDocument(old, file);
    } catch (error) {
      // Derived content is disposable. Only a validated cache-corruption error
      // permits rebuilding from the authorized, verified immutable original.
      if (!(error instanceof FileExtractionError) || error.code !== "MALFORMED")
        throw error;
    }
    const bytes = await this.source.bytes(actor, id);
    if (signal?.aborted) throw new FileExtractionError("CANCELED");
    if (
      bytes.size !== file.size ||
      bytes.size > fileExtractionLimits.inputBytes
    )
      throw new FileExtractionError("RESOURCE_LIMIT");
    const sections = await this.parser.parse(
      file.extension!,
      new Uint8Array(await bytes.arrayBuffer()),
      signal,
    );
    if (signal?.aborted) throw new FileExtractionError("CANCELED");
    const document = fileExtractionDocument(file, sections);
    const latest = await this.source.read(actor, id);
    if (latest.deletedAt) throw new DomainError("NOT_FOUND");
    if (
      latest.workspaceId !== actor.workspaceId ||
      latest.version !== version ||
      latest.contentHash !== file.contentHash
    )
      throw new DomainError("VERSION_CONFLICT");
    if (signal?.aborted) throw new FileExtractionError("CANCELED");
    await this.store.publish(actor, document);
    return document;
  }
}
