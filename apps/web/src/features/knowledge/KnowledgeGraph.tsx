import {
  type EntityRef,
  scopedKnowledgeDocuments,
} from "@arclattice/application";
import type { Node } from "@xyflow/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Snapshot } from "../../bootstrap";
import { GraphViewport } from "../graph/GraphViewport";
import { knowledgeForceLayout } from "../graph/layouts/KnowledgeForceLayout";
import { hierarchyPath } from "../hierarchy/hierarchy";

export function KnowledgeGraph({
  snapshot,
  onOpen,
  documentId,
  projectId,
  currentSpaceId,
}: {
  snapshot: Snapshot;
  onOpen(ref: EntityRef): void;
  documentId?: string;
  projectId?: string;
  currentSpaceId?: string | undefined;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [scope, setScope] = useState(
    documentId
      ? "local"
      : projectId
        ? "project"
        : currentSpaceId
          ? "space"
          : "workspace",
  );
  const [focusId, setFocusId] = useState(documentId ?? "");
  const [hops, setHops] = useState(1);
  const [query, setQuery] = useState("");
  const documents = snapshot.library.filter(
    (entry) =>
      entry.kind === "DOCUMENT" &&
      !entry.deletedAt &&
      snapshot.library.some(
        (space) => space.id === entry.spaceId && !space.deletedAt,
      ),
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
      (scope !== "local" || connected.has(entry.id)) &&
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
  const positions = knowledgeForceLayout([...ids], edges);
  const nodes: Node[] = [];
  if (scope === "local") {
    nodes.push(
      ...visible.map((entry) => ({
        id: entry.id,
        data: { label: entry.title },
        position: positions.find((position) => position.id === entry.id)!
          .position,
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
      <div className="action-row">
        <input
          aria-label={zh ? "图谱搜索" : "Graph search"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {(["local", "space", "project", "workspace"] as const).map((value) => (
          <button
            type="button"
            className="chip"
            aria-pressed={scope === value}
            key={value}
            onClick={() => setScope(value)}
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
        ))}
        <button
          type="button"
          className="chip"
          onClick={() => setHops(hops === 1 ? 2 : 1)}
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
                  setFocusId(entry.id);
                  setQuery("");
                }}
              >
                {entry.title} ·{" "}
                {
                  snapshot.library.find((space) => space.id === entry.spaceId)
                    ?.title
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
      <GraphViewport
        nodes={nodes}
        edges={edges}
        onOpen={(id) => {
          if (ids.has(id)) onOpen({ kind: "DOCUMENT", id });
        }}
      />
    </section>
  );
}
