import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import { prepareLocalKnowledgeReplayAcknowledgement } from "./local-knowledge-replay-ack";
import type {
  LocalEntity,
  LocalMetadataStore,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import type { Note } from "./notebook";
import { bodyManifest } from "./workspace-bootstrap";

const id = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  noteId = "33333333-3333-4333-8333-333333333333";
const actor = { workspaceId: "local", principalId: "owner" };
function fixture(later = false) {
  const canonical: Note = {
    id: noteId,
    workspaceId: "remote",
    title: "Accepted",
    bodyMd: "原文\n[[target]]",
    kind: "NOTE",
    day: null,
    version: 2,
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:01:00Z",
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
    cursor: 10,
    version: 1,
  };
  const mutation: LocalMutation = {
    id,
    commandId: id,
    deviceId,
    workspaceId: "local",
    principalId: "owner",
    entityType: "notes",
    entityId: noteId,
    operation: "PATCH",
    baseVersion: 1,
    payload: localDto(canonical),
    createdAt: "2026-10-13T00:00:00Z",
    state: "SENDING",
    attemptCount: 1,
    lastAttemptAt: "2026-10-13T00:01:00Z",
  };
  const plan: LocalCommandPlan = {
    id,
    state: "RECEIPT_REQUIRED",
    mutationIds: [id],
    mutations: [mutation],
    command: {
      name: "note.save",
      input: {
        id: noteId,
        version: 1,
        create: false,
        input: {
          title: "Accepted",
          bodyMd: canonical.bodyMd,
          kind: "NOTE",
          day: null,
        },
      },
    },
  };
  const records = new Map<string, LocalEntity>();
  const put = (entity: LocalEntity) =>
    records.set(JSON.stringify([entity.collection, entity.id]), entity);
  put({
    workspaceId: "local",
    collection: "$local.workspace",
    id: "revision",
    version: 4,
    value: { revision: 4 },
  });
  const local = {
    ...canonical,
    workspaceId: "local",
    version: later ? 3 : 2,
    bodyMd: later ? "Later local body" : canonical.bodyMd,
  };
  put({
    workspaceId: "local",
    collection: "notes",
    id: noteId,
    version: local.version,
    value: localDto(bodyManifest(local)),
  });
  put({
    workspaceId: "local",
    collection: "$local.noteBody",
    id: noteId,
    version: 2,
    value: { noteVersion: local.version, bodyMd: local.bodyMd },
  });
  const metadata: LocalMetadataStore = {
    get: async (_workspace, collection, key) =>
      structuredClone(records.get(JSON.stringify([collection, key])) ?? null),
    list: async () => [],
    commit: async () => {
      throw new Error("NO_USER_WRITE_ALLOWED");
    },
  };
  const pending = [
    mutation,
    ...(later
      ? [
          {
            ...mutation,
            id: "later",
            commandId: "later",
            state: "PENDING" as const,
            baseVersion: 2,
            attemptCount: 0,
            lastAttemptAt: null,
          },
        ]
      : []),
  ];
  const receipt = {
    commandId: id,
    deviceId,
    result: canonical,
    effects: [
      {
        collection: "notes",
        id: noteId,
        op: "UPSERT",
        version: 2,
        value: canonical,
      },
    ],
  };
  return { canonical, binding, plan, pending, receipt, metadata, put };
}
const wiki = { extract: () => [], resolve: () => [] };
it("recovers a body receipt after an exact metadata pull and rejects mismatched manifests", async () => {
  const f = fixture();
  const putBase = (value: unknown) =>
    f.put({
      workspaceId: actor.workspaceId,
      collection: "$local.remoteBase",
      id: JSON.stringify(["notes", noteId]),
      version: 1,
      value: localDto({
        remoteWorkspaceId: f.binding.remoteWorkspaceId,
        remotePrincipalId: f.binding.remotePrincipalId,
        serverOrigin: f.binding.serverOrigin,
        epoch: f.binding.epoch,
        version: f.canonical.version,
        value,
      }),
    });
  const manifest = bodyManifest(f.canonical);
  putBase(manifest);
  const recovered = await prepareLocalKnowledgeReplayAcknowledgement(
    actor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
    wiki,
  );
  expect(recovered.acknowledgements).toHaveLength(1);
  expect(
    recovered.records.find((r) => r.entity.collection === "$local.remoteBase")
      ?.entity.value,
  ).toMatchObject({ value: f.canonical });
  for (const wrong of [
    { ...manifest, title: "Changed" },
    { ...manifest, bodyCharacterCount: manifest.bodyCharacterCount + 1 },
    { ...manifest, aiAccess: "ALLOW" },
  ]) {
    putBase(wrong);
    await expect(
      prepareLocalKnowledgeReplayAcknowledgement(
        actor,
        f.binding,
        f.plan,
        f.receipt,
        f.pending,
        f.metadata,
        wiki,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
  }
});
it("knowledge ACK pairs canonical manifest, exact body, revision and search with original receipt and unchanged cursor", async () => {
  const f = fixture();
  const result = await prepareLocalKnowledgeReplayAcknowledgement(
    actor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
    wiki,
  );
  expect(result.nextCursor).toBe(10);
  expect(result.records.map((record) => record.entity.collection)).toEqual([
    "$local.remoteBase",
    "notes",
    "$local.noteBody",
    "$local.noteRevision",
    "$local.noteSearch",
    "$local.noteBodyAvailability",
  ]);
  expect(
    result.records.find((record) => record.entity.collection === "notes")
      ?.entity.value,
  ).not.toHaveProperty("bodyMd");
  expect(
    result.records.find(
      (record) => record.entity.collection === "$local.noteBody",
    )?.entity.value,
  ).toEqual({ noteVersion: 2, bodyMd: f.canonical.bodyMd });
  expect(
    result.records.find(
      (record) => record.entity.collection === "$local.noteRevision",
    )?.entity.value,
  ).toMatchObject({ workspaceId: "local", bodyMd: f.canonical.bodyMd });
  expect(result.acknowledgements).toEqual([
    {
      mutationId: id,
      deviceId,
      attemptCount: 1,
      lastAttemptAt: "2026-10-13T00:01:00Z",
    },
  ]);
});
it("knowledge ACK preserves later pending body and all local derived records while retaining accepted remote base", async () => {
  const f = fixture(true);
  const result = await prepareLocalKnowledgeReplayAcknowledgement(
    actor,
    f.binding,
    f.plan,
    f.receipt,
    f.pending,
    f.metadata,
    wiki,
  );
  expect(result.records).toHaveLength(1);
  expect(result.records[0]?.entity.collection).toBe("$local.remoteBase");
  expect(
    await f.metadata.get("local", "$local.noteBody", noteId),
  ).toMatchObject({ value: { bodyMd: "Later local body", noteVersion: 3 } });
});
it("knowledge ACK refuses unloaded, foreign, forged-version and wrong-device receipts before confirming any mutation", async () => {
  const f = fixture();
  for (const patch of [
    { bodyState: "UNLOADED" },
    { workspaceId: "foreign" },
    { version: 99 },
    { bodyMd: undefined },
  ]) {
    const value = { ...f.canonical, ...patch };
    await expect(
      prepareLocalKnowledgeReplayAcknowledgement(
        actor,
        f.binding,
        f.plan,
        { ...f.receipt, effects: [{ ...f.receipt.effects[0], value }] },
        f.pending,
        f.metadata,
        wiki,
      ),
    ).rejects.toThrow();
  }
  await expect(
    prepareLocalKnowledgeReplayAcknowledgement(
      actor,
      f.binding,
      f.plan,
      { ...f.receipt, deviceId: "foreign" },
      f.pending,
      f.metadata,
      wiki,
    ),
  ).rejects.toThrow("VALIDATION_ERROR");
});
