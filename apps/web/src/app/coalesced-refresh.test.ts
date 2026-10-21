import { expect, it } from "vitest";
import { coalescedRefresh } from "./coalesced-refresh";

it("coalesces overlap and awaits a fresh read after an in-flight change", async () => {
  const reads: boolean[] = [];
  let finish: (() => void) | undefined;
  let current = 1;
  let projected = 0;
  const refresh = coalescedRefresh(async (showError) => {
    reads.push(showError);
    const captured = current;
    if (reads.length === 1)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    projected = captured;
  });
  const first = refresh(false);
  await Promise.resolve();
  current = 2;
  const second = refresh(true);
  const third = refresh(false);
  expect(second).toBe(first);
  expect(third).toBe(first);
  finish!();
  await Promise.all([first, second, third]);
  expect(projected).toBe(2);
  expect(reads).toEqual([false, true]);
  await refresh(false);
  expect(reads).toEqual([false, true, false]);
});

it("propagates failures and permits a subsequent refresh", async () => {
  let failed = true;
  const refresh = coalescedRefresh(async () => {
    if (failed) throw new Error("READ_FAILED");
  });
  await expect(refresh(true)).rejects.toThrow("READ_FAILED");
  failed = false;
  await expect(refresh(false)).resolves.toBeUndefined();
});
