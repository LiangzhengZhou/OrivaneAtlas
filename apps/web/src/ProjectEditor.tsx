import {
  eligibleProjectParents,
  type ProjectLifecycle,
  projectAncestors,
  projectCompletion,
  projectLifecycle,
  projectLifecycles,
} from "@arclattice/domain";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProjectParentTree } from "./ProjectParentTree";
import type { WorkEditorProps } from "./WorkItemEditor";

export function ProjectEditor({
  item,
  projects,
  items = [],
  initialProjectId = "",
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: WorkEditorProps) {
  const { t } = useTranslation(["common", "desk", "work"]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(item?.title ?? "");
  const [parent, setParent] = useState(item?.projectId ?? initialProjectId);
  const [start, setStart] = useState(item?.startDate ?? "");
  const [due, setDue] = useState(item?.dueDate ?? "");
  const [lifecycle, setLifecycle] = useState<ProjectLifecycle>(
    item ? projectLifecycle(item) : "PLANNED",
  );
  const [reopen, setReopen] = useState(false);
  const selectedParent = projects.find((p) => p.id === parent);
  const requiresReopen =
    selectedParent?.status === "DONE" &&
    (!item ||
      (parent !== item.projectId &&
        !["COMPLETED", "CANCELED"].includes(lifecycle)));
  const completion = item ? projectCompletion(item, items) : null;
  const incomplete =
    lifecycle === "COMPLETED" &&
    item?.status !== "DONE" &&
    !!completion &&
    (completion.unfinished > 0 || completion.unfinishedProjects > 0);
  const blocked = incomplete || (requiresReopen && (!!item || !reopen));
  const [discard, setDiscard] = useState(false);
  const dirty =
    (item && lifecycle !== projectLifecycle(item)) ||
    reopen ||
    title !== (item?.title ?? "") ||
    parent !== (item?.projectId ?? initialProjectId) ||
    start !== (item?.startDate ?? "") ||
    due !== (item?.dueDate ?? "");
  const close = () => (dirty ? setDiscard(true) : onClose());
  const candidates = eligibleProjectParents(item, projects);
  const invalidParent = !!parent && !candidates.some((p) => p.id === parent);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  return (
    <dialog
      ref={dialog}
      className="task-dialog project-settings-dialog"
      aria-labelledby="project-editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !invalidParent && !blocked)
            void onSave({
              title,
              ...(item && lifecycle !== projectLifecycle(item)
                ? { projectLifecycle: lifecycle }
                : {}),
              ...(!item && requiresReopen && reopen
                ? { reopenProjectVersion: selectedParent!.version }
                : {}),
              projectId: parent || null,
              startDate: start || null,
              dueDate: due || null,
            });
        }}
      >
        <div className="dialog-heading">
          <h2 id="project-editor-heading">
            {t(item ? "desk:projectSettings" : "desk:newProject")}
          </h2>
          <button
            type="button"
            className="chip"
            disabled={busy}
            onClick={close}
          >
            {t("close")}
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {discard && (
          <div className="error">
            {t("desk:discardHint")}
            <button type="button" className="button danger" onClick={onClose}>
              {t("desk:discard")}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setDiscard(false)}
            >
              {t("cancel")}
            </button>
          </div>
        )}
        <label className="field">
          <span>{t("work:title")}</span>
          <input
            required
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("desk:parentProject")}</span>
          <select
            aria-label={t("desk:parentProject")}
            value={parent}
            onChange={(event) => {
              setParent(event.target.value);
              setReopen(false);
            }}
          >
            <option value="">{t("desk:noProject")}</option>
            {invalidParent && (
              <option value={parent} disabled>
                {t("desk:invalidProjectParent")}
              </option>
            )}
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {[...projectAncestors(p, projects).reverse(), p]
                  .map((node) => node.title)
                  .join(" / ")}
              </option>
            ))}
          </select>
        </label>
        {invalidParent && <p role="alert">{t("desk:invalidProjectParent")}</p>}
        <ProjectParentTree
          projects={projects}
          candidates={candidates}
          value={parent}
          disabled={busy}
          onChange={(value) => {
            setParent(value);
            setReopen(false);
          }}
        />
        {item && (
          <label className="field">
            <span>{t("desk:projectLifecycle")}</span>
            <select
              aria-label={t("desk:projectLifecycle")}
              value={lifecycle}
              onChange={(event) =>
                setLifecycle(event.target.value as ProjectLifecycle)
              }
            >
              {projectLifecycles.map((value) => (
                <option key={value} value={value}>
                  {t("desk:projectLifecycles." + value)}
                </option>
              ))}
            </select>
          </label>
        )}
        {completion && (
          <p>
            {t("desk:projectProgress", completion)} ·{" "}
            {t("desk:unfinishedSubprojects", {
              count: completion.unfinishedProjects,
            })}
          </p>
        )}
        {item && <p className="muted">{t("desk:projectCompletionHint")}</p>}
        {incomplete && (
          <p role="alert">{t("errors:PROJECT_HAS_UNFINISHED_WORK")}</p>
        )}
        {requiresReopen && <p>{t("desk:completedProjectHint")}</p>}
        {!item && requiresReopen && (
          <label className="reopen-project-consent">
            <input
              type="checkbox"
              checked={reopen}
              onChange={(event) => setReopen(event.target.checked)}
            />
            {t("desk:reopenConsent")}
          </label>
        )}
        <div className="schedule-fields">
          <label className="field">
            <span>{t("desk:startDate")}</span>
            <input
              type="date"
              min="0001-01-01"
              max={due || "9999-12-31"}
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("desk:dueDate")}</span>
            <input
              type="date"
              min={start || "0001-01-01"}
              max="9999-12-31"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </label>
        </div>
        <p className="muted">{t("desk:projectBriefSeparate")}</p>
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
            className="button primary"
            disabled={busy || !title.trim() || invalidParent || blocked}
          >
            {t(
              !item && requiresReopen && reopen
                ? "desk:reopenAndCreate"
                : item
                  ? "save"
                  : "create",
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}
