import { expect, test } from "vitest";
import {
  assertWorkspaceMutationPrecondition,
  mutationReceiptDigest,
  requireReviewedMutationReceiptProof,
  requireWorkspaceMutationPrecondition,
  reviewedWorkspaceMutationResult,
} from "./mutation-receipt";

test("strict reviewed workspace guards preserve historical digests and reject malformed fields", () => {
  expect(mutationReceiptDigest({ key: "k", digest: "historical" })).toBe(
    "historical",
  );
  expect(
    mutationReceiptDigest({
      key: "k",
      digest: "d",
      workspacePrecondition: { epoch: "e", cursor: 2 },
    }),
  ).toBe('["d","e",2]');
  for (const input of [
    null,
    [],
    {},
    { epoch: "", cursor: 0 },
    { epoch: "e", cursor: -1 },
    { epoch: "e", cursor: 1.5 },
    { epoch: "e", cursor: Number.MAX_SAFE_INTEGER + 1 },
    { epoch: "e", cursor: 0, extra: true },
  ])
    expect(() => requireWorkspaceMutationPrecondition(input)).toThrow(
      "VALIDATION_ERROR",
    );
});

test("epoch mismatch is refused even when a broken adapter reports no recovery and the same cursor", async () => {
  await expect(
    assertWorkspaceMutationPrecondition(
      {
        workspaceChanges: async () => ({
          epoch: "other",
          cursor: 0,
          changes: [],
          recovery: false,
          hasMore: false,
        }),
      },
      { epoch: "expected", cursor: 0 },
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
});

test("atomic import receipt captures all change pages and refuses a nonadvancing or recovering adapter", async () => {
  const cursors: number[] = [];
  const receipt = await reviewedWorkspaceMutationResult(
    {
      workspaceChanges: async (after) => {
        cursors.push(after);
        return {
          epoch: "e",
          cursor: after === 2 ? 502 : 600,
          changes: [],
          hasMore: after === 2,
          recovery: false,
        };
      },
    },
    { epoch: "e", cursor: 2 },
    { id: "accepted" },
  );
  expect(cursors).toEqual([2, 502]);
  expect(receipt).toEqual({
    result: { id: "accepted" },
    workspaceRevision: { epoch: "e", cursor: 600 },
  });
  for (const page of [
    { epoch: "e", cursor: 2, changes: [], hasMore: true, recovery: false },
    { epoch: "e", cursor: 1, changes: [], hasMore: false, recovery: false },
    {
      epoch: "other",
      cursor: 600,
      changes: [],
      hasMore: false,
      recovery: false,
    },
    { epoch: "e", cursor: 600, changes: [], hasMore: false, recovery: true },
  ])
    await expect(
      reviewedWorkspaceMutationResult(
        { workspaceChanges: async () => page },
        { epoch: "e", cursor: 2 },
        null,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
});

test("reviewed receipt proofs require canonical SHA256, epoch and safe cursor and reject legacy digests", () => {
  const valid = JSON.stringify(["a".repeat(64), "epoch", 1]);
  expect(requireReviewedMutationReceiptProof(valid)).toBe(valid);
  for (const value of [
    null,
    "secret-once",
    JSON.stringify(["digest", "epoch", 1]),
    JSON.stringify(["a".repeat(64), "", 1]),
    JSON.stringify(["a".repeat(64), "epoch", -1]),
    JSON.stringify(["a".repeat(64), "epoch", Number.MAX_SAFE_INTEGER + 1]),
    " " + valid,
    JSON.stringify(["a".repeat(64), "epoch", 1, "extra"]),
  ])
    expect(() => requireReviewedMutationReceiptProof(value)).toThrow(
      "VALIDATION_ERROR",
    );
});
