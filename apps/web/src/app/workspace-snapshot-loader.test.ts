import { expect, it, vi } from "vitest";
import { workspaceSnapshotLoader } from "./workspace-snapshot-loader";

it("skips only an already published unchanged durable revision and invalidates on real changes", async () => {
  let revision: number | null = null;
  const load = vi.fn(async () => ({ revision }));
  const publish = vi.fn(() => true);
  const read = workspaceSnapshotLoader(async () => revision, load);
  await read(publish);
  await read(publish);
  expect(load).toHaveBeenCalledTimes(1);
  revision = 1;
  await read(publish);
  expect(load).toHaveBeenCalledTimes(2);
  const otherScope = workspaceSnapshotLoader(async () => revision, load);
  await otherScope(publish);
  expect(load).toHaveBeenCalledTimes(3);
});

it("never pins failed, unpublished, or concurrently invalidated snapshots", async () => {
  let revision = 1;
  const load = vi.fn(async () => ({ revision }));
  const read = workspaceSnapshotLoader(async () => revision, load);
  await read(() => false);
  await read(() => true);
  expect(load).toHaveBeenCalledTimes(2);
  revision++;
  load.mockImplementationOnce(async () => {
    revision++;
    return { revision };
  });
  await read(() => true);
  await read(() => true);
  expect(load).toHaveBeenCalledTimes(4);
  revision++;
  load.mockRejectedValueOnce(new Error("READ_FAILED"));
  await expect(read(() => true)).rejects.toThrow("READ_FAILED");
  await read(() => true);
  expect(load).toHaveBeenCalledTimes(6);
});

it("pins its own validated repair revision but never a later concurrent commit", async () => {
  let revision = 1;
  const load = vi.fn(async () => ({ revision: ++revision }));
  const publish = vi.fn(() => true);
  const read = workspaceSnapshotLoader(
    async () => revision,
    load,
    (value) => value.revision,
  );
  await read(publish);
  await read(publish);
  expect(load).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
  let probes = 0;
  const contended = workspaceSnapshotLoader(
    async () => {
      if (++probes === 2) revision++;
      return revision;
    },
    load,
    (value) => value.revision,
  );
  await contended(publish);
  await contended(publish);
  await contended(publish);
  expect(load).toHaveBeenCalledTimes(3);
  expect(publish).toHaveBeenCalledTimes(3);
});
