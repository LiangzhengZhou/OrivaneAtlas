import { EditorState } from "@codemirror/state";
import { expect, it } from "vitest";
import { externalValue, imageAnchor, pendingImage } from "./imageInsertion";

it("maps an image anchor through typing and deletion without following later selections", () => {
  let state = EditorState.create({
    doc: "hello world",
    extensions: [pendingImage],
  });
  state = state.update({ effects: imageAnchor.of(5) }).state;
  state = state.update({
    changes: { from: 0, insert: "new " },
    selection: { anchor: 15 },
  }).state;
  expect(state.field(pendingImage)).toBe(9);
  state = state.update({ changes: { from: 0, to: 4 } }).state;
  expect(state.field(pendingImage)).toBe(5);
  state = state.update({ selection: { anchor: 0 } }).state;
  expect(state.field(pendingImage)).toBe(5);
});
it("invalidates pending insertion on document replacement and clears after upload", () => {
  let state = EditorState.create({ doc: "draft", extensions: [pendingImage] });
  state = state.update({ effects: imageAnchor.of(3) }).state;
  state = state.update({
    changes: { from: 0, to: 5, insert: "revision" },
    annotations: externalValue.of(true),
  }).state;
  expect(state.field(pendingImage)).toBeNull();
  state = state.update({ effects: imageAnchor.of(2) }).state;
  state = state.update({ effects: imageAnchor.of(null) }).state;
  expect(state.field(pendingImage)).toBeNull();
});
