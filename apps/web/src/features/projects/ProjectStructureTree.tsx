import type { WorkItem } from "@arclattice/domain";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectTreeIndex } from "./project-tree";
export function ProjectStructureTree({
  projects,
  parentId,
  onOpen,
  initialDepth = 1,
  showDepthControls = true,
}: {
  projects: readonly WorkItem[];
  parentId: string | null;
  onOpen(id: string): void;
  initialDepth?: number;
  showDepthControls?: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const children = useMemo(
    () =>
      projectTreeIndex(
        projects.filter((p) => p.type === "PROJECT" && !p.deletedAt),
      ),
    [projects],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState(initialDepth);
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
            open = expanded.has(project.id) || level < depth;
          return (
            <li key={project.id}>
              {descendants.length > 0 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    (zh ? "展开子项目：" : "Expand children: ") + project.title
                  }
                  aria-expanded={open}
                  onClick={() => {
                    setDepth(1);
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(project.id)) next.delete(project.id);
                      else next.add(project.id);
                      return next;
                    });
                  }}
                >
                  {open ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </button>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => onOpen(project.id)}
              >
                {project.title}
              </button>
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
            <button
              type="button"
              className="chip"
              key={value}
              aria-pressed={depth === value}
              onClick={() => {
                setDepth(value);
                setExpanded(new Set());
              }}
            >
              {zh ? value + " 层" : value + " level" + (value > 1 ? "s" : "")}
            </button>
          ))}
        </div>
      )}
      {render(parentId, 1, new Set(parentId ? [parentId] : []))}
    </section>
  );
}
