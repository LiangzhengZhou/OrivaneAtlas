import { expect, test, vi } from "vitest";
import { holdPrivateImage, resolvePrivateImage } from "./privateImageCache";

test("mode changes and viewer reuse one scoped Blob URL; failures remain retryable", async () => {
  const blob = new Blob(["original"], { type: "image/png" });
  const load = vi.fn(async () => blob);
  const path = "/api/v1/files/bytes?id=one";
  const first = await resolvePrivateImage(load, path);
  expect(await resolvePrivateImage(load, path)).toBe(first);
  expect(load).toHaveBeenCalledTimes(1);
  const otherWorkspace = vi.fn(async () => blob);
  const other = await resolvePrivateImage(otherWorkspace, path);
  expect(other).not.toBe(first);
  const failing = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(blob);
  await expect(resolvePrivateImage(failing, path)).rejects.toThrow("offline");
  expect(await resolvePrivateImage(failing, path)).toMatch(/^blob:/);
  expect(failing).toHaveBeenCalledTimes(2);
  URL.revokeObjectURL(first);
  URL.revokeObjectURL(other);
});

test("cache pressure never revokes a mounted reader", async () => {
  const load = vi.fn(async () => new Blob(["original"]));
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const pinned = holdPrivateImage(load, "pinned");
  const url = await pinned.promise;
  for (let index = 0; index < 140; index++) {
    const reader = holdPrivateImage(load, String(index));
    await reader.promise;
    reader.release();
  }
  expect(revoke).toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalledWith(url);
  expect(await resolvePrivateImage(load, "pinned")).toBe(url);
  pinned.release();
  pinned.release();
  revoke.mockRestore();
});
