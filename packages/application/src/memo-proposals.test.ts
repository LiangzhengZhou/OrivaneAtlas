import { createHash } from "node:crypto";
import type { EntityMemo } from "@arclattice/domain";
import { expect, test } from "vitest";
import { type MemoFormalization, MemoProposalService } from "./memo-proposals";

const actor = { workspaceId: "workspace", principalId: "alice" };
const memo: EntityMemo = {
  id: "memo",
  workspaceId: actor.workspaceId,
  ownerPrincipalId: "alice",
  targetKind: "TASK",
  targetId: "task",
  bodyMd: "Private exact source\n",
  version: 3,
  createdAt: "2026-10-18T00:00:00Z",
  updatedAt: "2026-10-18T01:00:00Z",
  createdBy: "alice",
  updatedBy: "alice",
  deletedAt: null,
};
const service = new MemoProposalService(
  async (value) => createHash("sha256").update(value).digest("hex"),
  () => crypto.randomUUID(),
);
const change: MemoFormalization = {
  kind: "CREATE_TASK",
  title: "Reviewed action",
  bodyMd: "Explicitly proposed text",
  projectId: null,
};

test("captures exact private source without mutating it and returns detached reviewed intent", async () => {
  const proposal = await service.propose(actor, memo, change);
  const reviewed = await service.review(actor, proposal, memo);
  expect(reviewed).toEqual(change);
  expect(reviewed).not.toBe(proposal.change);
  expect(memo.bodyMd).toBe("Private exact source\n");
  expect(proposal.sourceHash).toMatch(/^[a-f0-9]{64}$/);
});
test.each([
  { ...memo, version: 4 },
  { ...memo, bodyMd: "same-version forged text" },
  { ...memo, targetId: "other-task" },
  { ...memo, deletedAt: "2026-10-18T02:00:00Z" },
])(
  "rejects stale or changed Memo source before a formal mutation: %j",
  async (current) => {
    const proposal = await service.propose(actor, memo, change);
    await expect(
      service.review(actor, proposal, current),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  },
);
test.each([
  { ...actor, principalId: "bob" },
  { ...actor, workspaceId: "other" },
])(
  "does not inherit private Memo access from another owner/workspace",
  async (other) => {
    await expect(service.propose(other, memo, change)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const proposal = await service.propose(actor, memo, change);
    await expect(service.review(other, proposal, memo)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  },
);
test("checks append destination CAS and rejects extra instruction fields", async () => {
  const append: MemoFormalization = {
    kind: "APPEND_DOCUMENT",
    documentId: "doc",
    version: 7,
    bodyMd: "Append proposal\n",
  };
  expect((await service.propose(actor, memo, append)).change).toEqual(append);
  await expect(
    service.propose(actor, memo, { ...append, version: 0 }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    service.propose(actor, memo, {
      ...change,
      workspaceId: "other",
    } as MemoFormalization),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const proposal = await service.propose(actor, memo, change);
  await expect(
    service.review(actor, { ...proposal, sourceHash: "0".repeat(64) }, memo),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});
