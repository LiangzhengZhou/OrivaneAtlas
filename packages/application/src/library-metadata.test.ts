import { expect, it, vi } from "vitest";
import {
  type LibraryEntry,
  LibraryService,
  type LibraryStore,
} from "./library";
import {
  validateLocalCanonicalKnowledgeManifest,
  validateLocalCanonicalKnowledgeValue,
} from "./local-canonical-knowledge";
import { bodyManifest } from "./workspace-bootstrap";

function fixture() {
  const actor = { workspaceId: "workspace", principalId: "owner" };
  const entry = (
    id: string,
    kind: LibraryEntry["kind"],
    spaceId: string | null,
    parentDocumentId: string | null,
  ): LibraryEntry => ({
    ...actor,
    id,
    title: id,
    kind,
    spaceId,
    parentDocumentId,
    bodyMd: "Original body\nsecond line",
    version: 1,
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    deletedAt: null,
    provenance: "HUMAN",
  });
  const entries = new Map(
    [
      entry("space", "SPACE", null, null),
      entry("target", "SPACE", null, null),
      entry("parent", "DOCUMENT", "space", null),
      entry("child", "DOCUMENT", "space", "parent"),
    ].map((value) => [value.id, value]),
  );
  const store: LibraryStore = {
    list: vi.fn(async () => {
      throw new Error("FULL_BODY_SCAN_FORBIDDEN");
    }),
    listMetadata: vi.fn(async () => [...entries.values()].map(bodyManifest)),
    get: async (id) => {
      const value = entries.get(id);
      if (!value) throw new Error("NOT_FOUND");
      return structuredClone(value);
    },
    save: vi.fn(async (value) => {
      entries.set(value.id, structuredClone(value));
    }),
    revisions: async () => [],
    purge: vi.fn(async () => {}),
    putAsset: async () => {},
    putAssetChunk: async () => {},
    assetChunk: async () => {
      throw new Error("NOT_FOUND");
    },
    asset: async () => {
      throw new Error("NOT_FOUND");
    },
  };
  const service = new LibraryService(
    store,
    { require: async () => {} },
    { now: () => "2026-10-12T01:00:00Z" },
    { next: () => "new-id" },
  );
  return { actor, entries, store, service };
}

it("reads a document using its exact Space metadata and rejects deleted or foreign Space metadata", async () => {
  const { actor, entries, store, service } = fixture();
  const original = bodyManifest(entries.get("space")!);
  store.getMetadata = vi.fn(async () => original);
  expect((await service.read(actor, "child")).bodyMd).toBe(
    "Original body\nsecond line",
  );
  expect(store.getMetadata).toHaveBeenCalledWith("space");
  expect(store.listMetadata).not.toHaveBeenCalled();
  original.deletedAt = "2026-10-20T00:00:00Z";
  await expect(service.read(actor, "child")).rejects.toThrow("NOT_FOUND");
  original.deletedAt = null;
  original.workspaceId = "other-workspace";
  await expect(service.read(actor, "child")).rejects.toThrow("NOT_FOUND");
  original.workspaceId = actor.workspaceId;
  original.id = "different-space";
  await expect(service.read(actor, "child")).rejects.toThrow("NOT_FOUND");
});

it("checks hierarchy and aliases from manifests while preserving the saved document body", async () => {
  const { actor, store, service } = fixture();
  const bodyMd = "# Preserved\n正文\n";
  const saved = await service.save(actor, "child", 1, {
    title: "Renamed child",
    kind: "DOCUMENT",
    spaceId: "space",
    parentDocumentId: "parent",
    bodyMd,
  });
  expect(saved.bodyMd).toBe(bodyMd);
  expect(store.listMetadata).toHaveBeenCalledOnce();
  expect(store.list).not.toHaveBeenCalled();
  await expect(
    service.save(actor, "parent", 1, {
      title: "Parent",
      kind: "DOCUMENT",
      spaceId: "space",
      parentDocumentId: "child",
      bodyMd: "",
    }),
  ).rejects.toThrow("VALIDATION_ERROR");
  expect(store.save).toHaveBeenCalledTimes(1);
});

it("creates and reads an untitled document without hydrating its parent Space description", async () => {
  const { actor, store, service } = fixture();
  const originalGet = store.get;
  store.get = vi.fn(async (id) => {
    if (id === "space") throw new Error("LOCAL_BODY_UNAVAILABLE");
    return originalGet(id);
  });
  const saved = await service.save(actor, null, 0, {
    title: "",
    kind: "DOCUMENT",
    spaceId: "space",
    bodyMd: "Durable untitled body",
  });
  expect(saved.title).toBe("");
  expect(
    validateLocalCanonicalKnowledgeValue(
      "library",
      saved.id,
      actor.workspaceId,
      saved.version,
      JSON.parse(JSON.stringify(saved)),
    ).title,
  ).toBe("");
  expect(
    validateLocalCanonicalKnowledgeManifest(
      "library",
      saved.id,
      actor.workspaceId,
      saved.version,
      JSON.parse(JSON.stringify(bodyManifest(saved))),
    ).title,
  ).toBe("");
  expect((await service.read(actor, saved.id)).bodyMd).toBe(
    "Durable untitled body",
  );
  expect(store.get).not.toHaveBeenCalledWith("space");
  expect(store.list).not.toHaveBeenCalled();
});

it("uses metadata for move, deletion and purge dependency checks", async () => {
  const { actor, entries, store, service } = fixture();
  await expect(
    service.moveDocument(actor, "parent", 1, "target"),
  ).rejects.toThrow("DEPENDENCY_EXISTS");
  await expect(service.setDeleted(actor, "parent", 1, true)).rejects.toThrow(
    "VALIDATION_ERROR",
  );
  entries.set("parent", {
    ...entries.get("parent")!,
    deletedAt: "2026-10-12T00:00:00Z",
  });
  await expect(service.purge(actor, "parent", 1)).rejects.toThrow(
    "DEPENDENCY_EXISTS",
  );
  expect(store.list).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
  expect(store.purge).not.toHaveBeenCalled();
});

it("moves a leaf using manifests without hydrating unrelated Markdown", async () => {
  const { actor, store, service } = fixture();
  const moved = await service.moveDocument(actor, "child", 1, "target");
  expect(moved.spaceId).toBe("target");
  expect(moved.parentDocumentId).toBeNull();
  expect(moved.bodyMd).toBe("Original body\nsecond line");
  expect(store.listMetadata).toHaveBeenCalledTimes(1);
  expect(store.list).not.toHaveBeenCalled();
});
