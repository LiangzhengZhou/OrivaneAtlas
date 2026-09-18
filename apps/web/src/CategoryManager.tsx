import type { CategoryService, ProjectCategory } from "@arclattice/application";
import type { WorkItem } from "@arclattice/domain";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import "./category-presentation.css";
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
  const { t, i18n } = useTranslation("desk");
  const labels = i18n.language.startsWith("zh")
    ? {
        icon: "图标（文字或表情）",
        color: "颜色",
        position: "排序（小值优先）",
      }
    : {
        icon: "Icon (text or emoji)",
        color: "Color",
        position: "Position (lowest first)",
      };
  const [editing, setEditing] = useState<ProjectCategory>();
  const [name, setName] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("#7863c5");
  const [position, setPosition] = useState(0);
  const reset = () => {
    setEditing(undefined);
    setName("");
    setProjectIds([]);
    setIcon("");
    setColor("#7863c5");
    setPosition(0);
  };
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
              icon,
              color,
              position,
              projectIds,
              deleted: false,
            })
          ) {
            reset();
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
        <div className="category-presentation-fields">
          <label>
            {labels.icon}
            <input
              value={icon}
              maxLength={32}
              onChange={(event) => setIcon(event.target.value)}
            />
          </label>
          <label>
            {labels.color}
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <label>
            {labels.position}
            <input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              required
              value={position}
              onChange={(event) => setPosition(event.target.valueAsNumber)}
            />
          </label>
        </div>
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
          <button type="button" onClick={reset}>
            {t("categories.cancel")}
          </button>
        )}
      </form>
      <ul>
        {[...categories]
          .sort(
            (left, right) =>
              (left.position ?? 0) - (right.position ?? 0) ||
              left.createdAt.localeCompare(right.createdAt) ||
              left.id.localeCompare(right.id),
          )
          .map((c) => (
            <li key={c.id}>
              <span
                className="category-color"
                style={{
                  backgroundColor: /^#[0-9a-fA-F]{6}$/.test(c.color ?? "")
                    ? c.color
                    : "#7863c5",
                }}
                aria-hidden="true"
              />
              <span>
                {c.icon} {c.name}
              </span>{" "}
              ·{" "}
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
                  setIcon(c.icon ?? "");
                  setColor(c.color ?? "#7863c5");
                  setPosition(c.position ?? 0);
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
