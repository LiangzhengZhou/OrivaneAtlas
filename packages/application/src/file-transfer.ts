import { type ActorContext, DomainError } from "@arclattice/domain";
import type { AuthorizationService } from "./index";
import type { LocalChunkBlobStore } from "./local-persistence";

/** Authenticated, workspace-scoped transfer; no metadata publication or Base64. */
export class FileTransferService {
  constructor(
    private readonly blobs: LocalChunkBlobStore,
    private readonly auth: AuthorizationService,
  ) {}
  private async transfer<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "FILE_UPLOAD_NOT_FOUND")
          throw new DomainError("NOT_FOUND", { field: "fileUpload" });
        if (error.message === "FILE_UPLOAD_CONFLICT")
          throw new DomainError("VERSION_CONFLICT", { field: "fileUpload" });
        if (
          [
            "FILE_UPLOAD_INCOMPLETE",
            "FILE_HASH_MISMATCH",
            "INVALID_FILE_HASH",
            "INVALID_FILE_UPLOAD",
            "INVALID_FILE_CHUNK",
          ].includes(error.message)
        )
          throw new DomainError("VALIDATION_ERROR", { field: "fileUpload" });
      }
      throw error;
    }
  }
  private hash(value: string) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
      throw new DomainError("VALIDATION_ERROR", { field: "fileHash" });
    return value;
  }
  async begin(
    contextInput: ActorContext,
    input: {
      contentHash: string;
      size: number;
      mime: string;
      chunkSize: number;
    },
  ) {
    const context = Object.freeze({ ...contextInput }),
      captured = structuredClone(input);
    await this.auth.require(context, "work:create");
    this.hash(captured.contentHash);
    if (
      !Number.isSafeInteger(captured.size) ||
      captured.size < 0 ||
      captured.size > 100 * 1024 * 1024 ||
      !Number.isSafeInteger(captured.chunkSize) ||
      captured.chunkSize < 1 ||
      captured.chunkSize > 262144 ||
      typeof captured.mime !== "string" ||
      captured.mime.length > 127 ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(captured.mime)
    )
      throw new DomainError("VALIDATION_ERROR");
    await this.transfer(() =>
      this.blobs.begin({
        workspaceId: context.workspaceId,
        sha256: captured.contentHash,
        size: captured.size,
        mime: captured.mime,
        chunkSize: captured.chunkSize,
      }),
    );
    return {
      contentHash: captured.contentHash,
      received: await this.transfer(() =>
        this.blobs.chunks(context.workspaceId, captured.contentHash),
      ),
    };
  }
  async status(contextInput: ActorContext, contentHash: string) {
    const context = Object.freeze({ ...contextInput });
    await this.auth.require(context, "work:create");
    this.hash(contentHash);
    return {
      contentHash,
      received: await this.transfer(() =>
        this.blobs.chunks(context.workspaceId, contentHash),
      ),
    };
  }
  async putChunk(
    contextInput: ActorContext,
    contentHash: string,
    index: number,
    chunkHash: string,
    bytes: Blob,
  ) {
    const context = Object.freeze({ ...contextInput });
    await this.auth.require(context, "work:create");
    this.hash(contentHash);
    this.hash(chunkHash);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      bytes.size < 1 ||
      bytes.size > 262144
    )
      throw new DomainError("VALIDATION_ERROR");
    await this.transfer(() =>
      this.blobs.putChunk(
        context.workspaceId,
        contentHash,
        index,
        chunkHash,
        bytes,
      ),
    );
    return { contentHash, index };
  }
  async complete(contextInput: ActorContext, contentHash: string) {
    const context = Object.freeze({ ...contextInput });
    await this.auth.require(context, "work:create");
    this.hash(contentHash);
    await this.transfer(() =>
      this.blobs.complete(context.workspaceId, contentHash),
    );
    return { contentHash, complete: true };
  }
}
