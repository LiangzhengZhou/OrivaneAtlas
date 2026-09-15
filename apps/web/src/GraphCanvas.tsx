import type { EntityRef, KnowledgeLink } from "@arclattice/application";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "./bootstrap";
export function GraphCanvas({
  snapshot,
  tasks = false,
  onOpen,
  onConnect,
  onRemove,
}: {
  snapshot: Snapshot;
  tasks?: boolean;
  onOpen: (ref: EntityRef) => void;
  onConnect: (
    from: EntityRef,
    to: EntityRef,
    relation: KnowledgeLink["relation"],
  ) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("ALL"),
    [limit, setLimit] = useState(200),
    [relation, setRelation] = useState<KnowledgeLink["relation"]>("RELATED"),
    [error, setError] = useState(false),
    [pending, setPending] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    [] as {
      id: string;
      position: { x: number; y: number };
      data: { label: string };
    }[],
  );
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const entities = useMemo(
    () => [
      ...snapshot.items
        .filter((i) => !i.deletedAt)
        .map((i) => ({
          ref: { kind: "WORK" as const, id: i.id },
          title: i.title,
        })),
      ...(!tasks
        ? snapshot.notes
            .filter((n) => !n.deletedAt)
            .map((n) => ({
              ref: { kind: "NOTE" as const, id: n.id },
              title: n.title,
            }))
        : []),
      ...(!tasks
        ? snapshot.library
            .filter(
              (e) =>
                !e.deletedAt &&
                (e.kind === "SPACE" ||
                  snapshot.library.some(
                    (p) => p.id === e.spaceId && !p.deletedAt,
                  )),
            )
            .map((e) => ({ ref: { kind: e.kind, id: e.id }, title: e.title }))
        : []),
    ],
    [snapshot, tasks],
  );
  const visible = useMemo(
    () =>
      entities
        .filter(
          (e) =>
            (kind === "ALL" || e.ref.kind === kind) &&
            e.title.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, limit),
    [entities, kind, query, limit],
  );
  const key = (r: EntityRef) => r.kind + ":" + r.id;
  const edges: Edge[] = useMemo(() => {
    const ids = new Set(visible.map((e) => key(e.ref)));
    return (
      tasks
        ? snapshot.edges.map((e) => ({
            id: e.id,
            source: "WORK:" + (e.type === "REQUIRES" ? e.toId : e.fromId),
            target: "WORK:" + (e.type === "REQUIRES" ? e.fromId : e.toId),
            directed: e.type !== "RELATED",
            label: e.type,
          }))
        : snapshot.links.map((e) => ({
            id: e.id,
            source: key(e.from),
            target: key(e.to),
            directed: e.relation === "REFERENCES",
            label: e.relation,
          }))
    )
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        ...e,
        ...(e.directed ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
      }));
  }, [visible, snapshot, tasks]);
  const signature = JSON.stringify({
    nodes: visible.map((e) => ({ id: key(e.ref), title: e.title })),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
  });
  useEffect(() => {
    const input = JSON.parse(signature) as {
      nodes: { id: string; title: string }[];
      edges: { source: string; target: string }[];
    };
    const worker = new Worker(
      new URL("./graph-layout.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      event: MessageEvent<{
        positions: { id: string; x: number; y: number }[];
      }>,
    ) => {
      setNodes(
        event.data.positions.map((p) => ({
          id: p.id,
          position: positions.current.get(p.id) ?? { x: p.x, y: p.y },
          data: {
            label: input.nodes.find((n) => n.id === p.id)?.title ?? p.id,
          },
        })),
      );
    };
    worker.onerror = () => setError(true);
    worker.postMessage({
      id: 1,
      kind: tasks ? "tasks" : "knowledge",
      nodes: input.nodes.map((n) => n.id),
      edges: input.edges,
    });
    return () => worker.terminate();
  }, [signature, tasks, setNodes]);
  async function run(action: () => Promise<boolean>) {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      if (!(await action())) setError(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="graph-section">
      <div className="action-row">
        <input
          aria-label={zh ? "图谱搜索" : "Graph search"}
          placeholder={zh ? "搜索节点…" : "Search nodes…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!tasks && (
          <>
            <select
              aria-label={zh ? "节点类型" : "Node type"}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {["ALL", "NOTE", "WORK", "SPACE", "DOCUMENT"].map((k) => (
                <option key={k} value={k}>
                  {
                    (
                      {
                        ALL: zh ? "全部" : "All",
                        NOTE: zh ? "笔记 / 日记" : "Notes / journals",
                        WORK: zh ? "任务 / 项目" : "Tasks / projects",
                        SPACE: zh ? "知识空间" : "Knowledge spaces",
                        DOCUMENT: zh ? "讲义" : "Documents",
                      } as Record<string, string>
                    )[k]
                  }
                </option>
              ))}
            </select>
            <select
              aria-label={zh ? "关联类型" : "Relation type"}
              value={relation}
              onChange={(e) =>
                setRelation(e.target.value as KnowledgeLink["relation"])
              }
            >
              <option value="RELATED">
                {zh ? "无向相关" : "Undirected relation"}
              </option>
              <option value="REFERENCES">
                {zh ? "有向引用" : "Directed reference"}
              </option>
            </select>
          </>
        )}
        <span>
          {visible.length}/{entities.length}
        </span>
        <button
          className="chip"
          type="button"
          onClick={() => setLimit((n) => n + 200)}
          disabled={limit >= entities.length}
        >
          {zh ? "再显示 200 个" : "Show 200 more"}
        </button>
      </div>
      <p className="muted">
        {zh
          ? "拖动节点调整位置，拖动连接点创建关联；双击节点打开，双击连线移除。下方保留可键盘访问的列表。"
          : "Drag nodes to arrange; connect handles to link. Double-click a node to open, or an edge to remove. Accessible lists remain below."}
      </p>
      {error && (
        <p role="alert" className="error">
          {zh
            ? "图操作未完成，请检查关联规则或刷新。"
            : "Graph operation failed. Check relation rules or refresh."}
        </p>
      )}
      <div style={{ height: 560, width: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodesConnectable={!pending}
          deleteKeyCode={null}
          onNodeDragStop={(_, node) =>
            positions.current.set(node.id, node.position)
          }
          onNodeDoubleClick={(_, node) => {
            const e = entities.find((e) => key(e.ref) === node.id);
            if (e) onOpen(e.ref);
          }}
          onEdgeDoubleClick={(_, edge) => {
            if (window.confirm(zh ? "移除此关联？" : "Remove this relation?"))
              void run(() => onRemove(edge.id));
          }}
          onConnect={(connection) => {
            const a = entities.find((e) => key(e.ref) === connection.source),
              b = entities.find((e) => key(e.ref) === connection.target);
            if (a && b) void run(() => onConnect(a.ref, b.ref, relation));
          }}
          fitView
          minZoom={0.1}
          maxZoom={2}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </section>
  );
}
