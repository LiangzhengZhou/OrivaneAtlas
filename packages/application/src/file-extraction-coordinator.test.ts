import type { ActorContext, FileExtractionDocument } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import { FileExtractionCoordinator } from "./file-extraction-coordinator";

const actor = { workspaceId: "local", principalId: "owner" };
const document: FileExtractionDocument = {
  workspaceId: "local",
  fileId: "file",
  fileVersion: 1,
  contentHash: "a".repeat(64),
  indexVersion: 2,
  chunks: [],
};
function fixture() {
  let resolve!: (document: FileExtractionDocument) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<FileExtractionDocument>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const service = {
    extract: vi.fn(
      async (
        _actor: ActorContext,
        _id: string,
        _version: number,
        _signal?: AbortSignal,
      ) => promise,
    ),
  };
  const coordinator = new FileExtractionCoordinator(service);
  return { service, coordinator, resolve, reject };
}
it("preview and background observers share one producer for the same actor and source version", async () => {
  const f = fixture();
  const first = f.coordinator.extract(actor, "file", 1);
  const second = f.coordinator.extract(actor, "file", 1);
  expect(f.service.extract).toHaveBeenCalledTimes(1);
  f.resolve(document);
  expect(await first).toEqual(document);
  expect(await second).toEqual(document);
});
it("closing a preview cancels only that observer while background extraction continues", async () => {
  const f = fixture();
  const controller = new AbortController();
  const preview = f.coordinator.extract(actor, "file", 1, controller.signal);
  const canceled = expect(preview).rejects.toThrow("CANCELED");
  const background = f.coordinator.extract(actor, "file", 1);
  controller.abort();
  await canceled;
  expect(f.service.extract.mock.calls[0]?.[3]?.aborted).toBe(false);
  f.resolve(document);
  expect(await background).toEqual(document);
});
it("the final observer cancels underlying work and failures permit a fresh attempt", async () => {
  const f = fixture();
  const controller = new AbortController();
  const request = f.coordinator.extract(actor, "file", 1, controller.signal);
  const canceled = expect(request).rejects.toThrow("CANCELED");
  controller.abort();
  await canceled;
  expect(f.service.extract.mock.calls[0]?.[3]?.aborted).toBe(true);
  f.reject(new Error("SOURCE_CHANGED"));
  const fresh = f.coordinator.extract(actor, "file", 1);
  await expect(fresh).rejects.toThrow("SOURCE_CHANGED");
  expect(f.service.extract).toHaveBeenCalledTimes(2);
});
it("foreign actors and different versions never share a private producer", async () => {
  const f = fixture();
  const requests = [
    f.coordinator.extract(actor, "file", 1),
    f.coordinator.extract({ ...actor, principalId: "other" }, "file", 1),
    f.coordinator.extract(actor, "file", 2),
  ];
  expect(f.service.extract).toHaveBeenCalledTimes(3);
  f.resolve(document);
  await Promise.all(requests);
});
