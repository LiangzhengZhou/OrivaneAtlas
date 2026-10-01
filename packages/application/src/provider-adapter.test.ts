import { expect, it } from "vitest";
import { adaptModelProvider } from "./provider-adapter";

it("preserves provider completion without advertising or simulating streaming", async () => {
  const adapter = adaptModelProvider({
    route: {
      fingerprint: "test",
      provider: "test",
      model: "test",
      maxInputChars: 100,
      maxOutputTokens: 20,
      timeoutMs: 1000,
      maxRunsPerDay: 1,
    },
    complete: async () => "response",
  });
  const events = [];
  for await (const event of adapter.stream(
    "prompt",
    new AbortController().signal,
  ))
    events.push(event);
  expect(events).toEqual([{ type: "error", error: "STREAMING_NOT_SUPPORTED" }]);
  expect(await adapter.listModels(new AbortController().signal)).toEqual([
    "test",
  ]);
});
