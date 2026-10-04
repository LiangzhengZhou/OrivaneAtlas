import { expect, it } from "vitest";
import { WorkspaceEventDecoder } from "./workspace-event-decoder";

it("reassembles frames, ignores heartbeats/duplicates and accepts a new server epoch", () => {
  const decoder = new WorkspaceEventDecoder(),
    bytes = new TextEncoder();
  const cursor = "a".repeat(32) + ":1";
  expect(decoder.feed(bytes.encode('data: {"cur'))).toEqual([]);
  expect(
    decoder.feed(bytes.encode(`sor":"${cursor}"}\n\n: heartbeat\n\n`)),
  ).toEqual([cursor]);
  expect(
    decoder.feed(bytes.encode(`data: {"cursor":"${cursor}"}\n\n`)),
  ).toEqual([]);
  const restarted = "b".repeat(32) + ":0";
  expect(
    decoder.feed(bytes.encode(`data: {"cursor":"${restarted}"}\n\n`)),
  ).toEqual([restarted]);
});
it("rejects content-bearing or oversized invalidation events", () => {
  expect(() =>
    new WorkspaceEventDecoder().feed(
      new TextEncoder().encode('data: {"cursor":"bad","body":"secret"}\n\n'),
    ),
  ).toThrow();
  expect(() =>
    new WorkspaceEventDecoder().feed(
      new TextEncoder().encode("a".repeat(16385)),
    ),
  ).toThrow();
});
