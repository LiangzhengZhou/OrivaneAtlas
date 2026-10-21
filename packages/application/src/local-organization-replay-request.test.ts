import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { buildLocalOrganizationReplayRequest } from "./local-organization-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222";
function plan(
  action: "archive" | "delete",
  kind: "WORK" | "NOTE" = "WORK",
): LocalCommandPlan {
  const deleted = action === "delete";
  return {
    id: commandId,
    state: "READY",
    command: {
      name: "organization.apply",
      input: {
        kind,
        action,
        entries: [{ id: "entity", version: 3, organizationVersion: 1 }],
      },
    },
    mutationIds: [commandId],
    mutations: [
      {
        id: commandId,
        commandId,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: deleted
          ? kind === "WORK"
            ? "items"
            : "notes"
          : "organization",
        entityId: deleted ? "entity" : `${kind}:entity`,
        baseVersion: deleted ? 3 : 1,
        operation: "PATCH",
        payload: { wrongCurrentField: "Never serialize current projection" },
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: "2026-10-13T00:00:00Z",
      },
    ],
  };
}
it("organization original request retains both versions and excludes current projection", () => {
  const request = buildLocalOrganizationReplayRequest(plan("archive"));
  expect(request).toMatchObject({
    path: "/api/v1/organize",
    idempotencyKey: commandId,
    deviceId,
    body: {
      kind: "WORK",
      action: "archive",
      entries: [{ id: "entity", version: 3, organizationVersion: 1 }],
      syncCommand: {
        effects: [
          {
            collection: "organization",
            id: "WORK:entity",
            op: "UPSERT",
            baseVersion: 1,
          },
        ],
      },
    },
  });
  expect(JSON.stringify(request)).not.toContain("wrongCurrentField");
});
it("organization deletion effects preserve Work versus Note identity and original entity version", () => {
  for (const kind of ["WORK", "NOTE"] as const)
    expect(
      buildLocalOrganizationReplayRequest(plan("delete", kind)),
    ).toMatchObject({
      body: {
        syncCommand: {
          effects: [
            {
              collection: kind === "WORK" ? "items" : "notes",
              id: "entity",
              baseVersion: 3,
            },
          ],
        },
      },
    });
});
it("organization serializer rejects partial, foreign and stale original effect groups", () => {
  const original = plan("archive"),
    first = original.mutations[0];
  if (!first) throw new Error("MISSING_MUTATION");
  expect(
    buildLocalOrganizationReplayRequest({ ...original, mutationIds: [] }),
  ).toBeNull();
  expect(() =>
    buildLocalOrganizationReplayRequest({
      ...original,
      mutations: [{ ...first, entityId: "NOTE:entity" }],
    }),
  ).toThrow();
  expect(() =>
    buildLocalOrganizationReplayRequest({
      ...original,
      mutations: [{ ...first, baseVersion: 2 }],
    }),
  ).toThrow();
});
