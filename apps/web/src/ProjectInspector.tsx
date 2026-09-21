import {
  availability,
  localCalendarDay,
  projectLifecycle,
  projectPath,
  type WorkItem,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "./bootstrap";
import { Markdown } from "./Markdown";

export function ProjectInspector({
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
  const archived = snapshot.organization?.find(
    (entry) => entry.kind === "WORK" && entry.id === item.id,
  )?.archived;
  const today = localCalendarDay(
    new Date().toISOString(),
    snapshot.calendarTimezone ?? "UTC",
  );
  return (
    <aside className="panel project-inspector" aria-label={t("inspector")}>
      <h2>{t("inspector")}</h2>
      <h3>{item.title}</h3>
      <p className="muted">
        {projectPath(item, snapshot.items) || t("noProject")}
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
          <select
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
          </select>
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
                  type="checkbox"
                  disabled={busy}
                  checked={category.projectIds.includes(item.id)}
                  onChange={(event) => {
                    const projectIds = event.target.checked
                      ? [...category.projectIds, item.id]
                      : category.projectIds.filter((id) => id !== item.id);
                    void run(() =>
                      runtime.saveCategory({
                        id: category.id,
                        version: category.version,
                        name: category.name,
                        deleted: false,
                        projectIds,
                      }),
                    );
                  }}
                />
                {category.name}
              </label>
            ))}
        </fieldset>
      )}
      <button
        type="button"
        className="button primary"
        disabled={busy}
        onClick={onEdit}
      >
        {item.type === "PROJECT" ? t("projectSettings") : t("work:detail")}
      </button>
      {item.type === "PROJECT" && (
        <button
          type="button"
          className="button secondary"
          onClick={() => onProject(item.id)}
        >
          {t("openWorkspace")}
        </button>
      )}
      <div className="organization-toolbar">
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() => onOrganize(item, archived ? "unarchive" : "archive")}
        >
          {t(archived ? "unarchive" : "archive")}
        </button>
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() => onOrganize(item, "delete")}
        >
          {t("common:delete")}
        </button>
      </div>
    </aside>
  );
}
