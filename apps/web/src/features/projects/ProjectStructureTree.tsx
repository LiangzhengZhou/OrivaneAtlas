import type { WorkItem } from "@arclattice/domain";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "../../app/EntitySelection";
import { Button } from "../../components/ui/Button";
import { projectTreeIndex } from "./project-tree";
export function ProjectStructureTree({
  projects,
  parentId,
  onOpen,
  initialDepth = 1,
  showDepthControls = true,
  expandedIds,
  onExpandedChange,
  onSelect,
}: {
  projects: readonly WorkItem[];
  parentId: string | null;
  onOpen(id: string): void;
  initialDepth?: number;
  showDepthControls?: boolean;
  expandedIds?: ReadonlySet<string>;
  onExpandedChange?(ids: Set<string>): void;
  onSelect?(id: string): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const selection = useEntitySelection();
  const children = useMemo(
    () =>
      projectTreeIndex(
        projects.filter((p) => p.type === "PROJECT" && !p.deletedAt),
      ),
    [projects],
  );
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(
    () =>
      new Set(
        initialDepth > 1
          ? (children.get(parentId) ?? []).map((project) => project.id)
          : [],
      ),
  );
  const expanded = expandedIds ?? localExpanded;
  const setExpanded = onExpandedChange ?? setLocalExpanded;
  const render = (
    parent: string | null,
    level: number,
    visited: Set<string>,
  ) => (
    <ul>
      {(children.get(parent) ?? [])
        .filter((p) => !visited.has(p.id))
        .map((project) => {
          const descendants = children.get(project.id) ?? [],
            open = expanded.has(project.id);
          return (
            <li key={project.id}>
              {descendants.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  className="ui-icon-button"
                  aria-label={
                    (zh ? "展开子项目：" : "Expand children: ") + project.title
                  }
                  aria-expanded={open}
                  onClick={() => {
                    const next = new Set(expanded);
                    if (next.has(project.id)) next.delete(project.id);
                    else next.add(project.id);
                    setExpanded(next);
                  }}
                >
                  {open ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                type="button"
                aria-pressed={
                  selection?.selected?.kind === "WORK" &&
                  selection.selected.id === project.id
                }
                onClick={() =>
                  onSelect
                    ? onSelect(project.id)
                    : selection?.select({ kind: "WORK", id: project.id })
                }
                onDoubleClick={() => onOpen(project.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onOpen(project.id);
                  }
                }}
              >
                {project.title}
              </Button>
              {open &&
                descendants.length > 0 &&
                render(
                  project.id,
                  level + 1,
                  new Set([...visited, project.id]),
                )}
            </li>
          );
        })}
    </ul>
  );
  return (
    <section className="project-structure-tree">
      {showDepthControls && (
        <div className="action-row">
          {[1, 2].map((value) => (
            <Button
              type="button"
              variant="toggle"
              key={value}
              aria-pressed={
                value === 1
                  ? expanded.size === 0
                  : (children.get(parentId) ?? []).every((project) =>
                      expanded.has(project.id),
                    ) && expanded.size > 0
              }
              disabled={
                value === 2 &&
                !(children.get(parentId) ?? []).some(
                  (project) => (children.get(project.id)?.length ?? 0) > 0,
                )
              }
              onClick={() => {
                setExpanded(
                  new Set(
                    value === 2
                      ? (children.get(parentId) ?? []).map(
                          (project) => project.id,
                        )
                      : [],
                  ),
                );
              }}
            >
              {value === 1
                ? zh
                  ? "直属子项目"
                  : "Direct subprojects"
                : zh
                  ? "展开两层"
                  : "Expand two levels"}
            </Button>
          ))}
        </div>
      )}
      {render(parentId, 1, new Set(parentId ? [parentId] : []))}
    </section>
  );
}
