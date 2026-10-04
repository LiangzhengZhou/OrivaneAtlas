import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import type { WorkProps } from "../../WorkViews";
import { VirtualTaskCollection } from "./VirtualTaskCollection";

export function TaskTimeline({ items, derived, onOpen }: WorkProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const scheduled = useMemo(
    () =>
      [...items].sort(
        (left, right) =>
          (left.startDate ?? left.dueDate ?? "9999").localeCompare(
            right.startDate ?? right.dueDate ?? "9999",
          ) || left.id.localeCompare(right.id),
      ),
    [items],
  );
  return (
    <section
      className="task-timeline"
      aria-label={zh ? "任务时间线" : "Task timeline"}
    >
      <VirtualTaskCollection
        items={scheduled}
        render={(task) => (
          <Button
            variant="text"
            className="agenda-item task-timeline-row"
            onClick={() => onOpen(task)}
          >
            <strong>{task.title}</strong>
            <small>{derived.projectTitlesByTaskId.get(task.id)}</small>
            <small>
              {task.startDate ?? "—"} →{" "}
              {task.dueDate ?? (zh ? "未排期" : "Unscheduled")}
            </small>
          </Button>
        )}
      />
    </section>
  );
}
