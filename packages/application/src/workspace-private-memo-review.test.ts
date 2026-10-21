import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { canonicalEntityMemoId } from "./entity-memo-identity";
import { readWorkspacePrivateMemoReview } from "./workspace-private-memo-review";

const identity = {
  forTarget: (
    actor: Parameters<typeof canonicalEntityMemoId>[0],
    target: Parameters<typeof canonicalEntityMemoId>[1],
  ) =>
    canonicalEntityMemoId(actor, target, async (bytes) =>
      createHash("sha1").update(bytes).digest(),
    ),
};
async function fixture() {
  const actor = { workspaceId: randomUUID(), principalId: randomUUID() },
    target = { targetKind: "TASK" as const, targetId: randomUUID() };
  const memo = {
    ...target,
    id: await identity.forTarget(actor, target),
    workspaceId: actor.workspaceId,
    ownerPrincipalId: actor.principalId,
    bodyMd: "Exact private Markdown\n",
    version: 2,
    createdAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
    createdBy: actor.principalId,
    updatedBy: actor.principalId,
    deletedAt: null,
  };
  const page = {
    recovery: false,
    snapshot: null,
    epoch: "epoch",
    cursor: 5,
    hasMore: false,
    records: [
      {
        seq: 4,
        workspaceId: actor.workspaceId,
        collection: "entityMemos",
        entityId: memo.id,
        op: "UPSERT",
        version: 2,
      },
    ],
    changes: {
      values: {},
      collections: {
        entityMemos: { upserts: [memo], removed: [] as string[] },
      },
    },
  };
  return { actor, memo, page, revision: { epoch: "epoch", cursor: 5 } };
}
test("private import review follows journal pages including purge and preserves exact owner/body", async () => {
  const f = await fixture(),
    seen: number[] = [];
  const records = await readWorkspacePrivateMemoReview(
    f.actor,
    f.revision,
    async (after) => {
      seen.push(after);
      return after === 0
        ? { ...f.page, cursor: 4, hasMore: true }
        : { ...f.page, records: [], changes: { values: {}, collections: {} } };
    },
    identity,
  );
  expect(seen).toEqual([0, 4]);
  expect(records).toEqual([
    {
      workspaceId: f.actor.workspaceId,
      collection: "entityMemos",
      id: f.memo.id,
      version: 2,
      value: f.memo,
    },
  ]);
  expect(
    await readWorkspacePrivateMemoReview(
      f.actor,
      f.revision,
      async (after) =>
        after === 0
          ? { ...f.page, cursor: 4, hasMore: true }
          : {
              ...f.page,
              records: [
                { ...f.page.records[0]!, seq: 5, version: 3, op: "DELETE" },
              ],
              changes: {
                values: {},
                collections: {
                  entityMemos: { upserts: [], removed: [f.memo.id] },
                },
              },
            },
      identity,
    ),
  ).toEqual([]);
});
test("private review rejects owner leaks, unlogged content, stale cursors, recovery and non-progress pages", async () => {
  const f = await fixture();
  const read = (page: unknown) =>
    readWorkspacePrivateMemoReview(
      f.actor,
      f.revision,
      async () => page,
      identity,
    );
  await expect(read({ ...f.page, cursor: 6 })).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  await expect(read({ ...f.page, recovery: true })).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  await expect(read({ ...f.page, records: [] })).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await expect(
    read({
      ...f.page,
      records: [],
      cursor: 0,
      hasMore: true,
      changes: { values: {}, collections: {} },
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  const foreign = {
    ...f.memo,
    ownerPrincipalId: "foreign",
    createdBy: "foreign",
    updatedBy: "foreign",
  };
  await expect(
    read({
      ...f.page,
      changes: {
        values: {},
        collections: { entityMemos: { upserts: [foreign], removed: [] } },
      },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("private review preserves tombstone versions and refuses same-version different content across pages", async () => {
  const f = await fixture();
  const deleted = { ...f.memo, version: 3, deletedAt: "2026-10-18T01:00:00Z" };
  const tombstone = {
    ...f.page,
    records: [{ ...f.page.records[0]!, version: 3 }],
    changes: {
      values: {},
      collections: { entityMemos: { upserts: [deleted], removed: [] } },
    },
  };
  expect(
    (
      await readWorkspacePrivateMemoReview(
        f.actor,
        f.revision,
        async () => tombstone,
        identity,
      )
    )[0]!.value,
  ).toEqual(deleted);
  await expect(
    readWorkspacePrivateMemoReview(
      f.actor,
      f.revision,
      async (after) =>
        after === 0
          ? { ...f.page, cursor: 4, hasMore: true }
          : {
              ...f.page,
              records: [{ ...f.page.records[0]!, seq: 5 }],
              changes: {
                values: {},
                collections: {
                  entityMemos: {
                    upserts: [
                      { ...f.memo, bodyMd: "Same version forged body" },
                    ],
                    removed: [],
                  },
                },
              },
            },
      identity,
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});
