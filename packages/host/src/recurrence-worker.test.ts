import { afterEach, expect, test, vi } from "vitest";
import { startRecurrenceWorker } from "./recurrence-worker";

afterEach(() => vi.useRealTimers());
test("single-flight startup, periodic retry and drain on shutdown", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const tick = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const worker = startRecurrenceWorker(tick, 100);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(500);
  expect(tick).toHaveBeenCalledTimes(1);
  let closed = false;
  const closing = worker.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  await closing;
  await vi.advanceTimersByTimeAsync(500);
  await worker.run();
  expect(tick).toHaveBeenCalledTimes(1);
});
test("failure is isolated and later ticks retry", async () => {
  vi.useFakeTimers();
  const failed = vi.fn();
  const tick = vi
    .fn()
    .mockRejectedValueOnce(new Error("private details"))
    .mockResolvedValue(undefined);
  const worker = startRecurrenceWorker(tick, 100, failed);
  await vi.advanceTimersByTimeAsync(101);
  expect(tick).toHaveBeenCalledTimes(2);
  expect(failed).toHaveBeenCalledTimes(1);
  await worker.close();
});
