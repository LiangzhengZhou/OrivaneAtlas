import {
  dependency,
  isExecutionActive,
  type WorkEdge,
  type WorkItem,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  CheckCircle2,
  Circle,
  GitBranch,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "./app/EntitySelection";
import { Button, IconButton } from "./components/ui/Button";
import { ListRow, MenuItem } from "./components/ui/Content";
import { Menu, Select } from "./components/ui/Surfaces";
import { TaskEntityPicker } from "./features/tasks/TaskEntityPicker";
import type { taskDerivedIndex } from "./features/tasks/task-index";
import type { TaskWorkspaceIndex } from "./features/tasks/task-selectors";
import { VirtualTaskCollection } from "./features/tasks/VirtualTaskCollection";

export interface WorkProps {
  compact?: boolean;
  taskIndex: TaskWorkspaceIndex;
  derived: ReturnType<typeof taskDerivedIndex>;
  today: string;
  items: readonly WorkItem[];
  allItems: readonly WorkItem[];
  edges: readonly WorkEdge[];
  busy: boolean;
  isPending?(item: WorkItem): boolean;
  onOpen(item: WorkItem): void;
  onStatus(item: WorkItem, status: WorkStatus): Promise<boolean>;
  isArchived(item: WorkItem): boolean;
  archiveSource(item: WorkItem): WorkItem | undefined;
  onOrganize(item: WorkItem, action: "archive" | "unarchive" | "delete"): void;
}
function Task({
  compact = false,
  today,
  item,
  derived,
  busy: workspaceBusy,
  isPending,
  onOpen,
  onStatus,
  isArchived,
  archiveSource,
  onOrganize,
}: Omit<WorkProps, "items"> & {
  item: WorkItem;
  derived: ReturnType<typeof taskDerivedIndex>;
}) {
  const { t, i18n } = useTranslation(["common", "work"]);
  const busy = workspaceBusy || !!isPending?.(item);
  const selection = useEntitySelection();
  const blocked = (derived.blockersByTaskId.get(item.id)?.length ?? 0) > 0;
  const activated = isExecutionActive(item, today);
  const inherited = archiveSource(item);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreLabel =
    (i18n.language.startsWith("zh") ? "更多操作：" : "More actions: ") +
    item.title;
  return (
    <ListRow
      as="article"
      role="article"
      onSelect={() => selection?.select({ kind: "WORK", id: item.id })}
      onOpen={() => onOpen(item)}
      draggable={!busy}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={`task-card ${compact ? "task-action-row" : ""} ${item.status === "DONE" ? "completed" : ""}`}
      selected={
        (selection?.selected?.kind === "WORK" &&
          selection.selected.id === item.id) ||
        false
      }
      style={
        {
          "--task-hue":
            [...(item.projectIds?.[0] ?? item.id)].reduce(
              (hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0,
              0,
            ) % 360,
        } as CSSProperties
      }
    >
      <div className="task-main">
        <IconButton
          label={
            (i18n.language.startsWith("zh")
              ? item.status === "DONE"
                ? "重新打开："
                : "完成："
              : item.status === "DONE"
                ? "Reopen: "
                : "Complete: ") + item.title
          }
          disabled={busy}
          aria-pressed={item.status === "DONE"}
          onClick={(event) => {
            event.stopPropagation();
            void onStatus(item, item.status === "DONE" ? "TODO" : "DONE");
          }}
        >
          {item.status === "DONE" ? (
            <CheckCircle2 className="status-dot status-DONE" />
          ) : (
            <Circle className={`status-dot status-${item.status}`} />
          )}
        </IconButton>
        <Button
          variant="ghost"
          type="button"
          className="task-title"
          aria-label={t("openTask", { title: item.title })}
          onClick={(event) => {
            event.stopPropagation();
            selection
              ? selection.select({ kind: "WORK", id: item.id })
              : onOpen(item);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onOpen(item);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onOpen(item);
            }
          }}
        >
          {item.title}
        </Button>
      </div>
      <div className="task-meta">
        {inherited && (
          <small>
            {t("desk:inheritedArchive", { title: inherited.title })}
          </small>
        )}
        {!!item.projectIds?.length && (
          <span className="task-project">
            {derived.projectTitlesByTaskId.get(item.id)}
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
        {item.status === "TODO" && activated && blocked && (
          <span className="readiness blocked">
            <LockKeyhole size={12} aria-hidden="true" />
            {t("work:blocked")}
          </span>
        )}
        {item.status === "TODO" && !activated && (
          <span className="readiness waiting">
            {t(
              `work:${derived.availabilityByTaskId.get(item.id)?.toLowerCase()}`,
            )}
          </span>
        )}
        {!compact &&
          (item.priority === "HIGH" || item.priority === "URGENT") && (
            <span className="task-priority-signal">
              {t(`work:priorities.${item.priority}`)}
            </span>
          )}
        <IconButton
          ref={menuAnchor}
          label={moreLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          <MoreHorizontal />
        </IconButton>
        {menuOpen && (
          <Menu
            anchorRef={menuAnchor}
            label={moreLabel}
            onDismiss={() => setMenuOpen(false)}
          >
            <MenuItem
              disabled={busy || !!inherited}
              aria-label={
                t(isArchived(item) ? "desk:unarchive" : "desk:archive") +
                ": " +
                item.title
              }
              onClick={() => {
                setMenuOpen(false);
                onOrganize(item, isArchived(item) ? "unarchive" : "archive");
              }}
            >
              {isArchived(item) ? (
                <ArchiveRestore size={18} />
              ) : (
                <Archive size={18} />
              )}
              {t(isArchived(item) ? "desk:unarchive" : "desk:archive")}
            </MenuItem>
            <MenuItem
              disabled={busy}
              aria-label={t("desk:deleteItem") + ": " + item.title}
              onClick={() => {
                setMenuOpen(false);
                onOrganize(item, "delete");
              }}
            >
              <Trash2 size={18} />
              {t("desk:deleteItem")}
            </MenuItem>
            <Select
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
            </Select>
          </Menu>
        )}
      </div>
    </ListRow>
  );
}
export function TaskList({ items, ...props }: WorkProps) {
  const derived = props.derived;
  return (
    <div className="task-list">
      <VirtualTaskCollection
        items={items}
        render={(item) => <Task item={item} {...props} derived={derived} />}
      />
    </div>
  );
}
export function WorkBoard({ items, ...props }: WorkProps) {
  const { t, i18n } = useTranslation("work");
  const derived = props.derived;
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
              if (
                item &&
                !props.busy &&
                !props.isPending?.(item) &&
                item.status !== status
              )
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
            <VirtualTaskCollection
              board
              items={group}
              render={(item) => (
                <Task item={item} {...props} derived={derived} />
              )}
            />
          </section>
        );
      })}
    </div>
  );
}
export function Dependencies({
  scopeIds,
  items,
  edges,
  busy,
  onAdd,
  onRemove,
}: {
  scopeIds?: ReadonlySet<string>;
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
          if (
            !busy &&
            from !== to &&
            (!scopeIds || scopeIds.has(from) || scopeIds.has(to))
          )
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
          <TaskEntityPicker
            items={items}
            values={from ? [from] : []}
            mode="single"
            label={t("work:prerequisite")}
            excludedId={to}
            disabled={busy}
            onChange={(values) => setFrom(values[0] ?? "")}
          />
        </label>
        <ArrowRight size={19} aria-hidden="true" />
        <label className="field">
          <span>{t("work:dependent")}</span>
          <TaskEntityPicker
            items={items}
            values={to ? [to] : []}
            mode="single"
            label={t("work:dependent")}
            excludedId={from}
            disabled={busy}
            onChange={(values) => setTo(values[0] ?? "")}
          />
        </label>
        <Button
          variant="primary"
          type="submit"
          disabled={
            busy ||
            !from ||
            !to ||
            from === to ||
            (!!scopeIds && !scopeIds.has(from) && !scopeIds.has(to))
          }
        >
          <Plus size={16} aria-hidden="true" />
          {t("work:addDependency")}
        </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  className="ui-icon-button"
                  aria-label={t("remove")}
                  disabled={busy}
                  onClick={() => void onRemove(edge.id)}
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
