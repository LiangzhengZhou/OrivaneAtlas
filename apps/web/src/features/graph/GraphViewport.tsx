import {
  Background,
  type Edge,
  type Node,
  type NodeProps,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { Expand, Maximize, Minus, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "../../app/DismissibleDialog";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState, Tooltip } from "../../components/ui/Surfaces";
import "@xyflow/react/dist/style.css";

function SpaceClusterNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="space-cluster-label">{data.label}</div>;
}
const nodeTypes = { spaceCluster: SpaceClusterNode };

function GraphControls() {
  const flow = useReactFlow();
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <Panel position="bottom-left">
      <div className="ui-toolbar">
        <Tooltip label={zh ? "放大" : "Zoom in"}>
          <IconButton
            label={zh ? "放大" : "Zoom in"}
            onClick={() => void flow.zoomIn()}
          >
            <Plus />
          </IconButton>
        </Tooltip>
        <Tooltip label={zh ? "缩小" : "Zoom out"}>
          <IconButton
            label={zh ? "缩小" : "Zoom out"}
            onClick={() => void flow.zoomOut()}
          >
            <Minus />
          </IconButton>
        </Tooltip>
        <Tooltip label={zh ? "适应视图" : "Fit View"}>
          <IconButton
            label={zh ? "适应视图" : "Fit View"}
            onClick={() => void flow.fitView()}
          >
            <Maximize />
          </IconButton>
        </Tooltip>
      </div>
    </Panel>
  );
}

export function GraphViewport({
  emptyState,
  toolbar,
  inspector,
  nodes,
  edges,
  onSelect,
  onOpen,
  onWorkspace,
  workspace = false,
  selectionId,
  layoutKey,
}: {
  emptyState?: ReactNode;
  toolbar?: ReactNode;
  inspector?: ReactNode;
  nodes: Node[];
  edges: Edge[];
  onSelect?(id: string): void;
  onOpen(id: string): void;
  onWorkspace?: (() => void) | undefined;
  workspace?: boolean;
  selectionId?: string | undefined;
  layoutKey: string;
}) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(
    selectionId === undefined
      ? nodes
      : nodes.map((node) => ({ ...node, selected: node.id === selectionId })),
  );
  const structure = layoutKey;
  const lastStructure = useRef(structure);
  const lastInput = useRef({ nodes, selectionId });
  useEffect(() => {
    if (
      lastInput.current.nodes === nodes &&
      lastInput.current.selectionId === selectionId &&
      lastStructure.current === structure
    )
      return;
    lastInput.current = { nodes, selectionId };
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
  const { t, i18n } = useTranslation("desk");
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
      <Button
        type="button"
        className="icon-button graph-expand-button"
        aria-label={t(expanded ? "common:close" : "expandGraph")}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <X size={18} /> : <Expand size={18} />}
      </Button>
      {onWorkspace && (
        <Button type="button" className="chip" onClick={onWorkspace}>
          {t("openGraphWorkspace", { defaultValue: "Open Graph Workspace" })}
        </Button>
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
          {nodes.length === 0 ? (
            (emptyState ?? (
              <EmptyState
                title={
                  i18n.language.startsWith("zh")
                    ? "暂无关系"
                    : "No relations yet"
                }
              />
            ))
          ) : (
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
              <GraphControls />
            </ReactFlow>
          )}
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
              <Button type="button" onClick={() => onOpen(selected.id)}>
                {t("viewDetails")}
              </Button>
            )}
          </aside>
        )}
      </div>
    </DismissibleDialog>
  );
}
