import {
  eligibleProjectParents,
  type ProjectLifecycle,
  projectCompletion,
  projectLifecycle,
  projectLifecycles,
} from "@arclattice/domain";
import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EditorActionsMenu,
  EditorShell,
} from "./components/ui/InteractionSurfaces";
import "./features/tasks/task-editor.css";
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
  memo,
  intent = "EDIT",
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
  const { t, i18n } = useTranslation(["common", "desk", "work"]);
  const formId = useId();
  const lifecycleOnly = intent === "LIFECYCLE" && !!item;
  const pendingChange = useRef<(() => void) | null>(null);
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
    (completion.unfinished > 0 ||
      completion.unfinishedProjects > 0 ||
      completion.unfinishedMilestones > 0);
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
  const close = () => {
    pendingChange.current = null;
    if (dirty) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    const change = (event: Event) => {
      if (!dirty) return;
      event.preventDefault();
      if (!busy) {
        pendingChange.current = (event as CustomEvent<() => void>).detail;
        setDiscard(true);
      }
    };
    window.addEventListener("atlas:task-detail-change", change);
    return () => window.removeEventListener("atlas:task-detail-change", change);
  }, [dirty, busy]);
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
    <EditorShell
      className="work-editor-surface project-editor-surface project-settings-dialog"
      pending={busy}
      title={
        lifecycleOnly
          ? t("desk:changeProjectLifecycle")
          : t(item ? "desk:projectSettings" : "desk:newProject")
      }
      onClose={close}
      actions={
        lifecycleOnly ? undefined : (
          <EditorActionsMenu pending={busy} onDelete={onDelete} />
        )
      }
      footer={
        <>
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
            form={formId}
            disabled={
              busy ||
              !title.trim() ||
              (!lifecycleOnly && invalidParent) ||
              blocked
            }
          >
            {item ? t("save") : t("desk:createProject")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && (lifecycleOnly || !invalidParent) && !blocked)
            void onSave({
              ...(lifecycleOnly
                ? { title: item!.title }
                : {
                    title,
                    categoryId: categoryId || null,
                    parentProjectId: parent || null,
                    startDate: start || null,
                    dueDate: due || null,
                  }),
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
            });
        }}
      >
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {discard && (
          <div className="error">
            {t("desk:discardHint")}
            <Button
              type="button"
              variant="danger"
              onClick={() =>
                pendingChange.current ? pendingChange.current() : onClose()
              }
            >
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
        {!lifecycleOnly && (
          <>
            {" "}
            <label className="field">
              <span>{t("work:title")}</span>
              <input
                required
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {invalidParent && (
              <p role="alert">{t("desk:invalidProjectParent")}</p>
            )}
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
              label={t("desk:parentProject")}
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
          </>
        )}
        {lifecycleOnly && (
          <>
            {" "}
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
                {completion.unfinishedMilestones > 0 &&
                  ` · ${i18n.language.startsWith("zh") ? "未完成里程碑" : "Unfinished milestones"}: ${completion.unfinishedMilestones}`}
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
                  <option value="">
                    {t("desk:completionResolution.choose")}
                  </option>
                  {(["KEEP", "CANCEL", "INBOX", "MOVE"] as const).map(
                    (action) => (
                      <option key={action} value={action}>
                        {t("desk:completionResolution." + action)}
                      </option>
                    ),
                  )}
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
          </>
        )}
        {memo}
      </form>
    </EditorShell>
  );
}
