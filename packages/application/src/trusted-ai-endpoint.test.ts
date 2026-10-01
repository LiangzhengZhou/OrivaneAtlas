import { expect, it } from "vitest";
import {
  matchesTrustedAiEndpoint,
  validateTrustedAiEndpoint,
} from "./trusted-ai-endpoint";

it("accepts only explicit administrator endpoint shapes", () => {
  expect(
    validateTrustedAiEndpoint({
      id: "1",
      workspaceId: "w",
      title: "Ollama",
      provider: "OLLAMA",
      origin: "http://localhost:11434/api",
      enabled: true,
    }).origin,
  ).toBe("http://localhost:11434/api");
  expect(() =>
    validateTrustedAiEndpoint({
      id: "1",
      workspaceId: "w",
      title: "x",
      provider: "VLLM",
      origin: "http://localhost:8000",
      enabled: true,
    }),
  ).toThrow();
});
it("matches exact normalized paths/workspaces and rejects credential or query tricks", () => {
  const entries = [
    validateTrustedAiEndpoint({
      id: "trusted",
      workspaceId: "w",
      title: "Local",
      provider: "VLLM",
      enabled: true,
      origin: "http://127.0.0.1:8000/v1",
    }),
  ];
  expect(
    matchesTrustedAiEndpoint(
      entries,
      "w",
      "http://127.0.0.1:8000/v1/chat/completions",
    ),
  ).toBe(true);
  for (const endpoint of [
    "http://127.0.0.1:8000/v2/chat/completions",
    "http://127.0.0.1:8001/v1",
    "http://user@127.0.0.1:8000/v1",
    "http://127.0.0.1:8000/v1?target=metadata",
  ])
    expect(matchesTrustedAiEndpoint(entries, "w", endpoint)).toBe(false);
  expect(matchesTrustedAiEndpoint(entries, "other", entries[0]!.origin)).toBe(
    false,
  );
  expect(matchesTrustedAiEndpoint([], "w", entries[0]!.origin)).toBe(false);
});
