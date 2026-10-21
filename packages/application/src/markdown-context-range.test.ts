import { expect, test } from "vitest";
import { markdownContextRange } from "./markdown-context-range";

test("bounded canonical selection is independent of whole-document size", () => {
  const body = `${"x".repeat(100000)}\nSelected 🌍 paragraph\nTail`;
  const from = 100001,
    to = body.indexOf("\nTail");
  expect(markdownContextRange(body, { from, to })).toBe(
    "Selected 🌍 paragraph",
  );
});

test("invalid, fractional, empty and oversized coordinates fail closed", () => {
  for (const range of [
    { from: -1, to: 2 },
    { from: 0.5, to: 2 },
    { from: 2, to: 2 },
    { from: 3, to: 2 },
    { from: 0, to: 12001 },
    { from: 0, to: Infinity },
    { from: 19999, to: 20001 },
  ])
    expect(() => markdownContextRange("x".repeat(20000), range)).toThrow(
      "CONTEXT_CHANGED",
    );
});
