import { describe, expect, it } from "vitest";
import {
  accessibleConversationSelection,
  conversationSelectionKey,
  latestConversationRunId,
} from "./conversation-selection";

it("selects only the latest run reference from the current message page", () => {
  expect(latestConversationRunId([])).toBeNull();
  expect(
    latestConversationRunId([
      { runId: "old" },
      { runId: "current" },
      { runId: null },
    ]),
  ).toBe("current");
});

describe("explicit conversation selection", () => {
  it("never picks the latest conversation or restores an inaccessible ID", () => {
    const summaries = [{ id: "latest" }, { id: "chosen" }];
    expect(accessibleConversationSelection(null, summaries)).toBeNull();
    expect(accessibleConversationSelection("foreign", summaries)).toBeNull();
    expect(accessibleConversationSelection("chosen", summaries)).toBe("chosen");
  });
  it("isolates preferences by server, workspace, principal and surface", () => {
    const keys = [
      ["server", "workspace", "principal", "workspace"],
      ["other", "workspace", "principal", "workspace"],
      ["server", "other", "principal", "workspace"],
      ["server", "workspace", "other", "workspace"],
      ["server", "workspace", "principal", "editor"],
    ].map(([server, workspace, principal, surface]) =>
      conversationSelectionKey(server!, workspace!, principal!, surface!),
    );
    expect(new Set(keys).size).toBe(5);
  });
});
