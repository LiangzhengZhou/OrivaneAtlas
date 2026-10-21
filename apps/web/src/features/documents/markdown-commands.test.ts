import { history, undo } from "@codemirror/commands";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { expect, it, vi } from "vitest";
import {
  MarkdownCommandRegistry,
  runMarkdownCommand,
} from "./markdown-commands";

function editor(doc = "Hello", from = 0, to = doc.length) {
  let state = EditorState.create({
    doc,
    selection: { anchor: from, head: to },
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
it("shares discoverable bilingual commands without duplicate IDs", () => {
  expect(
    new Set(MarkdownCommandRegistry.map((command) => command.id)).size,
  ).toBe(18);
  expect(
    MarkdownCommandRegistry.every((command) => command.en && command.zh),
  ).toBe(true);
});
it("formats and toggles selected Markdown while retaining transaction undo", () => {
  const view = editor();
  expect(runMarkdownCommand(view, "bold")).toBe(true);
  expect(view.state.doc.toString()).toBe("**Hello**");
  runMarkdownCommand(view, "bold");
  expect(view.state.doc.toString()).toBe("Hello");
  expect(
    undo({
      state: view.state,
      dispatch: (transaction) => view.dispatch(transaction),
    }),
  ).toBe(true);
  expect(view.state.doc.toString()).toBe("**Hello**");
  expect(
    undo({
      state: view.state,
      dispatch: (transaction) => view.dispatch(transaction),
    }),
  ).toBe(true);
  expect(view.state.doc.toString()).toBe("Hello");
});
it("replaces slash trigger instead of formatting its command text", () => {
  const view = editor("/bold", 5, 5);
  runMarkdownCommand(view, "bold", { range: { from: 0, to: 5 } });
  expect(view.state.doc.toString()).toBe("****");
  expect(view.state.selection.main.from).toBe(2);
});
it("applies line commands across the selected lines and toggles prefixes", () => {
  const view = editor("First\nSecond");
  runMarkdownCommand(view, "task");
  expect(view.state.doc.toString()).toBe("- [ ] First\n- [ ] Second");
  runMarkdownCommand(view, "task");
  expect(view.state.doc.toString()).toBe("First\nSecond");
});
it("keeps selected link label while focusing the destination", () => {
  const view = editor();
  runMarkdownCommand(view, "link");
  expect(view.state.doc.toString()).toBe("[Hello](url)");
  expect(
    view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    ),
  ).toBe("url");
});
it("dispatches explicit contextual commands without embedding business state", () => {
  const view = editor("/atlas", 6, 6),
    askAtlas = vi.fn(),
    attachFile = vi.fn();
  runMarkdownCommand(view, "atlas", { range: { from: 0, to: 6 }, askAtlas });
  expect(view.state.doc.toString()).toBe("");
  expect(askAtlas).toHaveBeenCalledOnce();
  expect(attachFile).not.toHaveBeenCalled();
  runMarkdownCommand(view, "file", { attachFile });
  expect(attachFile).toHaveBeenCalledOnce();
  expect(runMarkdownCommand(view, "file")).toBe(false);
});
it("does not insert malformed ranges or exceed editor document budget", () => {
  const view = editor();
  expect(runMarkdownCommand(view, "bold", { range: { from: -1, to: 5 } })).toBe(
    false,
  );
  expect(view.state.doc.toString()).toBe("Hello");
  expect(runMarkdownCommand(editor("x".repeat(200000)), "bold")).toBe(false);
});
