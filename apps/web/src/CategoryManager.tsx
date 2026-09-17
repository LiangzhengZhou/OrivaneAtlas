import type { CategoryService, ProjectCategory } from "@arclattice/application";
import type { WorkItem } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
export function CategoryManager({
  categories,
  projects,
  busy,
  onSave,
}: {
  categories: ProjectCategory[];
  projects: WorkItem[];
  busy: boolean;
  onSave(input: Parameters<CategoryService["save"]>[1]): Promise<boolean>;
}) {
  const { t } = useTranslation("desk");
  const [editing, setEditing] = useState<ProjectCategory>();
  const [name, setName] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  return (
    <details className="panel category-manager">
      <summary>{t("categories.manage")}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave({
              ...(editing ? { id: editing.id } : {}),
              version: editing?.version ?? 0,
              name,
              projectIds,
              deleted: false,
            })
          ) {
            setEditing(undefined);
            setName("");
            setProjectIds([]);
          }
        }}
      >
        <label>
          {t("categories.name")}
          <input
            required
            maxLength={240}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className="project-memberships">
          <legend>{t("categories.projects")}</legend>
          {projects.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={projectIds.includes(p.id)}
                onChange={(e) =>
                  setProjectIds(
                    e.target.checked
                      ? [...projectIds, p.id]
                      : projectIds.filter((id) => id !== p.id),
                  )
                }
              />
              {p.title}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={busy || !name.trim()}>
          {t("categories.save")}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setName("");
              setProjectIds([]);
            }}
          >
            {t("categories.cancel")}
          </button>
        )}
      </form>
      <ul>
        {categories.map((c) => (
          <li key={c.id}>
            {c.name} ·{" "}
            {
              c.projectIds.filter((id) => projects.some((p) => p.id === id))
                .length
            }{" "}
            <button
              type="button"
              disabled={busy || !!c.deletedAt}
              onClick={() => {
                setEditing(c);
                setName(c.name);
                setProjectIds(c.projectIds);
              }}
            >
              {t("categories.edit")}
            </button>{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onSave({
                  id: c.id,
                  version: c.version,
                  name: c.name,
                  projectIds: c.projectIds,
                  deleted: !c.deletedAt,
                })
              }
            >
              {t(c.deletedAt ? "categories.restore" : "categories.delete")}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
