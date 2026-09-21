import type { ProjectScope } from "@arclattice/domain";
export const projectTabs = [
  "brief",
  "documents",
  "children",
  "tasks",
  "graph",
  "timeline",
  "activity",
] as const;
export type ProjectTab = (typeof projectTabs)[number];
export interface ProjectRoute {
  projectId: string | null;
  tab: ProjectTab;
  scope: ProjectScope;
}
export function parseProjectRoute(hash: string): ProjectRoute {
  const fallback: ProjectRoute = {
    projectId: null,
    tab: "brief",
    scope: "SUBTREE",
  };
  const match = /^#projects(?:\/([^?]+))?(?:\?(.*))?$/.exec(hash);
  if (!match?.[1]) return fallback;
  try {
    const id = decodeURIComponent(match[1]);
    if (!id || id.length > 240) return fallback;
    const query = new URLSearchParams(match[2]);
    const tab = query.get("tab");
    return {
      projectId: id,
      tab: projectTabs.includes(tab as ProjectTab)
        ? (tab as ProjectTab)
        : "brief",
      scope: query.get("scope") === "DIRECT" ? "DIRECT" : "SUBTREE",
    };
  } catch {
    return fallback;
  }
}
export function projectHash(route: ProjectRoute): string {
  if (!route.projectId) return "#projects";
  return (
    "#projects/" +
    encodeURIComponent(route.projectId) +
    "?" +
    new URLSearchParams({ tab: route.tab, scope: route.scope })
  );
}
