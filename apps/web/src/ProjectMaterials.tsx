import type {
  ActivityEvent,
  EntityRef,
  ProjectActivity,
  ProjectMaterial,
} from "@arclattice/application";
import type { WorkItem } from "@arclattice/domain";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePicker } from "./FilePicker";

export function ProjectMaterials({
  projectId,
  materials,
  busy,
  onCreate,
  onUpload,
  onDelete,
  onDownload,
  onOpen,
}: {
  projectId: string;
  materials: ProjectMaterial[];
  busy: boolean;
  onCreate(input: {
    projectId: string;
    title: string;
    bodyMd: string;
  }): Promise<boolean>;
  onUpload(input: {
    projectId: string;
    name: string;
    mime: string;
    base64: string;
  }): Promise<boolean>;
  onDelete(material: ProjectMaterial, deleted: boolean): Promise<boolean>;
  onDownload(id: string): Promise<void>;
  onOpen(ref: EntityRef): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [title, setTitle] = useState("");
  const [bodyMd, setBody] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const entries = materials.filter(
    (entry) =>
      entry.projectId === projectId &&
      entry.kind !== "SPACE" &&
      (showDeleted || !entry.deletedAt),
  );
  return (
    <section className="panel project-summary">
      <h2>{zh ? "项目专属资料" : "Project-owned materials"}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onCreate({ projectId, title, bodyMd }).then((ok) => {
            if (ok) {
              setTitle("");
              setBody("");
            }
          });
        }}
      >
        <label>
          {zh ? "文档标题" : "Document title"}
          <input
            required
            maxLength={240}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          {zh ? "Markdown 正文" : "Markdown content"}
          <textarea
            value={bodyMd}
            maxLength={200000}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <button className="button primary" type="submit" disabled={busy}>
          {zh ? "创建专属文档" : "Create owned document"}
        </button>
      </form>
      <FilePicker
        label={zh ? "上传项目文件" : "Upload project file"}
        hint={
          zh
            ? "最大 2 MiB，保留原始文件"
            : "Up to 2 MiB; original file preserved"
        }
        accept=""
        disabled={busy || uploading}
        onFile={(file) => {
          if (!file.size || file.size > 2097152) {
            setError(
              zh
                ? "文件必须为 1 字节至 2 MiB。"
                : "Files must contain 1 byte to 2 MiB.",
            );
            return;
          }
          setError("");
          setUploading(true);
          void file
            .arrayBuffer()
            .then(async (buffer) => {
              const bytes = new Uint8Array(buffer);
              let binary = "";
              for (let offset = 0; offset < bytes.length; offset += 8192)
                binary += String.fromCharCode(
                  ...bytes.subarray(offset, offset + 8192),
                );
              await onUpload({
                projectId,
                name: file.name,
                mime: file.type || "application/octet-stream",
                base64: btoa(binary),
              });
            })
            .catch(() =>
              setError(zh ? "读取文件失败。" : "Could not read the file."),
            )
            .finally(() => setUploading(false));
        }}
      />
      {error && <p role="alert">{error}</p>}
      <label>
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(event) => setShowDeleted(event.target.checked)}
        />
        {zh ? "包含已删除资料" : "Include deleted materials"}
      </label>
      {entries.map((entry) => (
        <div className="project-material" key={entry.id}>
          <button
            type="button"
            className="text-button"
            disabled={!!entry.deletedAt}
            onClick={() => {
              if (entry.kind === "FILE") void onDownload(entry.id);
              else if (entry.targetId)
                onOpen({ kind: entry.kind, id: entry.targetId });
            }}
          >
            {entry.title}
          </button>
          <small>
            {entry.ownership === "OWNED"
              ? zh
                ? "项目拥有"
                : "Owned"
              : zh
                ? "外部引用"
                : "Linked"}
            {entry.kind === "FILE" ? ` · ${entry.size} B` : ""}
          </small>
          <button
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => void onDelete(entry, !entry.deletedAt)}
          >
            {entry.deletedAt
              ? zh
                ? "恢复"
                : "Restore"
              : zh
                ? "删除"
                : "Delete"}
          </button>
        </div>
      ))}
    </section>
  );
}

export function ProjectHistory({
  projectId,
  tasks,
  load,
  loadWork,
}: {
  projectId: string;
  tasks: WorkItem[];
  load(projectId: string): Promise<ProjectActivity[]>;
  loadWork(): Promise<ActivityEvent[]>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [events, setEvents] = useState<
    { id: string; type: string; occurredAt: string; principalId: string }[]
  >([]);
  const [error, setError] = useState(false);
  const labels: Record<string, string> = {
    MATERIAL_SAVED: zh ? "资料已保存" : "Material saved",
    MATERIAL_DELETED: zh ? "资料已删除" : "Material deleted",
    WORK_ITEM_CREATED: zh ? "工作项已创建" : "Work item created",
    WORK_ITEM_UPDATED: zh ? "工作项已更新" : "Work item updated",
    WORK_ITEM_DELETED: zh ? "工作项已删除" : "Work item deleted",
    WORK_ITEM_RESTORED: zh ? "工作项已恢复" : "Work item restored",
    WORK_EDGE_ADDED: zh ? "依赖已添加" : "Dependency added",
    WORK_EDGE_REMOVED: zh ? "依赖已移除" : "Dependency removed",
  };
  useEffect(() => {
    let active = true;
    const taskIds = new Set([projectId, ...tasks.map((task) => task.id)]);
    void Promise.all([load(projectId), loadWork()])
      .then(([materials, work]) => {
        if (active)
          setEvents(
            [
              ...materials,
              ...work.filter((entry) => taskIds.has(entry.entityId)),
            ].sort((left, right) =>
              right.occurredAt.localeCompare(left.occurredAt),
            ),
          );
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, tasks, load, loadWork]);
  return (
    <section className="panel project-summary">
      <h2>{zh ? "项目活动" : "Project activity"}</h2>
      {error && (
        <p role="alert">{zh ? "无法加载活动。" : "Could not load activity."}</p>
      )}
      {events.map((entry) => (
        <div className="project-material" key={entry.id}>
          <span>
            {labels[entry.type] ?? (zh ? "项目已更新" : "Project updated")}
          </span>
          <small>
            {entry.principalId} ·{" "}
            {new Date(entry.occurredAt).toLocaleString(i18n.language)}
          </small>
        </div>
      ))}
    </section>
  );
}

export function ProjectTimeline({
  tasks,
  onOpen,
}: {
  tasks: WorkItem[];
  onOpen(ref: EntityRef): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <section className="panel project-summary">
      <h2>{zh ? "项目时间线" : "Project timeline"}</h2>
      {[...tasks]
        .sort((left, right) =>
          (left.startDate ?? left.dueDate ?? "9999").localeCompare(
            right.startDate ?? right.dueDate ?? "9999",
          ),
        )
        .map((task) => (
          <button
            key={task.id}
            type="button"
            className="agenda-item"
            onClick={() => onOpen({ kind: "WORK", id: task.id })}
          >
            <strong>{task.title}</strong>
            <small>
              {task.startDate ?? "—"} →{" "}
              {task.dueDate ?? (zh ? "尚未排期" : "Unscheduled")}
            </small>
          </button>
        ))}
    </section>
  );
}
