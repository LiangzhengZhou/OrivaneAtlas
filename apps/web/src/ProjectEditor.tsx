import {
  eligibleProjectParents,
  type ProjectLifecycle,
  projectCompletion,
  projectLifecycle,
  projectLifecycles,
} from "@arclattice/domain";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "./app/DismissibleDialog";
import { DateField } from "./components/DateField";
import { Button } from "./components/ui/Button";
import { Select } from "./components/ui/Surfaces";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import {
  buildWorkspaceWorkIndex,
  WorkspaceWorkIndexContext,
} from "./features/tasks/workspace-work-index";
import type { WorkEditorProps } from "./WorkItemEditor";

export function ProjectEditor({
  item,
  projects,
  categories = [],
  items = [],
  initialProjectId = "",
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: WorkEditorProps) {
  const { t } = useTranslation(["common", "desk", "work"]);
  const sharedWorkIndex = useContext(WorkspaceWorkIndexContext);
  const workIndex = useMemo(
    () => sharedWorkIndex ?? buildWorkspaceWorkIndex(projects, []),
    [sharedWorkIndex, projects],
  );
  const excludedDestinations = useMemo(
    () =>
      new Set(
        projects
          .filter(
            (project) =>
              project.id === item?.id ||
              workIndex.ancestorIdsByProjectId
                .get(project.id)
                ?.includes(item?.id ?? ""),
          )
          .map((project) => project.id),
      ),
    [projects, workIndex, item?.id],
  );
  const [title, setTitle] = useState(item?.title ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "");
  const [parent, setParent] = useState(
    item?.parentProjectId ?? initialProjectId,
  );
  const [start, setStart] = useState(item?.startDate ?? "");
  const [due, setDue] = useState(item?.dueDate ?? "");
  const [lifecycle, setLifecycle] = useState<ProjectLifecycle>(
    item ? projectLifecycle(item) : "PLANNED",
  );
  const [resolution, setResolution] = useState<
    "KEEP" | "CANCEL" | "INBOX" | "MOVE" | ""
  >("");
  const [destination, setDestination] = useState("");
  const completion = item ? projectCompletion(item, items) : null;
  const incomplete =
    lifecycle === "COMPLETED" &&
    item?.lifecycle !== "COMPLETED" &&
    !!completion &&
    (completion.unfinished > 0 || completion.unfinishedProjects > 0);
  const blocked =
    incomplete && (!resolution || (resolution === "MOVE" && !destination));
  const [discard, setDiscard] = useState(false);
  const dirty =
    categoryId !== (item?.categoryId ?? "") ||
    (item && lifecycle !== projectLifecycle(item)) ||
    title !== (item?.title ?? "") ||
    parent !== (item?.parentProjectId ?? initialProjectId) ||
    start !== (item?.startDate ?? "") ||
    due !== (item?.dueDate ?? "");
  const close = () => (dirty ? setDiscard(true) : onClose());
  const candidates = eligibleProjectParents(item, projects);
  const invalidParent = !!parent && !candidates.some((p) => p.id === parent);
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
    <DismissibleDialog
      className="task-dialog project-settings-dialog"
      aria-labelledby="project-editor-heading"
      onRequestClose={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !invalidParent && !blocked)
            void onSave({
              title,
              categoryId: categoryId || null,
              ...(!item ? { lifecycle } : {}),
              ...(item && lifecycle !== projectLifecycle(item)
                ? { projectLifecycle: lifecycle }
                : {}),
              ...(incomplete && resolution
                ? {
                    completionResolution: {
                      action: resolution,
                      ...(destination ? { projectId: destination } : {}),
                    },
                  }
                : {}),
              parentProjectId: parent || null,
              startDate: start || null,
              dueDate: due || null,
            });
        }}
      >
        <div className="dialog-heading">
          <h2 id="project-editor-heading">
            {t(item ? "desk:projectSettings" : "desk:newProject")}
          </h2>
          <Button
            type="button"
            variant="toggle"
            disabled={busy}
            onClick={close}
          >
            {t("close")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {discard && (
          <div className="error">
            {t("desk:discardHint")}
            <Button type="button" variant="danger" onClick={onClose}>
              {t("desk:discard")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDiscard(false)}
            >
              {t("cancel")}
            </Button>
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
          <output
            className="parent-selection"
            aria-label={t("desk:parentProject")}
          >
            {parent
              ? projects.find((project) => project.id === parent)?.title
              : t("desk:noProject")}
          </output>
        </label>
        {invalidParent && <p role="alert">{t("desk:invalidProjectParent")}</p>}
        {!parent && (
          <label className="field">
            <span>{t("desk:categories.filter")}</span>
            <Select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">{t("desk:noProject")}</option>
              {categories
                .filter((category) => !category.deletedAt)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </Select>
          </label>
        )}
        <ProjectDrilldownPicker
          mode="single"
          projects={projects}
          disabledIds={
            new Set(
              projects
                .filter(
                  (project) =>
                    !candidates.some(
                      (candidate) => candidate.id === project.id,
                    ),
                )
                .map((project) => project.id),
            )
          }
          value={parent}
          disabled={busy}
          onChange={(value) => {
            setParent(typeof value === "string" ? value : "");
          }}
        />
        {item && (
          <label className="field">
            <span>{t("desk:projectLifecycle")}</span>
            <Select
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
            </Select>
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
          <fieldset className="field">
            <legend>{t("desk:completionResolution.title")}</legend>
            <Select
              value={resolution}
              onChange={(event) =>
                setResolution(event.target.value as typeof resolution)
              }
            >
              <option value="">{t("desk:completionResolution.choose")}</option>
              {(["KEEP", "CANCEL", "INBOX", "MOVE"] as const).map((action) => (
                <option key={action} value={action}>
                  {t("desk:completionResolution." + action)}
                </option>
              ))}
            </Select>
            {resolution === "MOVE" && (
              <ProjectDrilldownPicker
                projects={projects}
                value={destination || null}
                mode="single"
                disabledIds={excludedDestinations}
                onChange={(value) =>
                  setDestination(typeof value === "string" ? value : "")
                }
              />
            )}
          </fieldset>
        )}
        <div className="schedule-fields">
          <label className="field">
            <span>{t("desk:startDate")}</span>
            <DateField
              aria-label={t("desk:startDate")}
              min="0001-01-01"
              max={due || "9999-12-31"}
              value={start}
              onChange={setStart}
            />
          </label>
          <label className="field">
            <span>{t("desk:dueDate")}</span>
            <DateField
              aria-label={t("desk:dueDate")}
              min={start || "0001-01-01"}
              max="9999-12-31"
              value={due}
              onChange={setDue}
            />
          </label>
        </div>
        <p className="muted">{t("desk:projectBriefSeparate")}</p>
        <div className="dialog-actions">
          {onDelete && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              {t("delete")}
            </Button>
          )}
          <div className="action-spacer" />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={close}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !title.trim() || invalidParent || blocked}
          >
            {item ? t("save") : t("desk:createProject")}
          </Button>
        </div>
      </form>
    </DismissibleDialog>
  );
}
