import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { buildLocalFileReplayRequest } from "./local-file-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId],
    command: {
      name: "file.upload",
      input: {
        id,
        input: {
          name: "Original.bin",
          mime: "application/octet-stream",
          spaceId: null,
        },
        contentHash: "b".repeat(64),
        size: 5,
      },
    },
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "files",
        entityId: id,
        operation: "CREATE",
        baseVersion: 0,
        payload: {
          name: "Later renamed.txt",
          base64: "never serialize projection",
        },
        state: "SENDING",
        attemptCount: 1,
        createdAt: "2026-10-14T00:00:00Z",
        lastAttemptAt: "2026-10-14T00:01:00Z",
      },
    ],
  };
}
it("serializes original File metadata and content address without binary or current projection", () => {
  const plan = fixture(),
    request = buildLocalFileReplayRequest(plan);
  expect(request).toMatchObject({
    path: "/api/v1/files/register",
    body: {
      name: "Original.bin",
      contentHash: "b".repeat(64),
      size: 5,
      stableId: id,
      deviceId,
      syncCommand: {
        effects: [{ collection: "files", id, op: "UPSERT", baseVersion: 0 }],
      },
    },
  });
  expect(request?.body).not.toHaveProperty("base64");
  expect(buildLocalFileReplayRequest(structuredClone(plan))).toEqual(request);
  expect(buildLocalFileReplayRequest({ ...plan, mutationIds: [] })).toBeNull();
  expect(() =>
    buildLocalFileReplayRequest({
      ...plan,
      command: {
        name: "file.upload",
        input: { ...(plan.command!.input as object), base64: "forbidden" },
      },
    }),
  ).toThrow();
});
it("preserves rename and delete/restore source versions and rejects changed effects", () => {
  for (const command of [
    {
      name: "file.policy",
      input: {
        id,
        version: 7,
        aiPolicy: {
          classification: "PRIVATE",
          processingBoundary: "LOCAL_ONLY",
          aiAccess: "ASK",
        },
      },
    },
    { name: "file.rename", input: { id, version: 7, name: "Display.txt" } },
    { name: "file.delete", input: { id, version: 7, deleted: true } },
    { name: "file.delete", input: { id, version: 7, deleted: false } },
  ]) {
    const initial = fixture(),
      plan: LocalCommandPlan = {
        ...initial,
        command,
        mutations: initial.mutations.map((m) => ({
          ...m,
          operation: "PATCH",
          baseVersion: 7,
        })),
      };
    expect(buildLocalFileReplayRequest(plan)?.body).toMatchObject(
      command.input,
    );
    expect(() =>
      buildLocalFileReplayRequest({
        ...plan,
        mutations: plan.mutations.map((m) => ({ ...m, baseVersion: 8 })),
      }),
    ).toThrow();
    expect(() =>
      buildLocalFileReplayRequest({
        ...plan,
        mutations: plan.mutations.map((m) => ({ ...m, entityId: "foreign" })),
      }),
    ).toThrow();
  }
});
