import { expect, it, vi } from "vitest";
import { scopedImageLoader } from "./scoped-image-loader";

it("keeps a stable loader only within one server/account/workspace generation", async () => {
  let identity = "server-A|owner-A|workspace-A|1";
  const load = vi.fn(async () => new Blob(["private"]));
  const current = scopedImageLoader(() => identity, load);
  const old = current();
  expect(current()).toBe(old);
  await old("image");
  identity = "server-A|owner-B|workspace-A|2";
  expect(current()).not.toBe(old);
  await expect(old("image")).rejects.toThrow("SERVER_CHANGED");
  expect(load).toHaveBeenCalledTimes(1);
});

it("rejects bytes from a download completed after an account change", async () => {
  let identity = "A";
  let finish!: (blob: Blob) => void;
  const current = scopedImageLoader(
    () => identity,
    () =>
      new Promise<Blob>((resolve) => {
        finish = resolve;
      }),
  );
  const request = current()("image");
  identity = "B";
  finish(new Blob(["owner A"]));
  await expect(request).rejects.toThrow("SERVER_CHANGED");
});
