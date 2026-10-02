import { expect, it } from "vitest";
import { work } from "../../../../../tests/fixtures";
import {
  currentLevel,
  excludedBranch,
  hierarchyPath,
} from "../hierarchy/hierarchy";
import { projectHierarchyEntries } from "./project-hierarchy";

it("ProjectDrilldownPicker projects only live hierarchy and never searches grandchildren", () => {
  const items = [
    { ...work("root"), type: "PROJECT" as const },
    { ...work("child"), type: "PROJECT" as const, parentProjectId: "root" },
    {
      ...work("grandchild"),
      type: "PROJECT" as const,
      parentProjectId: "child",
    },
    work("task"),
    { ...work("deleted"), type: "PROJECT" as const, deletedAt: "2026-10-02" },
  ];
  const entries = projectHierarchyEntries(items);
  expect(currentLevel(entries, null).map((entry) => entry.id)).toEqual([
    "root",
  ]);
  expect(currentLevel(entries, "root", "grandchild")).toEqual([]);
  expect(
    currentLevel(entries, "child", "grandchild").map((entry) => entry.id),
  ).toEqual(["grandchild"]);
  expect(hierarchyPath(entries, "grandchild").map((entry) => entry.id)).toEqual(
    ["root", "child", "grandchild"],
  );
  expect([...excludedBranch(entries, "root")]).toEqual([
    "root",
    "child",
    "grandchild",
  ]);
});
it("keeps live children reachable after a parent is deleted", () => {
  const entries = projectHierarchyEntries([
    { ...work("orphan"), type: "PROJECT" as const, parentProjectId: "deleted" },
  ]);
  expect(currentLevel(entries, null).map((entry) => entry.id)).toEqual([
    "orphan",
  ]);
});
