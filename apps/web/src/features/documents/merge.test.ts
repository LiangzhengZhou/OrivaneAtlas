import { expect, it } from "vitest";
import { mergeMarkdown } from "./merge";

it("merges independent edits and exposes overlapping edits", () => {
  expect(mergeMarkdown("a\nb", "A\nb", "a\nB")).toEqual({
    text: "A\nB",
    conflicts: 0,
  });
  expect(mergeMarkdown("a", "A", "B").conflicts).toBe(1);
  expect(mergeMarkdown("a", "a", "b")).toEqual({ text: "b", conflicts: 0 });
});
