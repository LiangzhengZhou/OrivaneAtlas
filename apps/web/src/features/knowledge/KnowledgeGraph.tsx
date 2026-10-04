import {
  type EntityRef,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { GraphViewport } from "../graph/GraphViewport";
import { openGraph } from "../graph/graph-route";
import { knowledgeForceLayout } from "../graph/layouts/KnowledgeForceLayout";
import { useStructuralLayout } from "../graph/layouts/useStructuralLayout";
import { hierarchyPath } from "../hierarchy/hierarchy";

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
  const entriesById = useMemo(
    () => new Map(snapshot.library.map((e) => [e.id, e])),
    [snapshot.library],
  );
  const documents = snapshot.library.filter(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      !entry.deletedAt &&
      !!entriesById.get(entry.spaceId ?? "") &&
      !entriesById.get(entry.spaceId ?? "")?.deletedAt,
  );
  const focus =
    documents.find((entry) => entry.id === focusId) ??
    documents.find((entry) => entry.spaceId === currentSpaceId) ??
    documents[0];
  const projectDocuments = new Set(
    scopedKnowledgeDocuments({
      ...snapshot,
      projectId,
      workspaceFallback: false,
    }).map((entry) => entry.id),
  );
  const links = snapshot.wikiLinks ?? [];
  const connected = new Set(
    links.flatMap((link) =>
      link.targetDocumentId
        ? [link.sourceDocumentId, link.targetDocumentId]
        : [],
    ),
  );
  const neighbors = new Set(focus ? [focus.id] : []);
  for (let hop = 0; hop < hops; hop++) {
    const frontier = new Set(neighbors);
    for (const link of links) {
      if (
        link.targetDocumentId &&
        (frontier.has(link.sourceDocumentId) ||
          frontier.has(link.targetDocumentId))
      ) {
        neighbors.add(link.sourceDocumentId);
        neighbors.add(link.targetDocumentId);
      }
    }
  }
  const visible = documents.filter(
    (entry) =>
      (connected.has(entry.id) || entry.id === focus?.id) &&
      (scope === "project"
        ? projectDocuments.has(entry.id)
        : scope === "workspace" || scope === "space"
          ? scope === "workspace" ||
            entry.spaceId === (currentSpaceId ?? focus?.spaceId)
          : neighbors.has(entry.id)),
  );
  const ids = new Set(visible.map((entry) => entry.id));
  const edges = links
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
  const positions = useStructuralLayout([...ids], edges, knowledgeForceLayout);
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
    const spaces = [...new Set(visible.map((entry) => entry.spaceId))];
    for (const [spaceIndex, spaceId] of spaces.entries()) {
      const children = visible.filter((entry) => entry.spaceId === spaceId);
      const groupId = "space-cluster:" + spaceId;
      nodes.push({
        id: groupId,
        type: "spaceCluster",
        data: {
          label:
            snapshot.library.find((entry) => entry.id === spaceId)?.title ?? "",
        },
        position: {
          x: (spaceIndex % 2) * 580,
          y:
            Math.floor(spaceIndex / 2) *
            Math.max(
              440,
              ...spaces.map(
                (id) =>
                  Math.ceil(
                    visible.filter((entry) => entry.spaceId === id).length / 2,
                  ) *
                    100 +
                  120,
              ),
            ),
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
                  <button
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
                  </button>
                ),
              )}
              <button
                type="button"
                className="chip"
                onClick={() => update({ hops: hops === 1 ? 2 : 1 })}
              >
                {hops} hop
              </button>
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
                    <button
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
                      {hierarchyPath(
                        documents.map((document) => ({
                          id: document.id,
                          title: document.title,
                          parentId: document.parentDocumentId ?? null,
                        })),
                        entry.id,
                      )
                        .map((ancestor) => ancestor.title)
                        .join(" / ")}
                    </button>
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
