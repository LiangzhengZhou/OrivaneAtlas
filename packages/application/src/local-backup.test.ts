import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { exportLocalWorkspace, restoreLocalWorkspace } from "./local-backup";
import type {
  LocalBlobStore,
  LocalMetadataStore,
  LocalWorkspaceArchive,
} from "./local-persistence";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const archive: LocalWorkspaceArchive = {
  schemaVersion: 2,
  identity: {
    schemaVersion: 1,
    workspaceId,
    principalId: "22222222-2222-4222-8222-222222222222",
    deviceId: "33333333-3333-4333-8333-333333333333",
  },
  entities: [],
  mutations: [],
  syncState: null,
};
const deviceId = "44444444-4444-4444-8444-444444444444";
function fixture() {
  const metadata: LocalMetadataStore = {
    get: async () => null,
    list: async () => [],
    commit: async () => {},
    exportWorkspace: async () => archive,
    assertEmptyWorkspace: vi.fn(async () => {}),
    restoreEmptyWorkspace: vi.fn(async () => {}),
  };
  const blobs: LocalBlobStore = {
    listHashes: async () => [],
    get: async () => null,
    put: vi.fn(async () => {}),
    digest: async (bytes) =>
      createHash("sha256")
        .update(Buffer.from(await bytes.arrayBuffer()))
        .digest("hex"),
  };
  return { metadata, blobs };
}
test("valid empty local backup declares excluded vault and preserves identity on isolated restore", async () => {
  const { metadata, blobs } = fixture();
  const backup = await exportLocalWorkspace(workspaceId, metadata, blobs);
  await restoreLocalWorkspace(backup, deviceId, metadata, blobs);
  expect(metadata.restoreEmptyWorkspace).toHaveBeenCalledWith(
    archive,
    deviceId,
  );
  expect(blobs.put).not.toHaveBeenCalled();
});
test("malformed/truncated/trailing archives and reused device identity never mutate a store", async () => {
  const { metadata, blobs } = fixture();
  const backup = await exportLocalWorkspace(workspaceId, metadata, blobs);
  for (const invalid of [
    new Blob(["garbage"]),
    backup.slice(0, 17),
    new Blob([backup, "trailing"]),
  ])
    await expect(
      restoreLocalWorkspace(invalid, deviceId, metadata, blobs),
    ).rejects.toThrow();
  await expect(
    restoreLocalWorkspace(backup, archive.identity.deviceId, metadata, blobs),
  ).rejects.toThrow("LOCAL_BACKUP_INVALID");
  expect(metadata.restoreEmptyWorkspace).not.toHaveBeenCalled();
  expect(blobs.put).not.toHaveBeenCalled();
});
test("occupied target is rejected before any binary staging", async () => {
  const { metadata, blobs } = fixture();
  const source = new Blob([new Uint8Array([0, 128, 255])]);
  const hash = await blobs.digest!(source);
  metadata.exportWorkspace = async () => ({
    ...archive,
    entities: [
      {
        workspaceId,
        collection: "files",
        id: "file",
        version: 1,
        value: { contentHash: hash },
      },
    ],
  });
  blobs.get = async () => source;
  const backup = await exportLocalWorkspace(workspaceId, metadata, blobs);
  vi.mocked(metadata.assertEmptyWorkspace!).mockRejectedValue(
    new Error("LOCAL_RESTORE_TARGET_NOT_EMPTY"),
  );
  await expect(
    restoreLocalWorkspace(backup, deviceId, metadata, blobs),
  ).rejects.toThrow("LOCAL_RESTORE_TARGET_NOT_EMPTY");
  expect(blobs.put).not.toHaveBeenCalled();
  expect(metadata.restoreEmptyWorkspace).not.toHaveBeenCalled();
  const bytes = new Uint8Array(await backup.arrayBuffer());
  const last = bytes.at(-1);
  if (last === undefined) throw new Error("EMPTY_BACKUP");
  bytes[bytes.length - 1] = last ^ 1;
  await expect(
    restoreLocalWorkspace(new Blob([bytes]), deviceId, metadata, blobs),
  ).rejects.toThrow("LOCAL_BACKUP_HASH_MISMATCH");
  expect(blobs.put).not.toHaveBeenCalled();
});
