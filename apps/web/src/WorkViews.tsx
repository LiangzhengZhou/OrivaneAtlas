import {
  blockers,
  dependency,
  type WorkEdge,
  type WorkItem,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Circle,
  GitBranch,
  LockKeyhole,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { useTranslation } from "react-i18next";

interface WorkProps {
  items: readonly WorkItem[];
  allItems: readonly WorkItem[];
  edges: readonly WorkEdge[];
  busy: boolean;
  onOpen(item: WorkItem): void;
  onStatus(item: WorkItem, status: WorkStatus): Promise<boolean>;
  isArchived(item: WorkItem): boolean;
  onOrganize(item: WorkItem, action: "archive" | "unarchive" | "delete"): void;
}
function Task({
  item,
  allItems,
  edges,
  busy,
  onOpen,
  onStatus,
  isArchived,
  onOrganize,
}: Omit<WorkProps, "items"> & { item: WorkItem }) {
  const { t } = useTranslation(["common", "work"]);
  const blocked = blockers(item, allItems, edges).length > 0;
  return (
    <article
      draggable={!busy}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={`task-card ${item.status === "DONE" ? "completed" : ""}`}
      style={
        {
          "--task-hue":
            [...item.id].reduce(
              (hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0,
              0,
            ) % 360,
        } as CSSProperties
      }
    >
      <div className="task-main">
        <Circle
          className={`status-dot status-${item.status}`}
          size={17}
          aria-hidden="true"
        />
        <button
          type="button"
          className="task-title"
          aria-label={t("openTask", { title: item.title })}
          onClick={() => onOpen(item)}
        >
          {item.title}
        </button>
      </div>
      <div className="task-meta">
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          title={t(isArchived(item) ? "desk:unarchive" : "desk:archive")}
          aria-label={
            t(isArchived(item) ? "desk:unarchive" : "desk:archive") +
            ": " +
            item.title
          }
          onClick={() =>
            onOrganize(item, isArchived(item) ? "unarchive" : "archive")
          }
        >
          {isArchived(item) ? (
            <ArchiveRestore size={18} />
          ) : (
            <Archive size={18} />
          )}
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          title={t("desk:deleteItem")}
          aria-label={t("desk:deleteItem") + ": " + item.title}
          onClick={() => onOrganize(item, "delete")}
        >
          <Trash2 size={18} />
        </button>
        {item.projectId && (
          <span className="task-project">
            {allItems.find((project) => project.id === item.projectId)?.title}
          </span>
        )}
        {item.dueDate && (
          <time
            dateTime={item.dueDate}
            className="task-due"
            title={t("desk:dueDate")}
          >
            {item.dueDate}
          </time>
        )}
        {item.status === "TODO" && (
          <span className={`readiness ${blocked ? "blocked" : "ready"}`}>
            {blocked && <LockKeyhole size={12} aria-hidden="true" />}
            {t(blocked ? "work:blocked" : "work:ready")}
          </span>
        )}
        <span className={`priority priority-${item.priority}`}>
          {t(`work:priorities.${item.priority}`)}
        </span>
        <select
          className="status-select"
          aria-label={t("statusLabel", { title: item.title })}
          value={item.status}
          disabled={busy}
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
      </div>
    </article>
  );
}
export function TaskList({ items, ...props }: WorkProps) {
  return (
    <div className="task-list">
      {items.map((item) => (
        <Task key={item.id} item={item} {...props} />
      ))}
    </div>
  );
}
export function WorkBoard({ items, ...props }: WorkProps) {
  const { t, i18n } = useTranslation("work");
  return (
    <div className="board">
      {workStatuses.map((status) => {
        const group = items.filter((item) => item.status === status);
        return (
          <section
            key={status}
            className="board-column"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const item = items.find(
                (item) => item.id === event.dataTransfer.getData("text/plain"),
              );
              if (item && !props.busy && item.status !== status)
                void props.onStatus(item, status);
            }}
          >
            <h3>
              <span className={`column-dot status-${status}`} />
              {t(`statuses.${status}`)}
              <span className="column-count">
                {new Intl.NumberFormat(i18n.language).format(group.length)}
              </span>
            </h3>
            {group.map((item) => (
              <Task key={item.id} item={item} {...props} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
export function Dependencies({
  items,
  edges,
  busy,
  onAdd,
  onRemove,
}: {
  items: readonly WorkItem[];
  edges: readonly WorkEdge[];
  busy: boolean;
  onAdd(from: string, to: string): Promise<boolean>;
  onRemove(id: string): Promise<boolean>;
}) {
  const { t } = useTranslation(["common", "work"]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <section className="dependencies">
      <p className="muted">{t("work:dependencyHint")}</p>
      <form
        className="dependency-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy)
            void onAdd(from, to).then((ok) => {
              if (ok) {
                setFrom("");
                setTo("");
              }
            });
        }}
      >
        <label className="field">
          <span>{t("work:prerequisite")}</span>
          <select
            aria-label={t("work:prerequisite")}
            required
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          >
            <option value="">{t("work:chooseTask")}</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <ArrowRight size={19} aria-hidden="true" />
        <label className="field">
          <span>{t("work:dependent")}</span>
          <select
            aria-label={t("work:dependent")}
            required
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            <option value="">{t("work:chooseTask")}</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="button primary"
          disabled={busy || !from || !to}
        >
          <Plus size={16} aria-hidden="true" />
          {t("work:addDependency")}
        </button>
      </form>
      <div className="edge-list">
        {edges.length === 0 ? (
          <div className="empty-state compact">
            <GitBranch size={30} aria-hidden="true" />
            <p>{t("work:noDependencies")}</p>
          </div>
        ) : (
          edges.map((edge) => {
            const pair = dependency(edge);
            if (!pair) return null;
            return (
              <div className="edge-row" key={edge.id}>
                <strong>
                  {items.find((item) => item.id === pair[0])?.title}
                </strong>
                <span className="edge-label">
                  {t("work:edge")}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
                <strong>
                  {items.find((item) => item.id === pair[1])?.title}
                </strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("remove")}
                  disabled={busy}
                  onClick={() => void onRemove(edge.id)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
