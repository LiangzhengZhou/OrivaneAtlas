import {
  type ActivationPolicy,
  type ActivationState,
  activationPolicies,
  availability,
  dependency,
  type Priority,
  priorities,
  type WorkStatus,
  workStatuses,
} from "@arclattice/domain";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "./Markdown";
import type { WorkEditorProps } from "./WorkItemEditor";

export function TaskEditor({
  item,
  projects,
  createType,
  items = [],
  edges = [],
  today,
  initialProjectId = "",
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: WorkEditorProps) {
  const { t, i18n } = useTranslation(["common", "work"]);
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingChange = useRef<(() => void) | null>(null);
  const [discard, setDiscard] = useState(false);
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState(item?.title ?? "");
  const [status, setStatus] = useState<WorkStatus>(item?.status ?? "TODO");
  const [projectId] = useState(
    item ? (item.parentProjectId ?? "") : initialProjectId,
  );
  const [extraProjects, setExtraProjects] = useState<string[]>([
    ...(item?.projectIds ?? (initialProjectId ? [initialProjectId] : [])),
  ]);
  const [activationState, setActivationState] = useState<ActivationState>(
    item?.activationState ?? "ACTIVE",
  );
  const [activationPolicy, setActivationPolicy] = useState<ActivationPolicy>(
    item?.activationPolicy ?? "MANUAL",
  );
  const [startDate, setStartDate] = useState(item?.startDate ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>(() =>
    item
      ? edges
          .filter((edge) => {
            const pair =
              edge.type === "BLOCKS"
                ? [edge.fromId, edge.toId]
                : edge.type === "REQUIRES"
                  ? [edge.toId, edge.fromId]
                  : [];
            return pair[1] === item.id;
          })
          .map((edge) => (edge.type === "BLOCKS" ? edge.fromId : edge.toId))
      : [],
  );
  const [initialPrerequisites] = useState(() =>
    item
      ? edges
          .flatMap((edge) => {
            const pair = dependency(edge);
            return pair?.[1] === item.id ? [pair[0]] : [];
          })
          .sort()
      : [],
  );
  const [prerequisiteSearch, setPrerequisiteSearch] = useState("");
  const previewId = item?.id ?? "new-task";
  const previewWorkspace =
    item?.workspaceId ?? items[0]?.workspaceId ?? "new-workspace";
  const previewAvailability = availability(
    {
      id: previewId,
      workspaceId: previewWorkspace,
      activationPolicy,
      activationState,
      startDate: startDate || null,
    },
    items,
    prerequisiteIds.map((fromId) => ({
      id: `preview:${fromId}`,
      workspaceId: previewWorkspace,
      fromId,
      toId: previewId,
      type: "BLOCKS" as const,
      createdBy: "preview",
      createdAt: "",
    })),
    today,
  );
  const [descriptionMd, setDescription] = useState(item?.descriptionMd ?? "");
  const [priority, setPriority] = useState<Priority>(
    item?.priority ?? "MEDIUM",
  );
  const dirty =
    status !== (item?.status ?? "TODO") ||
    title !== (item?.title ?? "") ||
    descriptionMd !== (item?.descriptionMd ?? "") ||
    priority !== (item?.priority ?? "MEDIUM") ||
    projectId !== (item ? (item.parentProjectId ?? "") : initialProjectId) ||
    JSON.stringify(extraProjects) !==
      JSON.stringify(
        item?.projectIds ?? (initialProjectId ? [initialProjectId] : []),
      ) ||
    activationState !== (item?.activationState ?? "ACTIVE") ||
    activationPolicy !== (item?.activationPolicy ?? "MANUAL") ||
    startDate !== (item?.startDate ?? "") ||
    dueDate !== (item?.dueDate ?? "") ||
    JSON.stringify([...prerequisiteIds].sort()) !==
      JSON.stringify(initialPrerequisites);
  function close() {
    if (dirty) setDiscard(true);
    else onClose();
  }
  useEffect(() => {
    const switchTask = (event: Event) => {
      if (busy || dirty) {
        event.preventDefault();
        if (!busy) {
          pendingChange.current = (event as CustomEvent<() => void>).detail;
          setDiscard(true);
        }
      }
    };
    window.addEventListener("atlas:task-detail-change", switchTask);
    return () =>
      window.removeEventListener("atlas:task-detail-change", switchTask);
  }, [busy, dirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    const node = dialog.current;
    if (window.matchMedia("(max-width: 767px)").matches) node?.showModal();
    else node?.show();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="task-dialog task-inspector"
      aria-labelledby="editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy)
            void onSave({
              title,
              ...(item ? { status } : {}),
              descriptionMd,
              priority,

              ...((item?.type ?? createType) === "TASK"
                ? {
                    projectIds: extraProjects,
                  }
                : { parentProjectId: projectId || null }),
              startDate: startDate || null,
              dueDate: dueDate || null,
              ...(JSON.stringify([...prerequisiteIds].sort()) !==
              JSON.stringify(initialPrerequisites)
                ? {
                    prerequisiteIds,
                    ...(item
                      ? { expectedPrerequisiteIds: initialPrerequisites }
                      : {}),
                  }
                : {}),
              activationState:
                activationPolicy === "MANUAL" && activationState === "SCHEDULED"
                  ? "INACTIVE"
                  : activationState,
              activationPolicy,
            });
        }}
      >
        <div className="dialog-heading">
          <h2 id="editor-heading">{item ? t("work:detail") : t("create")}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("close")}
            disabled={busy}
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {discard && (
          <div className="error">
            {t("desk:discardHint")}
            <button
              className="button danger"
              type="button"
              onClick={() =>
                pendingChange.current ? pendingChange.current() : onClose()
              }
            >
              {t("desk:discard")}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setDiscard(false)}
            >
              {t("cancel")}
            </button>
          </div>
        )}
        <label className="field">
          <span>{t("work:title")}</span>
          <input
            aria-label={t("work:title")}
            required
            maxLength={240}
            value={title}
            placeholder={t("work:titlePlaceholder")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {item && (
          <label className="field">
            <span>{t("work:status")}</span>
            <select
              aria-label={t("work:status")}
              value={status}
              onChange={(event) => setStatus(event.target.value as WorkStatus)}
            >
              {workStatuses.map((value) => (
                <option key={value} value={value}>
                  {t("work:statuses." + value)}
                </option>
              ))}
            </select>
          </label>
        )}
        {
          <label className="field">
            <span>{t("work:priority")}</span>
            <select
              aria-label={t("work:priority")}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {priorities.map((value) => (
                <option key={value} value={value}>
                  {t(`work:priorities.${value}`)}
                </option>
              ))}
            </select>
          </label>
        }
        {(item?.type ?? createType) === "TASK" && (
          <fieldset className="field project-memberships">
            <legend>{t("desk:projects")}</legend>
            {projects.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={extraProjects.includes(p.id)}
                  onChange={(event) =>
                    setExtraProjects((ids) =>
                      event.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />{" "}
                {p.title}
              </label>
            ))}
          </fieldset>
        )}
        <details className="task-advanced">
          <summary>{t("desk:advanced")}</summary>
          {
            <label className="field">
              <span>{t("desk:activationPolicy")}</span>
              <select
                aria-label={t("desk:activationPolicy")}
                value={activationPolicy}
                onChange={(event) =>
                  setActivationPolicy(event.target.value as ActivationPolicy)
                }
              >
                {activationPolicies.map((policy) => (
                  <option key={policy} value={policy}>
                    {t("desk:activationPolicies." + policy)}
                  </option>
                ))}
              </select>
            </label>
          }
          {(item?.type ?? createType) === "TASK" && (
            <fieldset className="field">
              <legend>{t("work:prerequisites")}</legend>
              <p className="muted">
                {t("work:availability")}:{" "}
                {t(`work:${previewAvailability.toLowerCase()}`)}
              </p>
              <input
                type="search"
                aria-label={t("work:prerequisites")}
                value={prerequisiteSearch}
                onChange={(event) => setPrerequisiteSearch(event.target.value)}
              />
              {items
                .filter(
                  (candidate) =>
                    candidate.type === "TASK" &&
                    !candidate.deletedAt &&
                    candidate.id !== item?.id &&
                    (prerequisiteIds.includes(candidate.id) ||
                      candidate.title
                        .toLocaleLowerCase()
                        .includes(prerequisiteSearch.toLocaleLowerCase())),
                )
                .map((candidate) => (
                  <label key={candidate.id}>
                    <input
                      type="checkbox"
                      checked={prerequisiteIds.includes(candidate.id)}
                      onChange={(event) =>
                        setPrerequisiteIds((ids) =>
                          event.target.checked
                            ? [...ids, candidate.id]
                            : ids.filter((id) => id !== candidate.id),
                        )
                      }
                    />{" "}
                    {candidate.title}
                  </label>
                ))}
            </fieldset>
          )}
          {activationPolicy === "MANUAL" && (
            <label className="field">
              <span>{t("desk:activationState")}</span>
              <select
                aria-label={t("desk:activationState")}
                value={
                  activationState === "SCHEDULED" ? "INACTIVE" : activationState
                }
                onChange={(event) =>
                  setActivationState(event.target.value as ActivationState)
                }
              >
                <option value="ACTIVE">
                  {t("desk:activationStates.ACTIVE")}
                </option>
                <option value="INACTIVE">
                  {t("desk:activationStates.INACTIVE")}
                </option>
              </select>
            </label>
          )}
          {activationPolicy === "AT_SCHEDULED_TIME" && (
            <p className="muted">{t("desk:scheduledHint")}</p>
          )}
        </details>
        <div className="schedule-fields">
          <label className="field">
            <span>{t("desk:startDate")}</span>
            <input
              type="date"
              min="0001-01-01"
              required={activationPolicy === "AT_SCHEDULED_TIME"}
              max={dueDate || "9999-12-31"}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("desk:dueDate")}</span>
            <input
              type="date"
              min={startDate || "0001-01-01"}
              max="9999-12-31"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span>{t("work:description")}</span>
          <div className="editor-toolbar">
            <button
              className={!preview ? "chip active" : "chip"}
              type="button"
              onClick={() => {
                setPreview(false);
              }}
            >
              {t("desk:write")}
            </button>
            <button
              className={preview ? "chip active" : "chip"}
              type="button"
              onClick={() => {
                setPreview(true);
              }}
            >
              {t("desk:read")}
            </button>
          </div>
          {preview ? (
            <Markdown text={descriptionMd} />
          ) : (
            <textarea
              aria-label={t("work:description")}
              rows={10}
              maxLength={200000}
              value={descriptionMd}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </label>
        {item && (
          <p className="muted metadata">
            {t("version", {
              version: new Intl.NumberFormat(i18n.language).format(
                item.version,
              ),
            })}
            <span> · </span>
            <time dateTime={item.updatedAt}>
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(item.updatedAt))}
            </time>
          </p>
        )}
        <div className="dialog-actions">
          {onDelete && (
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              {t("delete")}
            </button>
          )}
          <div className="action-spacer" />
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !title.trim()}
          >
            {item ? t("save") : t("create")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
