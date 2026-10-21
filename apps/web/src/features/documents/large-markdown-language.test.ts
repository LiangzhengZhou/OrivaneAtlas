import { parseWikiLinks } from "@arclattice/wiki-core";
import { language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { largeMarkdownLanguage } from "./large-markdown-language";

test("incremental syntax owns highlighting without rich preview AST nodes", () => {
  const source =
    "# Heading\n**Strong** and *emphasis* with [[Wiki]] and `code`.\n";
  const state = EditorState.create({
    doc: source,
    extensions: [largeMarkdownLanguage],
  });
  expect(state.facet(language)).toBe(largeMarkdownLanguage);
  const names = new Set<string>();
  largeMarkdownLanguage.parser.parse(source).iterate({
    enter(node) {
      names.add(node.name);
    },
  });
  expect(names.has("heading")).toBe(true);
  expect(names.has("strong")).toBe(true);
  expect(names.has("link")).toBe(true);
  expect(
    [...names].some((name) =>
      /^(ATXHeading[1-6]|StrongEmphasis|Emphasis|InlineCode|Link|HeaderMark|EmphasisMark|CodeMark)$/.test(
        name,
      ),
    ),
  ).toBe(false);
});

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

test("long CJK plain-text runs retain adjacent syntax and complete Wiki edits", () => {
  const source =
    "# 标题\n**开头** " +
    "Plain 文字 😀 ".repeat(6000) +
    "\n[[末尾]]\n`内联`\n";
  const state = EditorState.create({
    doc: source,
    extensions: [largeMarkdownLanguage],
  });
  const insertion = source.indexOf("末尾");
  const changed = state.update({
    changes: { from: insertion, insert: "新增" },
  }).state;
  const expected =
    source.slice(0, insertion) + "新增" + source.slice(insertion);
  expect(changed.doc.toString()).toBe(expected);
  expect(state.doc.toString()).toBe(source);
  expect(parseWikiLinks(expected).map((link) => link.targetText)).toEqual([
    "新增末尾",
  ]);
  const tokens: { name: string; text: string }[] = [];
  largeMarkdownLanguage.parser.parse(expected).iterate({
    enter(node) {
      if (!node.type.isTop)
        tokens.push({
          name: node.name,
          text: expected.slice(node.from, node.to),
        });
    },
  });
  expect(tokens).toEqual(
    expect.arrayContaining([
      { name: "heading", text: "# 标题" },
      { name: "strong", text: "**开头**" },
      { name: "link", text: "[[新增末尾]]" },
      { name: "monospace", text: "`内联`" },
    ]),
  );
});
