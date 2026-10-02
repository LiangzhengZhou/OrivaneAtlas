import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeProps,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

function SpaceClusterNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="space-cluster-label">{data.label}</div>;
}
const nodeTypes = { spaceCluster: SpaceClusterNode };

export function GraphViewport({
  nodes,
  edges,
  onSelect,
  onOpen,
}: {
  nodes: Node[];
  edges: Edge[];
  onSelect?(id: string): void;
  onOpen(id: string): void;
}) {
  return (
    <div className="graph-viewport" style={{ height: 560, width: "100%" }}>
      <ReactFlow
        key={nodes.map((node) => node.id).join("|")}
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        onNodeDoubleClick={(_, node) => onOpen(node.id)}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
