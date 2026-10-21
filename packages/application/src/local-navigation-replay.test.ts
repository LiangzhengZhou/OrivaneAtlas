import { defaultNavigationPreference } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import { buildLocalNavigationReplayRequest } from "./local-navigation-replay-request";
import type { LocalMetadataStore, LocalSyncState } from "./local-persistence";
import { prepareLocalWorkPull } from "./local-work-pull";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222";
const actor = { workspaceId: "local", principalId: "installation-owner" };
const binding: LocalSyncState = {
  workspaceId: "local",
  remoteWorkspaceId: "remote",
  remotePrincipalId: "remote-account",
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
      name: "navigation.save",
      input: localDto(defaultNavigationPreference()),
    },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: actor.principalId,
        entityType: "navigationPreference",
        entityId: actor.principalId,
        operation: "CREATE",
        baseVersion: 0,
        payload: {},
        createdAt: "2026-10-13T00:00:00Z",
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-13T00:01:00Z",
      },
    ],
  };
}
it("Navigation sends only the confirmed remote principal and ACK maps it to the installation-owned singleton", async () => {
  const plan = fixture();
  expect(buildLocalNavigationReplayRequest(plan, binding)?.body).toHaveProperty(
    "syncCommand.effects",
    [
      {
        collection: "navigationPreference",
        id: "remote-account",
        op: "UPSERT",
        baseVersion: 0,
      },
    ],
  );
  expect(() =>
    buildLocalNavigationReplayRequest(plan, {
      ...binding,
      remotePrincipalId: null,
    }),
  ).toThrow();
  const value = localDto({ ...defaultNavigationPreference(), version: 1 });
  const receipt = {
    commandId,
    deviceId,
    result: value,
    effects: [
      {
        collection: "navigationPreference",
        id: "remote-account",
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
      (record) => record.entity.collection === "navigationPreference",
    )?.entity,
  ).toEqual({
    workspaceId: "local",
    collection: "navigationPreference",
    id: actor.principalId,
    version: 1,
    value,
  });
  expect(commit.nextCursor).toBe(1);
  await expect(
    prepareLocalWorkReplayAcknowledgement(
      actor,
      binding,
      plan,
      {
        ...receipt,
        effects: [{ ...receipt.effects[0], id: "foreign-account" }],
      },
      plan.mutations,
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
it("Navigation delta refuses another account and preserves later local edits with a scoped canonical base", async () => {
  const value = localDto({ ...defaultNavigationPreference(), version: 1 });
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
        collection: "navigationPreference",
        entityId: "remote-account",
        op: "UPSERT",
        version: 1,
      },
    ],
    changes: { collections: {}, values: { navigationPreference: value } },
  };
  const accepted = await prepareLocalWorkPull(
    actor,
    binding,
    page,
    [],
    metadata,
  );
  expect(
    accepted?.records.find(
      (record) => record.entity.collection === "navigationPreference",
    )?.entity.id,
  ).toBe(actor.principalId);
  expect(accepted?.nextCursor).toBe(2);
  const preserved = await prepareLocalWorkPull(
    actor,
    binding,
    page,
    fixture().mutations,
    metadata,
  );
  expect(preserved?.records.map((record) => record.entity.collection)).toEqual([
    "$local.remoteBase",
  ]);
  await expect(
    prepareLocalWorkPull(
      actor,
      binding,
      {
        ...page,
        records: page.records.map((record) => ({
          ...record,
          entityId: "foreign-account",
        })),
      },
      [],
      metadata,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});
