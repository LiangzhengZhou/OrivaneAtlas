import type { WorkItem } from "@arclattice/domain";
import type { HierarchyEntry } from "../hierarchy/hierarchy";
export function projectHierarchyEntries(
  projects: readonly WorkItem[],
): HierarchyEntry[] {
  const live = projects.filter(
    (project) => project.type === "PROJECT" && !project.deletedAt,
  );
  const ids = new Set(live.map((project) => project.id));
  return live.map((project) => ({
    id: project.id,
    title: project.title,
    parentId:
      project.parentProjectId && ids.has(project.parentProjectId)
        ? project.parentProjectId
        : null,
  }));
}
