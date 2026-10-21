import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localObject } from "./local-dto";
import { buildLocalWorkReplayRequest } from "./local-work-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "READY",
    command: {
      name: "work.update",
      input: {
        id: "project",
        version: 3,
        input: {
          projectLifecycle: "COMPLETED",
          completionResolution: { action: "INBOX" },
          descriptionMd: "原文\n第二行",
        },
      },
    },
    mutationIds: [commandId, "effect"],
    mutations: [commandId, "effect"].map((id, index) => ({
      id,
      commandId,
      deviceId,
      workspaceId: "local",
      principalId: "owner",
      entityType: "items",
      entityId: index === 0 ? "project" : "task",
      operation: "PATCH",
      baseVersion: index === 0 ? 3 : 7,
      payload: { title: "This entity diff must not be replayed" },
      createdAt: "2026-10-13T00:00:00Z",
      state: "PENDING",
      attemptCount: 0,
      lastAttemptAt: null,
    })),
  };
}
it("serializes original logical intent and full effects, preserving identical receipt recovery bytes", () => {
  const plan = fixture();
  const request = buildLocalWorkReplayRequest(plan)!;
  expect(request.path).toBe("/api/v1/work/update");
  expect(request.idempotencyKey).toBe(commandId);
  expect(request.body).toEqual({
    id: "project",
    version: 3,
    input: {
      projectLifecycle: "COMPLETED",
      completionResolution: { action: "INBOX" },
      descriptionMd: "原文\n第二行",
    },
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        { collection: "items", id: "project", op: "UPSERT", baseVersion: 3 },
        { collection: "items", id: "task", op: "UPSERT", baseVersion: 7 },
      ],
    },
  });
  const attempted: LocalCommandPlan = {
    ...plan,
    state: "RECEIPT_REQUIRED",
    mutations: plan.mutations.map((mutation) => ({
      ...mutation,
      state: "SENDING",
      attemptCount: 1,
      lastAttemptAt: "2026-10-13T00:01:00Z",
    })),
  };
  expect(JSON.stringify(buildLocalWorkReplayRequest(attempted))).toBe(
    JSON.stringify(request),
  );
  Object.assign(localObject(plan.command!.input), { version: 99 });
  expect(request.body).toHaveProperty("version", 3);
});
it("does not serialize partial groups, legacy, unsupported or rejected effects", () => {
  const plan = fixture();
  expect(buildLocalWorkReplayRequest({ ...plan, state: "LEGACY" })).toBeNull();
  expect(
    buildLocalWorkReplayRequest({
      ...plan,
      command: { ...plan.command!, name: "work.purge" },
    }),
  ).toBeNull();
  expect(
    buildLocalWorkReplayRequest({
      ...plan,
      state: "RECEIPT_REQUIRED",
      mutations: plan.mutations.slice(1),
    }),
  ).toBeNull();
  expect(() =>
    buildLocalWorkReplayRequest({
      ...plan,
      mutations: plan.mutations.map((mutation) => ({
        ...mutation,
        state: "REJECTED",
      })),
    }),
  ).toThrow();
  expect(() =>
    buildLocalWorkReplayRequest({
      ...plan,
      mutations: plan.mutations.map((mutation, index) => ({
        ...mutation,
        principalId: index ? "foreign" : "owner",
      })),
    }),
  ).toThrow();
  expect(() =>
    buildLocalWorkReplayRequest({
      ...plan,
      command: {
        ...plan.command!,
        input: { id: "project", version: 3, input: {}, principalId: "foreign" },
      },
    }),
  ).toThrow();
});

it("maps stable Work and Edge creations without transmitting client attribution", () => {
  const plan = fixture();
  const stableId = "33333333-3333-4333-8333-333333333333";
  const mutation = {
    ...plan.mutations[0]!,
    entityId: stableId,
    operation: "CREATE" as const,
    baseVersion: null,
    payload: { createdBy: "local-owner", workspaceId: "local" },
  };
  const create: LocalCommandPlan = {
    ...plan,
    mutationIds: [commandId],
    mutations: [mutation],
    command: {
      name: "work.create",
      input: {
        id: stableId,
        input: { title: "Offline", descriptionMd: "保留\n换行" },
      },
    },
  };
  expect(buildLocalWorkReplayRequest(create)?.body).toEqual({
    title: "Offline",
    descriptionMd: "保留\n换行",
    stableId,
    deviceId,
    syncCommand: {
      commandId,
      deviceId,
      effects: [
        { collection: "items", id: stableId, op: "UPSERT", baseVersion: 0 },
      ],
    },
  });
  const edge: LocalCommandPlan = {
    ...create,
    mutations: [{ ...mutation, entityType: "edges" }],
    command: {
      name: "edge.create",
      input: { id: stableId, fromId: "a", toId: "b" },
    },
  };
  expect(buildLocalWorkReplayRequest(edge)).toMatchObject({
    path: "/api/v1/edge/create",
    body: { fromId: "a", toId: "b", stableId, deviceId },
  });
  expect(
    buildLocalWorkReplayRequest({
      ...create,
      mutationIds: ["wrong"],
      mutations: [{ ...mutation, id: "wrong" }],
    }),
  ).toBeNull();
});
