import { afterEach, expect, test, vi } from "vitest";
import type { AgentRun, ModelPort } from "./connected";
import type { ContentPolicy } from "./content-policy";
import type { LibraryEntry } from "./library";
import {
  executeApprovedModel,
  validateApprovedContext,
  validateContextPolicy,
} from "./model-gateway";

test("approved context is rechecked for revision, parent, workspace and route scope", async () => {
  const f = fixture();
  const entity: LibraryEntry = {
    id: "d",
    workspaceId: "w",
    kind: "DOCUMENT",
    spaceId: "s",
    title: "Document",
    bodyMd: "Original",
    version: 1,
    createdAt: "2026-09-17",
    updatedAt: "2026-09-17",
    createdBy: "p",
    updatedBy: "p",
    deletedAt: null,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    },
  };
  const parent: LibraryEntry = {
    ...entity,
    id: "s",
    kind: "SPACE",
    spaceId: null,
  };
  f.run.context = [
    {
      ref: { kind: "DOCUMENT", id: "d" },
      version: 1,
      title: entity.title,
      bodyMd: entity.bodyMd,
    },
  ];
  const notes = { get: vi.fn() };
  const library = {
    get: vi.fn(async (id: string) => (id === "s" ? parent : entity)),
  };
  await expect(
    validateApprovedContext(actor, f.run, notes, library),
  ).resolves.toBeUndefined();
  for (const patch of [
    { version: 2 },
    { bodyMd: "changed" },
    { deletedAt: "now" },
    { workspaceId: "other" },
  ]) {
    const original = { ...entity };
    Object.assign(entity, patch);
    await expect(
      validateApprovedContext(actor, f.run, notes, library),
    ).rejects.toThrow("CONTEXT_CHANGED");
    Object.assign(entity, original);
  }
  parent.deletedAt = "now";
  await expect(
    validateApprovedContext(actor, f.run, notes, library),
  ).rejects.toThrow("CONTEXT_CHANGED");
  parent.deletedAt = null;
  f.run.route.scope = "SPACE:other";
  await expect(
    validateApprovedContext(actor, f.run, notes, library),
  ).rejects.toThrow("CONTEXT_CHANGED");
  f.run.route.scope = "SPACE:s";
  await expect(
    validateApprovedContext(actor, f.run, notes, library),
  ).resolves.toBeUndefined();
});

afterEach(() => vi.useRealTimers());
test("policy defaults fail closed and approval cannot override boundaries, DENY or SECRET", () => {
  const { run } = fixture();
  const entity = { id: "data", workspaceId: "w", version: 1, deletedAt: null };
  expect(() => validateContextPolicy(actor, run.route, entity)).toThrow();
  const policy: ContentPolicy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ASK",
  };
  expect(() =>
    validateContextPolicy(actor, run.route, { ...entity, aiPolicy: policy }),
  ).not.toThrow();
  for (const patch of [
    { aiAccess: "DENY" },
    { classification: "SECRET" },
    { processingBoundary: "LOCAL_ONLY" },
    { processingBoundary: "SELF_HOSTED_ONLY" },
    { processingBoundary: "TRUSTED_CLOUD" },
    { aiAccess: "INHERIT" },
  ])
    expect(() =>
      validateContextPolicy(actor, run.route, {
        ...entity,
        aiPolicy: { ...policy, ...patch } as ContentPolicy,
      }),
    ).toThrow();
});
const actor = { workspaceId: "w", principalId: "p" };
function fixture() {
  const route = {
    fingerprint: "approved",
    provider: "test",
    model: "model",
    maxInputChars: 100,
    maxOutputTokens: 50,
    timeoutMs: 1000,
    maxRunsPerDay: 2,
  };
  const run: AgentRun = {
    id: "r",
    workspaceId: "w",
    version: 2,
    createdBy: "p",
    updatedBy: "p",
    createdAt: "2026-09-17",
    updatedAt: "2026-09-17",
    deletedAt: null,
    prompt: "hello",
    route,
    status: "RUNNING",
    output: null,
    error: null,
    approvedBy: "p",
    approvedAt: "2026-09-17",
  };
  const model: ModelPort = { route, complete: vi.fn(async () => "result") };
  const authorize = vi.fn(async () => {});
  const resolve = vi.fn(() => model);
  const controller = new AbortController();
  return { run, model, authorize, resolve, controller };
}
test("sends only after authorization and uses current approved route", async () => {
  const f = fixture();
  expect(
    await executeApprovedModel(
      actor,
      f.run,
      f.authorize,
      f.resolve,
      f.controller.signal,
    ),
  ).toEqual({ output: "result", error: null, interrupted: false });
  expect(f.authorize.mock.invocationCallOrder[0]).toBeLessThan(
    f.resolve.mock.invocationCallOrder[0]!,
  );
  expect(f.model.complete).toHaveBeenCalledOnce();
});
test("keeps provider-reported usage, including a response rejected after consumption", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    f.model.complete = async (_prompt, _signal, report) => {
      report?.({
        inputTokens: 8,
        outputTokens: 4,
        source: "PROVIDER_REPORTED",
      });
      if (fail) throw new Error("invalid response after usage");
      return "result";
    };
    const result = await executeApprovedModel(
      actor,
      f.run,
      f.authorize,
      f.resolve,
      f.controller.signal,
    );
    expect(result.usage).toEqual({
      inputTokens: 8,
      outputTokens: 4,
      source: "PROVIDER_REPORTED",
    });
    expect(result.error).toBe(fail ? "MODEL_REQUEST_FAILED" : null);
  }
});

test("rejects foreign, unapproved, changed or oversized requests before sending", async () => {
  for (const patch of [
    { workspaceId: "other" },
    { createdBy: "other" },
    { status: "WAITING_APPROVAL" },
    { approvedBy: null },
    { deletedAt: "2026-09-17" },
    { prompt: "x".repeat(101) },
  ]) {
    const f = fixture();
    const result = await executeApprovedModel(
      actor,
      { ...f.run, ...patch } as AgentRun,
      f.authorize,
      f.resolve,
      f.controller.signal,
    );
    expect(result.error).toBe("MODEL_REQUEST_FAILED");
    expect(f.model.complete).not.toHaveBeenCalled();
  }
  const f = fixture();
  f.model.route = { ...f.model.route, fingerprint: "changed" };
  expect(
    (
      await executeApprovedModel(
        actor,
        f.run,
        f.authorize,
        f.resolve,
        f.controller.signal,
      )
    ).error,
  ).toBe("MODEL_REQUEST_FAILED");
  expect(f.model.complete).not.toHaveBeenCalled();
});
test("settles deadline even when provider ignores abort", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.model.complete = vi.fn(() => new Promise<string>(() => {}));
  const pending = executeApprovedModel(
    actor,
    f.run,
    f.authorize,
    f.resolve,
    f.controller.signal,
  );
  await vi.advanceTimersByTimeAsync(1001);
  expect(await pending).toEqual({
    output: null,
    error: "MODEL_INTERRUPTED",
    interrupted: true,
  });
  expect(vi.getTimerCount()).toBe(0);
});
test("canceled authorization cannot dispatch later and provider errors are sanitized", async () => {
  const f = fixture();
  let release!: () => void;
  const pending = executeApprovedModel(
    actor,
    f.run,
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
    f.resolve,
    f.controller.signal,
  );
  f.controller.abort();
  expect((await pending).interrupted).toBe(true);
  release();
  await Promise.resolve();
  expect(f.resolve).not.toHaveBeenCalled();
  const g = fixture();
  g.model.complete = async () => {
    throw new Error("secret provider response");
  };
  expect(
    await executeApprovedModel(
      actor,
      g.run,
      g.authorize,
      g.resolve,
      g.controller.signal,
    ),
  ).toEqual({
    output: null,
    error: "MODEL_REQUEST_FAILED",
    interrupted: false,
  });
});
