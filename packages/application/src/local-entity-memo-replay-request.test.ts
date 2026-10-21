import { createHash, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { canonicalEntityMemoId } from "./entity-memo-identity";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto, localObject } from "./local-dto";
import { buildLocalEntityMemoReplayRequest } from "./local-entity-memo-replay-request";
import type { LocalSyncState } from "./local-persistence";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const actor = { workspaceId: "local", principalId: "owner" };
const binding: LocalSyncState = {
  workspaceId: actor.workspaceId,
  remoteWorkspaceId: "remote",
  remotePrincipalId: "remote-owner",
  serverOrigin: "https://example.test",
  epoch: "epoch",
  cursor: 0,
  version: 1,
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
async function fixture(): Promise<LocalCommandPlan> {
  const id = randomUUID(),
    deviceId = randomUUID();
  const input = {
    targetKind: "TASK" as const,
    targetId: "task",
    bodyMd: "  exact\n原文\n",
  };
  const memoId = await identity.forTarget(actor, input);
  return {
    id,
    state: "READY",
    mutationIds: [id],
    command: {
      name: "memo.save",
      input: localDto({ id: memoId, version: 0, input, deleted: false }),
    },
    mutations: [
      {
        id,
        commandId: id,
        deviceId,
        ...actor,
        entityType: "entityMemos",
        entityId: memoId,
        operation: "CREATE",
        baseVersion: null,
        payload: localDto({
          id: memoId,
          ...input,
          workspaceId: actor.workspaceId,
          ownerPrincipalId: actor.principalId,
          createdBy: actor.principalId,
          updatedBy: actor.principalId,
          createdAt: "2026-10-16T00:00:00Z",
          updatedAt: "2026-10-16T00:00:00Z",
          deletedAt: null,
          version: 1,
        }),
        createdAt: "2026-10-16T00:00:00Z",
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
      },
    ],
  };
}
it("serializes only captured Memo intent and binds remote identity without transmitting a caller-supplied owner", async () => {
  const plan = await fixture();
  const request = await buildLocalEntityMemoReplayRequest(
    plan,
    binding,
    identity,
  );
  const captured = localObject(plan.command!.input);
  const target = localObject(captured.input!);
  const remoteId = await identity.forTarget(
    {
      workspaceId: binding.remoteWorkspaceId!,
      principalId: binding.remotePrincipalId!,
    },
    target as unknown as Parameters<typeof identity.forTarget>[1],
  );
  expect(request).toMatchObject({
    path: "/api/v1/memo/save",
    idempotencyKey: plan.id,
    body: {
      version: 0,
      input: captured.input,
      deleted: false,
      syncCommand: {
        effects: [
          {
            collection: "entityMemos",
            id: remoteId,
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
  });
  expect(localObject(request!.body)).not.toHaveProperty("ownerPrincipalId");
  expect(localObject(request!.body)).not.toHaveProperty("id");
  expect(
    await buildLocalEntityMemoReplayRequest(
      structuredClone(plan),
      binding,
      identity,
    ),
  ).toEqual(request);
});
it("rejects altered collection, actor, version, body or command envelope before sending", async () => {
  const plan = await fixture();
  for (const change of [
    { entityType: "items" },
    { entityId: randomUUID() },
    { workspaceId: "other" },
    { principalId: "other" },
    { baseVersion: 1 },
    { operation: "PATCH" as const },
    {
      payload: localDto({
        ...localObject(plan.mutations[0]!.payload),
        bodyMd: "Altered",
      }),
    },
  ]) {
    const invalid = {
      ...plan,
      mutations: [{ ...plan.mutations[0]!, ...change }],
    };
    await expect(
      buildLocalEntityMemoReplayRequest(invalid, binding, identity),
    ).rejects.toMatchObject({
      code: change.principalId ? "FORBIDDEN" : "VALIDATION_ERROR",
    });
  }
  await expect(
    buildLocalEntityMemoReplayRequest(
      plan,
      { ...binding, remotePrincipalId: null },
      identity,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await buildLocalEntityMemoReplayRequest(
      { ...plan, mutations: [] },
      binding,
      identity,
    ),
  ).toBeNull();
});

async function acceptedFixture() {
  const initial = await fixture();
  const plan: LocalCommandPlan = {
    ...initial,
    state: "RECEIPT_REQUIRED",
    mutations: [
      {
        ...initial.mutations[0]!,
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-16T00:01:00Z",
      },
    ],
  };
  const local = localObject(plan.mutations[0]!.payload);
  const target = localObject(localObject(plan.command!.input).input!);
  const remote = {
    ...local,
    id: await identity.forTarget(
      {
        workspaceId: binding.remoteWorkspaceId!,
        principalId: binding.remotePrincipalId!,
      },
      target as unknown as Parameters<typeof identity.forTarget>[1],
    ),
    workspaceId: binding.remoteWorkspaceId!,
    ownerPrincipalId: binding.remotePrincipalId!,
    createdBy: binding.remotePrincipalId!,
    updatedBy: binding.remotePrincipalId!,
  };
  const receipt = {
    commandId: plan.id,
    deviceId: plan.mutations[0]!.deviceId,
    result: remote,
    effects: [
      {
        collection: "entityMemos",
        id: remote.id,
        op: "UPSERT",
        version: 1,
        value: remote,
      },
    ],
  };
  const metadata = {
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  return { plan, local, remote, receipt, metadata };
}

it("maps a private receipt to the local owner while retaining the exact remote base and cursor", async () => {
  const f = await acceptedFixture();
  const commit = await prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    f.plan,
    f.receipt,
    f.plan.mutations,
    f.metadata,
    undefined,
    identity,
  );
  expect(commit.nextCursor).toBe(binding.cursor);
  expect(commit.records).toHaveLength(2);
  expect(commit.records[0]!.entity.value).toMatchObject({
    id: f.local.id,
    remoteId: f.remote.id,
    value: f.remote,
  });
  expect(commit.records[1]!.entity.value).toEqual(f.local);
  expect(commit.acknowledgements).toEqual([
    {
      mutationId: f.plan.id,
      deviceId: f.plan.mutations[0]!.deviceId,
      attemptCount: 1,
      lastAttemptAt: "2026-10-16T00:01:00Z",
    },
  ]);
  expect(f.metadata.commit).not.toHaveBeenCalled();
});

it("rejects forged Memo receipt identity, owner, version and content", async () => {
  const f = await acceptedFixture();
  for (const change of [
    { id: randomUUID() },
    { ownerPrincipalId: "another-owner" },
    { workspaceId: "another-workspace" },
    { version: 2 },
    { bodyMd: "overwritten" },
    { targetId: "another-task" },
  ]) {
    const receipt = structuredClone(f.receipt);
    Object.assign(receipt.effects[0]!.value, change);
    await expect(
      prepareLocalWorkReplayAcknowledgement(
        actor,
        binding,
        f.plan,
        receipt,
        f.plan.mutations,
        f.metadata,
        undefined,
        identity,
      ),
    ).rejects.toMatchObject({
      code: "workspaceId" in change ? "FORBIDDEN" : "VALIDATION_ERROR",
    });
  }
  expect(f.metadata.commit).not.toHaveBeenCalled();
});

it("acknowledges an earlier private save without overwriting a later local draft", async () => {
  const f = await acceptedFixture();
  const later = {
    ...f.plan.mutations[0]!,
    id: randomUUID(),
    commandId: randomUUID(),
    state: "PENDING" as const,
    attemptCount: 0,
    lastAttemptAt: null,
    baseVersion: 1,
    operation: "PATCH" as const,
    payload: localDto({
      ...f.local,
      bodyMd: "later offline draft",
      version: 2,
    }),
  };
  const commit = await prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    f.plan,
    f.receipt,
    [...f.plan.mutations, later],
    f.metadata,
    undefined,
    identity,
  );
  expect(commit.records).toHaveLength(1);
  expect(commit.records[0]!.entity.collection).toBe("$local.remoteBase");
  expect(localObject(commit.records[0]!.entity.value).value).toEqual(f.remote);
});
