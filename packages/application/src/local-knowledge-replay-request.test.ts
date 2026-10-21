import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localObject } from "./local-dto";
import { buildLocalKnowledgeReplayRequest } from "./local-knowledge-replay-request";

const id = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const noteId = "33333333-3333-4333-8333-333333333333";
function fixture(): LocalCommandPlan {
  return {
    id,
    state: "READY",
    mutationIds: [id],
    command: {
      name: "note.save",
      input: {
        id: noteId,
        version: 0,
        create: true,
        input: {
          kind: "NOTE",
          day: null,
          title: "Original",
          bodyMd: "第一行\n第二行",
        },
      },
    },
    mutations: [
      {
        id,
        commandId: id,
        deviceId,
        workspaceId: "local",
        principalId: "owner",
        entityType: "notes",
        entityId: noteId,
        operation: "CREATE",
        baseVersion: 0,
        payload: {
          title: "Manifest must not replace original intent",
          bodyState: "UNLOADED",
        },
        createdAt: "2026-10-13T00:00:00Z",
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
      },
    ],
  };
}
it("document home moves replay exact versioned intent without body duplication", () => {
  const plan = fixture();
  const moved = {
    ...plan,
    command: {
      name: "library.move",
      input: { id: noteId, version: 2, spaceId: "target" },
    },
    mutations: plan.mutations.map((mutation) => ({
      ...mutation,
      entityType: "library",
      operation: "PATCH" as const,
      baseVersion: 2,
    })),
  };
  expect(buildLocalKnowledgeReplayRequest(moved)).toMatchObject({
    path: "/api/v1/library/move",
    body: {
      id: noteId,
      version: 2,
      spaceId: "target",
      syncCommand: {
        effects: [{ collection: "library", id: noteId, baseVersion: 2 }],
      },
    },
  });
  expect(() =>
    buildLocalKnowledgeReplayRequest({
      ...moved,
      command: {
        name: "library.move",
        input: { id: noteId, version: 1, spaceId: "target" },
      },
    }),
  ).toThrow("VALIDATION_ERROR");
});
it("knowledge recovery reconstructs original stable UUID and Markdown bytes rather than a metadata manifest", () => {
  const plan = fixture();
  const request = buildLocalKnowledgeReplayRequest(plan);
  expect(request).toMatchObject({
    path: "/api/v1/note/save",
    idempotencyKey: id,
    deviceId,
    body: {
      id: null,
      version: 0,
      stableId: noteId,
      deviceId,
      input: { bodyMd: "第一行\n第二行" },
      syncCommand: {
        commandId: id,
        deviceId,
        effects: [
          { collection: "notes", id: noteId, op: "UPSERT", baseVersion: 0 },
        ],
      },
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
  expect(JSON.stringify(buildLocalKnowledgeReplayRequest(attempted))).toBe(
    JSON.stringify(request),
  );
  if (!plan.command) throw new Error("MISSING_ORIGINAL_COMMAND");
  Object.assign(localObject(plan.command.input), {
    id: noteId,
    version: 999,
    create: false,
    input: { bodyMd: "Changed caller" },
  });
  expect(request?.body).toHaveProperty("version", 0);
});
it("knowledge replay refuses partial, unsupported, mixed-scope and non-original version effects", () => {
  const plan = fixture();
  expect(
    buildLocalKnowledgeReplayRequest({ ...plan, mutationIds: [id, "missing"] }),
  ).toBeNull();
  expect(
    buildLocalKnowledgeReplayRequest({
      ...plan,
      command: { name: "note.purge", input: { id: noteId, version: 0 } },
    }),
  ).toBeNull();
  for (const patch of [
    { principalId: "foreign" },
    { deviceId: "33333333-3333-4333-8333-333333333333" },
    { entityType: "items" },
    { baseVersion: 3 },
  ]) {
    const mutations = [
      ...plan.mutations,
      { ...plan.mutations[0]!, ...patch, id: "extra" },
    ];
    expect(() =>
      buildLocalKnowledgeReplayRequest({
        ...plan,
        mutationIds: [id, "extra"],
        mutations,
      }),
    ).toThrow("VALIDATION_ERROR");
  }
});

it.each(["note", "library"] as const)(
  "%s restore replays two checked revisions as one atomic human recovery request",
  (name) => {
    const base = fixture(),
      secondId = "44444444-4444-4444-8444-444444444444";
    const plan: LocalCommandPlan = {
      ...base,
      mutationIds: [id, secondId],
      command: {
        name: `${name}.restore`,
        input: {
          id: noteId,
          version: 2,
          create: false,
          input: {
            title: "Recovered",
            kind: name === "note" ? "NOTE" : "DOCUMENT",
            bodyMd: "Device bytes\n第二行",
            ...(name === "note" ? { day: null } : { spaceId: "space" }),
          },
        },
      },
      mutations: [2, 3].map((baseVersion, index) => ({
        ...base.mutations[0]!,
        id: index === 0 ? id : secondId,
        operation: "PATCH",
        entityType: name === "note" ? "notes" : "library",
        baseVersion,
        payload: { version: baseVersion + 1 },
      })),
    };
    expect(buildLocalKnowledgeReplayRequest(plan)).toMatchObject({
      path: `/api/v1/${name}/save`,
      idempotencyKey: id,
      body: {
        id: noteId,
        version: 2,
        restoreDeleted: true,
        input: { bodyMd: "Device bytes\n第二行" },
        syncCommand: {
          commandId: id,
          effects: [2, 3].map((baseVersion) => ({
            collection: name === "note" ? "notes" : "library",
            id: noteId,
            op: "UPSERT",
            baseVersion,
          })),
        },
      },
    });
    expect(() =>
      buildLocalKnowledgeReplayRequest({
        ...plan,
        mutationIds: [id],
        mutations: plan.mutations.slice(0, 1),
      }),
    ).toThrow("VALIDATION_ERROR");
  },
);
