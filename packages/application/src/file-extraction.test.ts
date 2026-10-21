import { createHash } from "node:crypto";
import type { LibraryFile } from "@arclattice/domain";
import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import {
  FileExtractionError,
  FileExtractionService,
  fileExtractionDocument,
  fileExtractionLimits,
} from "./file-extraction";

const actor = { workspaceId: "local", principalId: "owner" };
function fixture() {
  const text = "原始正文\n第二行",
    bytes = new Blob([text]);
  const file: LibraryFile = {
    id: "file",
    workspaceId: "local",
    spaceId: null,
    parentDocumentId: null,
    name: "Original.txt",
    originalName: "Original.txt",
    extension: "txt",
    mime: "text/plain",
    size: bytes.size,
    contentHash: createHash("sha256").update(text).digest("hex"),
    blobId: createHash("sha256").update(text).digest("hex"),
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
  const source = {
    read: vi.fn(async () => structuredClone(file)),
    bytes: vi.fn(async () => bytes),
  };
  const store = {
    get: vi.fn(async () => null),
    publish: vi.fn(async () => {}),
  };
  const parser = {
    parse: vi.fn(async () => [
      { kind: "TEXT" as const, locator: "text:1", text },
    ]),
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
  return {
    file,
    source,
    store,
    parser,
    auth,
    service: new FileExtractionService(source, store, parser, auth),
  };
}
it("authorizes before private source reads and rejects oversized files before reading bytes", async () => {
  const f = fixture();
  await expect(
    f.service.extract({ ...actor, principalId: "other" }, "file", 1),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.source.read).not.toHaveBeenCalled();
  Object.assign(f.file, { size: fileExtractionLimits.inputBytes + 1 });
  await expect(f.service.extract(actor, "file", 1)).rejects.toThrow(
    "RESOURCE_LIMIT",
  );
  expect(f.source.bytes).not.toHaveBeenCalled();
  expect(f.parser.parse).not.toHaveBeenCalled();
  expect(f.store.publish).not.toHaveBeenCalled();
});
it("rebuilds corrupt derived content but never hides storage failures or parser rejection", async () => {
  const f = fixture();
  f.store.get.mockRejectedValueOnce(new FileExtractionError("MALFORMED"));
  const recovered = await f.service.extract(actor, f.file.id, f.file.version);
  expect(recovered.chunks[0]?.text).toBe("原始正文\n第二行");
  expect(f.store.publish).toHaveBeenCalledWith(actor, recovered);
  f.source.bytes.mockClear();
  f.store.publish.mockClear();
  f.store.get.mockRejectedValueOnce(new Error("DISK_FAILURE"));
  await expect(
    f.service.extract(actor, f.file.id, f.file.version),
  ).rejects.toThrow("DISK_FAILURE");
  expect(f.source.bytes).not.toHaveBeenCalled();
  expect(f.store.publish).not.toHaveBeenCalled();
  f.store.get.mockRejectedValueOnce(new FileExtractionError("MALFORMED"));
  f.parser.parse.mockRejectedValueOnce(
    new FileExtractionError("UNSAFE_CONTENT"),
  );
  await expect(
    f.service.extract(actor, f.file.id, f.file.version),
  ).rejects.toThrow("UNSAFE_CONTENT");
  expect(f.store.publish).not.toHaveBeenCalled();
});
it("source changes and cancellation after parsing cannot publish a stale result", async () => {
  for (const mode of ["rename", "delete", "cancel"] as const) {
    const f = fixture(),
      controller = new AbortController();
    f.parser.parse.mockImplementation(async () => {
      if (mode === "rename") Object.assign(f.file, { version: 2 });
      if (mode === "delete")
        Object.assign(f.file, { deletedAt: "2026-10-14T01:00:00Z" });
      if (mode === "cancel") controller.abort();
      return [{ kind: "TEXT", locator: "text:1", text: "derived" }];
    });
    await expect(
      f.service.extract(actor, "file", 1, controller.signal),
    ).rejects.toThrow(
      mode === "rename"
        ? "VERSION_CONFLICT"
        : mode === "delete"
          ? "NOT_FOUND"
          : "CANCELED",
    );
    expect(f.store.publish).not.toHaveBeenCalled();
  }
});
it("published chunks retain exact source and index identity without modifying original metadata", async () => {
  const f = fixture(),
    before = structuredClone(f.file);
  const result = await f.service.extract(actor, "file", 1);
  expect(result.chunks[0]).toMatchObject({
    workspaceId: "local",
    fileId: "file",
    fileVersion: 1,
    contentHash: f.file.contentHash,
    indexVersion: 2,
    kind: "TEXT",
    locator: "text:1/chunk:1",
  });
  expect(f.file).toEqual(before);
  expect(f.store.publish).toHaveBeenCalledExactlyOnceWith(actor, result);
  expect(() =>
    fileExtractionDocument(f.file, [
      { kind: "TEXT", locator: "x", text: "one" },
      { kind: "TEXT", locator: "x", text: "two" },
    ]),
  ).toThrow("MALFORMED");
});

it("cancellation during binary hydration or final source validation cannot start parsing or publish", async () => {
  for (const stage of ["hydrate", "validate"] as const) {
    const f = fixture();
    const controller = new AbortController();
    if (stage === "hydrate") {
      f.source.bytes.mockImplementation(async () => {
        controller.abort();
        return new Blob(["original"]);
      });
    } else {
      f.source.read.mockResolvedValueOnce(structuredClone(f.file));
      f.source.read.mockImplementation(async () => {
        controller.abort();
        return structuredClone(f.file);
      });
    }
    await expect(
      f.service.extract(actor, "file", 1, controller.signal),
    ).rejects.toThrow("CANCELED");
    if (stage === "hydrate") expect(f.parser.parse).not.toHaveBeenCalled();
    expect(f.store.publish).not.toHaveBeenCalled();
  }
});
