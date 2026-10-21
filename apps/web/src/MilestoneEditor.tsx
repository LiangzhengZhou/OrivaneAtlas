import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "./components/DateField";
import { Button } from "./components/ui/Button";
import { confirmAction } from "./components/ui/ConfirmationHost";
import {
  EditorActionsMenu,
  EditorShell,
} from "./components/ui/InteractionSurfaces";
import { ProjectDrilldownPicker } from "./features/projects/ProjectDrilldownPicker";
import type { WorkEditorProps } from "./WorkItemEditor";

/** Milestones express an outcome and target date, not task activation or recurrence. */
export function MilestoneEditor({
  memo,
  item,
  initialProjectId,
  projects,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: WorkEditorProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh"),
    id = useId();
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.descriptionMd ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [projectId, setProjectId] = useState(
    item?.parentProjectId ?? initialProjectId ?? "",
  );
  const [reached, setReached] = useState(item?.status === "DONE");
  const dirty =
    title !== (item?.title ?? "") ||
    description !== (item?.descriptionMd ?? "") ||
    dueDate !== (item?.dueDate ?? "") ||
    projectId !== (item?.parentProjectId ?? initialProjectId ?? "") ||
    reached !== (item?.status === "DONE");
  async function close() {
    if (busy) return;
    if (
      dirty &&
      !(await confirmAction(
        zh ? "放弃未保存的里程碑修改？" : "Discard unsaved milestone changes?",
      ))
    )
      return;
    onClose();
  }
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  return (
    <EditorShell
      modal
      className="work-editor-surface milestone-editor-surface"
      title={
        zh
          ? item
            ? "里程碑"
            : "新建里程碑"
          : item
            ? "Milestone"
            : "New milestone"
      }
      pending={busy}
      onClose={() => void close()}
      actions={<EditorActionsMenu pending={busy} onDelete={onDelete} />}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void close()}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={id}
            pending={busy}
            disabled={!title.trim()}
          >
            {zh ? (item ? "保存" : "创建") : item ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && title.trim())
            void onSave({
              title,
              descriptionMd: description,
              dueDate: dueDate || null,
              parentProjectId: projectId || null,
              ...(item
                ? {
                    status:
                      reached === (item.status === "DONE")
                        ? item.status
                        : reached
                          ? "DONE"
                          : "TODO",
                  }
                : {}),
            });
        }}
      >
        <label className="field">
          {zh ? "里程碑名称" : "Milestone name"}
          <input
            autoFocus
            disabled={busy}
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          {zh ? "成果与达成标准" : "Outcome and success criteria"}
          <textarea
            disabled={busy}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="field">
          {zh ? "目标日期" : "Target date"}
          <DateField
            aria-label={zh ? "目标日期" : "Target date"}
            value={dueDate}
            onChange={setDueDate}
            disabled={busy}
          />
        </label>
        <ProjectDrilldownPicker
          kind="PROJECT"
          mode="single"
          projects={projects}
          value={projectId || null}
          disabled={busy}
          onChange={(value) =>
            setProjectId(typeof value === "string" ? value : "")
          }
        />
        {item && (
          <label className="field">
            <input
              type="checkbox"
              disabled={busy}
              checked={reached}
              onChange={(event) => setReached(event.target.checked)}
            />
            {zh ? "已达成" : "Reached"}
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {memo}
      </form>
    </EditorShell>
  );
}
