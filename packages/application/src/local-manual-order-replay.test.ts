import { expect, it, vi } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import { buildLocalManualOrderReplayRequest } from "./local-manual-order-replay-request";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";
import { prepareLocalWorkPull } from "./local-work-pull";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222";
const actor = { workspaceId: "local", principalId: "owner" },
  binding: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "human",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 1,
    version: 1,
  };
const metadata: LocalMetadataStore = {
  get: vi.fn(async () => null),
  list: vi.fn(async () => []),
  commit: vi.fn(async () => {}),
};
const input = {
  scope: { kind: "WORKSPACE_TASKS" },
  version: 0,
  entityId: "b",
  anchorId: "a",
  placement: "BEFORE",
};
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId],
    command: { name: "manual-order.move", input },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "manualOrders",
        entityId: "WORKSPACE_TASKS",
        operation: "CREATE",
        baseVersion: 0,
        payload: { entries: ["Do not serialize positions"] },
        createdAt: "2026-10-13T00:00:00Z",
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-13T00:01:00Z",
      },
    ],
  };
}
function canonical() {
  return {
    id: "WORKSPACE_TASKS",
    workspaceId: "remote",
    scope: { kind: "WORKSPACE_TASKS" },
    version: 1,
    updatedAt: "2026-10-13T00:00:00Z",
    updatedBy: "human",
    entries: ["b", "a"].map((entityId, index) => ({
      workspaceId: "remote",
      scopeKey: "WORKSPACE_TASKS",
      entityId,
      position: (index + 1) * 1024,
      version: 1,
      updatedAt: "2026-10-13T00:00:00Z",
      updatedBy: "human",
    })),
  };
}
it("original manual order transmits placement rather than rank payload; ACK projects aggregate and every entry into local workspace", async () => {
  const plan = fixture(),
    request = buildLocalManualOrderReplayRequest(plan);
  expect(request).toMatchObject({
    path: "/api/v1/manual-orders/move",
    idempotencyKey: commandId,
    body: {
      ...input,
      syncCommand: {
        effects: [
          {
            collection: "manualOrders",
            id: "WORKSPACE_TASKS",
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
  });
  expect(request?.body).not.toHaveProperty("entries");
  const value = localDto(canonical()),
    receipt = {
      commandId,
      deviceId,
      result: value,
      effects: [
        {
          collection: "manualOrders",
          id: "WORKSPACE_TASKS",
          op: "UPSERT",
          version: 1,
          value,
        },
      ],
    };
  const commit = await prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    plan,
    receipt,
    plan.mutations,
    metadata,
  );
  expect(
    commit.records.find((record) => record.entity.collection === "manualOrders")
      ?.entity.value,
  ).toEqual({
    ...canonical(),
    workspaceId: "local",
    entries: canonical().entries.map((entry) => ({
      ...entry,
      workspaceId: "local",
    })),
  });
  expect(commit.nextCursor).toBe(1);
  const bad = {
    ...canonical(),
    entries: canonical().entries.map((entry) => ({
      ...entry,
      workspaceId: "foreign",
    })),
  };
  await expect(
    prepareLocalWorkReplayAcknowledgement(
      actor,
      binding,
      plan,
      { ...receipt, effects: [{ ...receipt.effects[0], value: bad }] },
      plan.mutations,
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
it("manual order delta retains later aggregate edits and rejects inconsistent entry scope", async () => {
  const page = {
    epoch: "epoch",
    cursor: 2,
    recovery: false,
    hasMore: false,
    snapshot: null,
    records: [
      {
        seq: 2,
        workspaceId: "remote",
        collection: "manualOrders",
        entityId: "WORKSPACE_TASKS",
        op: "UPSERT",
        version: 1,
      },
    ],
    changes: {
      collections: { manualOrders: { upserts: [canonical()], removed: [] } },
      values: {},
    },
  };
  const commit = await prepareLocalWorkPull(actor, binding, page, [], metadata);
  expect(
    commit?.records.find(
      (record) => record.entity.collection === "manualOrders",
    )?.entity.value,
  ).toMatchObject({
    workspaceId: "local",
    entries: [
      expect.objectContaining({ workspaceId: "local" }),
      expect.objectContaining({ workspaceId: "local" }),
    ],
  });
  expect(
    (
      await prepareLocalWorkPull(
        actor,
        binding,
        page,
        fixture().mutations,
        metadata,
      )
    )?.records.map((record) => record.entity.collection),
  ).toEqual(["$local.remoteBase"]);
  const malformed = {
    ...canonical(),
    entries: canonical().entries.map((entry) => ({
      ...entry,
      scopeKey: "PROJECT_TASKS:foreign",
    })),
  };
  await expect(
    prepareLocalWorkPull(
      actor,
      binding,
      {
        ...page,
        changes: {
          collections: { manualOrders: { upserts: [malformed], removed: [] } },
          values: {},
        },
      },
      [],
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
