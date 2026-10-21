import { expect, it, vi } from "vitest";
import type {
  LocalEntity,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import { recoverLocalWorkReceipts } from "./local-receipt-recovery";

const actor = { workspaceId: "local", principalId: "owner" };
const commandId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const binding: LocalSyncState = {
    ...actor,
    remotePrincipalId: "remote-owner",
    remoteWorkspaceId: "remote",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 10,
    version: 1,
  };
  const mutation: LocalMutation = {
    ...actor,
    id: commandId,
    commandId,
    deviceId,
    entityType: "items",
    entityId: "task",
    operation: "PATCH",
    baseVersion: 1,
    payload: { title: "Local" },
    createdAt: "2026-10-13T00:00:00Z",
    state: "SENDING",
    attemptCount: 1,
    lastAttemptAt: "2026-10-13T00:01:00Z",
    order: { transactionVersion: 1, operationIndex: 0 },
  };
  const command: LocalEntity = {
    workspaceId: actor.workspaceId,
    collection: "$local.command",
    id: commandId,
    version: 1,
    value: {
      ...actor,
      schemaVersion: 1,
      id: commandId,
      name: "work.update",
      input: { id: "task", version: 1, input: { title: "Local" } },
      mutationIds: [commandId],
    },
  };
  const ports = {
    metadata: {
      get: vi.fn(async () => structuredClone(command)),
      list: vi.fn(async () => []),
      commit: vi.fn(async () => {}),
    },
    outbox: {
      list: vi.fn(async () => [structuredClone(mutation)]),
      transition: vi.fn(async () => mutation),
      transitionMany: vi.fn(async () => [mutation]),
      recoverSending: vi.fn(async () => 0),
    },
    syncState: {
      get: vi.fn(
        async (): Promise<LocalSyncState | null> => structuredClone(binding),
      ),
      save: vi.fn(async () => {}),
    },
    replica: { commit: vi.fn(async () => {}) },
    transport: { lookup: vi.fn(async (): Promise<unknown | null> => null) },
  };
  return { ports, binding, mutation };
}

it("refuses unconfirmed legacy identity before reading pending content or using transport", async () => {
  const f = fixture();
  f.ports.syncState.get.mockResolvedValue({
    ...f.binding,
    remotePrincipalId: null,
  });
  await expect(recoverLocalWorkReceipts(actor, f.ports)).rejects.toThrow(
    "FORBIDDEN",
  );
  expect(f.ports.outbox.list).not.toHaveBeenCalled();
  expect(f.ports.transport.lookup).not.toHaveBeenCalled();
});
it("an absent receipt retains original sending attempt without reset, push or cursor advance", async () => {
  const f = fixture();
  expect(await recoverLocalWorkReceipts(actor, f.ports)).toEqual({
    acknowledged: [],
    unresolved: [commandId],
  });
  expect(f.ports.transport.lookup).toHaveBeenCalledWith(
    f.binding,
    commandId,
    deviceId,
  );
  expect(f.ports.replica.commit).not.toHaveBeenCalled();
  expect(f.ports.outbox.transitionMany).not.toHaveBeenCalled();
  expect(f.ports.outbox.recoverSending).not.toHaveBeenCalled();
  expect(f.ports.syncState.save).not.toHaveBeenCalled();
});
it("transport failure does not acknowledge or rewrite uncertain attempts", async () => {
  const f = fixture();
  f.ports.transport.lookup.mockRejectedValue(new Error("NETWORK_ERROR"));
  await expect(recoverLocalWorkReceipts(actor, f.ports)).rejects.toThrow(
    "NETWORK_ERROR",
  );
  expect(f.ports.replica.commit).not.toHaveBeenCalled();
  expect(f.ports.outbox.transition).not.toHaveBeenCalled();
});
it("changing remote identity, origin or epoch stops recovery before any IO", async () => {
  for (const changed of [
    { remotePrincipalId: "other" },
    { serverOrigin: "https://other.test" },
    { epoch: "new" },
  ]) {
    const f = fixture();
    f.ports.syncState.get
      .mockResolvedValueOnce(f.binding)
      .mockResolvedValue({ ...f.binding, ...changed });
    await expect(recoverLocalWorkReceipts(actor, f.ports)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    expect(f.ports.transport.lookup).not.toHaveBeenCalled();
    expect(f.ports.replica.commit).not.toHaveBeenCalled();
  }
});
