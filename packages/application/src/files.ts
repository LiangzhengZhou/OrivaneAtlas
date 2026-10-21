import {
  type ActorContext,
  DomainError,
  fileExtension,
  fileReadTier,
  type LibraryFile,
  requireFileName,
} from "@arclattice/domain";
import { type ContentPolicy, contentPolicy } from "./content-policy";
import type { FileExtractionStore } from "./file-extraction";
import type { AuthorizationService, Clock, IdGenerator } from "./index";
import type { LibraryStore } from "./library";
import type { LocalBlobStore, LocalChunkBlobStore } from "./local-persistence";
import { stableEntityIds } from "./stable-entity-ids";

export interface LibraryFileStore {
  readonly extractions?: FileExtractionStore;
  list(): Promise<LibraryFile[]>;
  get(id: string): Promise<LibraryFile>;
  save(file: LibraryFile, expectedVersion: number): Promise<void>;
}
export interface FileUploadInput {
  name: string;
  mime: string;
  spaceId: string | null;
  parentDocumentId?: string | null;
  aiPolicy?: ContentPolicy;
}
/** The original File is durable; retry only its Project relationship. */
export class FileProjectLinkError extends Error {
  constructor(
    readonly file: LibraryFile,
    cause: unknown,
  ) {
    super("FILE_SAVED_PROJECT_LINK_FAILED", { cause });
    this.name = "FileProjectLinkError";
  }
}
export class FileBytesUnavailableError extends Error {
  constructor(readonly fileId: string) {
    super("FILE_BLOB_MISSING_OR_CORRUPT");
    this.name = "FileBytesUnavailableError";
  }
}

function supportsChunks(store: LocalBlobStore): store is LocalChunkBlobStore {
  return (
    "begin" in store &&
    typeof store.begin === "function" &&
    "chunks" in store &&
    typeof store.chunks === "function" &&
    "putChunk" in store &&
    typeof store.putChunk === "function" &&
    "complete" in store &&
    typeof store.complete === "function"
  );
}

export function requireOriginalFileIdentity(
  previous: LibraryFile,
  next: LibraryFile,
) {
  for (const field of [
    "id",
    "workspaceId",
    "contentHash",
    "blobId",
    "originalName",
    "mime",
    "size",
    "createdBy",
    "createdAt",
    "provenance",
    "extension",
  ] as const)
    if (previous[field] !== next[field])
      throw new DomainError("VALIDATION_ERROR");
}

/** Metadata policy only. Binary and parser implementations remain ports. */
export class FileService {
  constructor(
    private readonly store: LibraryFileStore,
    private readonly library: Pick<LibraryStore, "listMetadata">,
    private readonly blobs: LocalBlobStore,
    private readonly auth: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly maxBytes = 100 * 1024 * 1024,
  ) {}

  /** Call inside the authenticated business/receipt transaction. */
  async uploadWithStableId(
    contextInput: ActorContext,
    id: string,
    input: FileUploadInput,
    bytes: Blob,
  ): Promise<LibraryFile> {
    const context = Object.freeze({ ...contextInput }),
      captured = structuredClone(input);
    await this.auth.require(context, "work:create");
    const ids = stableEntityIds(this.ids, "FILE", id);
    try {
      await this.store.get(id);
      throw new DomainError("VERSION_CONFLICT");
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NOT_FOUND")
        throw error;
    }
    return new FileService(
      this.store,
      this.library,
      this.blobs,
      this.auth,
      this.clock,
      ids,
      this.maxBytes,
    ).upload(context, captured, bytes);
  }

  /** Binary transfer is separate; incomplete bytes cannot publish File metadata. */
  async registerUploaded(
    contextInput: ActorContext,
    id: string,
    input: FileUploadInput,
    contentHash: string,
    size: number,
  ): Promise<LibraryFile> {
    const context = Object.freeze({ ...contextInput }),
      captured = structuredClone(input);
    await this.auth.require(context, "work:create");
    if (
      typeof contentHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(contentHash) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > this.maxBytes
    )
      throw new DomainError("VALIDATION_ERROR");
    await this.location(
      context,
      captured.spaceId,
      captured.parentDocumentId ?? null,
    );
    const bytes = await this.blobs.get(context.workspaceId, contentHash);
    if (!bytes)
      throw new DomainError("NOT_FOUND", { field: "completedFileBlob" });
    if (
      !this.blobs.digest ||
      bytes.size !== size ||
      (await this.blobs.digest(bytes)) !== contentHash
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "fileContentIdentity",
      });
    return this.uploadWithStableId(context, id, captured, bytes);
  }

  private async location(
    context: ActorContext,
    spaceId: string | null,
    parentDocumentId: string | null,
  ) {
    if (!this.library.listMetadata)
      throw new Error("FILE_LOCATION_PORT_INCOMPLETE");
    const entries = await this.library.listMetadata();
    if (
      spaceId !== null &&
      !entries.some(
        (value) =>
          value.id === spaceId &&
          value.kind === "SPACE" &&
          value.workspaceId === context.workspaceId &&
          !value.deletedAt,
      )
    )
      throw new DomainError("NOT_FOUND");
    if (
      parentDocumentId !== null &&
      !entries.some(
        (value) =>
          value.id === parentDocumentId &&
          value.kind === "DOCUMENT" &&
          value.workspaceId === context.workspaceId &&
          value.spaceId === spaceId &&
          !value.deletedAt,
      )
    )
      throw new DomainError("NOT_FOUND");
  }

  async upload(
    contextInput: ActorContext,
    inputValue: FileUploadInput,
    bytes: Blob,
  ): Promise<LibraryFile> {
    const context = Object.freeze({ ...contextInput }),
      input = structuredClone(inputValue);
    await this.auth.require(context, "work:create");
    const name = requireFileName(input.name),
      policy = contentPolicy(input.aiPolicy);
    if (
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.mime) ||
      input.mime.length > 127 ||
      !Number.isSafeInteger(bytes.size) ||
      bytes.size > this.maxBytes
    )
      throw new DomainError("VALIDATION_ERROR");
    await this.location(context, input.spaceId, input.parentDocumentId ?? null);
    if (!this.blobs.digest) throw new Error("FILE_HASH_PORT_INCOMPLETE");
    const hash = await this.blobs.digest(bytes);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("FILE_HASH_INVALID");
    const existing = await this.blobs.get(context.workspaceId, hash);
    if (
      existing &&
      (existing.size !== bytes.size ||
        (await this.blobs.digest(existing)) !== hash)
    )
      throw new Error("FILE_BLOB_MISSING_OR_CORRUPT");
    if (!existing && supportsChunks(this.blobs)) {
      const chunkSize = 262144;
      await this.blobs.begin({
        workspaceId: context.workspaceId,
        sha256: hash,
        size: bytes.size,
        mime: input.mime.toLowerCase(),
        chunkSize,
      });
      const present = new Set(
        await this.blobs.chunks(context.workspaceId, hash),
      );
      for (let index = 0; index < Math.ceil(bytes.size / chunkSize); index++) {
        if (present.has(index)) continue;
        const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize);
        await this.blobs.putChunk(
          context.workspaceId,
          hash,
          index,
          await this.blobs.digest!(chunk),
          chunk,
        );
      }
      await this.blobs.complete(context.workspaceId, hash);
    } else if (!existing)
      await this.blobs.put(context.workspaceId, hash, bytes);
    const now = this.clock.now(),
      extension = fileExtension(name);
    const value: LibraryFile = {
      id: this.ids.nextFor?.("FILE") ?? this.ids.next(),
      workspaceId: context.workspaceId,
      spaceId: input.spaceId,
      parentDocumentId: input.parentDocumentId ?? null,
      name,
      originalName: name,
      extension,
      mime: input.mime.toLowerCase(),
      size: bytes.size,
      contentHash: hash,
      blobId: hash,
      version: 1,
      provenance: "HUMAN",
      aiPolicy: policy,
      extractionStatus:
        fileReadTier(extension) === "STORAGE" ? "NOT_APPLICABLE" : "PENDING",
      indexStatus: "PENDING",
      createdBy: context.principalId,
      updatedBy: context.principalId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.store.save(value, 0);
    return value;
  }

  async read(context: ActorContext, id: string, includeDeleted = false) {
    await this.auth.require(context, "work:read");
    const value = await this.store.get(id);
    if (
      value.workspaceId !== context.workspaceId ||
      (!includeDeleted && value.deletedAt)
    )
      throw new DomainError("NOT_FOUND");
    await this.location(context, value.spaceId, value.parentDocumentId);
    return value;
  }
  async originalBytes(context: ActorContext, id: string) {
    const file = await this.read(context, id);
    const bytes = await this.blobs.get(context.workspaceId, file.contentHash);
    if (!bytes) throw new FileBytesUnavailableError(id);
    if (!this.blobs.digest) throw new Error("FILE_HASH_PORT_INCOMPLETE");
    if (
      bytes.size !== file.size ||
      (await this.blobs.digest(bytes)) !== file.contentHash
    )
      throw new Error("FILE_BLOB_MISSING_OR_CORRUPT");
    return bytes;
  }
  async rename(
    context: ActorContext,
    id: string,
    version: number,
    name: string,
  ) {
    await this.auth.require(context, "work:update");
    const old = await this.read(context, id);
    if (old.version !== version) throw new DomainError("VERSION_CONFLICT");
    const value = {
      ...old,
      name: requireFileName(name),
      version: version + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
    };
    await this.store.save(value, version);
    return value;
  }
  async setDeleted(
    context: ActorContext,
    id: string,
    version: number,
    deleted: boolean,
  ) {
    await this.auth.require(context, deleted ? "work:delete" : "work:update");
    const old = await this.read(context, id, true);
    if (old.version !== version) throw new DomainError("VERSION_CONFLICT");
    const now = this.clock.now();
    const value = {
      ...old,
      version: version + 1,
      deletedAt: deleted ? now : null,
      updatedBy: context.principalId,
      updatedAt: now,
    };
    await this.store.save(value, version);
    return value;
  }
  /** Human metadata edit only; this never requests inference or approves disclosure. */
  async setPolicy(
    contextInput: ActorContext,
    id: string,
    version: number,
    input: ContentPolicy,
  ) {
    const context = Object.freeze({ ...contextInput }),
      policy = structuredClone(input);
    await this.auth.require(context, "work:update");
    const old = await this.read(context, id);
    if (old.version !== version) throw new DomainError("VERSION_CONFLICT");
    const value: LibraryFile = {
      ...old,
      aiPolicy: contentPolicy(policy),
      version: version + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
    };
    await this.store.save(value, version);
    return value;
  }
}
