import { createHash } from "node:crypto";
import { EditorProposalService } from "@arclattice/application";
import { history, undo } from "@codemirror/commands";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { expect, it } from "vitest";
import {
  applyEditorProposal,
  captureEditorSource,
} from "./editor-proposal-bridge";

const actor = { workspaceId: "workspace", principalId: "human" };
const identity = {
  workspaceId: "workspace",
  documentId: "document",
  version: 2,
};
const service = new EditorProposalService(async (text) =>
  createHash("sha256").update(text).digest("hex"),
);
function editor() {
  let state = EditorState.create({
    doc: "First\nHello\nLast",
    selection: { anchor: 6, head: 11 },
    extensions: [history()],
  });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
    focus() {},
  };
}
it("captures selection or cursor paragraph without any model call", () => {
  const view = editor();
  expect(captureEditorSource(view, identity).source.sourceText).toBe("Hello");
  view.dispatch({ selection: { anchor: 8 } });
  expect(captureEditorSource(view, identity).source.sourceText).toBe(
    "First\nHello\nLast",
  );
});
it("applies an explicit reviewed change through CodeMirror and preserves undo", async () => {
  const view = editor(),
    captured = captureEditorSource(view, identity);
  const proposal = await service.propose(
    actor,
    captured.source,
    "proposal",
    "你好",
  );
  view.dispatch({ selection: { anchor: 1 } });
  await applyEditorProposal(
    view,
    actor,
    service,
    { ...captured, proposal },
    identity,
  );
  expect(view.state.doc.toString()).toBe("First\n你好\nLast");
  expect(
    undo({
      state: view.state,
      dispatch: (transaction) => view.dispatch(transaction),
    }),
  ).toBe(true);
  expect(view.state.doc.toString()).toBe("First\nHello\nLast");
});
it("refuses edits even outside the selected source after capture", async () => {
  const view = editor(),
    captured = captureEditorSource(view, identity);
  const proposal = await service.propose(
    actor,
    captured.source,
    "proposal",
    "new",
  );
  view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
  await expect(
    applyEditorProposal(
      view,
      actor,
      service,
      { ...captured, proposal },
      identity,
    ),
  ).rejects.toThrow("VERSION_CONFLICT");
  expect(view.state.doc.toString()).toBe("First\nHello\nLast!");
});
