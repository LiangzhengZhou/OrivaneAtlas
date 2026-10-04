import type { AgentSession } from "../../packages/application/src/index";

export const legacyV21Session: AgentSession = {
  id: "legacy-session",
  workspaceId: "w",
  createdBy: "p",
  version: 1,
  title: "Original conversation",
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-10-01T12:00:00Z",
  deletedAt: null,
  messages: Array.from({ length: 120 }, (_, index) => ({
    id: `legacy-message-${index}`,
    kind: "USER",
    text: `Original\r\nMessage ${index} ${"x".repeat(200)}`,
    runId: null,
    createdAt: "2026-10-01T12:00:00Z",
  })),
};
export const legacyV21Document = JSON.stringify({
  id: "legacy-document",
  workspaceId: "w",
  kind: "DOCUMENT",
  title: "Original document",
  bodyMd: "First\r\nSecond\n[[Original]]",
  version: 1,
});
