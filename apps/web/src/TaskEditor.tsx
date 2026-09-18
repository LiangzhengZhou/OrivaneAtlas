import {
  type ActivationPolicy,
  type ActivationState,
  activationPolicies,
  type Priority,
  priorities,
  type WorkItem,
} from "@arclattice/domain";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "./Markdown";

interface Props {
  item: WorkItem | null;
  projects: WorkItem[];
  createType: "TASK" | "PROJECT";
  initialProjectId?: string;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSave(input: {
    title: string;
    descriptionMd: string;
    priority: Priority;
    projectId: string | null;
    projectIds?: readonly string[];
    startDate: string | null;
    dueDate: string | null;
    activationState: ActivationState;
    activationPolicy: ActivationPolicy;
  }): Promise<void>;
  onDelete: (() => Promise<void>) | null;
}
export function TaskEditor({
  item,
  projects,
  createType,
  initialProjectId = "",
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation(["common", "work"]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [discard, setDiscard] = useState(false);
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState(item?.title ?? "");
  const [projectId, setProjectId] = useState(
    item?.projectId ?? initialProjectId,
  );
  const [extraProjects, setExtraProjects] = useState<string[]>([
    ...(item?.projectIds ?? []).slice(1),
  ]);
  const [activationState, setActivationState] = useState<ActivationState>(
    item?.activationState ?? "ACTIVE",
  );
  const [activationPolicy, setActivationPolicy] = useState<ActivationPolicy>(
    item?.activationPolicy ?? "MANUAL",
  );
  const [startDate, setStartDate] = useState(item?.startDate ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [descriptionMd, setDescription] = useState(item?.descriptionMd ?? "");
  const [priority, setPriority] = useState<Priority>(
    item?.priority ?? "MEDIUM",
  );
  const dirty =
    title !== (item?.title ?? "") ||
    descriptionMd !== (item?.descriptionMd ?? "") ||
    priority !== (item?.priority ?? "MEDIUM") ||
    projectId !== (item?.projectId ?? initialProjectId) ||
    JSON.stringify(extraProjects) !==
      JSON.stringify((item?.projectIds ?? []).slice(1)) ||
    activationState !== (item?.activationState ?? "ACTIVE") ||
    activationPolicy !== (item?.activationPolicy ?? "MANUAL") ||
    startDate !== (item?.startDate ?? "") ||
    dueDate !== (item?.dueDate ?? "");
  function close() {
    if (dirty) setDiscard(true);
    else onClose();
  }
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
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="task-dialog"
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
              descriptionMd,
              priority,
              projectId: projectId || null,
              ...((item?.type ?? createType) === "TASK"
                ? {
                    projectIds: [
                      ...(projectId ? [projectId] : []),
                      ...extraProjects.filter((id) => id !== projectId),
                    ],
                    projectId: projectId || extraProjects[0] || null,
                  }
                : {}),
              startDate: startDate || null,
              dueDate: dueDate || null,
              activationState:
                activationPolicy === "MANUAL" && activationState === "SCHEDULED"
                  ? "INACTIVE"
                  : activationState,
              activationPolicy,
            });
        }}
      >
        <div className="dialog-heading">
          <h2 id="editor-heading">
            {item
              ? t("work:detail")
              : createType === "PROJECT"
                ? t("desk:newProject")
                : t("create")}
          </h2>
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
            <button className="button danger" type="button" onClick={onClose}>
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
        {
          <label className="field">
            <span>
              {t(
                (item?.type ?? createType) === "PROJECT"
                  ? "desk:parentProject"
                  : "desk:project",
              )}
            </span>
            <select
              aria-label={t(
                (item?.type ?? createType) === "PROJECT"
                  ? "desk:parentProject"
                  : "desk:project",
              )}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{t("desk:noProject")}</option>
              {projects
                .filter((project) => project.id !== item?.id)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
            </select>
          </label>
        }
        {(item?.type ?? createType) === "TASK" && (
          <fieldset className="field project-memberships">
            <legend>{t("desk:additionalProjects")}</legend>
            {projects
              .filter((p) => p.id !== projectId)
              .map((p) => (
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
              onClick={() => setPreview(false)}
            >
              {t("desk:write")}
            </button>
            <button
              className={preview ? "chip active" : "chip"}
              type="button"
              onClick={() => setPreview(true)}
            >
              {t("desk:read")}
            </button>
          </div>
          {preview ? (
            <Markdown text={descriptionMd} />
          ) : (
            <textarea
              aria-label={t("work:description")}
              rows={7}
              maxLength={200000}
              value={descriptionMd}
              placeholder={t("work:descriptionPlaceholder")}
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
