import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { buildLocalProjectKnowledgeReplayRequest } from "./local-project-knowledge-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  materialId = "33333333-3333-4333-8333-333333333333",
  targetId = "44444444-4444-4444-8444-444444444444";
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "READY",
    command: {
      name: "project.document.create",
      input: {
        materialId,
        targetId,
        input: {
          projectId: "project",
          spaceId: "space",
          title: "Original",
          bodyMd: "原文\n[[Target]]",
        },
      },
    },
    mutationIds: [commandId, "effect"],
    mutations: [
      {
        id: commandId,
        commandId,
        workspaceId: "local",
        principalId: "owner",
        deviceId,
        entityType: "library",
        entityId: targetId,
        operation: "CREATE",
        baseVersion: null,
        payload: { bodyMd: "Newer body must not replace original" },
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: "2026-10-14T00:00:00Z",
      },
      {
        id: "effect",
        commandId,
        workspaceId: "local",
        principalId: "owner",
        deviceId,
        entityType: "projectMaterials",
        entityId: materialId,
        operation: "CREATE",
        baseVersion: null,
        payload: { title: "Newer projection" },
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: "2026-10-14T00:00:00Z",
      },
    ],
  };
}
it("project replay sends original Markdown and both stable identities without projection reconstruction", () => {
  const request = buildLocalProjectKnowledgeReplayRequest(fixture());
  expect(request).toMatchObject({
    path: "/api/v1/projects/document/create",
    body: {
      title: "Original",
      bodyMd: "原文\n[[Target]]",
      stableMaterialId: materialId,
      stableTargetId: targetId,
      deviceId,
      syncCommand: {
        effects: [
          { collection: "library", id: targetId, baseVersion: 0 },
          { collection: "projectMaterials", id: materialId, baseVersion: 0 },
        ],
      },
    },
  });
  expect(JSON.stringify(request)).not.toContain("Newer");
});
it("project replay rejects missing, stale and foreign effect declarations", () => {
  const plan = fixture(),
    first = plan.mutations[0],
    second = plan.mutations[1];
  if (!first || !second) throw new Error("MISSING_EFFECTS");
  expect(() =>
    buildLocalProjectKnowledgeReplayRequest({
      ...plan,
      mutations: [first],
      mutationIds: [commandId],
    }),
  ).toThrow();
  expect(() =>
    buildLocalProjectKnowledgeReplayRequest({
      ...plan,
      mutations: [{ ...first, baseVersion: 1 }, second],
    }),
  ).toThrow();
  expect(() =>
    buildLocalProjectKnowledgeReplayRequest({
      ...plan,
      mutations: [first, { ...second, workspaceId: "foreign" }],
    }),
  ).toThrow();
  expect(
    buildLocalProjectKnowledgeReplayRequest({
      ...plan,
      mutationIds: ["effect", commandId],
    }),
  ).toBeNull();
});
