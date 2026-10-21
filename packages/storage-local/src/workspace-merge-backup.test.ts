import { createHash, randomUUID } from "node:crypto";
import {
  prepareWorkspaceMergeBackup,
  previewWorkspaceBinding,
  type WorkspaceConnectionPreview,
} from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, test, vi } from "vitest";
import { IndexedDbWorkspaceMergeBackups } from "./workspace-merge-backup";

const actor = { workspaceId: randomUUID(), principalId: randomUUID() };
const preview: WorkspaceConnectionPreview = {
  ...previewWorkspaceBinding(
    actor,
    { workspaceId: actor.workspaceId, revision: 2, records: [] },
    { workspaceId: randomUUID(), revision: 8, records: [] },
  ),
  remotePrincipalId: randomUUID(),
  serverOrigin: "https://example.test",
  epoch: "epoch",
};
const digest = async (bytes: Blob) =>
  createHash("sha256")
    .update(Buffer.from(await bytes.arrayBuffer()))
    .digest("hex");

test("immutable merge backups survive reopening with byte-identical originals and scoped review evidence", async () => {
  const factory = new IDBFactory(),
    name = randomUUID();
  let store = await IndexedDbWorkspaceMergeBackups.open(name, factory);
  const bytes = new Blob(["ORIVANE1 original portable archive\n原始文件"]);
  const backup = await prepareWorkspaceMergeBackup(actor, preview, {
    revision: async () => 2,
    archive: async () => bytes,
    digest,
    store,
    assertScope: () => {},
    id: randomUUID,
    now: () => "2026-10-15T00:00:00Z",
  });
  store.close();
  store = await IndexedDbWorkspaceMergeBackups.open(name, factory);
  try {
    const recovered = await store.get(backup.id);
    expect(recovered).toMatchObject({
      sourceWorkspaceId: actor.workspaceId,
      sourceRevision: 2,
      targetWorkspaceId: preview.remoteWorkspaceId,
      targetRevision: 8,
      sha256: backup.sha256,
    });
    expect(await recovered!.bytes.text()).toBe(await bytes.text());
    await expect(
      store.save({ ...backup, bytes: new Blob(["replaced original"]) }),
    ).rejects.toThrow();
    expect(await (await store.get(backup.id))!.bytes.text()).toBe(
      await bytes.text(),
    );
  } finally {
    store.close();
  }
});

test("a source edit during archive generation refuses eligibility and never stores a misleading backup", async () => {
  const factory = new IDBFactory(),
    store = await IndexedDbWorkspaceMergeBackups.open(randomUUID(), factory);
  let revision = 2;
  const save = vi.spyOn(store, "save");
  try {
    await expect(
      prepareWorkspaceMergeBackup(actor, preview, {
        revision: async () => revision,
        archive: async () => {
          revision = 3;
          return new Blob(["ORIVANE1 original archive"]);
        },
        digest,
        store,
        assertScope: () => {},
        id: randomUUID,
        now: () => "2026-10-15T00:00:00Z",
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(save).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});
