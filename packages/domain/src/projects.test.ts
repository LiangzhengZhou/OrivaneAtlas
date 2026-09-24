import { describe, expect, it } from "vitest";
import { work } from "../../../tests/fixtures";
import {
  inheritedArchiveSource,
  projectAncestors,
  projectDescendants,
  type WorkItem,
} from "./index";
import {
  effectiveCategoryId,
  eligibleProjectParents,
  MAX_PROJECT_DEPTH,
  projectScope,
  projectSubtreeHeight,
} from "./projects";

const root: WorkItem = { ...work("root"), type: "PROJECT" };
const child: WorkItem = {
  ...work("child"),
  type: "PROJECT",
  parentProjectId: root.id,
};
const task: WorkItem = { ...work("task"), projectIds: [child.id] };
describe("project projections", () => {
  it("shared tasks stay visible while any membership is unarchived", () => {
    const shared = { ...task, projectIds: [root.id, child.id] };
    const items = [root, child, shared];
    expect(
      projectDescendants(root, items).filter((i) => i.id === task.id),
    ).toHaveLength(1);
    expect(
      inheritedArchiveSource(shared, items, (i) => i.id === child.id)?.id,
    ).toBeUndefined();
    expect(
      inheritedArchiveSource(shared, items, (i) => i.id === root.id)?.id,
    ).toBe(root.id);
  });
  it("recursively includes descendants once, not unrelated or deleted work", () => {
    const deleted = {
      ...work("deleted"),
      parentProjectId: root.id,
      deletedAt: root.createdAt,
    };
    const foreign = { ...work("foreign", "other"), parentProjectId: root.id };
    expect(
      projectDescendants(root, [
        root,
        child,
        task,
        task,
        deleted,
        foreign,
        work("free"),
      ]).map((i) => i.id),
    ).toEqual(["child", "task"]);
    expect(projectDescendants(task, [root, child, task])).toEqual([]);
  });
  it("inherits archive without mutating work and preserves independently archived descendants", () => {
    const items = [root, child, task];
    const before = structuredClone(items);
    const archived = new Set([root.id, child.id]);
    const explicit = (item: WorkItem) => archived.has(item.id);
    expect(inheritedArchiveSource(task, items, explicit)?.id).toBe(child.id);
    archived.delete(child.id);
    expect(inheritedArchiveSource(task, items, explicit)?.id).toBe(root.id);
    archived.add(child.id);
    archived.delete(root.id);
    expect(inheritedArchiveSource(task, items, explicit)?.id).toBe(child.id);
    archived.clear();
    expect(inheritedArchiveSource(task, items, explicit)).toBeUndefined();
    expect(items).toEqual(before);
  });
  it("stops at missing, foreign, deleted or non-project ancestors", () => {
    for (const parent of [
      { ...child, deletedAt: root.createdAt },
      { ...child, workspaceId: "other" },
      { ...child, type: "TASK" as const },
    ]) {
      expect(projectAncestors(child, [parent, task])).toEqual([]);
    }
    expect(projectAncestors(task, [root, task])).toEqual([]);
  });
  it("terminates legacy cycles without counting the root as its own descendant", () => {
    const cyclic = { ...root, parentProjectId: child.id };
    expect(projectAncestors(cyclic, [cyclic, child])).toEqual([child]);
    expect(projectDescendants(cyclic, [cyclic, child, task])).toEqual([
      child,
      task,
    ]);
  });
  it("handles deep trees without recursive call stack growth", () => {
    const items = [root];
    for (let n = 0; n < 5000; n++)
      items.push({
        ...root,
        id: String(n),
        parentProjectId: items[items.length - 1]!.id,
      });
    expect(projectDescendants(root, items)).toHaveLength(5000);
    expect(projectAncestors(items[5000]!, items)).toHaveLength(5000);
  });
});

describe("project parent candidates", () => {
  it("excludes self, descendants, foreign, deleted and cyclic destinations", () => {
    const sibling = { ...root, id: "sibling" };
    const cycle = { ...root, id: "cycle", parentProjectId: "cycle" };
    const items = [
      root,
      child,
      task,
      sibling,
      cycle,
      { ...root, id: "foreign", workspaceId: "elsewhere" },
      { ...root, id: "deleted", deletedAt: "now" },
    ];
    expect(eligibleProjectParents(root, items).map((p) => p.id)).toEqual([
      "sibling",
    ]);
    expect(projectSubtreeHeight(root, items)).toBe(2);
  });
  it("reserves room for every descendant when moving a subtree", () => {
    const chain: WorkItem[] = [{ ...root, id: "level-1" }];
    for (let depth = 2; depth <= MAX_PROJECT_DEPTH; depth++)
      chain.push({
        ...root,
        id: "level-" + depth,
        parentProjectId: chain.at(-1)!.id,
      });
    const options = eligibleProjectParents(root, [root, child, ...chain]);
    expect(options.some((p) => p.id === "level-14")).toBe(true);
    expect(options.some((p) => p.id === "level-15")).toBe(false);
    expect(
      eligibleProjectParents(null, chain).some((p) => p.id === "level-16"),
    ).toBe(false);
  });
});

it("counts equal memberships once in direct and subtree scopes", () => {
  const shared = { ...work("shared"), projectIds: [root.id, child.id] };
  const done = {
    ...work("done"),
    projectIds: [root.id],
    status: "DONE" as const,
  };
  const items = [root, child, task, shared, done];
  expect(
    projectScope(root, items, "DIRECT").tasks.map((entry) => entry.id),
  ).toEqual(["shared", "done"]);
  expect(
    projectScope(child, items, "DIRECT").tasks.map((entry) => entry.id),
  ).toEqual(["task", "shared"]);
  const subtree = projectScope(root, items, "SUBTREE");
  expect([subtree.completed, subtree.unfinished]).toEqual([1, 2]);
  expect(
    projectDescendants(root, items).filter((entry) => entry.id === shared.id),
  ).toHaveLength(1);
});

it("membership order never changes progress, visibility or independent removal", () => {
  const other = { ...root, id: "other" };
  for (const projectIds of [
    [root.id, other.id],
    [other.id, root.id],
  ]) {
    const shared = { ...work("shared"), projectIds, status: "DONE" as const };
    const items = [root, other, shared];
    expect(projectScope(root, items, "DIRECT").completed).toBe(1);
    expect(projectScope(other, items, "DIRECT").completed).toBe(1);
    expect(
      inheritedArchiveSource(shared, items, (item) => item.id === other.id),
    ).toBeUndefined();
    const removed = { ...shared, projectIds: [other.id] };
    expect(projectScope(root, [root, other, removed], "DIRECT").tasks).toEqual(
      [],
    );
    expect(
      projectScope(other, [root, other, removed], "DIRECT").completed,
    ).toBe(1);
  }
});

it("inherits the nearest category through parentProjectId and preserves child archive", () => {
  const categorizedRoot = { ...root, categoryId: "research" };
  const grandchild = { ...child, id: "grandchild", parentProjectId: child.id };
  const items = [categorizedRoot, child, grandchild];
  expect(effectiveCategoryId(grandchild, items)).toBe("research");
  expect(
    effectiveCategoryId(grandchild, [
      categorizedRoot,
      { ...child, categoryId: "study" },
      grandchild,
    ]),
  ).toBe("study");
  const archived = new Set([root.id, child.id]);
  const explicit = (item: WorkItem) => archived.has(item.id);
  expect(inheritedArchiveSource(grandchild, items, explicit)?.id).toBe(
    child.id,
  );
  archived.delete(root.id);
  expect(explicit(child)).toBe(true);
  expect(inheritedArchiveSource(grandchild, items, explicit)?.id).toBe(
    child.id,
  );
});
