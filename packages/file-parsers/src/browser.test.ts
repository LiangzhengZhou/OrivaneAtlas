import { fileExtractionLimits } from "@arclattice/application";
import { afterEach, expect, it, vi } from "vitest";
import { WorkerFileParser, WorkerFileSearchIndex } from "./browser";

function harness() {
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const factory = vi.fn(() => worker as unknown as Worker);
  return { worker, factory, parser: new WorkerFileParser(factory) };
}
afterEach(() => vi.useRealTimers());
it("terminates a stalled parser at the hard deadline", async () => {
  vi.useFakeTimers();
  const { parser, worker } = harness();
  const result = parser.parse("pdf", new Uint8Array([1]));
  const rejected = expect(result).rejects.toThrow("TIMEOUT");
  await vi.advanceTimersByTimeAsync(fileExtractionLimits.milliseconds);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancellation terminates parsing and late results cannot revive it", async () => {
  vi.useFakeTimers();
  const { parser, worker } = harness();
  const abort = new AbortController();
  const result = parser.parse("docx", new Uint8Array([1]), abort.signal);
  const rejected = expect(result).rejects.toThrow("CANCELED");
  abort.abort();
  worker.onmessage?.({ data: { ok: true, sections: [] } } as MessageEvent);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("transfers a copy, preserves original bytes and releases the worker on success", async () => {
  vi.useFakeTimers();
  const { parser, worker } = harness();
  const bytes = new Uint8Array([1, 2, 3]);
  const result = parser.parse("txt", bytes);
  const request = worker.postMessage.mock.calls[0]?.[0] as {
    bytes: Uint8Array;
  };
  expect(request.bytes).toEqual(bytes);
  expect(request.bytes.buffer).not.toBe(bytes.buffer);
  worker.onmessage?.({
    data: {
      ok: true,
      sections: [{ kind: "TEXT", locator: "text:1", text: "source" }],
    },
  } as MessageEvent);
  await expect(result).resolves.toEqual([
    { kind: "TEXT", locator: "text:1", text: "source" },
  ]);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("pre-canceled and oversized inputs never create a worker", async () => {
  const { parser, factory } = harness();
  const abort = new AbortController();
  abort.abort();
  await expect(
    parser.parse("txt", new Uint8Array(), abort.signal),
  ).rejects.toThrow("CANCELED");
  await expect(
    parser.parse("txt", new Uint8Array(fileExtractionLimits.inputBytes + 1)),
  ).rejects.toThrow("RESOURCE_LIMIT");
  expect(factory).not.toHaveBeenCalled();
});

it("a stalled index worker terminates at the same resource deadline", async () => {
  vi.useFakeTimers();
  const { worker, factory } = harness();
  const indexer = new WorkerFileSearchIndex(factory);
  const document = {
    workspaceId: "local",
    fileId: "file",
    fileVersion: 1,
    contentHash: "a".repeat(64),
    indexVersion: 2,
    chunks: [],
  };
  const result = indexer.build(document);
  const rejected = expect(result).rejects.toThrow("TIMEOUT");
  await vi.advanceTimersByTimeAsync(fileExtractionLimits.milliseconds);
  await rejected;
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("index preparation releases the worker after success and preserves resource-limit errors", async () => {
  const document = {
    workspaceId: "local",
    fileId: "file",
    fileVersion: 1,
    contentHash: "a".repeat(64),
    indexVersion: 2,
    chunks: [],
  };
  for (const success of [true, false]) {
    const { worker, factory } = harness();
    const result = new WorkerFileSearchIndex(factory).build(document);
    const completed = success
      ? expect(result).resolves.toEqual([])
      : expect(result).rejects.toThrow("RESOURCE_LIMIT");
    worker.onmessage?.({
      data: success
        ? { ok: true, rows: [] }
        : { ok: false, code: "RESOURCE_LIMIT" },
    } as MessageEvent);
    await completed;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(document.chunks).toEqual([]);
  }
});
