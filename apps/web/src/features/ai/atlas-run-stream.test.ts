import type { AgentRun, ModelEventPage } from "@arclattice/application";
import { afterEach, expect, it, vi } from "vitest";
import { observeAtlasRun } from "./atlas-run-stream";

afterEach(() => vi.useRealTimers());
const finished = { id: "run", status: "SUCCEEDED", output: "ABC" } as AgentRun;

it("SSE fallback keeps its cursor, ignores overlapping deltas and reads only the finished run", async () => {
  vi.useFakeTimers();
  const runtime = {
    streamAiEvents: vi.fn(
      async (
        _id: string,
        _signal: AbortSignal,
        append: (page: ModelEventPage) => void,
      ) => {
        append({
          cursor: 2,
          done: false,
          events: [
            { type: "text-delta", text: "A" },
            { type: "text-delta", text: "B" },
          ],
        });
        throw new Error("STREAM_DISCONNECTED");
      },
    ),
    aiEvents: vi
      .fn()
      .mockResolvedValueOnce({
        cursor: 3,
        done: false,
        events: [
          { type: "text-delta", text: "B" },
          { type: "text-delta", text: "C" },
        ],
      })
      .mockResolvedValueOnce({
        cursor: 4,
        done: true,
        events: [{ type: "completed" }],
      }),
    agentRun: vi.fn(async () => finished),
  };
  const delta = vi.fn(),
    complete = vi.fn(),
    error = vi.fn();
  const stop = observeAtlasRun(runtime, "run", delta, complete, error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(runtime.aiEvents.mock.calls).toEqual([["run", 2]]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(runtime.aiEvents.mock.calls).toEqual([
    ["run", 2],
    ["run", 3],
  ]);
  expect(delta.mock.calls.flat().join("")).toBe("ABC");
  expect(runtime.agentRun).toHaveBeenCalledExactlyOnceWith("run");
  expect(complete).toHaveBeenCalledExactlyOnceWith(finished);
  expect(error).not.toHaveBeenCalled();
  stop();
});
it("closing a floating surface cancels transport and prevents a completed-stream metadata download", async () => {
  vi.useFakeTimers();
  let resolve: (() => void) | undefined;
  const runtime = {
    streamAiEvents: vi.fn(
      (
        _id: string,
        _signal: AbortSignal,
        _append: (page: ModelEventPage) => void,
      ) =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    ),
    aiEvents: vi.fn(),
    agentRun: vi.fn(async () => finished),
  };
  const complete = vi.fn(),
    stop = observeAtlasRun(runtime, "run", vi.fn(), complete, vi.fn());
  stop();
  resolve?.();
  await vi.advanceTimersByTimeAsync(10000);
  expect(runtime.streamAiEvents.mock.calls[0]![1].aborted).toBe(true);
  expect(runtime.aiEvents).not.toHaveBeenCalled();
  expect(runtime.agentRun).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
