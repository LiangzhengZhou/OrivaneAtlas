import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadModel } from "./model";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "arclattice-model-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true });
});
function config(overrides = {}) {
  const keyFile = join(directory, "provider.key");
  writeFileSync(keyFile, "test-only-secret", { mode: 0o600 });
  const path = join(directory, "model.json");
  writeFileSync(
    path,
    JSON.stringify({
      endpoint: "https://model.example/v1/chat/completions",
      model: "test",
      keyFile,
      maxInputChars: 1000,
      maxOutputTokens: 100,
      timeoutMs: 1000,
      maxRunsPerDay: 3,
      ...overrides,
    }),
    { mode: 0o600 },
  );
  return path;
}
it("sends only explicit input, disables redirects/storage/tools and exposes no credentials", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      choices: [{ message: { content: "Done" } }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const model = (await loadModel(config()))!;
  expect(JSON.stringify(model.route)).not.toContain("test-only-secret");
  const signal = new AbortController().signal;
  const usage = vi.fn();
  expect(await model.complete("Only this", signal, usage)).toBe("Done");
  expect(usage).toHaveBeenCalledWith({
    inputTokens: 12,
    outputTokens: 3,
    source: "PROVIDER_REPORTED",
  });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    new URL("https://model.example/v1/chat/completions"),
    expect.objectContaining({
      signal,
      redirect: "error",
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "Only this" }],
        max_completion_tokens: 100,
        store: false,
        stream: false,
      }),
    }),
  );
  expect(await loadModel(undefined)).toBeNull();
});
it.each([
  { endpoint: "http://model.example/chat/completions" },
  { endpoint: "https://user:pass@model.example/chat/completions" },
  { endpoint: "https://model.example/chat/completions?key=bad" },
  { maxOutputTokens: 99999 },
  { timeoutMs: 1 },
  { maxRunsPerDay: 0 },
  { keyFile: "relative.key" },
])("fails closed for invalid admin configuration %j", async (override) => {
  await expect(loadModel(config(override))).rejects.toThrow();
});
it.each([
  () => new Response("SECRET provider diagnostics", { status: 500 }),
  () =>
    Response.json({
      choices: [{ message: { content: "No tools", tool_calls: [{}] } }],
    }),
  () => Response.json({ choices: [{ message: { content: "" } }] }),
  () => new Response("x".repeat(1_000_001)),
])("rejects unsafe or failed responses without retry", async (response) => {
  const fetcher = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetcher);
  const model = (await loadModel(config()))!;
  await expect(
    model.complete("hello", new AbortController().signal),
  ).rejects.toThrow(/MODEL_/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
