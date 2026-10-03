import { expect, test } from "vitest";
import { work } from "../../../../../tests/fixtures";
import { projectProgressIndex, projectTreeIndex } from "./project-tree";

test("tree indexes immediate children, orphans and bounded legacy cycles", () => {
  const root = { ...work("root"), type: "PROJECT" as const };
  const child = { ...root, id: "child", parentProjectId: root.id };
  const grandchild = { ...root, id: "grandchild", parentProjectId: child.id };
  const orphan = { ...root, id: "orphan", parentProjectId: "missing" };
  const index = projectTreeIndex([root, child, grandchild, orphan]);
  expect(index.get(null)?.map((p) => p.id)).toEqual(["root", "orphan"]);
  expect(index.get(root.id)).toEqual([child]);
  expect(index.get(child.id)).toEqual([grandchild]);
  expect(
    projectTreeIndex([{ ...root, parentProjectId: child.id }, child]).get(null),
  ).toHaveLength(2);
});

test("progress deduplicates multi-membership ancestors and excludes deleted/cross-workspace tasks", () => {
  const root = { ...work("root"), type: "PROJECT" as const };
  const child = { ...root, id: "child", parentProjectId: root.id };
  const done = {
    ...work("done"),
    status: "DONE" as const,
    projectIds: [root.id, child.id],
  };
  const pending = { ...work("pending"), projectIds: [child.id] };
  const removed = { ...pending, id: "removed", deletedAt: "2026-10-03" };
  const alien = { ...pending, id: "alien", workspaceId: "other" };
  const result = projectProgressIndex([
    root,
    child,
    done,
    pending,
    removed,
    alien,
  ]);
  expect(result.get(root.id)).toEqual({
    completed: 1,
    unfinished: 1,
    canceled: 0,
  });
  expect(result.get(child.id)).toEqual(result.get(root.id));
});
