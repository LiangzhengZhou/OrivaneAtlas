import {
  DomainError,
  type EntityMemo,
  entityMemoOwnerKey,
} from "@arclattice/domain";
import { expect, test } from "vitest";
import {
  EntityMemoService,
  type EntityMemoTarget,
  type EntityMemoTransaction,
  type EntityMemoUnitOfWork,
} from "./entity-memos";

const actor = { workspaceId: "workspace", principalId: "alice" };
const target = { targetKind: "TASK" as const, targetId: "task" };
const input = { ...target, bodyMd: "Private original\n" };
function fixture() {
  let rows = new Map<string, EntityMemo>();
  let changes: Parameters<EntityMemoTransaction["appendChange"]>[0][] = [];
  let targetDeleted = false,
    denied = false,
    failChange = false;
  const uow: EntityMemoUnitOfWork = {
    run: async (context, operation) => {
      const staged = new Map(rows),
        stagedChanges = [...changes];
      const key = (owner: string, ref: EntityMemoTarget) =>
        entityMemoOwnerKey(
          context.workspaceId,
          owner,
          ref.targetKind,
          ref.targetId,
        );
      const result = await operation({
        target: async () => ({ deleted: targetDeleted }),
        find: async (owner, ref) => staged.get(key(owner, ref)) ?? null,
        replace: async (memo, version) => {
          const id = key(memo.ownerPrincipalId, memo);
          if ((staged.get(id)?.version ?? 0) !== version)
            throw new DomainError("VERSION_CONFLICT");
          staged.set(id, structuredClone(memo));
        },
        appendChange: async (event) => {
          if (failChange) throw new Error("OUTBOX_UNAVAILABLE");
          stagedChanges.push(event);
        },
      });
      rows = staged;
      changes = stagedChanges;
      return result;
    },
  };
  const service = new EntityMemoService(
    uow,
    {
      require: async () => {
        if (denied) throw new DomainError("FORBIDDEN");
      },
    },
    { now: () => "2026-10-16T00:00:00.000Z" },
    {
      forTarget: async (context, ref) =>
        entityMemoOwnerKey(
          context.workspaceId,
          context.principalId,
          ref.targetKind,
          ref.targetId,
        ),
      nextChangeId: () => crypto.randomUUID(),
    },
  );
  return {
    service,
    rows: () => rows,
    changes: () => changes,
    deleteTarget: (deleted: boolean) => {
      targetDeleted = deleted;
    },
    deny: () => {
      denied = true;
    },
    failChange: () => {
      failChange = true;
    },
  };
}

test("Memo policy edits use CAS and persist through ordinary body edits; imports do not inherit grants", async () => {
  const f = fixture();
  const policy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ASK",
  } as const;
  const created = await f.service.save(
    actor,
    { ...input, aiPolicy: policy },
    0,
  );
  expect(created?.aiPolicy).toEqual(policy);
  const updated = await f.service.save(actor, { ...input, bodyMd: "next" }, 1);
  expect(updated?.aiPolicy).toEqual(policy);
  await expect(
    f.service.save(
      actor,
      { ...input, aiPolicy: { ...policy, aiAccess: "DENY" } },
      1,
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect((await f.service.get(actor, target))?.aiPolicy).toEqual(policy);
  const imported = await f.service.importMemo(
    { ...actor, principalId: "bob" },
    { ...input, aiPolicy: policy },
  );
  expect(imported).not.toHaveProperty("aiPolicy");
  f.failChange();
  await expect(
    f.service.save(
      actor,
      { ...input, aiPolicy: { ...policy, aiAccess: "DENY" } },
      2,
    ),
  ).rejects.toThrow("OUTBOX_UNAVAILABLE");
  expect((await f.service.get(actor, target))?.aiPolicy).toEqual(policy);
});

test("memo creates once, updates with exact CAS, and preserves body and identity", async () => {
  const f = fixture();
  const first = await f.service.save(actor, input, 0);
  expect(first).toMatchObject({
    version: 1,
    ownerPrincipalId: "alice",
    bodyMd: input.bodyMd,
  });
  const next = await f.service.save(
    actor,
    { ...input, bodyMd: "Second\n\n" },
    1,
  );
  expect(next).toMatchObject({
    id: first!.id,
    version: 2,
    bodyMd: "Second\n\n",
  });
  await expect(f.service.save(actor, input, 1)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  expect(f.rows().size).toBe(1);
  expect(f.changes().map((event) => event.action)).toEqual([
    "CREATED",
    "UPDATED",
  ]);
});
test("ordinary first empty memo save never produces a row or Activity/Outbox", async () => {
  const f = fixture();
  expect(
    await f.service.save(actor, { ...input, bodyMd: " \n" }, 0),
  ).toBeNull();
  expect(f.rows().size).toBe(0);
  expect(f.changes()).toEqual([]);
});

test("explicit Memo import preserves empty original text with owner/CAS and atomicity guards", async () => {
  const f = fixture(),
    imported = { ...input, bodyMd: "  \n\n" };
  expect(await f.service.importMemo(actor, imported)).toMatchObject({
    bodyMd: imported.bodyMd,
    version: 1,
    ownerPrincipalId: actor.principalId,
  });
  expect(f.changes().map((change) => change.action)).toEqual(["CREATED"]);
  await expect(f.service.importMemo(actor, imported)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  const denied = fixture();
  denied.deny();
  await expect(
    denied.service.importMemo(actor, imported),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(denied.rows().size).toBe(0);
  const failed = fixture();
  failed.failChange();
  await expect(failed.service.importMemo(actor, imported)).rejects.toThrow(
    "OUTBOX_UNAVAILABLE",
  );
  expect(failed.rows().size).toBe(0);
});

test("memo version cannot overflow the exact sync integer range", async () => {
  const f = fixture();
  await expect(
    f.service.save(actor, input, Number.MAX_SAFE_INTEGER),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(f.rows().size).toBe(0);
  expect(f.changes()).toEqual([]);
});
test("private owner and workspace isolate memos on the same target", async () => {
  const f = fixture();
  await f.service.save(actor, input, 0);
  expect(
    await f.service.get({ ...actor, principalId: "bob" }, target),
  ).toBeNull();
  expect(
    await f.service.get({ ...actor, workspaceId: "other" }, target),
  ).toBeNull();
  await f.service.save({ ...actor, principalId: "bob" }, input, 0);
  expect(f.rows().size).toBe(2);
});
test("target delete hides memo without rewriting it; restoration reveals original", async () => {
  const f = fixture();
  const original = await f.service.save(actor, input, 0);
  f.deleteTarget(true);
  expect(await f.service.get(actor, target)).toBeNull();
  await expect(f.service.save(actor, input, 1)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  f.deleteTarget(false);
  expect(await f.service.get(actor, target)).toEqual(original);
});
test("memo soft deletion and restore retain identity and advance version", async () => {
  const f = fixture();
  const original = await f.service.save(actor, input, 0);
  await f.service.save(actor, input, 1, true);
  expect(await f.service.get(actor, target)).toBeNull();
  expect(await f.service.save(actor, input, 2)).toMatchObject({
    id: original!.id,
    version: 3,
    deletedAt: null,
  });
});
test("permission denial and failed Outbox append leave no partial business write", async () => {
  const f = fixture();
  f.failChange();
  await expect(f.service.save(actor, input, 0)).rejects.toThrow(
    "OUTBOX_UNAVAILABLE",
  );
  expect(f.rows().size).toBe(0);
  expect(f.changes()).toEqual([]);
  f.deny();
  await expect(f.service.save(actor, input, 0)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(f.rows().size).toBe(0);
});
