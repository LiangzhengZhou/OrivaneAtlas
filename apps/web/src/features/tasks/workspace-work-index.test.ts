import { inheritedArchiveSource } from "@arclattice/domain";
import { expect, test } from "vitest";
import { work } from "../../../../../tests/fixtures";
import { buildWorkspaceWorkIndex } from "./workspace-work-index";

test("indexed archive preserves all-membership semantics and nearest ancestor", () => {
  const root = { ...work("root"), type: "PROJECT" as const };
  const child = {
    ...work("child"),
    type: "PROJECT" as const,
    parentProjectId: root.id,
  };
  const other = { ...work("other"), type: "PROJECT" as const };
  const shared = { ...work("shared"), projectIds: [child.id, other.id] };
  const items = [root, child, other, shared];
  for (const archived of [
    [root.id],
    [root.id, other.id],
    [child.id, root.id, other.id],
    [shared.id],
  ]) {
    const index = buildWorkspaceWorkIndex(
      items,
      archived.map((id) => ({ kind: "WORK", id, archived: true })),
    );
    for (const item of items) {
      const expected = inheritedArchiveSource(item, items, (entry) =>
        archived.includes(entry.id),
      );
      expect(index.archiveSource(item)?.id).toBe(expected?.id);
      expect(index.isArchived(item)).toBe(
        archived.includes(item.id) || !!expected,
      );
    }
    expect(index.projectPathById.get(child.id)).toBe("root / child");
    expect(index.tasksByProjectId.get(child.id)).toEqual([shared.id]);
  }
});

test("broken foreign parents and cycles terminate without inheriting foreign archive", () => {
  const project = {
    ...work("project"),
    type: "PROJECT" as const,
    parentProjectId: "foreign",
  };
  const foreign = {
    ...work("foreign"),
    type: "PROJECT" as const,
    workspaceId: "elsewhere",
  };
  const index = buildWorkspaceWorkIndex(
    [project, foreign],
    [{ kind: "WORK", id: foreign.id, archived: true }],
  );
  expect(index.isArchived(project)).toBe(false);
  const cycle = buildWorkspaceWorkIndex(
    [{ ...project, parentProjectId: "project" }],
    [],
  );
  expect(cycle.ancestorIdsByProjectId.get(project.id)).toEqual([]);
});
