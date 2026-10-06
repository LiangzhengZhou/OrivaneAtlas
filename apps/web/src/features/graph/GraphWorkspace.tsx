import type { EntityRef } from "@arclattice/application";
import type { WorkItem } from "@arclattice/domain";
import { MarkerType } from "@xyflow/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextPane } from "../../app/ContextPane";
import type { Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Content";
import { KnowledgeGraph } from "../knowledge/KnowledgeGraph";
import { ProjectDependencyGraph } from "../projects/ProjectDependencyGraph";
import { ProjectStructureTree } from "../projects/ProjectStructureTree";
import {
  projectTreeIndex,
  visibleProjectBranches,
} from "../projects/project-tree";
import type { WorkspaceWorkIndex } from "../tasks/workspace-work-index";
import { GraphViewport } from "./GraphViewport";
import { collectionRevision } from "./graph-revision";
import type { GraphRoute } from "./graph-route";
import { dependencyDagreLayout } from "./layouts/DependencyDagreLayout";
import { useStructuralLayout } from "./layouts/useStructuralLayout";
export function GraphWorkspace({
  workIndex,
  route,
  snapshot,
  onOpen,
  onRouteChange,
  atlasOpen = false,
  onAtlas,
}: {
  workIndex: WorkspaceWorkIndex;
  route: GraphRoute;
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  onRouteChange(patch: Partial<GraphRoute>): void;
  atlasOpen?: boolean;
  onAtlas?(): void;
}) {
  const { i18n } = useTranslation();
  const text = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const tree = route.view !== "graph";
  const [query, setQuery] = useState(""),
    [copyError, setCopyError] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const update = (patch: Partial<GraphRoute>) => {
    if (patch.selection) setInspectorOpen(true);
    onRouteChange(patch);
  };
  const project =
    route.kind === "project" ? workIndex.projectsById.get(route.id) : null;
  const document =
    route.kind === "document"
      ? snapshot.library.find((i) => i.id === route.id && !i.deletedAt)
      : null;
  const projectChildren = useMemo(
    () =>
      projectTreeIndex(
        snapshot.items.filter(
          (item) => item.type === "PROJECT" && !item.deletedAt,
        ),
      ),
    [snapshot.items],
  );
  const directChildren = projectChildren.get(route.id) ?? [];
  const expandedIds = new Set(
    route.expandedIds ??
      (route.depth === 2 ? directChildren.map((item) => item.id) : []),
  );
  const hasSecondLevel = directChildren.some(
    (item) => (projectChildren.get(item.id)?.length ?? 0) > 0,
  );
  const structure =
    route.mode === "structure"
      ? [
          ...(project ? [project] : []),
          ...visibleProjectBranches(projectChildren, route.id, expandedIds),
        ]
      : [];
  const structureKey =
    route.mode === "structure"
      ? `${collectionRevision(snapshot.items)}:${route.id}:${structure.map((item) => item.id).join(":")}`
      : "inactive-structure";
  const structureIds = new Set(structure.map((item) => item.id));
  const edges = structure.flatMap((item) =>
    item.parentProjectId && structureIds.has(item.parentProjectId)
      ? [
          {
            id: item.id,
            source: item.parentProjectId,
            target: item.id,
            markerEnd: { type: MarkerType.ArrowClosed },
          },
        ]
      : [],
  );
  const positions = useStructuralLayout(
    structure.map((p) => p.id),
    edges,
    dependencyDagreLayout,
    structureKey,
  );
  const positionById = new Map(positions.map((p) => [p.id, p.position]));
  const selectedWork = route.selection
    ? workIndex.itemsById.get(route.selection)
    : undefined;
  const selected = route.selection
    ? selectedWork && !selectedWork.deletedAt
      ? selectedWork
      : snapshot.library.find((i) => i.id === route.selection && !i.deletedAt)
    : null;
  const inspector =
    inspectorOpen && !atlasOpen ? (
      <ContextPane
        openLabel={text("打开详情", "Open details")}
        className="is-inline"
        label={text("检查器", "Inspector")}
        selected={
          selected
            ? {
                kind: "type" in selected ? "WORK" : "DOCUMENT",
                id: selected.id,
              }
            : null
        }
        snapshot={snapshot}
        atlas={false}
        onMode={(atlas) => {
          if (atlas) onAtlas?.();
        }}
        onClose={() => setInspectorOpen(false)}
        onOpen={onOpen}
      />
    ) : (
      false
    );
  const { scoped, scopedTaskIds, scopedSnapshot } = useMemo(() => {
    const projectIds = project
      ? new Set([
          project.id,
          ...Array.from(workIndex.projectsById.values())
            .filter((item) =>
              workIndex.ancestorIdsByProjectId
                .get(item.id)
                ?.includes(project.id),
            )
            .map((item) => item.id),
        ])
      : new Set<string>();
    const taskIds = new Set<string>();
    for (const projectId of projectIds)
      for (const taskId of workIndex.tasksByProjectId.get(projectId) ?? [])
        taskIds.add(taskId);
    const tasks = Array.from(taskIds)
      .map((id) => workIndex.itemsById.get(id))
      .filter(
        (item): item is WorkItem => item?.type === "TASK" && !item.deletedAt,
      );
    const scopedTaskIds = new Set(tasks.map((task) => task.id));
    const completed = tasks.filter((task) => task.status === "DONE").length;
    const canceled = tasks.filter((task) => task.status === "CANCELED").length;
    const scoped = project
      ? {
          projects: Array.from(projectIds)
            .map((id) => workIndex.projectsById.get(id))
            .filter((item): item is WorkItem => !!item),
          projectIds,
          tasks,
          completed,
          canceled,
          unfinished: tasks.length - completed - canceled,
        }
      : null;
    return {
      scoped,
      scopedTaskIds,
      scopedSnapshot: {
        ...snapshot,
        items: snapshot.items.filter(
          (item) => item.type === "PROJECT" || scopedTaskIds.has(item.id),
        ),
      },
    };
  }, [project, snapshot]);
  if (
    (route.kind === "project" && !project) ||
    (route.kind === "document" && !document)
  )
    return (
      <section>
        <Button
          type="button"
          onClick={() => {
            location.hash = route.back;
          }}
        >
          {text("返回", "Back")}
        </Button>
        <p>{text("找不到图谱对象", "Graph entity is unavailable")}</p>
      </section>
    );
  return (
    <section className="graph-workspace">
      <header className="graph-workspace-header">
        <Button
          type="button"
          variant="toggle"
          onClick={() => {
            location.hash = route.back;
            if (route.kind === "document")
              onOpen({ kind: "DOCUMENT", id: route.id });
          }}
        >
          {text("返回", "Back")}
        </Button>
        <h2>
          {project?.title ?? document?.title} · {text("图谱", "Graph")}
        </h2>
        <Field label={text("搜索", "Search")}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="toggle"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(location.href);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {text("复制链接", "Copy link")}
        </Button>
      </header>
      {copyError && (
        <label role="alert">
          {text(
            "未能复制，请选择并复制链接",
            "Could not copy; select and copy the link",
          )}
          <input
            readOnly
            value={location.href}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      {query && (
        <div
          role="listbox"
          aria-label={text("图谱搜索结果", "Graph search results")}
        >
          {(route.mode === "knowledge"
            ? snapshot.library.filter(
                (i) => i.kind === "DOCUMENT" && !i.deletedAt,
              )
            : (route.mode === "structure"
                ? [
                    project,
                    ...visibleProjectBranches(
                      projectChildren,
                      route.id,
                      new Set(workIndex.projectsById.keys()),
                    ),
                  ].filter((item): item is WorkItem => !!item)
                : (scoped?.tasks ?? [])
              ).filter(
                (i) =>
                  !i.deletedAt &&
                  i.type === (route.mode === "structure" ? "PROJECT" : "TASK"),
              )
          )
            .filter((i) =>
              i.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            )
            .slice(0, 50)
            .map((item) => (
              <Button
                type="button"
                role="option"
                aria-selected={route.selection === item.id}
                key={item.id}
                onClick={() => {
                  update({
                    focus: item.id,
                    selection: item.id,
                    scope: route.mode === "knowledge" ? "local" : "focus",
                  });
                  setQuery("");
                }}
              >
                {item.title}
              </Button>
            ))}
        </div>
      )}
      {route.kind === "project" && (
        <div className="action-row">
          {["structure", "dependencies", "knowledge"].map((mode) => (
            <Button
              variant="toggle"
              type="button"
              key={mode}
              aria-pressed={route.mode === mode}
              onClick={() =>
                update({
                  mode: mode as GraphRoute["mode"],
                  scope: mode === "knowledge" ? "project" : "focus",
                })
              }
            >
              {text(
                {
                  structure: "项目结构",
                  dependencies: "任务依赖",
                  knowledge: "知识关系",
                }[mode] ?? mode,
                {
                  structure: "Project structure",
                  dependencies: "Task dependencies",
                  knowledge: "Knowledge relationships",
                }[mode] ?? mode,
              )}
            </Button>
          ))}
        </div>
      )}
      {route.mode === "structure" && (
        <>
          <div className="action-row">
            {[1, 2].map((depth) => (
              <Button
                type="button"
                variant="toggle"
                key={depth}
                aria-pressed={
                  depth === 1
                    ? expandedIds.size === 0
                    : hasSecondLevel &&
                      directChildren.every((item) => expandedIds.has(item.id))
                }
                disabled={depth === 2 && !hasSecondLevel}
                title={
                  depth === 2 && !hasSecondLevel
                    ? text("没有第二层子项目", "No second-level subprojects")
                    : undefined
                }
                onClick={() =>
                  update({
                    depth,
                    expandedIds:
                      depth === 2 ? directChildren.map((item) => item.id) : [],
                  })
                }
              >
                {depth === 1
                  ? text("直属子项目", "Direct subprojects")
                  : text("展开两层", "Expand two levels")}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => update({ expandedIds: [] })}>
              {text("全部折叠", "Collapse all")}
            </Button>
            <Button
              type="button"
              variant="toggle"
              aria-pressed={tree}
              onClick={() => update({ view: "tree" })}
            >
              {text("树形", "Tree")}
            </Button>
            <Button
              type="button"
              variant="toggle"
              aria-pressed={!tree}
              onClick={() => update({ view: "graph" })}
            >
              {text("图形", "Graph")}
            </Button>
          </div>
          {tree ? (
            <div className="graph-body">
              <div>
                <Button
                  type="button"
                  onClick={() => update({ selection: route.id })}
                >
                  {project?.title}
                </Button>
                <ProjectStructureTree
                  expandedIds={expandedIds}
                  onExpandedChange={(ids) => update({ expandedIds: [...ids] })}
                  showDepthControls={false}
                  projects={snapshot.items}
                  parentId={route.id}
                  onSelect={(id) => update({ selection: id })}
                  onOpen={(id) => onOpen({ kind: "WORK", id })}
                />
              </div>
              {inspector}
            </div>
          ) : (
            <GraphViewport
              initialViewport={route.viewport}
              onViewportChange={(viewport) => update({ viewport })}
              layoutKey={structureKey}
              workspace
              selectionId={route.selection}
              inspector={inspector}
              nodes={structure.map((p) => ({
                id: p.id,
                data: { label: p.title },
                position: positionById.get(p.id)!,
              }))}
              edges={edges}
              onSelect={(id) => update({ selection: id })}
              onOpen={(id) => onOpen({ kind: "WORK", id })}
            />
          )}
        </>
      )}
      {route.mode === "dependencies" && (
        <ProjectDependencyGraph
          initialViewport={route.viewport}
          onViewportChange={(viewport) => update({ viewport })}
          key={route.id + route.mode}
          scopeProjectId={route.id}
          workspace
          snapshot={scopedSnapshot}
          fullSnapshot={snapshot}
          inspector={inspector}
          initialFocus={scopedTaskIds.has(route.focus) ? route.focus : ""}
          initialHops={route.hops}
          initialScope={route.scope}
          selectionId={route.selection}
          onStateChange={(state) => update(state)}
          onSelect={(ref) => update({ selection: ref.id })}
          onOpen={onOpen}
        />
      )}
      {route.mode === "knowledge" && (
        <KnowledgeGraph
          initialViewport={route.viewport}
          onViewportChange={(viewport) => update({ viewport })}
          workspace
          inspector={inspector}
          initialScope={route.scope}
          initialFocus={route.focus}
          initialHops={route.hops}
          selectionId={route.selection}
          onStateChange={(state) => update(state)}
          onSelect={(ref) => update({ selection: ref.id })}
          snapshot={snapshot}
          onOpen={onOpen}
          {...(route.kind === "document"
            ? { documentId: route.id }
            : { projectId: route.id })}
        />
      )}
    </section>
  );
}
