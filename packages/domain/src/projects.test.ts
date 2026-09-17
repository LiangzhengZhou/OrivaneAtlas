import { describe, expect, it } from "vitest";
import { work } from "../../../tests/fixtures";
import {
  inheritedArchiveSource,
  projectAncestors,
  projectDescendants,
  type WorkItem,
} from "./index";

const root: WorkItem = { ...work("root"), type: "PROJECT" };
const child: WorkItem = {
  ...work("child"),
  type: "PROJECT",
  projectId: root.id,
};
const task: WorkItem = { ...work("task"), projectId: child.id };
describe("project projections", () => {
  it("shared tasks stay visible through any active project and count only once per subtree", () => {
    const shared = { ...task, projectIds: [root.id, child.id] };
    const items = [root, child, shared];
    expect(
      projectDescendants(root, items).filter((i) => i.id === task.id),
    ).toHaveLength(1);
    expect(
      inheritedArchiveSource(shared, items, (i) => i.id === child.id),
    ).toBeUndefined();
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
