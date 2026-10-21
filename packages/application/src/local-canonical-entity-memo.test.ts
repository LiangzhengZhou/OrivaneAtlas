import { createHash } from "node:crypto";
import type { EntityMemo } from "@arclattice/domain";
import { expect, it } from "vitest";
import { canonicalEntityMemoId } from "./entity-memo-identity";
import { projectLocalEntityMemo } from "./local-canonical-entity-memo";
import type { LocalSyncState } from "./local-persistence";

const actor = { workspaceId: "local-workspace", principalId: "local-owner" };
const binding: LocalSyncState = {
  workspaceId: actor.workspaceId,
  remoteWorkspaceId: "remote-workspace",
  remotePrincipalId: "remote-owner",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  version: 1,
  cursor: 10,
};
const identity = {
  forTarget: (
    context: Parameters<typeof canonicalEntityMemoId>[0],
    target: Parameters<typeof canonicalEntityMemoId>[1],
  ) =>
    canonicalEntityMemoId(context, target, async (input) =>
      createHash("sha1").update(input).digest(),
    ),
};
async function fixture(): Promise<EntityMemo> {
  const context = {
    workspaceId: binding.remoteWorkspaceId!,
    principalId: binding.remotePrincipalId!,
  };
  const target = { targetKind: "TASK" as const, targetId: "task" };
  return {
    ...target,
    id: await identity.forTarget(context, target),
    workspaceId: context.workspaceId,
    ownerPrincipalId: context.principalId,
    bodyMd: "  private\n原文\n",
    version: 2,
    createdAt: "2026-10-16T00:00:00Z",
    updatedAt: "2026-10-16T00:00:00Z",
    createdBy: context.principalId,
    updatedBy: context.principalId,
    deletedAt: null,
  };
}
it("maps only the explicitly bound owner and verifies both installation identities without altering Markdown", async () => {
  const remote = await fixture();
  const projected = await projectLocalEntityMemo(
    actor,
    binding,
    remote,
    identity,
  );
  expect(projected.remote).toEqual(remote);
  expect(projected.local).toMatchObject({
    ...remote,
    id: await identity.forTarget(actor, remote),
    workspaceId: actor.workspaceId,
    ownerPrincipalId: actor.principalId,
    createdBy: actor.principalId,
    updatedBy: actor.principalId,
  });
  const secondActor = {
    ...actor,
    workspaceId: "second-installation",
    principalId: "second-local-owner",
  };
  const second = await projectLocalEntityMemo(
    secondActor,
    { ...binding, workspaceId: secondActor.workspaceId },
    remote,
    identity,
  );
  expect(second.remote).toEqual(remote);
  expect(second.local.id).not.toBe(projected.local.id);
  expect(second.local.bodyMd).toBe(remote.bodyMd);
});
it("rejects foreign owners, workspaces, forged identity and invalid or missing binding metadata", async () => {
  const memo = await fixture();
  for (const [value, code] of [
    [
      {
        ...memo,
        ownerPrincipalId: "other",
        createdBy: "other",
        updatedBy: "other",
      },
      "FORBIDDEN",
    ],
    [{ ...memo, workspaceId: "other" }, "FORBIDDEN"],
    [{ ...memo, id: "forged" }, "VALIDATION_ERROR"],
    [{ ...memo, version: 0 }, "VALIDATION_ERROR"],
  ] as const)
    await expect(
      projectLocalEntityMemo(actor, binding, value, identity),
    ).rejects.toMatchObject({ code });
  for (const invalid of [
    { ...binding, workspaceId: "other" },
    { ...binding, remotePrincipalId: null },
    { ...binding, remoteWorkspaceId: null },
    { ...binding, epoch: null },
    { ...binding, version: 0 },
    { ...binding, cursor: -1 },
  ])
    await expect(
      projectLocalEntityMemo(actor, invalid, memo, identity),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
