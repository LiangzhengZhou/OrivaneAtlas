import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import type { LocalMutation, LocalSyncState } from "./local-persistence";
import {
  LocalWorkSyncCoordinator,
  type LocalWorkSyncPorts,
} from "./local-work-sync";

const actor = { workspaceId: "local", principalId: "owner" };
function fixture() {
  const binding: LocalSyncState = {
    workspaceId: "local",
    remoteWorkspaceId: "remote",
    remotePrincipalId: "remote-owner",
    serverOrigin: "https://example.test",
    epoch: "epoch",
    cursor: 0,
    version: 1,
  };
  const page = {
    epoch: "epoch",
    cursor: 0,
    recovery: false,
    hasMore: false,
    snapshot: null,
    records: [],
    changes: { collections: {}, values: {} },
  };
  const ports: LocalWorkSyncPorts = {
    metadata: {
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      commit: vi.fn(async () => {}),
    },
    outbox: {
      list: vi.fn(async () => []),
      transition: vi.fn(async (): Promise<LocalMutation> => {
        throw new Error("UNEXPECTED_CLAIM");
      }),
      transitionMany: vi.fn(async () => []),
      recoverSending: vi.fn(async () => 0),
    },
    syncState: {
      get: vi.fn(async () => structuredClone(binding)),
      save: vi.fn(async () => {}),
    },
    replica: { commit: vi.fn(async () => {}) },
    transport: {
      lookup: vi.fn(async () => null),
      pull: vi.fn(async () => structuredClone(page)),
      send: vi.fn(async () => {
        throw new Error("UNEXPECTED_SEND");
      }),
    },
    clock: { now: () => "2026-10-13T00:00:00Z" },
  };
  return {
    ports,
    binding,
    page,
    coordinator: new LocalWorkSyncCoordinator(actor, ports),
  };
}
it("unconfirmed binding never starts network IO or reads pending user content", async () => {
  const f = fixture();
  vi.mocked(f.ports.syncState.get).mockResolvedValue({
    ...f.binding,
    remotePrincipalId: null,
  });
  await expect(f.coordinator.run()).rejects.toThrow("FORBIDDEN");
  expect(f.ports.transport.pull).not.toHaveBeenCalled();
  expect(f.ports.outbox.list).not.toHaveBeenCalled();
});
it("overlapping runs share one promise and unchanged pages do not write or create attempts", async () => {
  const f = fixture();
  const first = f.coordinator.run(),
    second = f.coordinator.run();
  expect(first).toBe(second);
  expect(await first).toEqual({
    accepted: [],
    conflicted: [],
    unresolved: [],
    cursor: 0,
  });
  expect(f.ports.replica.commit).not.toHaveBeenCalled();
  expect(f.ports.outbox.transitionMany).not.toHaveBeenCalled();
  expect(f.ports.transport.send).not.toHaveBeenCalled();
  expect(f.ports.metadata.get).not.toHaveBeenCalled();
});
it("an expired authenticated transport does not reset pending attempts and permits a later explicit retry", async () => {
  const f = fixture();
  vi.mocked(f.ports.transport.pull).mockRejectedValueOnce(
    new DomainError("FORBIDDEN"),
  );
  await expect(f.coordinator.run()).rejects.toThrow("FORBIDDEN");
  expect(f.ports.outbox.recoverSending).not.toHaveBeenCalled();
  expect(f.ports.replica.commit).not.toHaveBeenCalled();
  expect(await f.coordinator.run()).toMatchObject({ cursor: 0, accepted: [] });
});
it("epoch recovery preserves local state instead of proceeding to push", async () => {
  const f = fixture();
  vi.mocked(f.ports.transport.pull).mockResolvedValue({
    ...f.page,
    epoch: "new",
    recovery: true,
  });
  await expect(f.coordinator.run()).rejects.toThrow("VERSION_CONFLICT");
  expect(f.ports.replica.commit).not.toHaveBeenCalled();
  expect(f.ports.outbox.transitionMany).not.toHaveBeenCalled();
  expect(f.ports.transport.send).not.toHaveBeenCalled();
});
it("a switched remote principal stops before any network request", async () => {
  const f = fixture();
  vi.mocked(f.ports.syncState.get)
    .mockResolvedValueOnce(f.binding)
    .mockResolvedValue({ ...f.binding, remotePrincipalId: "other" });
  await expect(f.coordinator.run()).rejects.toThrow("VERSION_CONFLICT");
  expect(f.ports.transport.pull).not.toHaveBeenCalled();
  expect(f.ports.transport.send).not.toHaveBeenCalled();
});

for (const earlierState of ["CONFLICT", "PENDING"] as const) {
  it(`an earlier ${earlierState} command blocks later edits of the same entity but not unrelated work`, async () => {
    const f = fixture();
    const deviceId = "00000000-0000-4000-8000-000000000001";
    const ids = [
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ];
    let pending: LocalMutation[] = ids.map((id, index) => ({
      id,
      commandId: id,
      workspaceId: actor.workspaceId,
      principalId: actor.principalId,
      deviceId,
      entityType: "items",
      entityId: index < 2 ? "same-task" : "unrelated-task",
      operation: "PATCH",
      baseVersion: index + 1,
      basePayload: { title: "Before" },
      payload: { title: `Edit ${index}` },
      state: index === 0 ? earlierState : "PENDING",
      attemptCount: index === 0 && earlierState === "CONFLICT" ? 1 : 0,
      lastAttemptAt:
        index === 0 && earlierState === "CONFLICT" ? f.ports.clock.now() : null,
      createdAt: f.ports.clock.now(),
      order: { transactionVersion: index + 1, operationIndex: 0 },
    }));
    const initial = structuredClone(pending);
    vi.mocked(f.ports.outbox.list).mockImplementation(async () =>
      structuredClone(pending),
    );
    vi.mocked(f.ports.metadata.get).mockImplementation(
      async (_workspaceId, collection, id) => {
        if (collection !== "$local.command") return null;
        const mutation = initial.find((entry) => entry.id === id);
        return mutation
          ? {
              workspaceId: actor.workspaceId,
              collection,
              id,
              version: 1,
              value: {
                schemaVersion: 1,
                id,
                workspaceId: actor.workspaceId,
                principalId: actor.principalId,
                name: "work.update",
                input: {
                  id: mutation.entityId,
                  version: mutation.baseVersion,
                  input: mutation.payload,
                },
                mutationIds: [id],
              },
            }
          : null;
      },
    );
    vi.mocked(f.ports.outbox.transitionMany).mockImplementation(
      async (changes) =>
        changes.map((change) => {
          const index = pending.findIndex(
            (entry) => entry.id === change.mutationId,
          );
          const before = pending[index]!;
          const after: LocalMutation = {
            ...before,
            state: change.nextState,
            attemptCount:
              before.attemptCount + (change.nextState === "SENDING" ? 1 : 0),
            lastAttemptAt:
              change.nextState === "SENDING" ? change.at : before.lastAttemptAt,
          };
          pending = pending.map((entry, offset) =>
            offset === index ? after : entry,
          );
          return structuredClone(after);
        }),
    );
    vi.mocked(f.ports.transport.send).mockImplementation(
      async (_binding, request) => {
        if (request.idempotencyKey === ids[0])
          throw new DomainError("VERSION_CONFLICT");
        if (request.idempotencyKey !== ids[2])
          throw new Error("SENT_BLOCKED_SUCCESSOR");
        throw new Error("REACHED_UNRELATED_COMMAND");
      },
    );
    await expect(f.coordinator.run()).rejects.toThrow(
      "REACHED_UNRELATED_COMMAND",
    );
    const sent = vi
      .mocked(f.ports.transport.send)
      .mock.calls.map((call) => call[1].idempotencyKey);
    expect(sent).toEqual(
      earlierState === "CONFLICT" ? [ids[2]] : [ids[0], ids[2]],
    );
    expect(pending[1]).toEqual(initial[1]);
    expect(pending[0]?.state).toBe("CONFLICT");
    expect(pending[0]?.payload).toEqual(initial[0]?.payload);
  });
}
