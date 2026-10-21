import { expect, it, vi } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";
import { buildLocalReminderReplayRequest } from "./local-reminder-replay-request";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const input = {
  title: "Original",
  bodyMd: "第一行\n第二行",
  day: "2026-10-14",
  time: "10:30",
  timezone: "Asia/Shanghai",
  notifyMode: "MINUTES_BEFORE",
  notifyOffsetMinutes: 15,
  linkedProjectId: null,
  linkedTaskId: null,
  state: "ACTIVE",
};
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId],
    command: {
      name: "reminder.save",
      input: localDto({ id, version: 0, create: true, input, deleted: false }),
    },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "reminders",
        entityId: id,
        operation: "CREATE",
        baseVersion: 0,
        payload: { title: "Must not serialize later projection" },
        createdAt: "2026-10-13T00:00:00Z",
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-13T00:01:00Z",
      },
    ],
  };
}
it("serializes original Reminder input with stable IDs and refuses incomplete or altered effects", () => {
  const plan = fixture(),
    request = buildLocalReminderReplayRequest(plan);
  expect(request).toMatchObject({
    path: "/api/v1/reminders/save",
    idempotencyKey: commandId,
    deviceId,
    body: { id: null, stableId: id, version: 0, input, deleted: false },
  });
  expect(
    buildLocalReminderReplayRequest({ ...plan, mutationIds: [] }),
  ).toBeNull();
  expect(() =>
    buildLocalReminderReplayRequest({
      ...plan,
      mutations: plan.mutations.map((mutation) => ({
        ...mutation,
        baseVersion: 2,
      })),
    }),
  ).toThrow();
  expect(() =>
    buildLocalReminderReplayRequest({
      ...plan,
      mutations: plan.mutations.map((mutation) => ({
        ...mutation,
        entityType: "items",
      })),
    }),
  ).toThrow();
  expect(buildLocalReminderReplayRequest(structuredClone(plan))).toEqual(
    request,
  );
});
it("Reminder ACK validates canonical scope and retains later local edits without moving the cursor", async () => {
  const plan = fixture(),
    actor = { workspaceId: "local", principalId: "owner" };
  const binding: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "human",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 10,
    version: 1,
  };
  const value = localDto({
    ...input,
    id,
    workspaceId: "remote",
    version: 1,
    createdBy: "human",
    updatedBy: "human",
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
    deletedAt: null,
  });
  const receipt = {
    commandId,
    deviceId,
    result: value,
    effects: [{ collection: "reminders", id, op: "UPSERT", version: 1, value }],
  };
  const metadata: LocalMetadataStore = {
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  const accepted = await prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    plan,
    receipt,
    plan.mutations,
    metadata,
  );
  expect(accepted.nextCursor).toBe(10);
  expect(
    accepted.records.find((record) => record.entity.collection === "reminders")
      ?.entity.value,
  ).toMatchObject({ workspaceId: "local", bodyMd: input.bodyMd, version: 1 });
  expect(accepted.acknowledgements).toHaveLength(1);
  const later = {
    ...plan.mutations[0]!,
    id: "later",
    commandId: "later",
    baseVersion: 1,
    state: "PENDING" as const,
    attemptCount: 0,
    lastAttemptAt: null,
  };
  const preserved = await prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    plan,
    receipt,
    [...plan.mutations, later],
    metadata,
  );
  expect(preserved.records.map((record) => record.entity.collection)).toEqual([
    "$local.remoteBase",
  ]);
  await expect(
    prepareLocalWorkReplayAcknowledgement(
      actor,
      binding,
      plan,
      { ...receipt, deviceId: id },
      plan.mutations,
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    prepareLocalWorkReplayAcknowledgement(
      actor,
      binding,
      plan,
      {
        ...receipt,
        effects: [
          {
            ...receipt.effects[0],
            value: { ...input, id, workspaceId: "foreign", version: 1 },
          },
        ],
      },
      plan.mutations,
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
