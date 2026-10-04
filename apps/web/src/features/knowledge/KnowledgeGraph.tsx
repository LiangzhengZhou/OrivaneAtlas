import {
  type EntityRef,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { GraphViewport } from "../graph/GraphViewport";
import { collectionRevision } from "../graph/graph-revision";
import { openGraph } from "../graph/graph-route";
import { knowledgeForceLayout } from "../graph/layouts/KnowledgeForceLayout";
import { useStructuralLayout } from "../graph/layouts/useStructuralLayout";
import {
  buildKnowledgeGraphIndex,
  knowledgeNeighborhood,
} from "./knowledge-graph-index";

export function KnowledgeGraph({
  snapshot,
  onOpen,
  documentId,
  projectId,
  currentSpaceId,
  initialScope,
  initialFocus,
  initialHops = 1,
  onStateChange,
  onSelect,
  inspector,
  workspace = false,
  selectionId,
}: {
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  documentId?: string;
  projectId?: string;
  currentSpaceId?: string | undefined;
  initialScope?: string;
  initialFocus?: string;
  initialHops?: number;
  onStateChange?(state: { scope: string; focus: string; hops: number }): void;
  onSelect?(ref: EntityRef): void;
  inspector?: ReactNode;
  workspace?: boolean;
  selectionId?: string | undefined;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const [scope, setScope] = useState(
    initialScope ??
      (documentId
        ? "local"
        : projectId
          ? "project"
          : currentSpaceId
            ? "space"
            : "local"),
  );
  const [focusId, setFocusId] = useState(initialFocus ?? documentId ?? "");
  const [hops, setHops] = useState(initialHops);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (initialFocus !== undefined) setFocusId(initialFocus);
    if (initialScope !== undefined) setScope(initialScope);
    setHops(initialHops);
  }, [initialFocus, initialScope, initialHops]);
  const update = (
    patch: Partial<{ scope: string; focus: string; hops: number }>,
  ) => {
    const next = { scope, focus: focusId, hops, ...patch };
    setScope(next.scope);
    setFocusId(next.focus);
    setHops(next.hops);
    onStateChange?.(next);
  };
  const graphIndex = useMemo(
    () => buildKnowledgeGraphIndex(snapshot.library, snapshot.wikiLinks ?? []),
    [snapshot.library, snapshot.wikiLinks],
  );
  const { documents } = graphIndex;
  const focus =
    graphIndex.documentsById.get(focusId) ??
    graphIndex.documentsBySpaceId.get(currentSpaceId ?? "")?.[0] ??
    documents[0];
  const projectDocuments = useMemo(
    () =>
      new Set(
        scope === "project"
          ? scopedKnowledgeDocuments({
              ...snapshot,
              projectId,
              workspaceFallback: false,
            }).map((entry) => entry.id)
          : [],
      ),
    [snapshot, projectId, scope],
  );
  const neighbors = knowledgeNeighborhood(graphIndex, focus?.id ?? "", hops);
  const candidates =
    scope === "local"
      ? [...neighbors].flatMap((id) => {
          const entry = graphIndex.documentsById.get(id);
          return entry ? [entry] : [];
        })
      : scope === "space"
        ? (graphIndex.documentsBySpaceId.get(
            currentSpaceId ?? focus?.spaceId ?? "",
          ) ?? [])
        : documents;
  const visible = candidates.filter(
    (entry) =>
      (graphIndex.neighborsByDocumentId.has(entry.id) ||
        entry.id === focus?.id) &&
      (scope === "project"
        ? projectDocuments.has(entry.id)
        : scope === "workspace" || scope === "space"
          ? scope === "workspace" ||
            entry.spaceId === (currentSpaceId ?? focus?.spaceId)
          : neighbors.has(entry.id)),
  );
  const ids = new Set(visible.map((entry) => entry.id));
  const edges = visible
    .flatMap((entry) => graphIndex.outgoingByDocumentId.get(entry.id) ?? [])
    .filter(
      (link) =>
        link.targetDocumentId &&
        ids.has(link.sourceDocumentId) &&
        ids.has(link.targetDocumentId),
    )
    .map((link, index) => ({
      id: String(index),
      source: link.sourceDocumentId,
      target: link.targetDocumentId!,
    }));
  const layoutKey = `${collectionRevision(snapshot.library)}:${snapshot.wikiLinks ? collectionRevision(snapshot.wikiLinks) : 0}:${collectionRevision(snapshot.items)}:${collectionRevision(snapshot.projectMaterials)}:${scope}:${focus?.id}:${hops}:${currentSpaceId}:${projectId}`;
  const positions = useStructuralLayout(
    [...ids],
    edges,
    knowledgeForceLayout,
    layoutKey,
  );
  const positionsById = new Map(
    positions.map((position) => [position.id, position.position]),
  );
  const nodes: Node[] = [];
  if (scope === "local") {
    nodes.push(
      ...visible.map((entry) => ({
        id: entry.id,
        data: { label: entry.title },
        position: positionsById.get(entry.id)!,
      })),
    );
  } else {
    const visibleBySpaceId = new Map<string | null, typeof visible>();
    for (const entry of visible) {
      const group = visibleBySpaceId.get(entry.spaceId) ?? [];
      group.push(entry);
      visibleBySpaceId.set(entry.spaceId, group);
    }
    const spaces = [...visibleBySpaceId.keys()];
    const clusterRowHeight = Math.max(
      440,
      ...[...visibleBySpaceId.values()].map(
        (group) => Math.ceil(group.length / 2) * 100 + 120,
      ),
    );
    for (const [spaceIndex, spaceId] of spaces.entries()) {
      const children = visibleBySpaceId.get(spaceId)!;
      const groupId = "space-cluster:" + spaceId;
      nodes.push({
        id: groupId,
        type: "spaceCluster",
        data: {
          label: graphIndex.spaceById.get(spaceId ?? "")?.title ?? "",
        },
        position: {
          x: (spaceIndex % 2) * 580,
          y: Math.floor(spaceIndex / 2) * clusterRowHeight,
        },
        style: {
          width: 540,
          height: Math.max(220, Math.ceil(children.length / 2) * 100 + 60),
          background: "var(--surface-alt, #f3f4f6)",
          borderRadius: 12,
        },
        selectable: false,
      });
      children.forEach((entry, index) =>
        nodes.push({
          id: entry.id,
          parentId: groupId,
          extent: "parent",
          data: { label: entry.title },
          position: {
            x: 30 + (index % 2) * 250,
            y: 50 + Math.floor(index / 2) * 100,
          },
        }),
      );
    }
  }
  return (
    <section className="graph-section">
      <GraphViewport
        layoutKey={layoutKey}
        workspace={workspace}
        selectionId={selectionId}
        inspector={inspector}
        onSelect={(id) => {
          if (ids.has(id)) onSelect?.({ kind: "DOCUMENT", id });
        }}
        onWorkspace={
          workspace
            ? undefined
            : () => {
                if (projectId)
                  openGraph({
                    kind: "project",
                    id: projectId,
                    mode: "knowledge",
                    scope,
                    focus: focus?.id ?? "",
                    hops,
                  });
                else if (focus)
                  openGraph({
                    kind: "document",
                    id: focus.id,
                    mode: "knowledge",
                    scope,
                    focus: focus.id,
                    hops,
                  });
              }
        }
        toolbar={
          <>
            <div className="action-row">
              <input
                aria-label={zh ? "图谱搜索" : "Graph search"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {(["local", "space", "project", "workspace"] as const).map(
                (value) => (
                  <Button
                    type="button"
                    className="chip"
                    aria-pressed={scope === value}
                    key={value}
                    onClick={() => update({ scope: value })}
                  >
                    {zh
                      ? {
                          local: "局部",
                          space: "空间",
                          project: "项目",
                          workspace: "工作区",
                        }[value]
                      : value}
                  </Button>
                ),
              )}
              <Button
                type="button"
                className="chip"
                onClick={() => update({ hops: hops === 1 ? 2 : 1 })}
              >
                {hops === 1
                  ? text("直接关系", "Direct relations")
                  : text("扩展两层", "Expand two levels")}
              </Button>
            </div>
            {query && (
              <div
                role="listbox"
                aria-label={zh ? "图谱搜索结果" : "Graph search results"}
              >
                {documents
                  .filter((entry) =>
                    entry.title
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()),
                  )
                  .map((entry) => (
                    <Button
                      variant="ghost"
                      type="button"
                      role="option"
                      aria-selected={entry.id === focusId}
                      className="text-button"
                      key={entry.id}
                      onClick={() => {
                        update({ focus: entry.id, scope: "local" });
                        setQuery("");
                      }}
                    >
                      {entry.title} ·{" "}
                      {
                        snapshot.library.find(
                          (space) => space.id === entry.spaceId,
                        )?.title
                      }
                      {" / "}
                      {graphIndex.hierarchyPathByDocumentId.get(entry.id)}
                    </Button>
                  ))}
              </div>
            )}
          </>
        }
        nodes={nodes}
        edges={edges}
        onOpen={(id) => {
          if (ids.has(id)) onOpen({ kind: "DOCUMENT", id });
        }}
      />
    </section>
  );
}
