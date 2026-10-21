import { expect, test } from "vitest";
import {
  type EntityMemo,
  entityMemoOwnerKey,
  entityMemoTargetKinds,
  requireEntityMemoInput,
  requireEntityMemoOwner,
  requireEntityMemoPolicy,
  requireEntityMemoRecord,
} from "./entity-memo";

const memo: EntityMemo = {
  id: "memo",
  workspaceId: "workspace",
  ownerPrincipalId: "alice",
  targetKind: "TASK",
  targetId: "task",
  bodyMd: "  # Private\n\n![image](file:original)\n",
  version: 1,
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
  createdBy: "alice",
  updatedBy: "alice",
  deletedAt: null,
};

test("Memo policy remains absent on legacy records and validates detached explicit owner metadata", () => {
  expect(requireEntityMemoRecord(memo)).not.toHaveProperty("aiPolicy");
  const policy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ASK",
  } as const;
  const accepted = requireEntityMemoRecord({ ...memo, aiPolicy: policy });
  expect(accepted.aiPolicy).toEqual(policy);
  expect(accepted.aiPolicy).not.toBe(policy);
  expect(
    requireEntityMemoInput({
      targetKind: "TASK",
      targetId: "task",
      bodyMd: "",
      aiPolicy: policy,
    }).aiPolicy,
  ).toEqual(policy);
  for (const invalid of [
    null,
    undefined,
    [],
    {},
    { ...policy, aiAccess: "yes" },
    { ...policy, processingBoundary: "UNKNOWN" },
    { ...policy, classification: "UNKNOWN" },
    { ...policy, consent: true },
  ]) {
    expect(() => requireEntityMemoPolicy(invalid)).toThrow("VALIDATION_ERROR");
    expect(() =>
      requireEntityMemoRecord({ ...memo, aiPolicy: invalid }),
    ).toThrow("VALIDATION_ERROR");
  }
});

test("durable Memo validation preserves bytes and rejects malformed or foreign audit ownership", () => {
  const accepted = requireEntityMemoRecord(memo);
  expect(accepted).toEqual(memo);
  expect(accepted).not.toBe(memo);
  for (const invalid of [
    null,
    [],
    { ...memo, version: 0 },
    { ...memo, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...memo, version: 1.5 },
    { ...memo, ownerPrincipalId: "bob" },
    { ...memo, createdBy: "bob" },
    { ...memo, updatedBy: "bob" },
    { ...memo, bodyMd: null },
    { ...memo, bodyMd: "x".repeat(100001) },
    { ...memo, createdAt: "not-a-date" },
    { ...memo, deletedAt: "not-a-date" },
    { ...memo, targetKind: "DOCUMENT" },
    { ...memo, secret: "unexpected field" },
    Object.fromEntries(
      Object.entries(memo).filter(([key]) => key !== "deletedAt"),
    ),
  ])
    expect(() => requireEntityMemoRecord(invalid)).toThrow("VALIDATION_ERROR");
  expect(
    requireEntityMemoRecord({ ...memo, version: Number.MAX_SAFE_INTEGER })
      .version,
  ).toBe(Number.MAX_SAFE_INTEGER);
});

test.each(entityMemoTargetKinds)(
  "%s memo preserves original Markdown independently of its target",
  (targetKind) => {
    expect(
      requireEntityMemoInput({
        targetKind,
        targetId: memo.targetId,
        bodyMd: memo.bodyMd,
      }),
    ).toEqual({ targetKind, targetId: memo.targetId, bodyMd: memo.bodyMd });
  },
);
test("memo identity includes both workspace and private owner", () => {
  const key = entityMemoOwnerKey("workspace", "alice", "TASK", "task");
  expect(key).toBe(entityMemoOwnerKey("workspace", "alice", "TASK", "task"));
  expect(key).not.toBe(entityMemoOwnerKey("workspace", "bob", "TASK", "task"));
  expect(key).not.toBe(entityMemoOwnerKey("other", "alice", "TASK", "task"));
  expect(key).not.toBe(
    entityMemoOwnerKey("workspace", "alice", "PROJECT", "task"),
  );
});
test("target permission cannot substitute for private owner and workspace isolation", () => {
  expect(() =>
    requireEntityMemoOwner(
      { workspaceId: "workspace", principalId: "alice" },
      memo,
    ),
  ).not.toThrow();
  expect(() =>
    requireEntityMemoOwner(
      { workspaceId: "workspace", principalId: "bob" },
      memo,
    ),
  ).toThrow("FORBIDDEN");
  expect(() =>
    requireEntityMemoOwner(
      { workspaceId: "other", principalId: "alice" },
      memo,
    ),
  ).toThrow("FORBIDDEN");
});
test("memo input rejects missing target and oversized content without silently trimming", () => {
  expect(() =>
    requireEntityMemoInput({ targetKind: "TASK", targetId: " ", bodyMd: "" }),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    requireEntityMemoInput({
      targetKind: "TASK",
      targetId: "task",
      bodyMd: "x".repeat(100001),
    }),
  ).toThrow("VALIDATION_ERROR");
  expect(
    requireEntityMemoInput({ targetKind: "TASK", targetId: "task", bodyMd: "" })
      .bodyMd,
  ).toBe("");
});
