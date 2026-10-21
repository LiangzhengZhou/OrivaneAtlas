import { expect, it, vi } from "vitest";
import { buildLocalCalendarReplayRequest } from "./local-calendar-replay-request";
import type { LocalCommandPlan } from "./local-command-plan";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";
import { prepareLocalWorkPull } from "./local-work-pull";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222";
const actor = { workspaceId: "local", principalId: "owner" };
const binding: LocalSyncState = {
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
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId],
    command: {
      name: "calendar.settings",
      input: { version: 0, timezone: "Asia/Shanghai" },
    },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "calendarSettings",
        entityId: "workspace",
        operation: "CREATE",
        baseVersion: 0,
        payload: { timezone: "Must not serialize later projection" },
        createdAt: "2026-10-13T00:00:00Z",
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-13T00:01:00Z",
      },
    ],
  };
}
it("Calendar original command uses the singleton ID and canonical ACK never manufactures entity identity fields", async () => {
  const plan = fixture();
  expect(buildLocalCalendarReplayRequest(plan)).toMatchObject({
    path: "/api/v1/work/calendar-settings",
    idempotencyKey: commandId,
    body: {
      version: 0,
      timezone: "Asia/Shanghai",
      syncCommand: {
        effects: [
          {
            collection: "calendarSettings",
            id: "workspace",
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
  });
  const value = { version: 1, timezone: "Asia/Shanghai" };
  const receipt = {
    commandId,
    deviceId,
    result: value,
    effects: [
      {
        collection: "calendarSettings",
        id: "workspace",
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
    commit.records.find(
      (record) => record.entity.collection === "calendarSettings",
    )?.entity.value,
  ).toEqual(value);
  expect(commit.nextCursor).toBe(1);
  const later = {
    ...plan.mutations[0]!,
    id: "later",
    commandId: "later",
    baseVersion: 1,
    state: "PENDING" as const,
    attemptCount: 0,
    lastAttemptAt: null,
  };
  expect(
    (
      await prepareLocalWorkReplayAcknowledgement(
        actor,
        binding,
        plan,
        receipt,
        [...plan.mutations, later],
        metadata,
      )
    ).records.map((record) => record.entity.collection),
  ).toEqual(["$local.remoteBase"]);
});
it("Calendar metadata value is paired with its journal and rejects contradictory derived timezone or foreign singleton", async () => {
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
        collection: "calendarSettings",
        entityId: "workspace",
        op: "UPSERT",
        version: 1,
      },
    ],
    changes: {
      collections: {},
      values: {
        calendarSettings: { version: 1, timezone: "Asia/Shanghai" },
        calendarTimezone: "Asia/Shanghai",
      },
    },
  };
  const commit = await prepareLocalWorkPull(actor, binding, page, [], metadata);
  expect(
    commit?.records.find(
      (record) => record.entity.collection === "calendarSettings",
    )?.entity.value,
  ).toEqual({ version: 1, timezone: "Asia/Shanghai" });
  expect(commit?.nextCursor).toBe(2);
  await expect(
    prepareLocalWorkPull(
      actor,
      binding,
      {
        ...page,
        changes: {
          ...page.changes,
          values: { ...page.changes.values, calendarTimezone: "UTC" },
        },
      },
      [],
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    prepareLocalWorkPull(
      actor,
      binding,
      {
        ...page,
        records: page.records.map((record) => ({
          ...record,
          entityId: "foreign",
        })),
      },
      [],
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    prepareLocalWorkPull(
      actor,
      binding,
      {
        ...page,
        changes: { collections: {}, values: { calendarTimezone: "UTC" } },
      },
      [],
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
