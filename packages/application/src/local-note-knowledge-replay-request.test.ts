import { expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { localDto } from "./local-dto";
import { buildLocalNoteKnowledgeReplayRequest } from "./local-note-knowledge-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  documentId = "33333333-3333-4333-8333-333333333333",
  linkId = "44444444-4444-4444-8444-444444444444";
function fixture(): LocalCommandPlan {
  return {
    id: commandId,
    state: "RECEIPT_REQUIRED",
    mutationIds: [commandId, "link-mutation", "note-mutation"],
    command: {
      name: "note.document.promote",
      input: localDto({
        id: "note",
        version: 7,
        documentId,
        linkId,
        input: {
          spaceId: "space",
          parentDocumentId: null,
          archiveSourceNote: true,
        },
      }),
    },
    mutations: [
      { entityType: "library", entityId: documentId, baseVersion: 0 },
      { entityType: "links", entityId: linkId, baseVersion: 0 },
      { entityType: "notes", entityId: "note", baseVersion: 7 },
    ].map((entry, i) => ({
      ...entry,
      id: [commandId, "link-mutation", "note-mutation"][i]!,
      commandId,
      deviceId,
      workspaceId: "local",
      principalId: "owner",
      operation: entry.baseVersion ? "PATCH" : "CREATE",
      payload: { bodyMd: "Later projection must not overwrite source" },
      state: "SENDING",
      attemptCount: 1,
      createdAt: "2026-10-14T00:00:00Z",
      lastAttemptAt: "2026-10-14T00:01:00Z",
    })),
  };
}
it("preserves original promotion source version, stable IDs and complete deletion effects", () => {
  const plan = fixture();
  expect(buildLocalNoteKnowledgeReplayRequest(plan)).toMatchObject({
    path: "/api/v1/note/promote",
    body: {
      id: "note",
      version: 7,
      stableDocumentId: documentId,
      stableLinkId: linkId,
      spaceId: "space",
      parentDocumentId: null,
      archiveSourceNote: true,
      syncCommand: {
        effects: [
          {
            collection: "library",
            id: documentId,
            baseVersion: 0,
            op: "UPSERT",
          },
          { collection: "links", id: linkId, baseVersion: 0, op: "UPSERT" },
          { collection: "notes", id: "note", baseVersion: 7, op: "UPSERT" },
        ],
      },
    },
  });
  expect(
    buildLocalNoteKnowledgeReplayRequest({ ...plan, mutationIds: [commandId] }),
  ).toBeNull();
  expect(() =>
    buildLocalNoteKnowledgeReplayRequest({
      ...plan,
      mutations: plan.mutations.slice(0, 2),
      mutationIds: plan.mutationIds.slice(0, 2),
    }),
  ).toThrow();
  expect(() =>
    buildLocalNoteKnowledgeReplayRequest({
      ...plan,
      mutations: plan.mutations.map((m, i) =>
        i === 2 ? { ...m, baseVersion: 8 } : m,
      ),
    }),
  ).toThrow();
  expect(() =>
    buildLocalNoteKnowledgeReplayRequest({
      ...plan,
      mutations: plan.mutations.map((m, i) =>
        i === 1 ? { ...m, principalId: "foreign" } : m,
      ),
    }),
  ).toThrow();
});
