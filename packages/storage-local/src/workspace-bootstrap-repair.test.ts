import {
  bodyManifest,
  LocalRuntime,
  type LocalSyncState,
  LocalWorkSyncCoordinator,
  LocalWorkspace,
  type Note,
  prepareLocalWorkPull,
  prepareLocalWorkspaceBootstrap,
  preserveReplicaBootstrapBackup,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { edge, work } from "../../../tests/fixtures";
import { IndexedDbLocalBlobStore } from "./blob-store";
import { IndexedDbLocalStore } from "./indexed-db";
import { IndexedDbWorkspaceMergeBackups } from "./workspace-merge-backup";

const own = {
  schemaVersion: 1 as const,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  deviceId: "33333333-3333-4333-8333-333333333333",
};
const scope: LocalSyncState = {
  workspaceId: own.workspaceId,
  remoteWorkspaceId: "remote",
  remotePrincipalId: "remote-owner",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  cursor: 272,
  version: 1,
};
const originalText =
  "# Original\r\n中文 $Z=0$\n![Original](/api/library/asset?id=original)";
function manifest() {
  const root = {
    ...work("historical-root", "remote"),
    type: "PROJECT",
    lifecycle: "PLANNED",
    version: 7,
  };
  const child = {
    ...root,
    id: "historical-child",
    parentProjectId: root.id,
    version: 4,
  };
  const task = {
    ...work("historical-task", "remote"),
    projectIds: [root.id],
    version: 3,
  };
  const milestone = {
    ...work("historical-milestone", "remote"),
    type: "MILESTONE",
  };
  const note: Note = {
    id: "historical-note",
    workspaceId: "remote",
    title: "Research",
    bodyMd: originalText,
    kind: "NOTE",
    day: null,
    version: 5,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    createdBy: "remote-owner",
    updatedBy: "remote-owner",
    deletedAt: null,
    classification: "PRIVATE",
    boundary: "REMOTE",
    aiAccess: "DENY",
    provenance: "HUMAN",
  };
  return {
    schemaVersion: 1,
    epoch: "epoch",
    cursor: 272,
    notes: [
      bodyManifest(note),
      bodyManifest({
        ...note,
        id: "historical-journal",
        kind: "JOURNAL",
        day: "2026-10-01",
      }),
    ],
    library: [],
    workspace: {
      items: [
        root,
        child,
        task,
        milestone,
        { ...root, id: "soft-deleted", deletedAt: "2026-10-02T00:00:00Z" },
      ],
      edges: [edge(task.id, milestone.id, "BLOCKS", "remote")],
      projectMaterials: [],
      organization: [],
      links: [],
      files: [],
    },
  };
}

it("repairs untouched pre-log projects, preserves pending Markdown and original backup, then survives restart", async () => {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("partial", factory);
  const blobs = await IndexedDbLocalBlobStore.open("partial", factory);
  const backups = await IndexedDbWorkspaceMergeBackups.open("backups", factory);
  try {
    await store.metadata.restoreEmptyWorkspace!(
      {
        schemaVersion: 2,
        identity: own,
        syncState: scope,
        entities: [],
        mutations: [],
      },
      own.deviceId,
    );
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        store.metadata,
        blobs,
        own,
        { extract: () => [], resolve: () => [] },
        { now: () => "2026-10-22T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      ),
    );
    const local = await runtime.saveNote(null, 0, {
      title: "Pending original",
      bodyMd: originalText,
      kind: "NOTE",
      day: null,
    });
    const before = await store.metadata.exportWorkspace!(own.workspaceId);
    const pending = await store.outbox.list(own.workspaceId);
    // The released client's delta-only path cannot discover historical entities.
    expect(
      await prepareLocalWorkPull(
        own,
        scope,
        {
          epoch: "epoch",
          cursor: 272,
          recovery: false,
          hasMore: false,
          snapshot: null,
          records: [],
          changes: { collections: {}, values: {} },
        },
        pending,
        store.metadata,
      ),
    ).toBeNull();
    expect((await runtime.loadWorkspace()).items).toHaveLength(0);
    const snapshot = manifest();
    const prepared = await prepareLocalWorkspaceBootstrap(
      own,
      scope,
      snapshot,
      pending,
      store.metadata,
    );
    await preserveReplicaBootstrapBackup(
      own,
      scope,
      prepared.expectedWorkspaceVersion,
      prepared.nextCursor,
      {
        metadata: store.metadata,
        blobs,
        store: backups,
        assertScope() {},
        id: () => "44444444-4444-4444-8444-444444444444",
        now: () => "2026-10-22T00:00:00Z",
      },
    );
    await store.replica.commit(prepared);
    const result = await runtime.loadWorkspace();
    expect(result.items.map((item) => [item.id, item.version]).sort()).toEqual(
      snapshot.workspace.items.map((item) => [item.id, item.version]).sort(),
    );
    expect(result.edges).toHaveLength(1);
    expect(await runtime.readDocumentBody(local)).toMatchObject({
      bodyMd: originalText,
      version: local.version,
    });
    expect(await store.outbox.list(own.workspaceId)).toEqual(pending);
    expect((await store.syncState.get(own.workspaceId))!.cursor).toBe(272);
    expect(
      await store.metadata.get(
        own.workspaceId,
        "$local.workspaceBootstrap",
        "complete",
      ),
    ).not.toBeNull();
    const preserved = await backups.get("44444444-4444-4444-8444-444444444444");
    expect(preserved).not.toBeNull();
    const bytes = preserved!.bytes;
    const length = new DataView(
      await bytes.slice(0, 16).arrayBuffer(),
    ).getUint32(8, false);
    expect(
      JSON.parse(await bytes.slice(16, 16 + length).text()).archive,
    ).toEqual(before);
    const reopened = await IndexedDbLocalStore.open("partial", factory);
    try {
      expect(
        await reopened.metadata.list(own.workspaceId, "items"),
      ).toHaveLength(5);
    } finally {
      reopened.close();
    }
  } finally {
    store.close();
    blobs.close();
    backups.close();
  }
});

it("rejects incomplete, wrong-workspace and stale snapshots before any commit", async () => {
  const factory = new IDBFactory();
  const store = await IndexedDbLocalStore.open("negative", factory);
  try {
    const data = manifest();
    for (const bad of [
      { ...data, cursor: 271 },
      { ...data, epoch: "foreign" },
      { ...data, workspace: {} },
      {
        ...data,
        workspace: {
          ...data.workspace,
          items: [{ ...data.workspace.items[0], workspaceId: "foreign" }],
        },
      },
    ]) {
      await expect(
        prepareLocalWorkspaceBootstrap(own, scope, bad, [], store.metadata),
      ).rejects.toThrow();
      expect(await store.metadata.list(own.workspaceId, "items")).toEqual([]);
    }
  } finally {
    store.close();
  }
});

it.each([false, true])(
  "coordinator completes %s partial replicas before replay and pins completeness across restart",
  async (partial) => {
    const factory = new IDBFactory();
    const store = await IndexedDbLocalStore.open("coordinator", factory);
    try {
      const initial = { ...scope, cursor: 0 };
      await store.metadata.restoreEmptyWorkspace!(
        {
          schemaVersion: 2,
          identity: own,
          syncState: initial,
          entities: [],
          mutations: [],
        },
        own.deviceId,
      );
      const snapshot = manifest();
      if (partial) {
        const old = snapshot.workspace.items.at(-1)!;
        const delta = await prepareLocalWorkPull(
          own,
          initial,
          {
            epoch: "epoch",
            cursor: 272,
            recovery: false,
            hasMore: false,
            snapshot: null,
            records: [
              {
                seq: 272,
                workspaceId: "remote",
                collection: "items",
                entityId: old.id,
                version: old.version,
                op: "UPSERT",
              },
            ],
            changes: {
              collections: { items: { upserts: [old], removed: [] } },
              values: {},
            },
          },
          [],
          store.metadata,
        );
        await store.replica.commit(delta!);
        expect(
          await store.metadata.list(own.workspaceId, "items"),
        ).toHaveLength(1);
      }
      const bootstrap = vi.fn(async () => snapshot);
      const backup = vi.fn(async () => {
        expect(
          await store.metadata.get(
            own.workspaceId,
            "$local.workspaceBootstrap",
            "complete",
          ),
        ).toBeNull();
      });
      const ports = {
        metadata: store.metadata,
        outbox: store.outbox,
        syncState: store.syncState,
        replica: store.replica,
        beforeBootstrap: backup,
        transport: {
          bootstrap,
          lookup: async () => null,
          send: async () => {
            throw Error("UNEXPECTED_SEND");
          },
          pull: async () => ({
            epoch: "epoch",
            cursor: 272,
            recovery: false,
            hasMore: false,
            snapshot: null,
            records: [],
            changes: { collections: {}, values: {} },
          }),
        },
        clock: { now: () => "2026-10-22T00:00:00Z" },
      };
      await new LocalWorkSyncCoordinator(own, ports).run();
      expect(await store.metadata.list(own.workspaceId, "items")).toHaveLength(
        5,
      );
      await new LocalWorkSyncCoordinator(own, ports).run();
      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(backup).toHaveBeenCalledTimes(1);
      expect(await store.outbox.list(own.workspaceId)).toEqual([]);
    } finally {
      store.close();
    }
  },
);
