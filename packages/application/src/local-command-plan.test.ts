import { expect, it, vi } from "vitest";
import { planLocalCommands } from "./local-command-plan";
import type {
  LocalEntity,
  LocalMetadataStore,
  LocalMutation,
} from "./local-persistence";

const actor = { workspaceId: "local", principalId: "owner" };
function mutation(id: string, commandId = "command", index = 0): LocalMutation {
  return {
    id,
    commandId,
    workspaceId: actor.workspaceId,
    principalId: actor.principalId,
    deviceId: "device",
    entityType: "items",
    entityId: id,
    operation: "PATCH",
    baseVersion: 1,
    basePayload: { title: "Before" },
    payload: { title: "After" },
    createdAt: "2026-10-13T00:00:00Z",
    state: "PENDING",
    attemptCount: 0,
    lastAttemptAt: null,
    order: { transactionVersion: 2, operationIndex: index },
  };
}
function fixture(ids = ["command", "effect"]) {
  const record: LocalEntity = {
    workspaceId: actor.workspaceId,
    collection: "$local.command",
    id: "command",
    version: 1,
    value: {
      schemaVersion: 1,
      id: "command",
      workspaceId: actor.workspaceId,
      principalId: actor.principalId,
      name: "work.update",
      input: {
        id: "project",
        version: 1,
        input: {
          completionResolution: { action: "INBOX" },
          projectLifecycle: "COMPLETED",
        },
      },
      mutationIds: ids,
    },
  };
  const store: LocalMetadataStore = {
    get: vi.fn(async () => record),
    list: vi.fn(async () => []),
    commit: vi.fn(async () => {}),
  };
  return { store, record };
}

it("groups original project command once in causal order without replaying effects or scanning metadata", async () => {
  const { store } = fixture();
  const plans = await planLocalCommands(actor, store, [
    mutation("effect", "command", 1),
    mutation("command"),
  ]);
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({
    id: "command",
    state: "READY",
    mutationIds: ["command", "effect"],
    command: {
      name: "work.update",
      input: { input: { completionResolution: { action: "INBOX" } } },
    },
  });
  expect(plans[0]!.mutations.map((entry) => entry.id)).toEqual([
    "command",
    "effect",
  ]);
  expect(store.get).toHaveBeenCalledTimes(1);
  expect(store.list).not.toHaveBeenCalled();
  expect(store.commit).not.toHaveBeenCalled();
});

it("requires receipt resolution before attempted or partially acknowledged groups can be rebased", async () => {
  const { store } = fixture();
  for (const pending of [
    [mutation("effect", "command", 1)],
    [
      mutation("command"),
      {
        ...mutation("effect", "command", 1),
        attemptCount: 1,
        lastAttemptAt: "2026-10-13T00:01:00Z",
      },
    ],
  ]) {
    const before = structuredClone(pending);
    expect((await planLocalCommands(actor, store, pending))[0]!.state).toBe(
      "RECEIPT_REQUIRED",
    );
    expect(pending).toEqual(before);
  }
  expect(store.commit).not.toHaveBeenCalled();
});

it("retains legacy, corrupt, conflict and rejected groups instead of silently dropping them", async () => {
  const { store, record } = fixture(["command"]);
  const { commandId: _id, ...legacy } = mutation("legacy");
  expect((await planLocalCommands(actor, store, [legacy]))[0]!.state).toBe(
    "LEGACY",
  );
  for (const state of ["CONFLICT", "REJECTED"] as const)
    expect(
      (
        await planLocalCommands(actor, store, [
          { ...mutation("command"), state },
        ])
      )[0]!.state,
    ).toBe(state);
  vi.mocked(store.get).mockResolvedValue({ ...record, workspaceId: "foreign" });
  expect(
    (await planLocalCommands(actor, store, [mutation("command")]))[0]!.state,
  ).toBe("CORRUPT");
  await expect(
    planLocalCommands(actor, store, [
      { ...mutation("command"), principalId: "foreign" },
    ]),
  ).rejects.toThrow("LOCAL_COMMAND_SCOPE_CORRUPT");
});
