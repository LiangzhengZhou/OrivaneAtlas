import { parseWikiLinks } from "@arclattice/wiki-core";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { largeMarkdownLanguage } from "./large-markdown-language";

test("large editing syntax preserves full Markdown and Wiki references after an incremental edit", () => {
  const source =
    "# Heading\n[[Original]]\n" +
    "A **useful** Markdown paragraph.\n".repeat(3500);
  const state = EditorState.create({
    doc: source,
    extensions: [largeMarkdownLanguage],
  });
  const changed = state.update({
    changes: { from: source.length, insert: "\n[[Second]]" },
  }).state;
  expect(state.doc.toString()).toBe(source);
  expect(changed.doc.toString()).toBe(source + "\n[[Second]]");
  expect(
    parseWikiLinks(changed.doc.toString()).map((link) => link.targetText),
  ).toEqual(["Original", "Second"]);
});

test("large syntax keeps mismatched and short closing fences inside code", () => {
  const source =
    "````md\n**inside**\n~~~\n```\n**still inside**\n````\n**outside**";
  const tree = largeMarkdownLanguage.parser.parse(source);
  const tokens: { name: string; text: string }[] = [];
  tree.iterate({
    enter(node) {
      if (node.type.isTop) return;
      tokens.push({ name: node.name, text: source.slice(node.from, node.to) });
    },
  });
  expect(
    tokens.some(
      (token) =>
        token.name === "monospace" && token.text.includes("**still inside**"),
    ),
  ).toBe(true);
  expect(
    tokens.some(
      (token) => token.name === "strong" && token.text === "**outside**",
    ),
  ).toBe(true);
});
