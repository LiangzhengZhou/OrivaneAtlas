import { DomainError, type LibraryFile } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { type AgentRun } from "./connected";
import { fileContextText, selectFileContext } from "./file-ai-context";
import { fileExtractionDocument } from "./file-extraction";
import type { LibraryEntry } from "./library";
import {
  validateApprovedContext,
  validateContextPolicy,
} from "./model-gateway";

const actor = { workspaceId: "w", principalId: "owner" };
function fixture() {
  const file: LibraryFile = {
    id: "f",
    workspaceId: "w",
    spaceId: null,
    parentDocumentId: null,
    name: "source.txt",
    originalName: "source.txt",
    extension: "txt",
    mime: "text/plain",
    size: 100,
    contentHash: "a".repeat(64),
    blobId: "a".repeat(64),
    version: 1,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    },
    extractionStatus: "PENDING",
    indexStatus: "PENDING",
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-10-15",
    updatedAt: "2026-10-15",
    deletedAt: null,
  };
  const document = fileExtractionDocument(
    file,
    Array.from({ length: 8 }, (_, index) => ({
      kind: "TEXT" as const,
      locator: `section:${index}`,
      text:
        index === 7
          ? "Relevant finding on satellites"
          : `Unrelated original section ${index}`,
    })),
  );
  const get = vi.fn(async () => structuredClone(document));
  const files = {
    get: vi.fn(async () => structuredClone(file)),
    extractions: { get, publish: vi.fn(async () => {}) },
  };
  const library = {
    get: vi.fn(async (_id: string): Promise<LibraryEntry> => {
      throw new DomainError("NOT_FOUND");
    }),
  };
  const run: AgentRun = {
    id: "r",
    workspaceId: "w",
    version: 1,
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "now",
    updatedAt: "now",
    deletedAt: null,
    status: "WAITING_APPROVAL",
    prompt: "question",
    route: {
      fingerprint: "fp",
      provider: "test",
      model: "test",
      maxInputChars: 32000,
      maxOutputTokens: 100,
      maxRunsPerDay: 10,
      timeoutMs: 1000,
    },
    approvedBy: null,
    approvedAt: null,
    output: null,
    error: null,
  };
  const select = () =>
    selectFileContext(
      actor,
      files,
      library,
      { id: "f", version: 1, query: "satellites", scope: "personal" },
      (entity) => validateContextPolicy(actor, run.route, entity),
    );
  return { file, document, files, library, run, select };
}

it("File context selects bounded relevant canonical citations rather than the whole original", async () => {
  const f = fixture(),
    source = await f.select();
  expect(source.ref).toEqual({ kind: "FILE", id: "f" });
  expect(source.file.locators).toHaveLength(3);
  expect(source.file.locators[0]).toBe("section:7/chunk:1");
  expect(source.bodyMd).toContain(
    "[section:7/chunk:1]\nRelevant finding on satellites",
  );
  expect(source.bodyMd).not.toContain("Unrelated original section 6");
  expect(f.file.version).toBe(1);
  expect(f.files.extractions.publish).not.toHaveBeenCalled();
});
it("File processing policy and scope are checked before extraction reads", async () => {
  const f = fixture();
  Object.assign(f.file.aiPolicy, { aiAccess: "DENY" });
  await expect(f.select()).rejects.toThrow("FORBIDDEN");
  expect(f.files.extractions.get).not.toHaveBeenCalled();
  Object.assign(f.file.aiPolicy, { aiAccess: "ASK" });
  await expect(
    selectFileContext(
      actor,
      f.files,
      f.library,
      { id: "f", version: 1, query: "satellites", scope: "SPACE:other" },
      () => {},
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.files.extractions.get).not.toHaveBeenCalled();
  Object.assign(f.file.aiPolicy, { processingBoundary: "LOCAL_ONLY" });
  await expect(f.select()).rejects.toThrow("FORBIDDEN");
});
it("approved File citations are re-read; edits, revoked policy and missing locators cannot silently reuse context", async () => {
  const f = fixture(),
    source = await f.select();
  f.run.context = [structuredClone(source)];
  const notes = { get: vi.fn() };
  await expect(
    validateApprovedContext(actor, f.run, notes, f.library, f.files),
  ).resolves.toBeUndefined();
  f.run.context[0]!.bodyMd += "forged client body";
  await expect(
    validateApprovedContext(actor, f.run, notes, f.library, f.files),
  ).rejects.toThrow("CONTEXT_CHANGED");
  f.run.context = [source];
  Object.assign(f.file.aiPolicy, { aiAccess: "DENY" });
  await expect(
    validateApprovedContext(actor, f.run, notes, f.library, f.files),
  ).rejects.toThrow("FORBIDDEN");
  Object.assign(f.file.aiPolicy, { aiAccess: "ASK" });
  Object.assign(f.file, { version: 2 });
  await expect(
    validateApprovedContext(actor, f.run, notes, f.library, f.files),
  ).rejects.toThrow("VERSION_CONFLICT");
});
it("a revoked or deleted parent policy blocks File context before extraction reads", async () => {
  const f = fixture();
  Object.assign(f.file, { spaceId: "space" });
  const parent: LibraryEntry = {
    id: "space",
    workspaceId: "w",
    kind: "SPACE",
    spaceId: null,
    title: "Parent",
    bodyMd: "",
    version: 1,
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "now",
    updatedAt: "now",
    deletedAt: null,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "DENY",
    },
  };
  f.library.get.mockImplementation(async () => structuredClone(parent));
  await expect(f.select()).rejects.toThrow("FORBIDDEN");
  expect(f.files.extractions.get).not.toHaveBeenCalled();
  Object.assign(parent, { deletedAt: "now" });
  await expect(f.select()).rejects.toThrow("NOT_FOUND");
  expect(f.files.extractions.get).not.toHaveBeenCalled();
});
it("duplicate, missing and oversized citation collections are rejected", () => {
  const f = fixture();
  expect(() => fileContextText(f.document, ["unknown"])).toThrow(
    "VERSION_CONFLICT",
  );
  expect(() =>
    fileContextText(f.document, ["section:0/chunk:1", "section:0/chunk:1"]),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    fileContextText(
      f.document,
      f.document.chunks.map((chunk) => chunk.locator),
    ),
  ).toThrow("VALIDATION_ERROR");
});
