import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import { buildLocalPlanReplayRequest } from "./local-plan-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  planId = "33333333-3333-4333-8333-333333333333",
  projectId = "44444444-4444-4444-8444-444444444444";
function fixture(publish = false): LocalCommandPlan {
  const entries = publish
    ? [
        { entityType: "items", entityId: projectId, baseVersion: 0 },
        { entityType: "items", entityId: projectId, baseVersion: 1 },
        { entityType: "workflows", entityId: planId, baseVersion: 1 },
      ]
    : [{ entityType: "workflows", entityId: planId, baseVersion: 0 }];
  const mutationIds = entries.map((_, i) => (i ? `mutation-${i}` : commandId));
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds,
    command: {
      name: publish ? "plan.publish" : "plan.preview",
      input: localDto(
        publish
          ? { id: planId, version: 1 }
          : {
              id: planId,
              projectId: null,
              manifest: {
                version: 1,
                tasks: [
                  {
                    tempId: "t",
                    title: "Reviewed",
                    descriptionMd: "第一行\n第二行",
                    dependsOn: [],
                  },
                ],
              },
              baseRevision: JSON.stringify({
                categories: [],
                items: [],
                edges: [],
              }),
              documentRevision: "",
            },
      ),
    },
    mutations: entries.map((entry, i) => ({
      ...entry,
      id: mutationIds[i]!,
      commandId,
      deviceId,
      workspaceId: "local",
      principalId: "owner",
      operation: entry.baseVersion ? "PATCH" : "CREATE",
      payload: {
        title: "Later projection",
        bodyMd: "Do not send current projection",
      },
      state: "SENDING",
      attemptCount: 1,
      createdAt: "2026-10-14T00:00:00Z",
      lastAttemptAt: "2026-10-14T00:01:00Z",
    })),
  };
}
it("replays the reviewed preview baseline and manifest instead of the current projection", () => {
  const original = fixture();
  const request = buildLocalPlanReplayRequest(original);
  expect(request).toMatchObject({
    path: "/api/v1/plans/preview",
    body: {
      stableId: planId,
      documentRevision: "",
      manifest: {
        tasks: [{ title: "Reviewed", descriptionMd: "第一行\n第二行" }],
      },
    },
  });
  expect(request?.body).not.toHaveProperty("title");
  expect(buildLocalPlanReplayRequest(structuredClone(original))).toEqual(
    request,
  );
  expect(() =>
    buildLocalPlanReplayRequest({
      ...original,
      mutations: original.mutations.map((m) => ({
        ...m,
        principalId: "foreign",
        workspaceId: "other",
        commandId: "other",
      })),
    }),
  ).toThrow();
});
it("retains complete publication version chains and rejects changed source versions or ordering", () => {
  const plan = fixture(true);
  expect(buildLocalPlanReplayRequest(plan)).toMatchObject({
    path: "/api/v1/plans/publish",
    body: {
      id: planId,
      version: 1,
      syncCommand: {
        effects: [
          { id: projectId, baseVersion: 0 },
          { id: projectId, baseVersion: 1 },
          { id: planId, baseVersion: 1 },
        ],
      },
    },
  });
  expect(
    buildLocalPlanReplayRequest({
      ...plan,
      mutationIds: [...plan.mutationIds].reverse(),
    }),
  ).toBeNull();
  expect(() =>
    buildLocalPlanReplayRequest({
      ...plan,
      mutations: plan.mutations.map((m, i) =>
        i === 1 ? { ...m, baseVersion: 2 } : m,
      ),
    }),
  ).toThrow();
  expect(() =>
    buildLocalPlanReplayRequest({
      ...plan,
      command: { name: "plan.publish", input: { id: planId, version: 2 } },
    }),
  ).toThrow();
});
