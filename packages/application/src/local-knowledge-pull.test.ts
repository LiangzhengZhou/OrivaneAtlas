import { expect, it } from "vitest";
import { LocalBodyUnavailableError } from "./local-body-availability";
import { prepareLocalConflictBody } from "./local-conflict-body";
import { localDto } from "./local-dto";
import { prepareLocalKnowledgeHydration } from "./local-knowledge-hydration";
import { LocalMarkdownStore } from "./local-markdown-store";
import { LocalMutationTransaction } from "./local-mutation-transaction";
import type {
  LocalEntity,
  LocalMetadataStore,
  LocalSyncState,
} from "./local-persistence";
import { prepareLocalWorkPull } from "./local-work-pull";
import type { Note } from "./notebook";
import { bodyManifest } from "./workspace-bootstrap";

const actor = { workspaceId: "local", principalId: "owner" };
const clock = { now: () => "2026-10-13T00:00:00Z" };
function fixture() {
  const note: Note = {
    id: "note",
    workspaceId: "remote",
    title: "Remote note",
    bodyMd: "原文\n第二行",
    kind: "NOTE",
    day: null,
    version: 1,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    createdBy: "remote-owner",
    updatedBy: "remote-owner",
    deletedAt: null,
    classification: "PRIVATE",
    boundary: "REMOTE",
    aiAccess: "DENY",
    provenance: "HUMAN",
  };
  const binding: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "remote-owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 0,
    version: 1,
  };
  const page = {
    epoch: "epoch",
    cursor: 1,
    recovery: false,
    hasMore: false,
    snapshot: null,
    records: [
      {
        seq: 1,
        workspaceId: "remote",
        collection: "notes",
        entityId: note.id,
        op: "UPSERT",
        version: 1,
      },
    ],
    changes: {
      collections: { notes: { upserts: [bodyManifest(note)], removed: [] } },
      values: {},
    },
  };
  const records = new Map<string, LocalEntity>();
  const key = (collection: string, id: string) =>
    JSON.stringify([collection, id]);
  const metadata: LocalMetadataStore = {
    get: async (_w, collection, id) =>
      structuredClone(records.get(key(collection, id)) ?? null),
    list: async (_w, collection) =>
      [...records.values()].filter((entry) => entry.collection === collection),
    commit: async () => {
      throw new Error("NO_USER_WRITE_ALLOWED");
    },
  };
  const put = (entity: LocalEntity) =>
    records.set(key(entity.collection, entity.id), structuredClone(entity));
  return { note, binding, page, records, metadata, put, key };
}
it("metadata knowledge pull records durable unavailable provenance without an empty body or manufactured user change", async () => {
  const f = fixture();
  const prepared = await prepareLocalWorkPull(
    actor,
    f.binding,
    f.page,
    [],
    f.metadata,
  );
  expect(prepared?.nextCursor).toBe(1);
  expect(prepared?.records.map((record) => record.entity.collection)).toEqual([
    "$local.remoteBase",
    "notes",
    "$local.noteBodyAvailability",
    "$local.noteSearch",
  ]);
  for (const write of prepared?.records ?? []) f.put(write.entity);
  const stage = await LocalMutationTransaction.begin(
    f.metadata,
    actor,
    "device",
    clock,
    { next: () => "id" },
  );
  const store = new LocalMarkdownStore<Note>(
    stage,
    actor,
    clock,
    { next: () => "id" },
    () => {},
    "notes",
    "note",
  );
  await expect(store.get(f.note.id)).rejects.toBeInstanceOf(
    LocalBodyUnavailableError,
  );
  expect(f.records.has(f.key("$local.noteBody", f.note.id))).toBe(false);
  expect(JSON.stringify(prepared)).not.toContain('"bodyMd"');
  const hydrated = await prepareLocalKnowledgeHydration(
    actor,
    f.binding,
    "notes",
    f.note.id,
    1,
    f.note,
    [],
    f.metadata,
    { extract: () => [], resolve: () => [] },
  );
  expect(hydrated.nextCursor).toBe(f.binding.cursor);
  expect(hydrated.acknowledgements).toBeUndefined();
  for (const write of hydrated.records) f.put(write.entity);
  const hydratedStage = await LocalMutationTransaction.begin(
    f.metadata,
    actor,
    "device",
    clock,
    { next: () => "id" },
  );
  const hydratedStore = new LocalMarkdownStore<Note>(
    hydratedStage,
    actor,
    clock,
    { next: () => "id" },
    () => {},
    "notes",
    "note",
  );
  expect(await hydratedStore.get(f.note.id)).toMatchObject({
    bodyMd: f.note.bodyMd,
    workspaceId: "local",
  });
});
it("missing local body without explicit matching remote provenance remains corruption", async () => {
  const f = fixture();
  f.put({
    workspaceId: "local",
    collection: "notes",
    id: f.note.id,
    version: 1,
    value: localDto({ ...bodyManifest(f.note), workspaceId: "local" }),
  });
  const stage = await LocalMutationTransaction.begin(
    f.metadata,
    actor,
    "device",
    clock,
    { next: () => "id" },
  );
  const store = new LocalMarkdownStore<Note>(
    stage,
    actor,
    clock,
    { next: () => "id" },
    () => {},
    "notes",
    "note",
  );
  await expect(store.get(f.note.id)).rejects.toThrow("LOCAL_DATA_CORRUPT");
});
it("metadata catch-up after a full receipt retains canonical body and available local projections", async () => {
  const f = fixture();
  f.put({
    workspaceId: "local",
    collection: "$local.remoteBase",
    id: f.key("notes", f.note.id),
    version: 1,
    value: localDto({
      ...f.binding,
      collection: "notes",
      id: f.note.id,
      version: 1,
      value: f.note,
    }),
  });
  f.put({
    workspaceId: "local",
    collection: "notes",
    id: f.note.id,
    version: 1,
    value: localDto({ ...bodyManifest(f.note), workspaceId: "local" }),
  });
  const prepared = await prepareLocalWorkPull(
    actor,
    f.binding,
    f.page,
    [],
    f.metadata,
  );
  expect(prepared?.records).toHaveLength(1);
  expect(prepared?.records[0]?.entity.value).toMatchObject({
    value: { bodyMd: f.note.bodyMd },
  });
});
it("stale body hydration cannot overwrite a newer manifest or a changed origin", async () => {
  const f = fixture();
  const prepared = await prepareLocalWorkPull(
    actor,
    f.binding,
    f.page,
    [],
    f.metadata,
  );
  for (const write of prepared?.records ?? []) f.put(write.entity);
  const wiki = { extract: () => [], resolve: () => [] };
  await expect(
    prepareLocalKnowledgeHydration(
      actor,
      { ...f.binding, serverOrigin: "https://other.test" },
      "notes",
      f.note.id,
      1,
      f.note,
      [],
      f.metadata,
      wiki,
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  await expect(
    prepareLocalKnowledgeHydration(
      actor,
      f.binding,
      "notes",
      f.note.id,
      1,
      { ...f.note, version: 2 },
      [],
      f.metadata,
      wiki,
    ),
  ).rejects.toThrow("VALIDATION_ERROR");
  const original = f.records.get(f.key("notes", f.note.id));
  if (!original) throw new Error("MISSING_MANIFEST");
  f.put({
    ...original,
    version: 2,
    value: localDto({
      ...bodyManifest(f.note),
      workspaceId: "local",
      version: 2,
    }),
  });
  await expect(
    prepareLocalKnowledgeHydration(
      actor,
      f.binding,
      "notes",
      f.note.id,
      1,
      f.note,
      [],
      f.metadata,
      wiki,
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(f.records.has(f.key("$local.noteBody", f.note.id))).toBe(false);
});

it("conflict hydration pins exact remote metadata and writes only the captured base", async () => {
  const f = fixture();
  const pulled = await prepareLocalWorkPull(
    actor,
    f.binding,
    f.page,
    [],
    f.metadata,
  );
  for (const write of pulled?.records ?? []) f.put(write.entity);
  const captured =
    f.records.get(f.key("$local.remoteBase", f.note.id)) ??
    [...f.records.values()].find(
      (entry) => entry.collection === "$local.remoteBase",
    );
  if (!captured) throw new Error("MISSING_BASE");
  const before = structuredClone([...f.records.values()]);
  const result = await prepareLocalConflictBody(
    actor,
    f.binding,
    captured,
    f.note,
    f.metadata,
  );
  expect(result.nextCursor).toBe(f.binding.cursor);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({
    expectedVersion: captured.version,
    entity: {
      collection: "$local.remoteBase",
      version: captured.version + 1,
      value: { value: { bodyMd: f.note.bodyMd } },
    },
  });
  expect([...f.records.values()]).toEqual(before);
  await expect(
    prepareLocalConflictBody(
      actor,
      f.binding,
      captured,
      { ...f.note, version: 2 },
      f.metadata,
    ),
  ).rejects.toThrow("VALIDATION_ERROR");
  await expect(
    prepareLocalConflictBody(
      actor,
      f.binding,
      captured,
      { ...f.note, title: "Changed after manifest" },
      f.metadata,
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  await expect(
    prepareLocalConflictBody(
      actor,
      { ...f.binding, serverOrigin: "https://other.test" },
      captured,
      f.note,
      f.metadata,
    ),
  ).rejects.toThrow("FORBIDDEN");
  await expect(
    prepareLocalConflictBody(
      actor,
      { ...f.binding, remotePrincipalId: "other" },
      captured,
      f.note,
      f.metadata,
    ),
  ).rejects.toThrow("FORBIDDEN");
  f.put({ ...captured, version: captured.version + 1 });
  await expect(
    prepareLocalConflictBody(actor, f.binding, captured, f.note, f.metadata),
  ).rejects.toThrow("VERSION_CONFLICT");
});
