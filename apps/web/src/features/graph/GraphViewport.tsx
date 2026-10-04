import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeProps,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import { Expand, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "../../app/DismissibleDialog";
import "@xyflow/react/dist/style.css";

function SpaceClusterNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="space-cluster-label">{data.label}</div>;
}
const nodeTypes = { spaceCluster: SpaceClusterNode };

export function GraphViewport({
  toolbar,
  inspector,
  nodes,
  edges,
  onSelect,
  onOpen,
  onWorkspace,
  workspace = false,
  selectionId,
}: {
  toolbar?: ReactNode;
  inspector?: ReactNode;
  nodes: Node[];
  edges: Edge[];
  onSelect?(id: string): void;
  onOpen(id: string): void;
  onWorkspace?: (() => void) | undefined;
  workspace?: boolean;
  selectionId?: string | undefined;
}) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(nodes);
  const structure = JSON.stringify([
    nodes.map((node) => [node.id, node.parentId]).sort(),
    edges.map((edge) => [edge.source, edge.target]).sort(),
  ]);
  const lastStructure = useRef(structure);
  useEffect(() => {
    const changed = structure !== lastStructure.current;
    lastStructure.current = structure;
    setFlowNodes((previous) => {
      const existing = new Map(previous.map((node) => [node.id, node]));
      return nodes.map((node) => {
        const old = existing.get(node.id);
        return {
          ...node,
          ...(!changed && old ? { position: old.position } : {}),
          selected:
            selectionId !== undefined
              ? node.id === selectionId
              : (old?.selected ?? false),
        };
      });
    });
  }, [nodes, structure, setFlowNodes, selectionId]);
  const [selectedId, setSelectedId] = useState<string | null>(
    selectionId ?? null,
  );
  const selected = nodes.find((node) => node.id === selectedId);
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation("desk");
  return (
    <DismissibleDialog
      role={expanded ? "dialog" : "region"}
      modal={expanded}
      onRequestClose={() => {
        if (expanded) setExpanded(false);
      }}
      className={expanded ? "graph-expanded-dialog" : "graph-inline-dialog"}
      aria-label={t("expandGraph")}
    >
      <button
        type="button"
        className="icon-button graph-expand-button"
        aria-label={t(expanded ? "common:close" : "expandGraph")}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <X size={18} /> : <Expand size={18} />}
      </button>
      {onWorkspace && (
        <button type="button" className="chip" onClick={onWorkspace}>
          {t("openGraphWorkspace", { defaultValue: "Open Graph Workspace" })}
        </button>
      )}
      {toolbar}
      <div className="graph-body">
        <div
          className="graph-viewport"
          style={{
            height: workspace
              ? "calc(100dvh - 240px)"
              : expanded
                ? "calc(84vh - 100px)"
                : 560,
            width: "100%",
          }}
        >
          <ReactFlow
            nodeTypes={nodeTypes}
            nodes={flowNodes}
            onNodesChange={onNodesChange}
            edges={edges}
            nodesConnectable={false}
            deleteKeyCode={null}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              onSelect?.(node.id);
            }}
            autoPanOnNodeFocus={false}
            zoomOnDoubleClick={false}
            onNodeDoubleClick={(_, node) => onOpen(node.id)}
            fitView
            minZoom={0.1}
            maxZoom={2}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        {inspector ?? (
          <aside className="graph-selection" aria-label={t("selectedEntity")}>
            <strong>
              {selected &&
                (typeof selected.data.title === "string"
                  ? selected.data.title
                  : typeof selected.data.label === "string"
                    ? selected.data.label
                    : selected.id)}
            </strong>
            {selected && (
              <button type="button" onClick={() => onOpen(selected.id)}>
                {t("viewDetails")}
              </button>
            )}
          </aside>
        )}
      </div>
    </DismissibleDialog>
  );
}
