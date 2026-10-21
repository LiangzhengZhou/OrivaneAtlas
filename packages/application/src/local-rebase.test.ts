import { expect, it } from "vitest";
import type { LocalJson, LocalMutation } from "./local-persistence";
import { rebaseLocalRecord } from "./local-rebase";

function mutation(basePayload: LocalJson, payload: LocalJson): LocalMutation {
  return {
    id: "mutation",
    deviceId: "device",
    workspaceId: "workspace",
    principalId: "owner",
    operation: "PATCH",
    entityType: "items",
    entityId: "task",
    baseVersion: 1,
    basePayload,
    payload,
    createdAt: "2026-10-13T00:00:00Z",
    attemptCount: 0,
    lastAttemptAt: null,
    state: "PENDING",
  };
}

it("merges independent business fields while retaining canonical remote metadata", () => {
  const base = {
    title: "Original",
    priority: "MEDIUM",
    dueDate: null,
    version: 1,
  };
  expect(
    rebaseLocalRecord(
      mutation(base, { ...base, priority: "HIGH", version: 2 }),
      { ...base, dueDate: "2026-10-14", version: 7 },
    ),
  ).toEqual({
    state: "CLEAN",
    value: { ...base, priority: "HIGH", dueDate: "2026-10-14", version: 7 },
    changedFields: ["priority"],
  });
});

it("requires review for title, structural, ordering and file rename conflicts", () => {
  for (const key of [
    "title",
    "parentProjectId",
    "projectIds",
    "displayName",
    "order",
  ]) {
    expect(
      rebaseLocalRecord(mutation({ [key]: "base" }, { [key]: "local" }), {
        [key]: "remote",
      }),
    ).toEqual({ state: "CONFLICT", fields: [key], reason: "SAME_FIELD" });
  }
});

it("never silently drops a local edit against remote deletion or vice versa", () => {
  const base = { title: "Original", deletedAt: null };
  expect(
    rebaseLocalRecord(mutation(base, { ...base, title: "Local" }), null).state,
  ).toBe("CONFLICT");
  expect(
    rebaseLocalRecord(mutation(base, { ...base, deletedAt: "2026-10-13" }), {
      ...base,
      title: "Remote",
    }).state,
  ).toBe("CONFLICT");
});

it("retains legacy mutations without inferring a base or last-write-wins", () => {
  const { basePayload: _base, ...legacy } = mutation({}, { title: "Local" });
  expect(rebaseLocalRecord(legacy, { title: "Remote" })).toEqual({
    state: "CONFLICT",
    fields: [],
    reason: "BASE_UNAVAILABLE",
  });
});

it("uses the shared Markdown merge for exact nonoverlapping edits and rejects overlapping changes", () => {
  const base = { bodyMd: "a\nb\nc" };
  expect(
    rebaseLocalRecord(mutation(base, { bodyMd: "intro\na\nb\nc" }), {
      bodyMd: "a\nb\nC",
    }),
  ).toEqual({
    state: "CLEAN",
    value: { bodyMd: "intro\na\nb\nC" },
    changedFields: ["bodyMd"],
  });
  expect(
    rebaseLocalRecord(mutation(base, { bodyMd: "A\nb\nc" }), {
      bodyMd: "Remote\nb\nc",
    }),
  ).toEqual({ state: "CONFLICT", fields: ["bodyMd"], reason: "SAME_FIELD" });
});

it("cannot change stable entity identity during rebase", () => {
  expect(
    rebaseLocalRecord(
      mutation(
        { id: "original", title: "Base" },
        { id: "replacement", title: "Local" },
      ),
      { id: "original", title: "Base" },
    ),
  ).toEqual({ state: "CONFLICT", fields: ["id"], reason: "SAME_FIELD" });
});
