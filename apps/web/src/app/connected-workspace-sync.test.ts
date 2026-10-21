import { afterEach, expect, it, vi } from "vitest";
import { connectedWorkspaceSync } from "./connected-workspace-sync";

afterEach(() => vi.useRealTimers());
const schedule = (callback: () => void, delay: number) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};

it("defers work until after shell mount and never opens a stream for an unbound workspace", async () => {
  vi.useFakeTimers();
  const sync = vi.fn(async () => null),
    stream = vi.fn(),
    onOffline = vi.fn();
  const loop = connectedWorkspaceSync({
    sync,
    stream,
    onOffline,
    schedule,
    visible: () => true,
  });
  expect(sync).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(stream).not.toHaveBeenCalled();
  loop.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(sync).toHaveBeenCalledTimes(1);
});

it("backs off failed pulls at one, two and four seconds", async () => {
  vi.useFakeTimers();
  const sync = vi.fn(async () => {
    throw new Error("offline");
  });
  const loop = connectedWorkspaceSync({
    sync,
    onOffline: vi.fn(),
    schedule,
    visible: () => true,
  });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(999);
  expect(sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(sync).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(sync).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(4000);
  expect(sync).toHaveBeenCalledTimes(4);
  loop.stop();
});

it("keeps the SSE hint cursor separate from the durable cursor and aborts when unbound", async () => {
  vi.useFakeTimers();
  let changed!: (cursor: string) => void;
  let signal!: AbortSignal;
  const sync = vi
    .fn<() => Promise<{ cursor: number } | null>>()
    .mockResolvedValueOnce({ cursor: 42 })
    .mockResolvedValueOnce(null);
  const stream = vi.fn(
    (cursor: string, current: AbortSignal, wake: (cursor: string) => void) => {
      expect(cursor).toBe("");
      signal = current;
      changed = wake;
      return new Promise<void>((resolve) =>
        current.addEventListener("abort", () => resolve()),
      );
    },
  );
  const loop = connectedWorkspaceSync({
    sync,
    stream,
    onOffline: vi.fn(),
    schedule,
    visible: () => true,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(stream).toHaveBeenCalledTimes(1);
  changed("0123456789abcdef0123456789abcdef:42");
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(signal.aborted).toBe(true);
  loop.stop();
});

it("coalesces local wakes during a pull and suppresses completion after cleanup", async () => {
  vi.useFakeTimers();
  let resolve!: (value: { cursor: number }) => void;
  const sync = vi.fn(
    () =>
      new Promise<{ cursor: number }>((done) => {
        resolve = done;
      }),
  );
  const onOffline = vi.fn();
  const loop = connectedWorkspaceSync({
    sync,
    onOffline,
    schedule,
    visible: () => true,
  });
  await vi.advanceTimersByTimeAsync(0);
  loop.wake();
  loop.wake();
  loop.wake();
  resolve({ cursor: 3 });
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(2);
  loop.stop();
  onOffline.mockClear();
  resolve({ cursor: 4 });
  await vi.advanceTimersByTimeAsync(60000);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(onOffline).not.toHaveBeenCalled();
});

it("reconnects using the last SSE hint while canonical pulls retain their own durable state", async () => {
  vi.useFakeTimers();
  const hint = "0123456789abcdef0123456789abcdef:99";
  let changed!: (cursor: string) => void;
  let end!: () => void;
  const stream = vi.fn(
    (
      _cursor: string,
      signal: AbortSignal,
      onCursor: (cursor: string) => void,
    ) => {
      changed = onCursor;
      return new Promise<void>((resolve) => {
        end = resolve;
        signal.addEventListener("abort", () => resolve());
      });
    },
  );
  const sync = vi.fn(async () => ({ cursor: 2 }));
  const loop = connectedWorkspaceSync({
    sync,
    stream,
    onOffline: vi.fn(),
    schedule,
    visible: () => true,
  });
  await vi.advanceTimersByTimeAsync(0);
  changed(hint);
  await vi.advanceTimersByTimeAsync(0);
  end();
  await vi.advanceTimersByTimeAsync(1000);
  expect(stream).toHaveBeenCalledTimes(2);
  expect(stream.mock.calls[1]?.[0]).toBe(hint);
  expect(sync).toHaveBeenCalledTimes(3);
  loop.stop();
});

it("backs off an unavailable SSE endpoint even when finite canonical pulls succeed", async () => {
  vi.useFakeTimers();
  const stream = vi.fn(async () => {
    throw new Error("STREAM_UNAVAILABLE");
  });
  const loop = connectedWorkspaceSync({
    sync: async () => ({ cursor: 1 }),
    stream,
    onOffline: vi.fn(),
    schedule,
    visible: () => true,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(stream).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(stream).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(stream).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(stream).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(4000);
  expect(stream).toHaveBeenCalledTimes(4);
  loop.stop();
});
