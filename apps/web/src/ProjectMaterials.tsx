import type {
  ActivityEvent,
  EntityRef,
  ProjectActivity,
  ProjectMaterial,
} from "@arclattice/application";
import {
  type LibraryFile,
  type WorkEdge,
  type WorkItem,
} from "@arclattice/domain";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/Button";
import { EntityMenu } from "./components/ui/EntityMenu";
import { FilePicker } from "./FilePicker";
import { ProjectFileRow } from "./features/files/ProjectFileRow";
import { VirtualTaskCollection } from "./features/tasks/VirtualTaskCollection";
import { buildWorkspaceWorkIndex } from "./features/tasks/workspace-work-index";

export function ProjectMaterials({
  projectId,
  library,
  onCreateSpace,
  onLinkSpace,
  scopeIds,
  projects,
  materials,
  inheritedSpaces = [],
  busy,
  onNewPage,
  onUpload,
  files,
  onFileDelete,
  onFileDownload,
  onDelete,
  onDownload,
  onLegacyOpen,
  onOpen,
}: {
  library: {
    id: string;
    kind: string;
    title: string;
    deletedAt: string | null;
  }[];
  onCreateSpace(input: {
    projectId: string;
    title: string;
    inheritToChildren: boolean;
  }): Promise<boolean>;
  onLinkSpace(input: {
    projectId: string;
    spaceId: string;
    inheritToChildren: boolean;
  }): Promise<boolean>;
  projectId: string;
  scopeIds?: ReadonlySet<string>;
  projects?: WorkItem[];
  materials: ProjectMaterial[];
  inheritedSpaces?: ProjectMaterial[];
  busy: boolean;
  onNewPage(spaceId: string): void;
  files: readonly LibraryFile[];
  onFileDelete(file: LibraryFile, deleted: boolean): Promise<boolean>;
  onFileDownload(file: LibraryFile): Promise<void>;
  onUpload(file: File): Promise<boolean>;
  onDelete(material: ProjectMaterial, deleted: boolean): Promise<boolean>;
  onDownload(id: string): Promise<void>;
  onLegacyOpen(id: string): Promise<void>;
  onOpen(ref: EntityRef): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [spaceTitle, setSpaceTitle] = useState("");
  const [spaceQuery, setSpaceQuery] = useState("");
  const [selectedSpace, setSelectedSpace] = useState("");
  const [choosingPageSpace, setChoosingPageSpace] = useState(false);
  const spaces = materials.filter(
    (entry) =>
      entry.projectId === projectId &&
      entry.kind === "SPACE" &&
      !entry.deletedAt,
  );
  const entries = materials.filter(
    (entry) =>
      (scopeIds
        ? scopeIds.has(entry.projectId)
        : entry.projectId === projectId) &&
      (showDeleted || !entry.deletedAt),
  );
  return (
    <section className="project-summary project-knowledge-list">
      <h2>{zh ? "项目知识" : "Knowledge"}</h2>
      {!spaces.length && (
        <p>{zh ? "尚无项目知识" : "No project knowledge yet"}</p>
      )}
      <details open={spaces.length === 0}>
        <summary>{zh ? "新建知识空间" : "New knowledge space"}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onCreateSpace({
              projectId,
              title: spaceTitle,
              inheritToChildren: true,
            }).then((ok) => {
              if (ok) setSpaceTitle("");
            });
          }}
        >
          <input
            aria-label={zh ? "知识空间名称" : "Wiki space title"}
            required
            value={spaceTitle}
            onChange={(event) => setSpaceTitle(event.target.value)}
          />
          <Button variant="secondary" type="submit" disabled={busy}>
            {zh ? "创建 Wiki" : "Create Wiki"}
          </Button>
        </form>
      </details>
      <details>
        <summary>{zh ? "链接现有空间" : "Link existing space"}</summary>
        <input
          aria-label={zh ? "搜索空间" : "Search spaces"}
          value={spaceQuery}
          onChange={(event) => setSpaceQuery(event.target.value)}
        />
        {library
          .filter(
            (entry) =>
              entry.kind === "SPACE" &&
              !entry.deletedAt &&
              entry.title
                .toLocaleLowerCase()
                .includes(spaceQuery.toLocaleLowerCase()) &&
              !spaces.some((space) => space.targetId === entry.id),
          )
          .slice(0, 20)
          .map((entry) => (
            <Button
              variant="ghost"
              type="button"
              key={entry.id}
              disabled={busy}
              onClick={() =>
                void onLinkSpace({
                  projectId,
                  spaceId: entry.id,
                  inheritToChildren: false,
                })
              }
            >
              {entry.title}
            </Button>
          ))}
      </details>
      {(["OWNED", "LINKED"] as const)
        .filter((ownership) =>
          spaces.some((space) => space.ownership === ownership),
        )
        .map((ownership) => (
          <section key={ownership}>
            <h3>
              {ownership === "OWNED"
                ? zh
                  ? "项目空间"
                  : "Project spaces"
                : zh
                  ? "链接空间"
                  : "Linked spaces"}
            </h3>
            {spaces
              .filter((space) => space.ownership === ownership)
              .map((space) => (
                <Button
                  type="button"
                  variant="toggle"
                  key={space.id}
                  aria-pressed={selectedSpace === space.targetId}
                  onClick={() => {
                    setSelectedSpace(space.targetId ?? "");
                    if (space.targetId)
                      onOpen({ kind: "SPACE", id: space.targetId });
                  }}
                >
                  {space.role === "PRIMARY" ? "★ " : ""}
                  {space.title}
                </Button>
              ))}
          </section>
        ))}
      {inheritedSpaces.length > 0 && (
        <section aria-label={zh ? "继承空间" : "Inherited spaces"}>
          <h3>{zh ? "继承空间" : "Inherited spaces"}</h3>
          {inheritedSpaces.map((space) => (
            <Button
              type="button"
              variant="toggle"
              key={space.id}
              onClick={() =>
                space.targetId && onOpen({ kind: "SPACE", id: space.targetId })
              }
            >
              {space.title}
            </Button>
          ))}
        </section>
      )}
      <Button
        variant="secondary"
        type="button"
        disabled={busy || !spaces.length}
        onClick={() => {
          if (spaces.length === 1 && spaces[0]?.targetId)
            onNewPage(spaces[0].targetId);
          else setChoosingPageSpace(true);
        }}
      >
        {zh ? "新建页面" : "Create page"}
      </Button>
      {choosingPageSpace && (
        <section aria-label={zh ? "选择页面空间" : "Choose page space"}>
          {spaces.map((space) => (
            <Button
              type="button"
              variant="toggle"
              key={space.id}
              onClick={() => {
                if (space.targetId) onNewPage(space.targetId);
                setChoosingPageSpace(false);
              }}
            >
              {space.title}
            </Button>
          ))}
        </section>
      )}
      <h3>{zh ? "页面与引用" : "Pages and references"}</h3>
      <FilePicker
        label={zh ? "上传项目文件" : "Upload project file"}
        hint={
          zh
            ? "原始文件保存到本机，后台同步"
            : "Original file saved locally; sync runs in the background"
        }
        accept=""
        disabled={busy || uploading}
        onFile={(file) => {
          if (!file.size) {
            setError(zh ? "请选择非空文件。" : "Choose a nonempty file.");
            return;
          }
          setError("");
          setUploading(true);
          void onUpload(file)
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
      {files
        .filter((file) => showDeleted || !file.deletedAt)
        .map((file) => (
          <ProjectFileRow
            key={file.id}
            file={file}
            busy={busy}
            onOpen={onOpen}
            onDownload={onFileDownload}
            onDelete={onFileDelete}
          />
        ))}
      {entries
        .filter(
          (entry) =>
            entry.kind !== "SPACE" &&
            !(
              entry.kind === "FILE" &&
              files.some((file) => file.id === entry.id)
            ),
        )
        .map((entry) => (
          <div className="project-material" key={entry.id}>
            <Button
              variant="ghost"
              type="button"
              disabled={!!entry.deletedAt}
              onClick={() => {
                if (entry.kind === "FILE") void onLegacyOpen(entry.id);
                else if (entry.targetId)
                  onOpen({ kind: entry.kind, id: entry.targetId });
              }}
            >
              {entry.kind === "SPACE" ? "◈ " : ""}
              {entry.title}
            </Button>
            <small>
              {entry.ownership === "OWNED"
                ? zh
                  ? "项目拥有"
                  : "Owned"
                : zh
                  ? "外部引用"
                  : "Linked"}
              {entry.kind === "FILE" ? ` · ${entry.size} B` : ""}
              {" · "}
              {
                projects?.find((project) => project.id === entry.projectId)
                  ?.title
              }
            </small>
            {entry.deletedAt ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void onDelete(entry, false)}
              >
                {zh ? "恢复" : "Restore"}
              </Button>
            ) : (
              <EntityMenu
                title={entry.title}
                pending={busy}
                {...(entry.kind === "FILE"
                  ? {
                      onDownload: () => {
                        void onDownload(entry.id);
                      },
                    }
                  : {})}
                onDelete={() => {
                  void onDelete(entry, true);
                }}
              />
            )}
          </div>
        ))}
    </section>
  );
}

export function ProjectHistory({
  projectId,
  projectIds,
  edges,
  tasks,
  load,
  loadWork,
}: {
  projectId: string;
  projectIds?: string[];
  edges?: readonly WorkEdge[];
  tasks: WorkItem[];
  load(projectId: string): Promise<ProjectActivity[]>;
  loadWork(): Promise<ActivityEvent[]>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [events, setEvents] = useState<
    {
      id: string;
      type: string;
      occurredAt: string;
      principalId: string;
      fromId?: string | null;
      toId?: string | null;
    }[]
  >([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    const edgeIds = new Set((edges ?? []).map((edge) => edge.id));
    setError(false);
    setLoaded(false);
    void Promise.all([
      Promise.all((projectIds ?? [projectId]).map(load)),
      loadWork(),
    ])
      .then(([materials, work]) => {
        if (active)
          setEvents(
            [
              ...materials.flat(),
              ...work
                .filter(
                  (entry) =>
                    taskIds.has(entry.entityId) ||
                    edgeIds.has(entry.entityId) ||
                    (!!entry.fromId && taskIds.has(entry.fromId)) ||
                    (!!entry.toId && taskIds.has(entry.toId)),
                )
                .map((entry) =>
                  entry.edgeType === "REQUIRES"
                    ? {
                        ...entry,
                        fromId: entry.toId ?? null,
                        toId: entry.fromId ?? null,
                      }
                    : entry,
                ),
            ].sort((left, right) =>
              right.occurredAt.localeCompare(left.occurredAt),
            ),
          );
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, projectIds, tasks, edges, load, loadWork]);
  if (loaded && !error && events.length === 0) return null;
  return (
    <section className="panel project-summary">
      <h2>{zh ? "最近活动" : "Recent activity"}</h2>
      {error && (
        <p role="alert">{zh ? "无法加载活动。" : "Could not load activity."}</p>
      )}
      {(expanded ? events : events.slice(0, 5)).map((entry) => (
        <div className="project-material" key={entry.id}>
          <span>
            {labels[entry.type] ?? (zh ? "项目已更新" : "Project updated")}
            {entry.fromId && entry.toId && (
              <small>
                {" "}
                ·{" "}
                {tasks.find((task) => task.id === entry.fromId)?.title ??
                  entry.fromId}{" "}
                →{" "}
                {tasks.find((task) => task.id === entry.toId)?.title ??
                  entry.toId}
              </small>
            )}
          </span>
          <small>
            {new Date(entry.occurredAt).toLocaleString(i18n.language)}
          </small>
        </div>
      ))}
      {events.length > 5 && (
        <Button
          variant="text"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? zh
              ? "收起"
              : "Show less"
            : zh
              ? "更多活动"
              : "More activity"}
        </Button>
      )}
    </section>
  );
}

export function ProjectTimeline({
  items,
  tasks,
  onOpen,
}: {
  items: readonly WorkItem[];
  tasks: WorkItem[];
  onOpen(ref: EntityRef): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const workIndex = useMemo(() => buildWorkspaceWorkIndex(items, []), [items]);
  const sorted = useMemo(
    () =>
      [...tasks].sort((left, right) =>
        (left.startDate ?? left.dueDate ?? "9999").localeCompare(
          right.startDate ?? right.dueDate ?? "9999",
        ),
      ),
    [tasks],
  );
  return (
    <section className="panel project-summary">
      <h2>{zh ? "项目时间线" : "Project timeline"}</h2>
      <VirtualTaskCollection
        items={sorted}
        render={(task) => (
          <Button
            key={task.id}
            type="button"
            className="agenda-item"
            onClick={() => onOpen({ kind: "WORK", id: task.id })}
          >
            <strong>{task.title}</strong>
            <small>{workIndex.projectTitleByTaskId.get(task.id)}</small>
            <small>
              {task.startDate ?? "—"} →{" "}
              {task.dueDate ?? (zh ? "尚未排期" : "Unscheduled")}
            </small>
          </Button>
        )}
      />
    </section>
  );
}
