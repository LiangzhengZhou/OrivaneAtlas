import type { EntityMemo } from "@arclattice/domain";
import { expect, test } from "vitest";
import type { ModelRoute } from "./connected";
import { MemoAiContextService } from "./memo-ai-context";

const actor = { workspaceId: "workspace", principalId: "alice" };
const target = { targetKind: "TASK" as const, targetId: "task" };
const route: ModelRoute = {
  provider: "test",
  model: "model",
  fingerprint: "trusted-route",
  maxInputChars: 100000,
  maxOutputTokens: 100,
  timeoutMs: 1000,
  maxRunsPerDay: 10,
};
const canonical: EntityMemo = {
  id: "memo",
  workspaceId: actor.workspaceId,
  ownerPrincipalId: "alice",
  ...target,
  bodyMd: "Private exact Markdown\n",
  version: 2,
  createdAt: "2026-10-18T00:00:00Z",
  updatedAt: "2026-10-18T00:00:00Z",
  createdBy: "alice",
  updatedBy: "alice",
  deletedAt: null,
  aiPolicy: {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ASK",
  },
};

test("explicit Memo source keeps owner/target/version identity and rechecks canonical body", async () => {
  let current: EntityMemo = structuredClone(canonical);
  const service = new MemoAiContextService({ get: async () => current });
  const source = await service.select(actor, target, 2, route);
  expect(source).toMatchObject({
    ref: { kind: "MEMO", id: "memo" },
    target,
    ownerPrincipalId: "alice",
    bodyMd: canonical.bodyMd,
    permission: canonical.aiPolicy,
  });
  await service.recheck(actor, source, route);
  current = { ...current, bodyMd: "same-version corrupt body" };
  await expect(service.recheck(actor, source, route)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
});

test.each([
  undefined,
  { classification: "PRIVATE", processingBoundary: "ANY", aiAccess: "DENY" },
  {
    classification: "PRIVATE",
    processingBoundary: "LOCAL_ONLY",
    aiAccess: "ALLOW",
  },
  {
    classification: "PRIVATE",
    processingBoundary: "SELF_HOSTED_ONLY",
    aiAccess: "ASK",
  },
  { classification: "SECRET", processingBoundary: "ANY", aiAccess: "ALLOW" },
] as const)(
  "Memo approval does not override current denied or restricted policy: %j",
  async (aiPolicy) => {
    let current: EntityMemo = structuredClone(canonical);
    const service = new MemoAiContextService({ get: async () => current });
    const source = await service.select(actor, target, 2, route);
    const { aiPolicy: _previousPolicy, ...withoutPolicy } = current;
    current = { ...withoutPolicy, ...(aiPolicy ? { aiPolicy } : {}) };
    await expect(service.select(actor, target, 2, route)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(service.recheck(actor, source, route)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  },
);

test("Memo source rejects owner/workspace/target drift, stale version and revoked target access", async () => {
  let current: EntityMemo | null = structuredClone(canonical);
  const service = new MemoAiContextService({ get: async () => current });
  for (const actorInput of [
    { ...actor, principalId: "bob" },
    { ...actor, workspaceId: "other" },
  ])
    await expect(
      service.select(actorInput, target, 2, route),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    service.select(actor, { ...target, targetId: "other" }, 2, route),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(service.select(actor, target, 1, route)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  const source = await service.select(actor, target, 2, route);
  current = null;
  await expect(service.recheck(actor, source, route)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("an allowed File Memo never substitutes for the File content guard, including after approval", async () => {
  const fileMemo: EntityMemo = { ...canonical, targetKind: "FILE" };
  const reader = { get: async () => fileMemo };
  const fileTarget = {
    targetKind: "FILE" as const,
    targetId: canonical.targetId,
  };
  await expect(
    new MemoAiContextService(reader).select(actor, fileTarget, 2, route),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  let revoked = false,
    checks = 0;
  const service = new MemoAiContextService(
    reader,
    async (candidate, fileId, candidateRoute) => {
      expect(candidate).toEqual(actor);
      expect(fileId).toBe(fileTarget.targetId);
      expect(candidateRoute).toEqual(route);
      checks++;
      if (revoked) throw new Error("FILE_CONTENT_REVOKED");
    },
  );
  const source = await service.select(actor, fileTarget, 2, route);
  revoked = true;
  await expect(service.recheck(actor, source, route)).rejects.toThrow(
    "FILE_CONTENT_REVOKED",
  );
  expect(checks).toBe(2);
});
