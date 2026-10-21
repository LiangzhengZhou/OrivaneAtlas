import { expect, it } from "vitest";
import { mergeMarkdown } from "./markdown-merge";

it("preserves independent line substitutions and insertion/deletion alignment", () => {
  expect(mergeMarkdown("a\nb\nc", "intro\na\nb\nc", "a\nb\nC")).toEqual({
    text: "intro\na\nb\nC",
    conflicts: 0,
  });
  expect(mergeMarkdown("a\nb\nc", "a\nc", "a\nb\nC")).toEqual({
    text: "a\nC",
    conflicts: 0,
  });
  expect(mergeMarkdown("a\nb", "A\nb", "a\nB")).toEqual({
    text: "A\nB",
    conflicts: 0,
  });
});

it("retains both complete texts when same-position inserts or edits overlap", () => {
  for (const [base, local, remote] of [
    ["a\nb", "x\na\nb", "y\na\nb"],
    ["a\nb\nc", "A\nb\nC", "a\nB\nc"],
  ]) {
    const result = mergeMarkdown(base!, local!, remote!);
    expect(result.conflicts).toBe(1);
    expect(result.text).toContain(local!);
    expect(result.text).toContain(remote!);
  }
});

it("preserves exact Chinese Markdown, trailing newline and large unchanged sections", () => {
  const base = "第一行\n" + "unchanged\n".repeat(10000) + "最后一行\n";
  expect(
    mergeMarkdown(base, "开始\n" + base, base.replace("最后一行", "结束")),
  ).toEqual({
    text: "开始\n" + base.replace("最后一行", "结束"),
    conflicts: 0,
  });
});
