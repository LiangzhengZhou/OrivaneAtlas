import type { EntityRef } from "@arclattice/application";
import { projectPath, projectScope } from "@arclattice/domain";
import { MarkerType } from "@xyflow/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { KnowledgeGraph } from "../knowledge/KnowledgeGraph";
import { ProjectDependencyGraph } from "../projects/ProjectDependencyGraph";
import { ProjectStructureTree } from "../projects/ProjectStructureTree";
import { GraphViewport } from "./GraphViewport";
import { type GraphRoute, graphHash } from "./graph-route";
import { projectDepth } from "./graph-scope";
import { dependencyDagreLayout } from "./layouts/DependencyDagreLayout";
import { useStructuralLayout } from "./layouts/useStructuralLayout";
export function GraphWorkspace({
  route,
  snapshot,
  onOpen,
}: {
  route: GraphRoute;
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
}) {
  const { i18n, t } = useTranslation();
  const text = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const tree = route.view !== "graph";
  const [query, setQuery] = useState(""),
    [copyError, setCopyError] = useState(false);
  const update = (patch: Partial<GraphRoute>) => {
    history.replaceState(null, "", graphHash({ ...route, ...patch }));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const project = snapshot.items.find(
    (i) => i.id === route.id && i.type === "PROJECT" && !i.deletedAt,
  );
  const document = snapshot.library.find(
    (i) => i.id === route.id && !i.deletedAt,
  );
  const structure = projectDepth(snapshot.items, route.id, route.depth);
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
  );
  const positionById = new Map(positions.map((p) => [p.id, p.position]));
  const selected =
    snapshot.items.find((i) => i.id === route.selection && !i.deletedAt) ??
    snapshot.library.find((i) => i.id === route.selection && !i.deletedAt);
  const inspector = (
    <aside className="graph-selection" aria-label={text("检查器", "Inspector")}>
      <h3>{selected?.title ?? text("选择节点", "Select a node")}</h3>
      {selected && (
        <>
          <p>
            {"status" in selected
              ? t("work:statuses." + selected.status)
              : text(
                  selected.kind === "SPACE" ? "知识空间" : "文档",
                  selected.kind === "SPACE" ? "Space" : "Document",
                )}
          </p>
          <p>
            {text("版本", "Version")} {selected.version}
          </p>
          {"type" in selected ? (
            <>
              <p>{projectPath(selected, snapshot.items)}</p>
              {selected.type === "TASK" && (
                <p>{t("work:priorities." + selected.priority)}</p>
              )}
              <p>{selected.descriptionMd.slice(0, 400)}</p>
            </>
          ) : (
            <p>{selected.bodyMd.slice(0, 400)}</p>
          )}
          <button
            type="button"
            className="chip"
            onClick={() =>
              onOpen({
                kind: "type" in selected ? "WORK" : "DOCUMENT",
                id: selected.id,
              })
            }
          >
            {text("打开详情", "Open details")}
          </button>
        </>
      )}
    </aside>
  );
  const scoped = project
    ? projectScope(project, snapshot.items, "SUBTREE")
    : null;
  const scopedTaskIds = new Set(scoped?.tasks.map((task) => task.id) ?? []);
  const scopedSnapshot = {
    ...snapshot,
    items: snapshot.items.filter(
      (i) => i.type === "PROJECT" || scopedTaskIds.has(i.id),
    ),
  };
  if (
    (route.kind === "project" && !project) ||
    (route.kind === "document" && !document)
  )
    return (
      <section>
        <button
          type="button"
          onClick={() => {
            location.hash = route.back;
          }}
        >
          {text("返回", "Back")}
        </button>
        <p>{text("找不到图谱对象", "Graph entity is unavailable")}</p>
      </section>
    );
  return (
    <section className="graph-workspace">
      <header className="action-row">
        <button
          type="button"
          className="chip"
          onClick={() => {
            location.hash = route.back;
            if (route.kind === "document")
              onOpen({ kind: "DOCUMENT", id: route.id });
          }}
        >
          {text("返回", "Back")}
        </button>
        <h2>
          {project?.title ?? document?.title} · {text("图谱", "Graph")}
        </h2>
        <label>
          {text("搜索", "Search")}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="chip"
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
        </button>
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
            : snapshot.items.filter(
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
              <button
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
              </button>
            ))}
        </div>
      )}
      {route.kind === "project" && (
        <div className="action-row">
          {["structure", "dependencies", "knowledge"].map((mode) => (
            <button
              className="chip"
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
                mode,
              )}
            </button>
          ))}
        </div>
      )}
      {route.mode === "structure" && (
        <>
          <div className="action-row">
            {[1, 2].map((depth) => (
              <button
                type="button"
                className="chip"
                key={depth}
                aria-pressed={route.depth === depth}
                onClick={() => update({ depth })}
              >
                {depth} {text("层", "level")}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={tree}
              onClick={() => update({ view: "tree" })}
            >
              {text("树形", "Tree")}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={!tree}
              onClick={() => update({ view: "graph" })}
            >
              {text("图形", "Graph")}
            </button>
          </div>
          {tree ? (
            <div className="graph-body">
              <div>
                <button
                  type="button"
                  onClick={() => update({ selection: route.id })}
                >
                  {project?.title}
                </button>
                <ProjectStructureTree
                  key={route.depth}
                  initialDepth={route.depth}
                  showDepthControls={false}
                  projects={snapshot.items}
                  parentId={route.id}
                  onOpen={(id) => update({ selection: id })}
                />
              </div>
              {inspector}
            </div>
          ) : (
            <GraphViewport
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
          key={route.id + route.mode}
          workspace
          snapshot={scopedSnapshot}
          fullSnapshot={snapshot}
          inspector={inspector}
          initialFocus={route.focus}
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
