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
it("folder create and soft archive replay through the organization collection", () => {
  const folderId = "33333333-3333-4333-8333-333333333333";
  const created: LocalCommandPlan = {
    id: commandId,
    state: "READY",
    command: {
      name: "organization.apply",
      input: {
        kind: "FOLDER",
        action: "create",
        id: folderId,
        name: "Research",
        parentId: "",
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
        entityType: "organization",
        entityId: `FOLDER:${folderId}`,
        baseVersion: 0,
        operation: "CREATE",
        payload: { localOnly: "not serialized" },
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: "2026-10-13T00:00:00Z",
      },
    ],
  };
  const request = buildLocalOrganizationReplayRequest(created);
  expect(request).toMatchObject({
    path: "/api/v1/organize",
    idempotencyKey: commandId,
    body: {
      kind: "FOLDER",
      action: "create",
      id: folderId,
      name: "Research",
      parentId: "",
      syncCommand: {
        effects: [
          {
            collection: "organization",
            id: `FOLDER:${folderId}`,
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
  });
  expect(JSON.stringify(request)).not.toContain("not serialized");
  const archived: LocalCommandPlan = {
    ...created,
    command: {
      name: "organization.apply",
      input: {
        kind: "FOLDER",
        action: "delete",
        entries: [{ id: folderId, version: 1, organizationVersion: 1 }],
      },
    },
    mutations: [
      {
        ...created.mutations[0]!,
        entityId: `FOLDER:${folderId}`,
        baseVersion: 1,
        operation: "PATCH",
      },
    ],
  };
  expect(buildLocalOrganizationReplayRequest(archived)).toMatchObject({
    body: {
      kind: "FOLDER",
      action: "delete",
      syncCommand: {
        effects: [
          {
            collection: "organization",
            id: `FOLDER:${folderId}`,
            baseVersion: 1,
          },
        ],
      },
    },
  });
});
it("note icon replay keeps the presentation glyph out of the content projection", () => {
  const noteId = "44444444-4444-4444-8444-444444444444";
  const plan: LocalCommandPlan = {
    id: commandId,
    state: "READY",
    command: {
      name: "organization.apply",
      input: {
        kind: "NOTE",
        action: "icon",
        icon: "🔬",
        entries: [{ id: noteId, version: 3, organizationVersion: 0 }],
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
        entityType: "organization",
        entityId: `NOTE:${noteId}`,
        baseVersion: 0,
        operation: "CREATE",
        payload: { bodyMd: "must stay out" },
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: "2026-10-13T00:00:00Z",
      },
    ],
  };
  const request = buildLocalOrganizationReplayRequest(plan);
  expect(request).toMatchObject({
    body: {
      kind: "NOTE",
      action: "icon",
      icon: "🔬",
      syncCommand: {
        effects: [
          {
            collection: "organization",
            id: `NOTE:${noteId}`,
            op: "UPSERT",
            baseVersion: 0,
          },
        ],
      },
    },
  });
  expect(JSON.stringify(request)).not.toContain("must stay out");
  expect(() =>
    buildLocalOrganizationReplayRequest({
      ...plan,
      command: {
        name: "organization.apply",
        input: {
          kind: "NOTE",
          action: "icon",
          icon: "x".repeat(17),
          entries: [{ id: noteId, version: 3, organizationVersion: 0 }],
        },
      },
    }),
  ).toThrow();
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
