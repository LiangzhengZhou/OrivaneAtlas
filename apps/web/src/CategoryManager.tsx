import type { CategoryService, ProjectCategory } from "@arclattice/application";
import type { WorkItem } from "@arclattice/domain";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/Button";
import {
  DragHandle,
  SortableList,
  SortableRow,
} from "./components/ui/Sortable";
import "./category-presentation.css";
export function CategoryManager({
  categories,
  projects,
  busy,
  onSave,
  onReorder,
}: {
  categories: ProjectCategory[];
  projects: WorkItem[];
  busy: boolean;
  onSave(input: Parameters<CategoryService["save"]>[1]): Promise<boolean>;
  onReorder(
    ordered: Parameters<CategoryService["reorder"]>[1],
  ): Promise<boolean>;
}) {
  const { t, i18n } = useTranslation("desk");
  const labels = i18n.language.startsWith("zh")
    ? {
        icon: "图标（文字或表情）",
        color: "颜色",
        reorder: "调整顺序：",
      }
    : {
        icon: "Icon (text or emoji)",
        color: "Color",
        reorder: "Reorder: ",
      };
  const [editing, setEditing] = useState<ProjectCategory>();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("#7863c5");
  const ordered = useMemo(
    () =>
      [...categories].sort(
        (left, right) =>
          left.position - right.position ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      ),
    [categories],
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const project of projects)
      if (project.categoryId)
        result.set(
          project.categoryId,
          (result.get(project.categoryId) ?? 0) + 1,
        );
    return result;
  }, [projects]);
  function move(
    movingId: string,
    anchorId: string,
    placement: "BEFORE" | "AFTER",
  ) {
    if (busy || movingId === anchorId) return;
    const live = ordered.filter((category) => !category.deletedAt);
    const moving = live.find((category) => category.id === movingId);
    if (!moving || !live.some((category) => category.id === anchorId)) return;
    const next = live.filter((category) => category.id !== movingId);
    next.splice(
      next.findIndex((category) => category.id === anchorId) +
        (placement === "AFTER" ? 1 : 0),
      0,
      moving,
    );
    void onReorder(
      next.map((category) => ({ id: category.id, version: category.version })),
    );
  }
  const reset = () => {
    setEditing(undefined);
    setName("");
    setIcon("");
    setColor("#7863c5");
  };
  return (
    <section className="category-manager">
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
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          {t("categories.save")}
        </Button>
        {editing && (
          <Button type="button" onClick={reset}>
            {t("categories.cancel")}
          </Button>
        )}
      </form>
      <SortableList>
        {ordered.map((c) => (
          <SortableRow
            key={c.id}
            entityId={c.id}
            scopeKey="PROJECT_CATEGORIES"
            disabled={busy || !!c.deletedAt}
            onMoveBefore={(movingId, targetId) =>
              move(movingId, targetId, "BEFORE")
            }
            onMoveAfter={(movingId, targetId) =>
              move(movingId, targetId, "AFTER")
            }
          >
            {!c.deletedAt && (
              <DragHandle
                input={{
                  version: 1,
                  intent: "REORDER",
                  entityId: c.id,
                  scopeKey: "PROJECT_CATEGORIES",
                }}
                label={labels.reorder + c.name}
                disabled={busy}
                onMove={(direction) => {
                  const live = ordered.filter(
                    (category) => !category.deletedAt,
                  );
                  const index = live.findIndex(
                    (category) => category.id === c.id,
                  );
                  const anchor = live[index + (direction === "UP" ? -1 : 1)];
                  if (!anchor) return;
                  move(
                    c.id,
                    anchor.id,
                    direction === "UP" ? "BEFORE" : "AFTER",
                  );
                }}
              />
            )}
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
            · {counts.get(c.id) ?? 0}{" "}
            <Button
              type="button"
              disabled={busy || !!c.deletedAt}
              onClick={() => {
                setEditing(c);
                setName(c.name);
                setIcon(c.icon ?? "");
                setColor(c.color ?? "#7863c5");
              }}
            >
              {t("categories.edit")}
            </Button>{" "}
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                onSave({
                  id: c.id,
                  version: c.version,
                  name: c.name,
                  deleted: !c.deletedAt,
                })
              }
            >
              {t(c.deletedAt ? "categories.restore" : "categories.delete")}
            </Button>
          </SortableRow>
        ))}
      </SortableList>
    </section>
  );
}
