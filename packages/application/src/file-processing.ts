import {
  type ActorContext,
  DomainError,
  fileReadTier,
  type LibraryFile,
} from "@arclattice/domain";
import {
  FileExtractionError,
  type FileExtractionFailure,
  fileExtractionIndexVersion,
  fileExtractionLimits,
} from "./file-extraction";
import type { AuthorizationService, Clock, IdGenerator } from "./index";

export interface FileProcessingRecord {
  readonly fileId: string;
  readonly fileVersion: number;
  readonly contentHash: string;
  readonly indexVersion: number;
  readonly state: "RUNNING" | "READY" | "FAILED" | "PENDING";
  readonly leaseId: string;
  readonly leaseUntil: string;
  readonly error: FileExtractionFailure | null;
}
export function requireFileProcessingRecord(
  value: unknown,
): FileProcessingRecord {
  const invalid = (): never => {
    throw new Error("LOCAL_FILE_PROCESSING_CORRUPT");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "fileId",
          "fileVersion",
          "contentHash",
          "indexVersion",
          "state",
          "leaseId",
          "leaseUntil",
          "error",
        ].includes(key),
    ) ||
    typeof row.fileId !== "string" ||
    !row.fileId ||
    row.fileId.length > 240 ||
    !Number.isSafeInteger(row.fileVersion) ||
    (row.fileVersion as number) < 1 ||
    !Number.isSafeInteger(row.indexVersion) ||
    (row.indexVersion as number) < 1 ||
    typeof row.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.contentHash) ||
    typeof row.state !== "string" ||
    !["RUNNING", "READY", "FAILED", "PENDING"].includes(row.state) ||
    typeof row.leaseId !== "string" ||
    !row.leaseId ||
    row.leaseId.length > 240 ||
    typeof row.leaseUntil !== "string" ||
    !Number.isFinite(Date.parse(row.leaseUntil)) ||
    (row.error !== null &&
      (typeof row.error !== "string" ||
        ![
          "UNSUPPORTED",
          "MALFORMED",
          "RESOURCE_LIMIT",
          "ENCRYPTED",
          "UNSAFE_CONTENT",
          "TIMEOUT",
          "CANCELED",
        ].includes(row.error))) ||
    (["RUNNING", "READY"].includes(row.state) && row.error !== null) ||
    (row.state === "FAILED" &&
      (row.error === null || row.error === "CANCELED")) ||
    (row.state === "PENDING" && row.error !== null && row.error !== "CANCELED")
  )
    return invalid();
  return structuredClone(value) as FileProcessingRecord;
}
export interface FileProcessingStore {
  get(
    actor: ActorContext,
    file: LibraryFile,
  ): Promise<FileProcessingRecord | null>;
  claim(
    actor: ActorContext,
    file: LibraryFile,
    leaseId: string,
    at: string,
    retry: boolean,
  ): Promise<boolean>;
  finish(
    actor: ActorContext,
    file: LibraryFile,
    leaseId: string,
    state: "READY" | "FAILED" | "PENDING",
    error: FileExtractionFailure | null,
  ): Promise<void>;
}
export interface FileProcessingSource {
  list(actor: ActorContext): Promise<readonly LibraryFile[]>;
  available(actor: ActorContext, file: LibraryFile): Promise<boolean>;
  extract(
    actor: ActorContext,
    file: LibraryFile,
    signal?: AbortSignal,
  ): Promise<void>;
}

/** Durable File metadata is the pending source; never hydrate remote originals during a scan. */
export class FileProcessingService {
  constructor(
    private readonly source: FileProcessingSource,
    private readonly store: FileProcessingStore,
    private readonly auth: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async process(
    actorInput: ActorContext,
    file: LibraryFile,
    retry = false,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const actor = Object.freeze({ ...actorInput });
    await this.auth.require(actor, "work:read");
    if (file.workspaceId !== actor.workspaceId || file.deletedAt)
      throw new DomainError("NOT_FOUND");
    if (
      fileReadTier(file.extension) === "STORAGE" ||
      file.size > fileExtractionLimits.inputBytes ||
      signal?.aborted
    )
      return false;
    const previous = await this.store.get(actor, file);
    if (
      previous &&
      (previous.state === "READY" ||
        (previous.state === "FAILED" && !retry) ||
        (previous.state === "RUNNING" &&
          Date.parse(previous.leaseUntil) > Date.parse(this.clock.now())))
    )
      return false;
    if (!(await this.source.available(actor, file))) return false;
    const leaseId = this.ids.next();
    if (
      !(await this.store.claim(actor, file, leaseId, this.clock.now(), retry))
    )
      return false;
    try {
      await this.source.extract(actor, file, signal);
      await this.store.finish(actor, file, leaseId, "READY", null);
      return true;
    } catch (error) {
      if (
        error instanceof DomainError &&
        ["NOT_FOUND", "VERSION_CONFLICT"].includes(error.code)
      )
        return false;
      const failure = error instanceof FileExtractionError ? error.code : null;
      if (failure) {
        await this.store.finish(
          actor,
          file,
          leaseId,
          failure === "CANCELED" ? "PENDING" : "FAILED",
          failure,
        );
        if (failure === "CANCELED") return false;
        return true;
      }
      // Infrastructure failures leave an expiring durable lease, so restart can recover.
      throw error;
    }
  }
  async nextRecovery(actorInput: ActorContext): Promise<string | null> {
    const actor = Object.freeze({ ...actorInput });
    await this.auth.require(actor, "work:read");
    let next: string | null = null;
    for (const file of await this.source.list(actor)) {
      if (file.workspaceId !== actor.workspaceId || file.deletedAt) continue;
      try {
        const record = await this.store.get(actor, file);
        if (
          record?.state === "RUNNING" &&
          (!next || Date.parse(record.leaseUntil) < Date.parse(next))
        )
          next = record.leaseUntil;
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          !["NOT_FOUND", "VERSION_CONFLICT"].includes(error.code)
        )
          throw error;
      }
    }
    return next;
  }
  async drain(actorInput: ActorContext, signal?: AbortSignal, limit = 8) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new DomainError("VALIDATION_ERROR");
    const actor = Object.freeze({ ...actorInput });
    await this.auth.require(actor, "work:read");
    let processed = 0;
    for (const file of await this.source.list(actor)) {
      if (signal?.aborted || processed >= limit) break;
      if (file.workspaceId !== actor.workspaceId || file.deletedAt) continue;
      try {
        if (await this.process(actor, file, false, signal)) processed++;
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          !["NOT_FOUND", "VERSION_CONFLICT"].includes(error.code)
        )
          throw error;
      }
    }
    return processed;
  }
}

export function fileProcessingMatches(
  record: FileProcessingRecord,
  file: LibraryFile,
) {
  return (
    record.fileId === file.id &&
    record.fileVersion === file.version &&
    record.contentHash === file.contentHash &&
    record.indexVersion === fileExtractionIndexVersion
  );
}
