import { describe, expect, it } from "vitest";
import { currentLevel, excludedBranch, hierarchyPath } from "./hierarchy";

const entries = [
  { id: "study", title: "学习", parentId: null },
  { id: "research", title: "Research", parentId: null },
  { id: "english", title: "英语学习", parentId: "study" },
  { id: "economics", title: "经济学", parentId: "study" },
  { id: "micro", title: "微观经济学", parentId: "economics" },
  { id: "macro", title: "宏观经济学", parentId: "economics" },
];
describe("shared drill-down hierarchy", () => {
  it("shows only direct children and searches only the current level", () => {
    expect(currentLevel(entries, null).map((entry) => entry.id)).toEqual([
      "study",
      "research",
    ]);
    expect(currentLevel(entries, "study").map((entry) => entry.id)).toEqual([
      "english",
      "economics",
    ]);
    expect(currentLevel(entries, "study", "宏观")).toEqual([]);
    expect(
      currentLevel(entries, "economics", "宏观").map((entry) => entry.id),
    ).toEqual(["macro"]);
  });
  it("builds breadcrumb paths and excludes the whole descendant branch", () => {
    expect(hierarchyPath(entries, "macro").map((entry) => entry.id)).toEqual([
      "study",
      "economics",
      "macro",
    ]);
    expect([...excludedBranch(entries, "economics")]).toEqual([
      "economics",
      "micro",
      "macro",
    ]);
  });
  it("terminates safely on malformed cycles", () => {
    const cycle = [
      { id: "a", title: "A", parentId: "b" },
      { id: "b", title: "B", parentId: "a" },
    ];
    expect(hierarchyPath(cycle, "a")).toHaveLength(2);
    expect(excludedBranch(cycle, "a").size).toBe(2);
  });
});
