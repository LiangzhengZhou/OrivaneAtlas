import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import { buildLocalLinkedKnowledgeReplayRequest } from "./local-linked-knowledge-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId],
    command: {
      name: "link.create",
      input: localDto({
        id,
        from: { kind: "NOTE", id: "original-note" },
        to: { kind: "SPACE", id: "original-space" },
        relation: "REFERENCES",
      }),
    },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "links",
        entityId: id,
        operation: "CREATE",
        baseVersion: 0,
        payload: { from: { kind: "WORK", id: "later-projection" } },
        createdAt: "2026-10-14T00:00:00Z",
        state: "SENDING",
        attemptCount: 1,
        lastAttemptAt: "2026-10-14T00:01:00Z",
      },
    ],
  };
}
it("replays original link references and identity rather than a later projection", () => {
  const plan = fixture();
  expect(buildLocalLinkedKnowledgeReplayRequest(plan)).toMatchObject({
    path: "/api/v1/link/create",
    idempotencyKey: commandId,
    deviceId,
    body: {
      stableId: id,
      from: { kind: "NOTE", id: "original-note" },
      to: { kind: "SPACE", id: "original-space" },
      relation: "REFERENCES",
      syncCommand: {
        effects: [{ collection: "links", id, op: "UPSERT", baseVersion: 0 }],
      },
    },
  });
  expect(
    buildLocalLinkedKnowledgeReplayRequest({ ...plan, mutationIds: [] }),
  ).toBeNull();
  expect(() =>
    buildLocalLinkedKnowledgeReplayRequest({
      ...plan,
      mutations: plan.mutations.map((m) => ({ ...m, baseVersion: 1 })),
    }),
  ).toThrow();
  expect(() =>
    buildLocalLinkedKnowledgeReplayRequest({
      ...plan,
      command: {
        name: "link.create",
        input: localDto({
          id,
          from: { kind: "UNKNOWN", id: "file" },
          to: { kind: "SPACE", id: "space" },
          relation: "REFERENCES",
        }),
      },
    }),
  ).toThrow();
});
it("retains the original deletion version and rejects a mismatched base", () => {
  const plan = fixture(),
    deletion: LocalCommandPlan = {
      ...plan,
      command: { name: "link.delete", input: { id, version: 3 } },
      mutations: plan.mutations.map((m) => ({
        ...m,
        operation: "PATCH",
        baseVersion: 3,
      })),
    };
  expect(buildLocalLinkedKnowledgeReplayRequest(deletion)).toMatchObject({
    path: "/api/v1/link/delete",
    body: { id, version: 3 },
  });
  expect(() =>
    buildLocalLinkedKnowledgeReplayRequest({
      ...deletion,
      mutations: deletion.mutations.map((m) => ({ ...m, baseVersion: 2 })),
    }),
  ).toThrow();
});
it("retains original first-class File endpoints without trusting a later projection", () => {
  const plan = fixture();
  const command = {
    name: "link.create" as const,
    input: localDto({
      id,
      from: { kind: "FILE", id: "original-file" },
      to: { kind: "WORK", id: "original-project" },
      relation: "RELATED",
    }),
  };
  expect(
    buildLocalLinkedKnowledgeReplayRequest({ ...plan, command }),
  ).toMatchObject({
    path: "/api/v1/link/create",
    body: {
      from: { kind: "FILE", id: "original-file" },
      to: { kind: "WORK", id: "original-project" },
      relation: "RELATED",
      stableId: id,
    },
  });
});
