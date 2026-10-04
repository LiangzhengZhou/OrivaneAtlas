import {
  availability,
  localCalendarDay,
  projectLifecycle,
  type WorkItem,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "./bootstrap";
import { Button } from "./components/ui/Button";
import { Select } from "./components/ui/Surfaces";
import type { WorkspaceWorkIndex } from "./features/tasks/workspace-work-index";
import { Markdown } from "./Markdown";

export function ProjectInspector({
  workIndex,
  item,
  snapshot,
  busy,
  runtime,
  run,
  onEdit,
  onProject,
  onStatus,
  onOrganize,
}: {
  workIndex: WorkspaceWorkIndex;
  item: WorkItem;
  snapshot: Snapshot;
  busy: boolean;
  runtime: Runtime;
  run(operation: () => Promise<unknown>): Promise<boolean>;
  onEdit(): void;
  onProject(id: string): void;
  onStatus(item: WorkItem, status: WorkStatus): Promise<boolean>;
  onOrganize(item: WorkItem, action: "archive" | "unarchive" | "delete"): void;
}) {
  const { t } = useTranslation(["desk", "work", "common"]);
  const archived = workIndex.isArchived(item);
  const today = localCalendarDay(
    new Date().toISOString(),
    snapshot.calendarTimezone ?? "UTC",
  );
  return (
    <aside className="panel project-inspector" aria-label={t("inspector")}>
      <h2>{t("inspector")}</h2>
      <h3>{item.title}</h3>
      <p className="muted">
        {(item.type === "TASK"
          ? workIndex.projectTitleByTaskId.get(item.id)
          : workIndex.projectPathById.get(item.id)) || t("noProject")}
      </p>
      <dl>
        <dt>
          {item.type === "PROJECT" ? t("projectLifecycle") : t("work:status")}
        </dt>
        <dd>
          {item.type === "PROJECT"
            ? t(`projectLifecycles.${projectLifecycle(item)}`)
            : t(`work:statuses.${item.status}`)}
        </dd>
        {item.type === "TASK" &&
          !["DONE", "CANCELED"].includes(item.status) && (
            <>
              <dt>{t("work:availability")}</dt>
              <dd>
                {t(
                  `work:${availability(item, snapshot.items, snapshot.edges, today).toLowerCase()}`,
                )}
              </dd>
            </>
          )}
        <dt>
          {t("startDate")} / {t("dueDate")}
        </dt>
        <dd>
          {item.startDate ?? "—"} / {item.dueDate ?? "—"}
        </dd>
      </dl>
      {item.descriptionMd && <Markdown text={item.descriptionMd} />}
      {item.type === "TASK" && (
        <label className="field">
          <span>{t("work:status")}</span>
          <Select
            aria-label={t("work:status")}
            disabled={busy}
            value={item.status}
            onChange={(event) =>
              void onStatus(item, event.target.value as WorkStatus)
            }
          >
            {workStatuses.map((status) => (
              <option key={status} value={status}>
                {t(`work:statuses.${status}`)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {item.type === "PROJECT" && (
        <fieldset className="field">
          <legend>{t("categories.filter")}</legend>
          {(snapshot.categories ?? [])
            .filter((category) => !category.deletedAt)
            .map((category) => (
              <label key={category.id}>
                <input
                  type="radio"
                  name="project-category"
                  disabled={busy}
                  checked={item.categoryId === category.id}
                  onChange={() => {
                    void run(() =>
                      runtime.service.update(
                        runtime.context!,
                        item.id,
                        item.version,
                        { categoryId: category.id },
                      ),
                    );
                  }}
                />
                {category.name}
              </label>
            ))}
        </fieldset>
      )}
      <Button
        variant="primary"
        type="button"
        className="button primary"
        disabled={busy}
        onClick={onEdit}
      >
        {item.type === "PROJECT" ? t("projectSettings") : t("work:detail")}
      </Button>
      {item.type === "PROJECT" && (
        <Button
          type="button"
          className="button secondary"
          onClick={() => onProject(item.id)}
        >
          {t("openWorkspace")}
        </Button>
      )}
      <div className="organization-toolbar">
        <Button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() => onOrganize(item, archived ? "unarchive" : "archive")}
        >
          {t(archived ? "unarchive" : "archive")}
        </Button>
        <Button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() => onOrganize(item, "delete")}
        >
          {t("common:delete")}
        </Button>
      </div>
    </aside>
  );
}
