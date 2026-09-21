import { describe, expect, it } from "vitest";
import { work } from "../../../tests/fixtures";
import {
  inheritedArchiveSource,
  projectAncestors,
  projectDescendants,
  type WorkItem,
} from "./index";
import {
  eligibleProjectParents,
  MAX_PROJECT_DEPTH,
  projectScope,
  projectSubtreeHeight,
  taskOwnership,
} from "./projects";

const root: WorkItem = { ...work("root"), type: "PROJECT" };
const child: WorkItem = {
  ...work("child"),
  type: "PROJECT",
  projectId: root.id,
};
const task: WorkItem = { ...work("task"), projectId: child.id };
describe("project projections", () => {
  it("archive inheritance follows the owner despite active references", () => {
    const shared = { ...task, projectIds: [root.id, child.id] };
    const items = [root, child, shared];
    expect(
      projectDescendants(root, items).filter((i) => i.id === task.id),
    ).toHaveLength(1);
    expect(
      inheritedArchiveSource(shared, items, (i) => i.id === child.id)?.id,
    ).toBe(child.id);
    expect(
      inheritedArchiveSource(shared, items, (i) => i.id === root.id)?.id,
    ).toBe(root.id);
  });
  it("recursively includes descendants once, not unrelated or deleted work", () => {
    const deleted = {
      ...work("deleted"),
      projectId: root.id,
      deletedAt: root.createdAt,
    };
    const foreign = { ...work("foreign", "other"), projectId: root.id };
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
      expect(projectAncestors(task, [root, parent, task])).toEqual([]);
    }
    expect(projectAncestors(task, [root, task])).toEqual([]);
  });
  it("terminates legacy cycles without counting the root as its own descendant", () => {
    const cyclic = { ...root, projectId: child.id };
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
        projectId: items[items.length - 1]!.id,
      });
    expect(projectDescendants(root, items)).toHaveLength(5000);
    expect(projectAncestors(items[5000]!, items)).toHaveLength(5000);
  });
});

describe("project parent candidates", () => {
  it("excludes self, descendants, foreign, deleted and cyclic destinations", () => {
    const sibling = { ...root, id: "sibling" };
    const cycle = { ...root, id: "cycle", projectId: "cycle" };
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
        projectId: chain.at(-1)!.id,
      });
    const options = eligibleProjectParents(root, [root, child, ...chain]);
    expect(options.some((p) => p.id === "level-14")).toBe(true);
    expect(options.some((p) => p.id === "level-15")).toBe(false);
    expect(
      eligibleProjectParents(null, chain).some((p) => p.id === "level-16"),
    ).toBe(false);
  });
});

it("separates direct, subtree, references and terminal outcome counts", () => {
  const linked = { ...work("linked"), projectId: null, projectIds: [root.id] };
  const done = { ...work("done"), projectId: root.id, status: "DONE" as const };
  const canceled = {
    ...work("canceled"),
    projectId: child.id,
    status: "CANCELED" as const,
  };
  const items = [root, child, task, linked, done, canceled];
  const direct = projectScope(root, items, "DIRECT");
  expect(direct.tasks.map((i) => i.id)).toEqual(["done"]);
  expect(direct.linkedTasks.map((i) => i.id)).toEqual(["linked"]);
  const subtree = projectScope(root, items, "SUBTREE");
  expect([subtree.completed, subtree.canceled, subtree.unfinished]).toEqual([
    1, 1, 1,
  ]);
  expect(taskOwnership(linked)).toEqual({
    ownerProjectId: null,
    linkedProjectIds: [root.id],
  });
  expect(projectDescendants(root, items).some((i) => i.id === "linked")).toBe(
    false,
  );
});
