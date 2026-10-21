import { DomainError, type LibraryFile } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { FileExtractionError } from "./file-extraction";
import {
  type FileProcessingRecord,
  FileProcessingService,
  requireFileProcessingRecord,
} from "./file-processing";

const actor = { workspaceId: "local", principalId: "owner" };
it("processing records reject arbitrary error bodies and contradictory completion states", () => {
  const record: FileProcessingRecord = {
    fileId: "file",
    fileVersion: 1,
    contentHash: "a".repeat(64),
    indexVersion: 2,
    state: "RUNNING",
    leaseId: "lease",
    leaseUntil: "2026-10-14T00:01:00Z",
    error: null,
  };
  expect(requireFileProcessingRecord(record)).toEqual(record);
  for (const invalid of [
    { ...record, error: "Authorization: private" },
    { ...record, state: "READY", error: "MALFORMED" },
    { ...record, state: "FAILED", error: "CANCELED" },
    { ...record, fileVersion: 0 },
    { ...record, extra: "private" },
  ]) {
    expect(() => requireFileProcessingRecord(invalid)).toThrow(
      "LOCAL_FILE_PROCESSING_CORRUPT",
    );
  }
});
const file: LibraryFile = {
  id: "file",
  workspaceId: "local",
  spaceId: null,
  parentDocumentId: null,
  name: "original.txt",
  originalName: "original.txt",
  extension: "txt",
  mime: "text/plain",
  size: 1,
  contentHash: "a".repeat(64),
  blobId: "a".repeat(64),
  version: 1,
  provenance: "HUMAN",
  aiPolicy: {
    classification: "PRIVATE",
    processingBoundary: "LOCAL_ONLY",
    aiAccess: "DENY",
  },
  extractionStatus: "PENDING",
  indexStatus: "PENDING",
  createdBy: "owner",
  updatedBy: "owner",
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
  deletedAt: null,
};
function fixture() {
  const source = {
    list: vi.fn(async () => [file]),
    available: vi.fn(async () => true),
    extract: vi.fn(async () => {}),
  };
  const store = {
    get: vi.fn(async (): Promise<FileProcessingRecord | null> => null),
    claim: vi.fn(async () => true),
    finish: vi.fn(async () => {}),
  };
  const auth = {
    require: vi.fn(async (context: typeof actor) => {
      if (
        context.workspaceId !== actor.workspaceId ||
        context.principalId !== actor.principalId
      )
        throw new DomainError("FORBIDDEN");
    }),
  };
  const service = new FileProcessingService(
    source,
    store,
    auth,
    { now: () => "2026-10-14T00:00:00Z" },
    { next: () => "lease" },
  );
  return { source, store, auth, service };
}
it("authorizes before scanning private files and never downloads unavailable originals", async () => {
  const f = fixture();
  await expect(
    f.service.drain({ ...actor, principalId: "other" }),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.source.list).not.toHaveBeenCalled();
  f.source.available.mockResolvedValue(false);
  expect(await f.service.drain(actor)).toBe(0);
  expect(f.store.claim).not.toHaveBeenCalled();
  expect(f.source.extract).not.toHaveBeenCalled();
});
it("only claims eligible local originals and records success after real extraction", async () => {
  const f = fixture();
  expect(await f.service.drain(actor)).toBe(1);
  expect(f.store.finish).toHaveBeenCalledExactlyOnceWith(
    actor,
    file,
    "lease",
    "READY",
    null,
  );
  f.store.claim.mockResolvedValue(false);
  expect(await f.service.process(actor, file)).toBe(false);
  expect(f.source.extract).toHaveBeenCalledTimes(1);
});
it("persists bounded failure and cancellation, while infrastructure errors remain visible", async () => {
  for (const code of ["MALFORMED", "CANCELED"] as const) {
    const f = fixture();
    f.source.extract.mockRejectedValue(new FileExtractionError(code));
    expect(await f.service.process(actor, file)).toBe(code !== "CANCELED");
    expect(f.store.finish).toHaveBeenCalledExactlyOnceWith(
      actor,
      file,
      "lease",
      code === "CANCELED" ? "PENDING" : "FAILED",
      code,
    );
  }
  const f = fixture();
  f.source.extract.mockRejectedValue(new Error("LOCAL_TRANSACTION_ABORTED"));
  await expect(f.service.drain(actor)).rejects.toThrow(
    "LOCAL_TRANSACTION_ABORTED",
  );
  expect(f.store.finish).not.toHaveBeenCalled();
});
it("stale sources cannot publish READY and the earliest active lease schedules restart recovery", async () => {
  const f = fixture();
  f.source.extract.mockRejectedValue(new DomainError("VERSION_CONFLICT"));
  expect(await f.service.drain(actor)).toBe(0);
  expect(f.store.finish).not.toHaveBeenCalled();
  f.store.get.mockResolvedValue({
    fileId: file.id,
    fileVersion: 1,
    contentHash: file.contentHash,
    indexVersion: 2,
    state: "RUNNING",
    leaseId: "old",
    leaseUntil: "2026-10-14T00:01:00Z",
    error: null,
  });
  expect(await f.service.nextRecovery(actor)).toBe("2026-10-14T00:01:00Z");
});
