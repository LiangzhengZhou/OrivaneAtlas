import {
  bodyManifest,
  LocalRuntime,
  LocalWorkspace,
  type Note,
  prepareLocalWorkPull,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it("moving lazy Notes uses metadata, retains CAS, and never fabricates or hydrates bodies", async () => {
  const store = await IndexedDbLocalStore.open(
    "organization-metadata",
    new IDBFactory(),
  );
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  };
  const note: Note = {
    id: crypto.randomUUID(),
    workspaceId: identity.workspaceId,
    kind: "NOTE",
    day: null,
    title: "Metadata only",
    bodyMd: "Private original",
    version: 1,
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    createdBy: identity.principalId,
    updatedBy: identity.principalId,
    deletedAt: null,
    provenance: "HUMAN",
    classification: "PRIVATE",
    boundary: "REMOTE",
    aiAccess: "DENY",
  };
  try {
    const binding = {
      workspaceId: identity.workspaceId,
      remoteWorkspaceId: crypto.randomUUID(),
      remotePrincipalId: crypto.randomUUID(),
      serverOrigin: "https://example.test",
      epoch: "epoch",
      cursor: 0,
      version: 1,
    };
    await store.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity,
        syncState: binding,
        mutations: [],
        entities: [],
      },
      identity.deviceId,
    );
    const remote = {
      ...note,
      workspaceId: binding.remoteWorkspaceId,
      createdBy: binding.remotePrincipalId,
      updatedBy: binding.remotePrincipalId,
    };
    const pull = await prepareLocalWorkPull(
      identity,
      binding,
      {
        epoch: binding.epoch,
        cursor: 1,
        snapshot: null,
        recovery: false,
        hasMore: false,
        records: [
          {
            seq: 1,
            workspaceId: binding.remoteWorkspaceId,
            collection: "notes",
            entityId: note.id,
            op: "UPSERT",
            version: 1,
          },
        ],
        changes: {
          values: {},
          collections: {
            notes: { upserts: [bodyManifest(remote)], removed: [] },
          },
        },
      },
      [],
      store.metadata,
    );
    if (!pull) throw new Error("Expected Note projection");
    await store.replica.commit(pull);
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        store.metadata,
        { get: async () => null, put: async () => {} },
        identity,
        { extract: () => [], resolve: () => [] },
        { now: () => note.updatedAt },
        { next: () => crypto.randomUUID() },
      ),
    );
    await expect(
      runtime.organize({
        kind: "NOTE",
        action: "move",
        folder: "量子场论",
        entries: [{ id: note.id, version: 1, organizationVersion: 0 }],
      }),
    ).resolves.toEqual({ changed: 1 });
    await expect(
      runtime.organize({
        kind: "NOTE",
        action: "move",
        folder: "Wrong",
        entries: [{ id: note.id, version: 1, organizationVersion: 0 }],
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      runtime.organize({
        kind: "NOTE",
        action: "move",
        folder: "Wrong",
        entries: [{ id: note.id, version: 2, organizationVersion: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const snapshot = await runtime.loadWorkspace();
    expect(snapshot.organization).toEqual([
      expect.objectContaining({ id: note.id, folder: "量子场论", version: 1 }),
    ]);
    expect(
      await store.metadata.get(identity.workspaceId, "notes", note.id),
    ).toMatchObject({ version: 1, value: { bodyState: "UNLOADED" } });
    expect(
      await store.metadata.get(
        identity.workspaceId,
        "$local.noteBody",
        note.id,
      ),
    ).toBeNull();
    expect(await store.outbox.list(identity.workspaceId)).toHaveLength(1);
  } finally {
    store.close();
  }
});
