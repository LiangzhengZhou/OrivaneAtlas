import { projectAncestors, type WorkItem } from "@arclattice/domain";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export function ProjectParentTree({
  projects,
  candidates,
  value,
  disabled,
  onChange,
}: {
  projects: readonly WorkItem[];
  candidates: readonly WorkItem[];
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const { t } = useTranslation("desk");
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(projects.map((project) => project.id)),
  );
  const [recent, setRecent] = useState<string[]>([]);
  const allowed = new Set(candidates.map((project) => project.id));
  const path = (project: WorkItem) =>
    [...projectAncestors(project, projects).reverse(), project]
      .map((entry) => entry.title)
      .join(" / ");
  const visible = new Set<string>();
  for (const project of projects) {
    if (
      !query ||
      path(project).toLocaleLowerCase().includes(query.toLocaleLowerCase())
    ) {
      visible.add(project.id);
      for (const ancestor of projectAncestors(project, projects))
        visible.add(ancestor.id);
    }
  }
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const select = (id: string) => {
    onChange(id);
    setRecent((old) =>
      [id, ...old.filter((entry) => entry !== id)].slice(0, 5),
    );
  };
  const branch = (
    parent: string | null,
    visited: Set<string>,
  ): React.ReactNode => {
    const nodes = projects.filter(
      (project) =>
        visible.has(project.id) &&
        !visited.has(project.id) &&
        (parent === null
          ? !projects.some((entry) => entry.id === project.parentProjectId)
          : project.parentProjectId === parent),
    );
    return nodes.map((project) => {
      const children = projects.some(
        (entry) =>
          entry.parentProjectId === project.id && visible.has(entry.id),
      );
      const open = !!query || !collapsed.has(project.id);
      return (
        <li role="none" key={project.id}>
          <div className="parent-tree-row">
            {children && (
              <button
                type="button"
                className="chip"
                aria-label={t(open ? "collapseProject" : "expandProject", {
                  title: project.title,
                })}
                disabled={disabled || !!query}
                onClick={() => toggle(project.id)}
              >
                {open ? "−" : "+"}
              </button>
            )}
            <button
              type="button"
              role="treeitem"
              aria-selected={value === project.id}
              aria-expanded={children ? open : undefined}
              aria-disabled={disabled || !allowed.has(project.id)}
              className="parent-tree-choice"
              onKeyDown={(event) => {
                if (
                  children &&
                  ["ArrowLeft", "ArrowRight"].includes(event.key)
                ) {
                  event.preventDefault();
                  if ((event.key === "ArrowRight") !== open) toggle(project.id);
                }
                if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const nodes = Array.from(
                    event.currentTarget
                      .closest('[role="tree"]')!
                      .querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
                  );
                  const position = nodes.indexOf(event.currentTarget);
                  const target =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? nodes.length - 1
                        : position + (event.key === "ArrowDown" ? 1 : -1);
                  nodes[
                    Math.max(0, Math.min(nodes.length - 1, target))
                  ]?.focus();
                }
              }}
              onClick={() => {
                if (!disabled && allowed.has(project.id)) select(project.id);
              }}
            >
              <span>
                {project.title}
                {!!query && (
                  <small className="parent-tree-path">{path(project)}</small>
                )}
              </span>
              {value === project.id && <span aria-hidden="true">✓</span>}
            </button>
          </div>
          {children && open && (
            <ul role="group">
              {branch(project.id, new Set([...visited, project.id]))}
            </ul>
          )}
        </li>
      );
    });
  };
  return (
    <section className="parent-tree-picker">
      <label htmlFor={searchId}>{t("searchProjects")}</label>
      <input
        id={searchId}
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      <button
        className="chip"
        type="button"
        aria-pressed={!value}
        disabled={disabled}
        onClick={() => onChange("")}
      >
        {t("noProject")}
      </button>
      {recent.length > 0 && !query && (
        <div className="parent-tree-recent">
          <small>{t("recentProjects")}</small>
          {recent.map((id) => {
            const project = projects.find((entry) => entry.id === id);
            return project && allowed.has(id) ? (
              <button
                className="text-button"
                type="button"
                key={id}
                onClick={() => select(id)}
              >
                {path(project)}
              </button>
            ) : null;
          })}
        </div>
      )}
      {value && projects.find((project) => project.id === value) && (
        <p className="muted" aria-live="polite">
          {t("selectedProject")}:{" "}
          {path(projects.find((project) => project.id === value)!)}
        </p>
      )}
      <ul role="tree" aria-label={t("parentTree")}>
        {branch(null, new Set())}
      </ul>
      {visible.size === 0 && <p className="muted">{t("noProjectMatches")}</p>}
    </section>
  );
}
