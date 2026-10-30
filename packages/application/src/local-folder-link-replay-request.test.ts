import { describe, expect, it } from "vitest";
import type { LocalCommandPlan } from "./local-command-plan";
import { buildLocalFolderLinkReplayRequest } from "./local-folder-link-replay-request";

const workspaceId = "workspace-a";
const principalId = "principal-a";
const deviceId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";
const linkId = "33333333-3333-4333-8333-333333333333";
const folderId = "44444444-4444-4444-8444-444444444444";
const spaceId = "55555555-5555-4555-8555-555555555555";
const projectId = "66666666-6666-4666-8666-666666666666";

function plan(
  name:
    | "folderLink.create"
    | "folderLink.delete"
    | "spaceFolderLink.create"
    | "projectFolderLink.create",
  input: Record<string, unknown>,
  entityType: string,
  operation: "CREATE" | "PATCH" = "CREATE",
  baseVersion = 0,
): LocalCommandPlan {
  return {
    id: commandId,
    state: "READY",
    command: { name, input },
    mutationIds: [commandId],
    mutations: [
      {
        id: commandId,
        commandId,
        workspaceId,
        principalId,
        deviceId,
        entityType,
        entityId: linkId,
        operation,
        baseVersion,
        state: "PENDING",
      } as never,
    ],
  } as LocalCommandPlan;
}

describe("folder link replay requests", () => {
  it("builds a general folder link create with a stable id", () => {
    expect(
      buildLocalFolderLinkReplayRequest(
        plan(
          "folderLink.create",
          { id: linkId, folderId, targetKind: "NOTE", targetId: spaceId },
          "folderLinks",
        ),
      ),
    ).toMatchObject({
      path: "/api/v1/folders/link",
      idempotencyKey: commandId,
      deviceId,
      body: {
        folderId,
        targetKind: "NOTE",
        targetId: spaceId,
        stableId: linkId,
        syncCommand: {
          commandId,
          deviceId,
          effects: [
            {
              collection: "folderLinks",
              id: linkId,
              op: "UPSERT",
              baseVersion: 0,
            },
          ],
        },
      },
    });
  });

  it("builds a soft-delete request at the current version", () => {
    expect(
      buildLocalFolderLinkReplayRequest(
        plan(
          "folderLink.delete",
          { id: linkId, version: 2 },
          "folderLinks",
          "PATCH",
          2,
        ),
      ),
    ).toMatchObject({
      path: "/api/v1/folders/unlink",
      body: {
        id: linkId,
        version: 2,
        syncCommand: {
          effects: [
            {
              collection: "folderLinks",
              id: linkId,
              op: "UPSERT",
              baseVersion: 2,
            },
          ],
        },
      },
    });
  });

  it("builds space and project link creates", () => {
    expect(
      buildLocalFolderLinkReplayRequest(
        plan(
          "spaceFolderLink.create",
          { id: linkId, spaceId, folderId },
          "spaceFolderLinks",
        ),
      ),
    ).toMatchObject({
      path: "/api/v1/space-folders/link",
      body: { spaceId, folderId, stableId: linkId },
    });
    expect(
      buildLocalFolderLinkReplayRequest(
        plan(
          "projectFolderLink.create",
          { id: linkId, projectId, folderId },
          "projectFolderLinks",
        ),
      ),
    ).toMatchObject({
      path: "/api/v1/project-folders/link",
      body: { projectId, folderId, stableId: linkId },
    });
  });
});
