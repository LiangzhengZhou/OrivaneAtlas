import type { WorkItem } from "@arclattice/domain";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchoredFloatingSurface } from "../../app/AnchoredFloatingSurface";
import { Button } from "../../components/ui/Button";
import { PickerIdentityContext } from "../hierarchy/PickerIdentityContext";
import { cleanRecent, recentKey } from "../hierarchy/recent";
import { VirtualTaskCollection } from "./VirtualTaskCollection";
import {
  buildWorkspaceWorkIndex,
  WorkspaceWorkIndexContext,
} from "./workspace-work-index";

export function TaskEntityPicker({
  items,
  label,
  mode = "multiple",
  values,
  excludedId,
  disabled,
  onChange,
  scopeProjectId,
  excludedIds,
  disabledIds,
}: {
  label?: string;
  mode?: "single" | "multiple";
  items: readonly WorkItem[];
  values: readonly string[];
  excludedId?: string | undefined;
  disabled: boolean;
  onChange(values: string[]): void;
  scopeProjectId?: string;
  excludedIds?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
}) {
  const { t, i18n } = useTranslation("work");
  const zh = i18n.language.startsWith("zh");
  const sharedIndex = useContext(WorkspaceWorkIndexContext);
  const index = useMemo(
    () => sharedIndex ?? buildWorkspaceWorkIndex(items, []),
    [items, sharedIndex],
  );
  const accessible = useMemo(
    () =>
      new Set(items.filter((item) => !item.deletedAt).map((item) => item.id)),
    [items],
  );
  const identity = useContext(PickerIdentityContext);
  const key = identity
    ? recentKey(identity, "TASK:" + (scopeProjectId ?? "workspace"))
    : null;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(scopeProjectId ?? "");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try {
      setRecent(
        key
          ? cleanRecent(
              JSON.parse(localStorage.getItem(key) ?? "[]"),
              accessible,
            )
          : [],
      );
    } catch {
      setRecent([]);
    }
  }, [key, accessible]);
  const fullPath = current
    ? [...(index.ancestorIdsByProjectId.get(current) ?? [])]
        .reverse()
        .concat(current)
    : [];
  const path = scopeProjectId
    ? fullPath.slice(Math.max(0, fullPath.indexOf(scopeProjectId)))
    : fullPath;
  const children = current
    ? (index.childrenByProjectId.get(current) ?? [])
    : [...index.projectsById.keys()].filter(
        (id) =>
          accessible.has(id) &&
          !accessible.has(index.parentProjectById.get(id) ?? ""),
      );
  const taskIds = current
    ? (index.tasksByProjectId.get(current) ?? [])
    : index.unassignedTaskIds;
  const matches = (id: string) =>
    accessible.has(id) &&
    !excludedIds?.has(id) &&
    index.searchTextByWorkId.get(id)?.includes(query.toLocaleLowerCase());
  const choose = (id: string) => {
    if (
      disabled ||
      id === excludedId ||
      excludedIds?.has(id) ||
      disabledIds?.has(id) ||
      !accessible.has(id)
    )
      return;
    onChange(
      mode === "single"
        ? [id]
        : values.includes(id)
          ? values.filter((value) => value !== id)
          : [...values, id],
    );
    const next = [id, ...recent.filter((value) => value !== id)].slice(0, 5);
    setRecent(next);
    if (key)
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Preferences remain optional when browser storage is unavailable. */
      }
    if (mode === "single") setOpen(false);
  };
  const row = (id: string) => {
    const item = index.itemsById.get(id);
    if (!item || item.deletedAt) return null;
    return (
      <Button
        key={id}
        variant="text"
        disabled={disabled || id === excludedId || disabledIds?.has(id)}
        aria-pressed={values.includes(id)}
        onClick={() => choose(id)}
      >
        {values.includes(id) ? "✓ " : ""}
        {item.title}
        <small>
          {(index.taskProjectIds.get(id) ?? [])
            .map((projectId) => index.projectPathById.get(projectId))
            .join(" · ")}{" "}
          · {t("statuses." + item.status)}
        </small>
      </Button>
    );
  };
  return (
    <section>
      <div className="hierarchy-selected">
        {values.map((id) => (
          <Button
            variant="toggle"
            key={id}
            disabled={disabled}
            onClick={() => onChange(values.filter((value) => value !== id))}
          >
            {index.itemsById.get(id)?.title ?? id} ×
          </Button>
        ))}
      </div>
      <Button
        ref={anchorRef}
        aria-label={label ?? (zh ? "添加前置任务" : "Add prerequisite")}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label ?? (zh ? "添加前置任务" : "Add prerequisite")}
      </Button>
      {open && (
        <AnchoredFloatingSurface
          anchorRef={anchorRef}
          onDismiss={() => setOpen(false)}
          label={label ?? t("prerequisites")}
          placement="bottom-start"
          className="hierarchy-browser"
        >
          <nav aria-label={zh ? "任务路径" : "Task path"}>
            {!scopeProjectId && (
              <Button
                variant="text"
                onClick={() => {
                  setCurrent("");
                  setQuery("");
                }}
              >
                {zh ? "项目" : "Projects"}
              </Button>
            )}
            {path.map((id) => (
              <Button
                key={id}
                variant="text"
                onClick={() => {
                  setCurrent(id);
                  setQuery("");
                }}
              >
                {index.itemsById.get(id)?.title}
              </Button>
            ))}
          </nav>
          <input
            type="search"
            aria-label={t("prerequisites")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {children.filter(matches).map((id) => (
            <Button
              key={id}
              variant="text"
              onClick={() => {
                setCurrent(id);
                setQuery("");
              }}
            >
              {index.itemsById.get(id)?.title} ›
            </Button>
          ))}
          <VirtualTaskCollection
            items={taskIds.filter(matches).map((id) => ({ id }))}
            render={(entry) => row(entry.id)}
          />
          {!query && recent.length > 0 && (
            <section aria-label={zh ? "最近" : "Recent"}>
              <small>{zh ? "最近" : "Recent"}</small>
              {recent.filter((id) => taskIds.includes(id)).map(row)}
            </section>
          )}
        </AnchoredFloatingSurface>
      )}
    </section>
  );
}
