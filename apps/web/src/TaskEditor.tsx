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
import { DismissibleDialog } from "./app/DismissibleDialog";
import { DateField } from "./components/DateField";
import { RepeatFields, type RepeatRule } from "./components/RepeatFields";
import { Button } from "./components/ui/Button";
import { Select } from "./components/ui/Surfaces";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import { TaskEntityPicker } from "./features/tasks/TaskEntityPicker";
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
  workflows = [],
  calendarTimezone = "UTC",
  onSaveRepeat,
}: WorkEditorProps) {
  const { t, i18n } = useTranslation(["common", "work"]);
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
  const occurrence = workflows.find(
    (r) =>
      !r.deletedAt &&
      r.payload.kind === "OCCURRENCE" &&
      r.payload.taskId === item?.id,
  );
  const definition =
    occurrence?.payload.kind === "OCCURRENCE"
      ? workflows.find(
          (r) =>
            r.id ===
              (occurrence.payload.kind === "OCCURRENCE"
                ? occurrence.payload.definitionId
                : "") &&
            !r.deletedAt &&
            r.payload.kind === "RECURRENCE",
        )
      : null;
  const [seriesEditing, setSeriesEditing] = useState(false);
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const seriesRule =
    seriesEditing && definition?.payload.kind === "RECURRENCE"
      ? definition.payload
      : null;
  const dirty =
    (seriesEditing
      ? JSON.stringify(repeat) !== JSON.stringify(definition?.payload)
      : repeat !== null) ||
    status !== (item?.status ?? "TODO") ||
    title !==
      (seriesEditing && definition?.payload.kind === "RECURRENCE"
        ? definition.payload.title
        : (item?.title ?? "")) ||
    descriptionMd !==
      (seriesEditing && definition?.payload.kind === "RECURRENCE"
        ? definition.payload.descriptionMd
        : (item?.descriptionMd ?? "")) ||
    priority !== (seriesRule?.priority ?? item?.priority ?? "MEDIUM") ||
    projectId !== (item ? (item.parentProjectId ?? "") : initialProjectId) ||
    JSON.stringify(extraProjects) !==
      JSON.stringify(
        item?.projectIds ?? (initialProjectId ? [initialProjectId] : []),
      ) ||
    activationState !==
      (seriesRule?.activationState ?? item?.activationState ?? "ACTIVE") ||
    activationPolicy !==
      (seriesRule?.activationPolicy ?? item?.activationPolicy ?? "MANUAL") ||
    startDate !== (item?.startDate ?? "") ||
    dueDate !== (item?.dueDate ?? "") ||
    JSON.stringify([...prerequisiteIds].sort()) !==
      JSON.stringify(initialPrerequisites);
  function changeEditScope(action: () => void) {
    if (dirty) {
      pendingChange.current = () => {
        pendingChange.current = null;
        setDiscard(false);
        action();
      };
      setDiscard(true);
    } else action();
  }
  function close() {
    pendingChange.current = null;
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
  return (
    <DismissibleDialog
      modal={window.matchMedia("(max-width: 767px)").matches}
      className="task-dialog task-inspector"
      aria-labelledby="editor-heading"
      onRequestClose={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy)
            void (async () => {
              const draft = {
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
                  activationPolicy === "MANUAL" &&
                  activationState === "SCHEDULED"
                    ? "INACTIVE"
                    : activationState,
                activationPolicy,
              };
              if ((repeat || seriesEditing) && onSaveRepeat) {
                const rule =
                  repeat ??
                  (definition?.payload.kind === "RECURRENCE"
                    ? definition.payload
                    : null);
                if (!rule) return;
                await onSaveRepeat({
                  ...(item
                    ? { task: { id: item.id, version: item.version } }
                    : {}),
                  draft,
                  recurrence: {
                    ...(definition ? { id: definition.id } : {}),
                    version: definition?.version ?? 0,
                    deleted: false,
                    rule: {
                      state: rule.state ?? "ACTIVE",
                      closePolicy: rule.closePolicy ?? "END_OF_DAY",
                      closeIncomplete: rule.closeIncomplete ?? true,
                      durationValue: rule.durationValue ?? null,
                      durationUnit: rule.durationUnit ?? null,
                      startDate: rule.startDate,
                      endDate: rule.endDate ?? null,
                      timezone: rule.timezone,
                      frequency: rule.frequency,
                      interval: rule.interval,
                      assigneePrincipalId: rule.assigneePrincipalId ?? null,
                      title,
                      descriptionMd,
                      projectIds: extraProjects,
                      priority,
                      activationState,
                      activationPolicy,
                    },
                  },
                });
              } else await onSave(draft);
            })();
        }}
      >
        <div className="dialog-heading">
          <h2 id="editor-heading">{item ? t("work:detail") : t("create")}</h2>
          <Button
            type="button"
            className="icon-button"
            aria-label={t("close")}
            disabled={busy}
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {discard && (
          <div className="error">
            {t("desk:discardHint")}
            <Button
              className="button danger"
              type="button"
              onClick={() =>
                pendingChange.current ? pendingChange.current() : onClose()
              }
            >
              {t("desk:discard")}
            </Button>
            <Button
              className="button secondary"
              type="button"
              onClick={() => setDiscard(false)}
            >
              {t("cancel")}
            </Button>
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
            <Select
              aria-label={t("work:status")}
              value={status}
              onChange={(event) => setStatus(event.target.value as WorkStatus)}
            >
              {workStatuses.map((value) => (
                <option key={value} value={value}>
                  {t("work:statuses." + value)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {
          <label className="field">
            <span>{t("work:priority")}</span>
            <Select
              aria-label={t("work:priority")}
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {priorities.map((value) => (
                <option key={value} value={value}>
                  {t(`work:priorities.${value}`)}
                </option>
              ))}
            </Select>
          </label>
        }
        {(item?.type ?? createType) === "TASK" && (
          <fieldset className="field project-memberships">
            <legend>{t("desk:projects")}</legend>
            <ProjectDrilldownPicker
              mode="multiple"
              projects={projects}
              values={extraProjects}
              disabled={busy}
              onChange={(value) =>
                setExtraProjects(Array.isArray(value) ? value : [])
              }
            />
          </fieldset>
        )}
        <details className="task-advanced">
          <summary>{t("desk:advanced")}</summary>
          {(item?.type ?? createType) === "TASK" &&
            onSaveRepeat &&
            (occurrence ? (
              <div className="occurrence-edit-scope">
                <p>
                  {i18n.language.startsWith("zh")
                    ? "此任务属于一个周期任务"
                    : "This task belongs to a recurring series"}
                </p>
                <Button
                  type="button"
                  className={!seriesEditing ? "chip active" : "chip"}
                  onClick={() => {
                    if (!seriesEditing) return;
                    changeEditScope(() => {
                      setSeriesEditing(false);
                      setRepeat(null);
                      setTitle(item?.title ?? "");
                      setDescription(item?.descriptionMd ?? "");
                      setPriority(item?.priority ?? "MEDIUM");
                      setExtraProjects([...(item?.projectIds ?? [])]);
                      setActivationState(item?.activationState ?? "ACTIVE");
                      setActivationPolicy(item?.activationPolicy ?? "MANUAL");
                    });
                  }}
                >
                  {i18n.language.startsWith("zh")
                    ? "编辑本次"
                    : "Edit this occurrence"}
                </Button>
                <Button
                  type="button"
                  className={seriesEditing ? "chip active" : "chip"}
                  disabled={!definition}
                  onClick={() => {
                    if (seriesEditing) return;
                    if (definition?.payload.kind === "RECURRENCE") {
                      const series = definition.payload;
                      changeEditScope(() => {
                        setSeriesEditing(true);
                        setRepeat(series);
                        setTitle(series.title);
                        setDescription(series.descriptionMd);
                        setPriority(series.priority ?? "MEDIUM");
                        setExtraProjects([...(series.projectIds ?? [])]);
                        setActivationState(series.activationState ?? "ACTIVE");
                        setActivationPolicy(
                          series.activationPolicy ?? "MANUAL",
                        );
                      });
                    }
                  }}
                >
                  {i18n.language.startsWith("zh")
                    ? "编辑整个系列"
                    : "Edit entire series"}
                </Button>
                {seriesEditing && (
                  <RepeatFields
                    rule={repeat}
                    onChange={(next) => {
                      if (next) setRepeat(next);
                    }}
                  />
                )}
              </div>
            ) : (
              <>
                <RepeatFields
                  rule={repeat}
                  onChange={(next) =>
                    setRepeat(
                      next
                        ? repeat
                          ? next
                          : {
                              ...next,
                              timezone: calendarTimezone,
                              startDate: startDate || today || next.startDate,
                            }
                        : null,
                    )
                  }
                />
                {repeat && item && (
                  <p>
                    {i18n.language.startsWith("zh")
                      ? "将此任务设为重复任务：当前任务会作为首次任务保留。"
                      : "Convert this task to a recurring series, keeping it as the first occurrence."}
                  </p>
                )}
              </>
            ))}
          {
            <label className="field">
              <span>{t("desk:activationPolicy")}</span>
              <Select
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
              </Select>
            </label>
          }
          {(item?.type ?? createType) === "TASK" && (
            <fieldset className="field">
              <legend>{t("work:prerequisites")}</legend>
              <p className="muted">
                {t("work:availability")}:{" "}
                {t(`work:${previewAvailability.toLowerCase()}`)}
              </p>
              <TaskEntityPicker
                items={items}
                values={prerequisiteIds}
                excludedId={item?.id}
                disabled={busy}
                onChange={setPrerequisiteIds}
              />
            </fieldset>
          )}
          {activationPolicy === "MANUAL" && (
            <label className="field">
              <span>{t("desk:activationState")}</span>
              <Select
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
              </Select>
            </label>
          )}
          {activationPolicy === "AT_SCHEDULED_TIME" && (
            <p className="muted">{t("desk:scheduledHint")}</p>
          )}
        </details>
        <div className="schedule-fields">
          <label className="field">
            <span>{t("desk:startDate")}</span>
            <DateField
              aria-label={t("desk:startDate")}
              min="0001-01-01"
              required={activationPolicy === "AT_SCHEDULED_TIME"}
              max={dueDate || "9999-12-31"}
              value={startDate}
              onChange={setStartDate}
            />
          </label>
          <label className="field">
            <span>{t("desk:dueDate")}</span>
            <DateField
              aria-label={t("desk:dueDate")}
              min={startDate || "0001-01-01"}
              max="9999-12-31"
              value={dueDate}
              onChange={setDueDate}
            />
          </label>
        </div>
        <label className="field">
          <span>{t("work:description")}</span>
          <div className="editor-toolbar">
            <Button
              className={!preview ? "chip active" : "chip"}
              type="button"
              onClick={() => {
                setPreview(false);
              }}
            >
              {t("desk:write")}
            </Button>
            <Button
              className={preview ? "chip active" : "chip"}
              type="button"
              onClick={() => {
                setPreview(true);
              }}
            >
              {i18n.language === "zh-CN" ? "预览" : "Preview"}
            </Button>
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
          <details className="task-metadata">
            <summary>{t("desk:advanced")}</summary>
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
          </details>
        )}
        <div className="dialog-actions">
          {onDelete && (
            <Button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              {t("delete")}
            </Button>
          )}
          <div className="action-spacer" />
          <Button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            className="button primary"
            disabled={busy || !title.trim()}
          >
            {item ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </DismissibleDialog>
  );
}
