import {
  buildLocalWorkReplayRequest,
  LocalRuntime,
  LocalWorkspace,
  planLocalCommands,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it("persists owned-resource archive and restore as one replayable command each", async () => {
  const factory = new IDBFactory();
  let store = await IndexedDbLocalStore.open("project-archive", factory);
  const identity = {
    schemaVersion: 1 as const,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    principalId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
  };
  const runtime = () =>
    new LocalRuntime(
      new LocalWorkspace(
        store.metadata,
        {
          get: async () => null,
          put: async () => {
            throw new Error("unexpected blob write");
          },
        },
        identity,
        { extract: () => [], resolve: () => [] },
        { now: () => "2026-11-06T00:00:00.000Z" },
        { next: () => crypto.randomUUID() },
      ),
    );
  try {
    const first = runtime();
    const project = await first.service.create(first.context, {
      type: "PROJECT",
      title: "Offline project",
    });
    const space = await first.createProjectSpace({
      projectId: project.id,
      title: "Owned space",
    });
    const document = await first.createProjectDocument({
      projectId: project.id,
      spaceId: space.spaceId,
      title: "Original",
      bodyMd: "# Body preserved",
    });
    const before = await store.outbox.list(identity.workspaceId);
    const archived = await first.service.update(
      first.context,
      project.id,
      project.version,
      { archived: true },
    );
    expect((await store.outbox.list(identity.workspaceId)).length).toBe(
      before.length + 5,
    );
    const pending = (await store.outbox.list(identity.workspaceId)).filter(
      (entry) => !before.some((old) => old.id === entry.id),
    );
    const plans = await planLocalCommands(
      first.context,
      store.metadata,
      pending,
    );
    expect(plans).toHaveLength(1);
    const request = buildLocalWorkReplayRequest(plans[0]!);
    expect(request?.path).toBe("/api/v1/work/update");
    expect(plans[0]?.mutations.map((entry) => entry.entityType).sort()).toEqual(
      ["items", "library", "library", "projectMaterials", "projectMaterials"],
    );
    store.close();
    store = await IndexedDbLocalStore.open("project-archive", factory);
    const reopened = runtime();
    const snapshot = await reopened.service.snapshot(reopened.context);
    expect(
      snapshot.items.find((item) => item.id === project.id)?.archivedAt,
    ).toBe(archived.archivedAt);
    const restored = await reopened.service.update(
      reopened.context,
      project.id,
      archived.version,
      { archived: false },
    );
    expect(restored.archivedAt).toBeNull();
    const full = await reopened.readDocumentBody(document);
    expect(full.bodyMd).toBe("# Body preserved");
    expect(full.deletedAt).toBeNull();
    expect((await store.outbox.list(identity.workspaceId)).length).toBe(
      before.length + 10,
    );
    await expect(
      reopened.service.update(reopened.context, project.id, archived.version, {
        archived: true,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await store.outbox.list(identity.workspaceId)).length).toBe(
      before.length + 10,
    );
  } finally {
    store.close();
  }
});
