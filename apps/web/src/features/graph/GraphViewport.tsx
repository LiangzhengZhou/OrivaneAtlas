import {
  Background,
  type Edge,
  type Node,
  type NodeProps,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { Expand, Maximize, Minus, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DismissibleDialog } from "../../app/DismissibleDialog";
import { Button, IconButton } from "../../components/ui/Button";
import { MenuItem } from "../../components/ui/Content";
import { EmptyState, Menu, Tooltip } from "../../components/ui/Surfaces";
import "@xyflow/react/dist/style.css";

function SpaceClusterNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="space-cluster-label">{data.label}</div>;
}
const nodeTypes = { spaceCluster: SpaceClusterNode };
export interface GraphViewportStateProps {
  initialViewport?: Viewport | undefined;
  onViewportChange?: ((viewport: Viewport) => void) | undefined;
}

function GraphControls({ onViewportIntent }: { onViewportIntent(): void }) {
  const flow = useReactFlow();
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <Panel position="bottom-left">
      <div className="ui-toolbar">
        <Tooltip label={zh ? "放大" : "Zoom in"}>
          <IconButton
            label={zh ? "放大" : "Zoom in"}
            onClick={() => {
              onViewportIntent();
              void flow.zoomIn();
            }}
          >
            <Plus />
          </IconButton>
        </Tooltip>
        <Tooltip label={zh ? "缩小" : "Zoom out"}>
          <IconButton
            label={zh ? "缩小" : "Zoom out"}
            onClick={() => {
              onViewportIntent();
              void flow.zoomOut();
            }}
          >
            <Minus />
          </IconButton>
        </Tooltip>
        <Tooltip label={zh ? "适应视图" : "Fit View"}>
          <IconButton
            label={zh ? "适应视图" : "Fit View"}
            onClick={() => {
              onViewportIntent();
              void flow.fitView();
            }}
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
  initialViewport,
  onViewportChange,
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
} & GraphViewportStateProps) {
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
  const menuAnchor = useRef<HTMLElement | null>(null);
  const [menuNode, setMenuNode] = useState<Node | null>(null);
  const viewportIntent = useRef(false);
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
        variant="ghost"
        className="ui-icon-button graph-expand-button"
        aria-label={t(expanded ? "common:close" : "expandGraph")}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <X size={18} /> : <Expand size={18} />}
      </Button>
      {onWorkspace && (
        <Button type="button" variant="toggle" onClick={onWorkspace}>
          {t("openGraphWorkspace", { defaultValue: "Open Graph Workspace" })}
        </Button>
      )}
      {toolbar}
      <div className="graph-body">
        <div
          className="graph-viewport"
          onKeyDownCapture={(event) => {
            if (event.key !== "Enter" || !(event.target instanceof HTMLElement))
              return;
            const id = event.target
              .closest(".react-flow__node")
              ?.getAttribute("data-id");
            if (id) {
              event.preventDefault();
              event.stopPropagation();
              onOpen(id);
            }
          }}
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
              onNodeContextMenu={(event, node) => {
                if (node.selectable === false) return;
                event.preventDefault();
                const target = event.target;
                menuAnchor.current =
                  target instanceof HTMLElement
                    ? target.closest<HTMLElement>(".react-flow__node")
                    : null;
                if (!menuAnchor.current) return;
                setSelectedId(node.id);
                onSelect?.(node.id);
                setMenuNode(node);
              }}
              fitView={!initialViewport}
              {...(initialViewport ? { defaultViewport: initialViewport } : {})}
              onMoveStart={(event) => {
                if (event) viewportIntent.current = true;
              }}
              onMoveEnd={(_, viewport) => {
                if (!viewportIntent.current) return;
                viewportIntent.current = false;
                onViewportChange?.(viewport);
              }}
              minZoom={0.1}
              maxZoom={2}
            >
              <Background />
              <GraphControls
                onViewportIntent={() => {
                  viewportIntent.current = true;
                }}
              />
            </ReactFlow>
          )}
        </div>
        {menuNode && (
          <Menu
            anchorRef={menuAnchor}
            label={i18n.language.startsWith("zh") ? "节点操作" : "Node actions"}
            onDismiss={() => setMenuNode(null)}
          >
            <MenuItem
              onClick={() => {
                setMenuNode(null);
                onOpen(menuNode.id);
              }}
            >
              {i18n.language.startsWith("zh") ? "打开" : "Open"}
            </MenuItem>
          </Menu>
        )}
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
